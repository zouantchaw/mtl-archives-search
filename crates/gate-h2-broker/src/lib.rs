#![forbid(unsafe_op_in_unsafe_fn)]

pub mod broker;
pub mod credential;
pub mod enrollment;
pub mod evidence;
pub mod handoff;
pub mod launcher;
pub mod model;
pub mod network;
pub mod policy;
pub mod stage;
pub mod supervisor;
pub mod uds;

pub use broker::{Broker, BrokerConfig, ExchangeError};
pub use network::{NetworkFailure, ProductionNetworkClient};

pub const PROTOCOL_VERSION: &str = "gate_h2_https_exchange_uds_v1.0.0";
pub const EVENT_VERSION: &str = "gate_h2_https_broker_event_v1.0.0";
pub const TRANSCRIPT_VERSION: &str = "gate_h2_https_broker_transcript_v1.0.0";

#[cfg(test)]
mod production_tests;
