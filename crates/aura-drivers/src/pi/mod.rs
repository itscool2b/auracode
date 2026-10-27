//! Native Pi 1.x RPC adapter.
mod metadata;
mod session;
#[cfg(test)]
mod tests;
pub mod translate;
mod ui;
pub mod wire;

use crate::driver::{AgentDriver, DriverContext, DriverExit};
use futures::{FutureExt, future::BoxFuture};
#[derive(Debug, Default)]
pub struct PiDriver;
impl PiDriver {
    pub fn new() -> Self {
        Self
    }
}
impl AgentDriver for PiDriver {
    fn run(self: Box<Self>, ctx: DriverContext) -> BoxFuture<'static, DriverExit> {
        session::run(ctx).boxed()
    }
}
