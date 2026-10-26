//! Only display fields cross from native model/configuration responses into the product.
use super::wire::text;
use crate::acp::{
    map::{hex, reduce_commands},
    options::truncate,
    wire::CommandEntry,
};
use aura_protocol::session::{ConfigCategory, ConfigChoice, ConfigKind, ConfigOption, ConfigValue};
use aura_protocol::{Cost, SlashCommand, TokenUsage, UsageInfo, UsageScope};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const MAX_MODELS: usize = 500;
const LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Model {
    pub provider: String,
    pub id: String,
    pub name: String,
}
impl Model {
    pub fn parse(value: &Value) -> Option<Self> {
        let provider = text(value, "provider")?;
        let id = text(value, "id")?;
        if provider.len() > 1024 || id.len() > 1024 {
            return None;
        }
        Some(Self {
            provider: provider.into(),
            id: id.into(),
            name: truncate(text(value, "name").unwrap_or(id), 100),
        })
    }
    pub fn key(&self) -> String {
        // Separating with a JSON tuple avoids collisions when provider/model contain slashes.
        format!(
            "pi-model-{}",
            hex(&Sha256::digest(json!([self.provider, self.id]).to_string()))
        )
    }
}

#[derive(Debug, Default)]
pub struct Metadata {
    pub models: BTreeMap<String, Model>,
    pub model: Option<Model>,
    pub level: Option<String>,
    pub levels: Vec<String>,
    pub auto_compaction: Option<bool>,
}
impl Metadata {
    pub fn models(&mut self, data: &Value) -> bool {
        let Some(models) = data["models"].as_array() else {
            return false;
        };
        self.models = models
            .iter()
            .filter_map(Model::parse)
            .take(MAX_MODELS)
            .map(|m| (m.key(), m))
            .collect();
        true
    }
    pub fn levels(&mut self, data: &Value) -> bool {
        let Some(levels) = data["levels"].as_array() else {
            return false;
        };
        self.levels = LEVELS
            .iter()
            .filter(|s| levels.iter().any(|v| v.as_str() == Some(**s)))
            .map(|s| (*s).into())
            .collect();
        true
    }
    pub fn state(&mut self, state: &Value) {
        self.model = Model::parse(&state["model"]);
        self.level = text(state, "thinkingLevel")
            .filter(|s| LEVELS.contains(s))
            .map(str::to_owned);
        self.auto_compaction = state["autoCompactionEnabled"].as_bool();
    }
    pub fn options(&self) -> Vec<ConfigOption> {
        let mut options = Vec::new();
        if let Some(current) = &self.model {
            let mut models = self.models.clone();
            models.insert(current.key(), current.clone());
            options.push(select(
                "model",
                "Model",
                ConfigCategory::Model,
                current.key(),
                models
                    .into_iter()
                    .map(|(key, model)| ConfigChoice {
                        value: key,
                        name: model.name,
                        description: None,
                        group: Some(truncate(&model.provider, 100)),
                    })
                    .collect(),
            ));
        }
        if let Some(current) = &self.level {
            let mut levels = self.levels.clone();
            if !levels.contains(current) {
                levels.push(current.clone());
            }
            options.push(select(
                "effort",
                "Thinking",
                ConfigCategory::Effort,
                current.clone(),
                levels
                    .into_iter()
                    .map(|level| ConfigChoice {
                        name: level.clone(),
                        value: level,
                        description: None,
                        group: None,
                    })
                    .collect(),
            ));
        }
        if let Some(current) = self.auto_compaction {
            options.push(ConfigOption {
                id: "auto_compaction".into(),
                name: "Auto compaction".into(),
                description: Some("Automatically compact context when needed.".into()),
                category: ConfigCategory::ModelConfig,
                kind: ConfigKind::Toggle { current },
                pending: None,
            });
        }
        options
    }
    pub fn request(&self, id: &str, value: &ConfigValue) -> Option<Value> {
        match (id, value) {
            ("model", ConfigValue::Choice { value }) => {
                let model = self
                    .models
                    .get(value)
                    .or_else(|| self.model.as_ref().filter(|m| m.key() == *value))?;
                Some(json!({"type":"set_model","provider":model.provider,"modelId":model.id}))
            }
            ("effort", ConfigValue::Choice { value }) if self.levels.contains(value) => {
                Some(json!({"type":"set_thinking_level","level":value}))
            }
            ("auto_compaction", ConfigValue::Toggle { value })
                if self.auto_compaction.is_some() =>
            {
                Some(json!({"type":"set_auto_compaction","enabled":value}))
            }
            _ => None,
        }
    }
}
fn select(
    id: &str,
    name: &str,
    category: ConfigCategory,
    current: String,
    choices: Vec<ConfigChoice>,
) -> ConfigOption {
    ConfigOption {
        id: id.into(),
        name: name.into(),
        description: None,
        category,
        kind: ConfigKind::Select { current, choices },
        pending: None,
    }
}

pub fn commands(value: &Value) -> Vec<SlashCommand> {
    reduce_commands(
        value["commands"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| {
                Some(CommandEntry {
                    name: text(c, "name")?.into(),
                    description: c["description"].as_str().unwrap_or_default().into(),
                    hint: None,
                })
            })
            .collect(),
    )
}

/// Context occupancy may explicitly become unknown after compaction. Do not substitute cumulative
/// session token counts for occupancy or preserve an outdated pre-compaction count.
pub fn usage(value: &Value) -> UsageInfo {
    UsageInfo {
        context_used: value["contextUsage"]["tokens"].as_u64(),
        context_size: value["contextUsage"]["contextWindow"]
            .as_u64()
            .filter(|n| *n > 0),
        cost: value["cost"]
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .map(|amount| Cost {
                amount,
                currency: "USD".into(),
            }),
    }
}
pub fn tokens(value: &Value, scope: UsageScope) -> Option<TokenUsage> {
    Some(TokenUsage {
        input_tokens: value["input"].as_u64()?,
        output_tokens: value["output"].as_u64()?,
        cache_read_tokens: value["cacheRead"].as_u64(),
        cache_write_tokens: value["cacheWrite"].as_u64(),
        reasoning_tokens: None,
        scope,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_choices_keep_current_valid_and_never_export_auth_or_source_fields() {
        let mut m = Metadata::default();
        m.models(&json!({"models":[{"id":"m","provider":"p","name":"Model","apiKey":"secret","baseUrl":"private"}]}));
        m.state(&json!({"model":{"provider":"custom","id":"current"},"thinkingLevel":"off","autoCompactionEnabled":true}));
        for option in m.options() {
            if let ConfigKind::Select { current, choices } = option.kind {
                assert!(choices.iter().any(|c| c.value == current));
            }
        }
        let rendered = serde_json::to_string(&m.options()).unwrap();
        assert!(!rendered.contains("secret") && !rendered.contains("private"));
        let key = m.models.keys().next().unwrap().clone();
        assert_eq!(
            m.request("model", &ConfigValue::Choice { value: key }),
            Some(json!({"type":"set_model","provider":"p","modelId":"m"}))
        );
        assert!(
            m.request(
                "effort",
                &ConfigValue::Choice {
                    value: "high".into()
                }
            )
            .is_none()
        );
    }
    #[test]
    fn context_is_occupancy_and_null_clears_it_without_inventing_tokens() {
        let data = json!({"tokens":{"input":9000,"output":20,"cacheRead":10,"cacheWrite":4},
            "cost":0.02,"contextUsage":{"tokens":null,"contextWindow":100000}});
        assert_eq!(usage(&data).context_used, None);
        assert_eq!(usage(&data).context_size, Some(100000));
        assert_eq!(
            tokens(&data["tokens"], UsageScope::Session).unwrap().scope,
            UsageScope::Session
        );
    }
}
