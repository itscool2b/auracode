//! Agent installations and execution hosts. A provider, host and launch path are separate identities.
use serde::{Deserialize, Serialize};
use specta::Type;

/// Where the user's agent runs. Unknown future hosts must never fall back to a local launch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentHost {
    #[default]
    Native,
    Wsl {
        distro: String,
    },
    Unsupported,
}

impl<'de> Deserialize<'de> for AgentHost {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "type", rename_all = "snake_case")]
        enum Wire {
            Native,
            Wsl {
                distro: String,
            },
            #[serde(other)]
            Unsupported,
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Native => Self::Native,
            Wire::Wsl { distro } => Self::Wsl { distro },
            Wire::Unsupported => Self::Unsupported,
        })
    }
}

/// How the installed binary is managed. Unknown and bundled installations cannot be updated here.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InstallChannel {
    VendorStandalone,
    Npm {
        package: String,
    },
    Homebrew {
        formula: String,
    },
    Bundled {
        application: String,
    },
    #[default]
    Unknown,
}

impl<'de> Deserialize<'de> for InstallChannel {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "type", rename_all = "snake_case")]
        enum Wire {
            VendorStandalone,
            Npm {
                package: String,
            },
            Homebrew {
                formula: String,
            },
            Bundled {
                application: String,
            },
            #[serde(other)]
            Unknown,
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::VendorStandalone => Self::VendorStandalone,
            Wire::Npm { package } => Self::Npm { package },
            Wire::Homebrew { formula } => Self::Homebrew { formula },
            Wire::Bundled { application } => Self::Bundled { application },
            Wire::Unknown => Self::Unknown,
        })
    }
}

/// Evidence about this exact installed version, independent of whether its binary can start.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum VersionVerification {
    Verified {
        version: String,
        scope: String,
    },
    Untested {
        last_verified: Option<String>,
    },
    #[default]
    Unknown,
}

/// A successful version probe of one installation. `launch_path` remains the stable user entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AgentInstallation {
    pub agent_id: String,
    pub provider: String,
    pub host: AgentHost,
    pub launch_path: String,
    pub resolved_path: Option<String>,
    pub version: String,
    pub channel: InstallChannel,
    pub verification: VersionVerification,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_hosts_never_become_native() {
        assert_eq!(
            serde_json::from_value::<AgentHost>(json!({"type":"remote","host":"example"})).unwrap(),
            AgentHost::Unsupported
        );
        assert_eq!(
            serde_json::to_value(AgentHost::Wsl {
                distro: "Ubuntu".into()
            })
            .unwrap(),
            json!({"type":"wsl","distro":"Ubuntu"})
        );
    }
}
