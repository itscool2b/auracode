use crate::policy::{ApiError, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;
use wasm_bindgen::JsValue;
use worker::{D1Database, D1PreparedStatement};

pub struct Db(pub D1Database);
impl Db {
    fn statement(&self, sql: &str, args: Vec<Value>) -> Result<D1PreparedStatement> {
        let values = args
            .into_iter()
            .map(|value| match value {
                Value::Null => Ok(JsValue::NULL),
                Value::String(text) => Ok(JsValue::from_str(&text)),
                Value::Bool(value) => Ok(JsValue::from_f64(if value { 1.0 } else { 0.0 })),
                Value::Number(number) => number
                    .as_f64()
                    .map(JsValue::from_f64)
                    .ok_or(ApiError::InvalidRequest),
                _ => Err(ApiError::InvalidRequest),
            })
            .collect::<Result<Vec<_>>>()?;
        self.0.prepare(sql).bind(&values).map_err(map_error)
    }
    pub async fn all<T: DeserializeOwned>(&self, sql: &str, args: Vec<Value>) -> Result<Vec<T>> {
        self.statement(sql, args)?
            .all()
            .await
            .map_err(map_error)?
            .results()
            .map_err(map_error)
    }
    pub async fn first<T: DeserializeOwned>(
        &self,
        sql: &str,
        args: Vec<Value>,
    ) -> Result<Option<T>> {
        self.statement(sql, args)?
            .first(None)
            .await
            .map_err(map_error)
    }
    pub async fn run(&self, sql: &str, args: Vec<Value>) -> Result<()> {
        self.statement(sql, args)?.run().await.map_err(map_error)?;
        Ok(())
    }
    pub async fn batch(&self, items: Vec<(&str, Vec<Value>)>) -> Result<()> {
        let statements = items
            .into_iter()
            .map(|(sql, args)| self.statement(sql, args))
            .collect::<Result<Vec<_>>>()?;
        self.0.batch(statements).await.map_err(map_error)?;
        Ok(())
    }
}
fn map_error(error: worker::Error) -> ApiError {
    // Match only our fixed trigger errors. Never send database/provider error text to the client.
    let text = error.to_string();
    if text.contains("sync_quota") || text.contains("blob_quota") {
        ApiError::Quota
    } else {
        ApiError::Unavailable
    }
}
