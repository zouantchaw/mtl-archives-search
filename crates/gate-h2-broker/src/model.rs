use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: String,
    pub schema_pin: SchemaPin,
    pub manifest_id: String,
    pub candidate_id: String,
    pub authorization_version: String,
    pub stage_id: String,
    pub socket_owner: String,
    pub raw_network_policy: String,
    pub exact_exchange_count: usize,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SchemaPin {
    pub sha256: String,
    pub bytes: u64,
    pub schema_version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    pub schema_version: String,
    pub schema_pin: SchemaPin,
    pub capability_id: String,
    pub candidate_id: String,
    pub stage_id: String,
    pub exchange_ordinal: usize,
    pub purpose: String,
    pub protocol_pin: String,
    pub broker_binary: FilePin,
    pub protocol_schema: FilePin,
    pub hostname: String,
    pub port: u16,
    pub path_query: String,
    pub method: Method,
    pub fixed_headers: FixedHeaders,
    pub request_artifact: ArtifactPin,
    pub connect_deadline_ms: u64,
    pub exchange_deadline_ms: u64,
    pub request_byte_cap: u64,
    pub response_byte_cap: u64,
    pub allowed_response_statuses: Vec<u16>,
    pub allowed_response_media_types: Vec<String>,
    pub content_encoding: String,
    pub raw_response_output_role: String,
    pub dns_policy: serde_json::Value,
    pub tls_policy: serde_json::Value,
    pub redirect_policy: String,
    pub retry_policy: String,
    pub auth_policy: AuthPolicy,
    pub replay_policy: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FilePin {
    pub sha256: String,
    pub bytes: u64,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactPin {
    pub artifact_role: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FixedHeaders {
    pub accept: String,
    pub content_type: String,
    pub serialization: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthPolicy {
    pub injection_owner: String,
    pub scheme: AuthScheme,
    pub credential_capability_id: String,
    pub stage_visibility: String,
    pub header_name: Option<String>,
    pub insertion_order: String,
    pub serialization: String,
    pub collision_policy: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthScheme {
    None,
    Bearer,
    ApiKeyHeader,
}

#[derive(Deserialize, Serialize, Zeroize)]
#[zeroize(drop)]
#[serde(deny_unknown_fields)]
pub struct ExchangeRequest {
    pub schema_version: String,
    pub message_type: String,
    pub request_id: String,
    pub run_token: String,
    pub capability_handle: String,
    pub request_artifact_role: String,
    pub request_artifact_sha256: String,
    pub request_artifact_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExchangeResponse {
    pub schema_version: String,
    pub message_type: String,
    pub request_id: String,
    pub outcome: String,
    pub exchange_consumed: bool,
    pub output_artifact: Option<OutputArtifact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputArtifact {
    pub artifact_role: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
    pub status: u16,
}
