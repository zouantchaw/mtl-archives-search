use std::{net::IpAddr, time::Duration};

use thiserror::Error;

pub struct NetworkRequest<'a> {
    pub hostname: &'a str,
    pub port: u16,
    pub method: &'a str,
    pub path_query: &'a str,
    pub headers: Vec<(&'static str, Vec<u8>)>,
    pub body: &'a [u8],
    pub connect_deadline: Duration,
    pub exchange_deadline: Duration,
    pub response_byte_cap: u64,
}

#[derive(Clone, Debug)]
pub struct NetworkObservation {
    pub dns_answers: Vec<IpAddr>,
    pub connected_peer: IpAddr,
    pub tls_version: String,
    pub tls_peer_chain_sha256: String,
    pub alpn: String,
}

#[derive(Clone, Debug)]
pub struct NetworkResponse {
    pub observation: NetworkObservation,
    pub status: u16,
    pub media_type: String,
    pub content_encoding: Option<String>,
    pub content_length: Option<u64>,
    pub transfer_encoding: Option<String>,
    pub location: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Error)]
pub enum NetworkFailure {
    #[error("dns policy failure")]
    DnsForbidden,
    #[error("connected peer mismatch")]
    DnsRebinding,
    #[error("TLS verification failure")]
    Tls,
    #[error("deadline exceeded")]
    Deadline,
    #[error("response framing failure")]
    Framing,
    #[error("response exceeded byte cap")]
    Overflow,
    #[error("production TLS transport is unavailable in this build")]
    ProductionTransportUnavailable,
}

pub trait NetworkClient: Send + Sync {
    fn exchange(&self, request: NetworkRequest<'_>) -> Result<NetworkResponse, NetworkFailure>;
}

pub struct ProductionNetworkClient {
    _private: (),
}

impl ProductionNetworkClient {
    pub fn new() -> Result<Self, NetworkFailure> {
        // Production builds remain fail-closed until the pinned rustls/webpki source bundle
        // and Linux static target are independently reproduced under issue #101.
        Err(NetworkFailure::ProductionTransportUnavailable)
    }
}
