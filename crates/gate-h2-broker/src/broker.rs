use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    sync::Arc,
    time::Duration,
};

use serde_json::json;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::{
    PROTOCOL_VERSION,
    credential::SecretBytes,
    evidence::{Clock, Event, EvidenceWriter, transcript_base},
    model::{AuthScheme, ExchangeRequest, ExchangeResponse, Manifest, OutputArtifact},
    network::{
        AuthHeader, NetworkClient, NetworkFailure, NetworkMilestone, NetworkRequest,
        ProductionNetworkClient,
    },
    policy::validate_manifest,
};

pub struct BrokerConfig {
    pub manifest: Manifest,
    pub expected_uid: u32,
    pub session_id: String,
    pub attempt_id: String,
    pub run_token: SecretBytes,
    pub handles: Vec<String>,
    pub request_bodies: Vec<Vec<u8>>,
    pub credentials: HashMap<String, SecretBytes>,
    pub socket_identity_sha256: String,
    pub output_directory: std::path::PathBuf,
}

#[derive(Debug, Error)]
pub enum ExchangeError {
    #[error("invalid broker configuration")]
    Configuration,
    #[error("request rejected: {0}")]
    Rejected(&'static str),
    #[error("exchange failed closed: {0}")]
    Failed(&'static str),
    #[error("durable evidence failure")]
    Evidence,
}

impl ExchangeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Rejected(code) | Self::Failed(code) => code,
            Self::Configuration | Self::Evidence => "protocol_error",
        }
    }

    fn uds_code(&self) -> &'static str {
        uds_failure_code(self.code())
    }
}

pub struct Broker {
    config: BrokerConfig,
    network: Arc<dyn NetworkClient>,
    clock: Arc<dyn Clock>,
    pub evidence: EvidenceWriter,
    next_ordinal: usize,
    failed_closed: bool,
    started_at: String,
}

impl Broker {
    pub fn new(
        config: BrokerConfig,
        network: ProductionNetworkClient,
        clock: Arc<dyn Clock>,
        evidence: EvidenceWriter,
    ) -> Result<Self, ExchangeError> {
        Self::new_inner(config, Arc::new(network), clock, evidence)
    }

    fn new_inner(
        config: BrokerConfig,
        network: Arc<dyn NetworkClient>,
        clock: Arc<dyn Clock>,
        evidence: EvidenceWriter,
    ) -> Result<Self, ExchangeError> {
        validate_manifest(&config.manifest).map_err(|_| ExchangeError::Configuration)?;
        if config.run_token.expose().len() != 43
            || !config
                .run_token
                .expose()
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
        {
            return Err(ExchangeError::Configuration);
        }
        if config.socket_identity_sha256
            != socket_identity_commitment(
                &config.session_id,
                &config.attempt_id,
                &config.manifest.manifest_id,
                config.expected_uid,
            )
        {
            return Err(ExchangeError::Configuration);
        }
        if config.handles.len() != config.manifest.exact_exchange_count
            || config.request_bodies.len() != config.manifest.exact_exchange_count
            || config.session_id.is_empty()
            || config.attempt_id.is_empty()
        {
            return Err(ExchangeError::Configuration);
        }
        let mut handles = HashSet::new();
        if config.handles.iter().any(|handle| {
            !(36..=90).contains(&handle.len())
                || !handle.starts_with("h2h_")
                || !handle[4..]
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
                || !handles.insert(handle)
        }) {
            return Err(ExchangeError::Configuration);
        }
        for (index, body) in config.request_bodies.iter().enumerate() {
            let pin = &config.manifest.capabilities[index].request_artifact;
            if body.len() as u64 != pin.bytes || hex::encode(Sha256::digest(body)) != pin.sha256 {
                return Err(ExchangeError::Configuration);
            }
            let capability = &config.manifest.capabilities[index];
            if capability.auth_policy.scheme != AuthScheme::None
                && !config
                    .credentials
                    .contains_key(&capability.auth_policy.credential_capability_id)
            {
                return Err(ExchangeError::Configuration);
            }
        }
        let started_at = clock.now();
        Ok(Self {
            config,
            network,
            clock,
            evidence,
            next_ordinal: 0,
            failed_closed: false,
            started_at,
        })
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(
        config: BrokerConfig,
        network: Arc<dyn NetworkClient>,
        clock: Arc<dyn Clock>,
        evidence: EvidenceWriter,
    ) -> Result<Self, ExchangeError> {
        Self::new_inner(config, network, clock, evidence)
    }

    pub fn expected_uid(&self) -> u32 {
        self.config.expected_uid
    }
    #[cfg(test)]
    pub(crate) fn manifest(&self) -> &Manifest {
        &self.config.manifest
    }
    pub fn is_terminal(&self) -> bool {
        self.failed_closed || self.next_ordinal == self.config.manifest.exact_exchange_count
    }
    pub fn exchange(
        &mut self,
        capability_id: &str,
        request: ExchangeRequest,
    ) -> Result<ExchangeResponse, ExchangeError> {
        let request_id = request.request_id.clone();
        let ordinal_before = self.next_ordinal;
        let result = self.exchange_inner(capability_id, &request);
        let consumed = self.next_ordinal > ordinal_before;
        match result {
            Ok(output) => Ok(ExchangeResponse {
                schema_version: PROTOCOL_VERSION.into(),
                message_type: "exchange_response".into(),
                request_id,
                outcome: "accepted".into(),
                exchange_consumed: consumed,
                output_artifact: Some(output),
                failure_code: None,
            }),
            Err(ExchangeError::Evidence) => Err(ExchangeError::Evidence),
            Err(error) if consumed => {
                let outcome = if matches!(error, ExchangeError::Rejected(_)) {
                    "rejected"
                } else {
                    "failed_closed"
                };
                Ok(ExchangeResponse {
                    schema_version: PROTOCOL_VERSION.into(),
                    message_type: "exchange_response".into(),
                    request_id,
                    outcome: outcome.into(),
                    exchange_consumed: consumed,
                    output_artifact: None,
                    failure_code: Some(error.uds_code().into()),
                })
            }
            Err(error) => Err(error),
        }
    }

    fn exchange_inner(
        &mut self,
        capability_id: &str,
        r: &ExchangeRequest,
    ) -> Result<OutputArtifact, ExchangeError> {
        if self.failed_closed {
            return Err(ExchangeError::Rejected("replay"));
        }
        if self.next_ordinal >= self.config.manifest.capabilities.len() {
            return Err(ExchangeError::Rejected("replay"));
        }
        let ordinal = self.next_ordinal;
        let c = self.config.manifest.capabilities[ordinal].clone();
        self.next_ordinal += 1;
        self.append(ordinal, "handle_consumed", "accepted", json!({"request_sha256":c.request_artifact.sha256,"request_bytes":c.request_artifact.bytes}))?;
        if r.schema_version != PROTOCOL_VERSION
            || r.message_type != "exchange_request"
            || r.request_id.len() != 32
            || !r
                .request_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            self.terminal_failure("protocol_error", ordinal)?;
            return Err(ExchangeError::Rejected("protocol_error"));
        }
        if r.run_token.len() != 43
            || !r
                .run_token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            self.terminal_failure("invalid_token", ordinal)?;
            return Err(ExchangeError::Rejected("invalid_token"));
        }
        let supplied = Sha256::digest(r.run_token.as_bytes());
        let expected = Sha256::digest(self.config.run_token.expose());
        if supplied.ct_eq(&expected).unwrap_u8() != 1 {
            self.terminal_failure("invalid_token", ordinal)?;
            return Err(ExchangeError::Rejected("invalid_token"));
        }
        if r.capability_handle != self.config.handles[ordinal] {
            let code = if self
                .config
                .handles
                .iter()
                .take(ordinal)
                .any(|h| h == &r.capability_handle)
            {
                "replay"
            } else if self
                .config
                .handles
                .iter()
                .skip(ordinal + 1)
                .any(|h| h == &r.capability_handle)
            {
                "out_of_order"
            } else {
                "invalid_handle"
            };
            self.terminal_failure(code, ordinal)?;
            return Err(ExchangeError::Rejected(code));
        }
        if capability_id != c.capability_id {
            self.terminal_failure("invalid_handle", ordinal)?;
            return Err(ExchangeError::Rejected("invalid_handle"));
        }
        if r.request_artifact_role != c.request_artifact.artifact_role
            || r.request_artifact_sha256 != c.request_artifact.sha256
            || r.request_artifact_bytes != c.request_artifact.bytes
        {
            self.terminal_failure("request_artifact_mismatch", ordinal)?;
            return Err(ExchangeError::Rejected("request_artifact_mismatch"));
        }
        let auth = match c.auth_policy.scheme {
            AuthScheme::None => None,
            AuthScheme::Bearer => Some(AuthHeader::Bearer(
                self.config
                    .credentials
                    .get(&c.auth_policy.credential_capability_id)
                    .ok_or(ExchangeError::Configuration)?,
            )),
            AuthScheme::ApiKeyHeader => Some(AuthHeader::ApiKey(
                self.config
                    .credentials
                    .get(&c.auth_policy.credential_capability_id)
                    .ok_or(ExchangeError::Configuration)?,
            )),
        };
        let body = &self.config.request_bodies[ordinal];
        let request = NetworkRequest {
            hostname: &c.hostname,
            port: c.port,
            method: c.method.as_str(),
            path_query: &c.path_query,
            auth,
            body,
            connect_deadline: Duration::from_millis(c.connect_deadline_ms),
            exchange_deadline: Duration::from_millis(c.exchange_deadline_ms),
            response_byte_cap: c.response_byte_cap,
        };
        let network = Arc::clone(&self.network);
        let manifest_id = self.config.manifest.manifest_id.clone();
        let candidate_id = self.config.manifest.candidate_id.clone();
        let stage_id = self.config.manifest.stage_id.clone();
        let capability_id = c.capability_id.clone();
        let event_schema_pin = self.evidence.event_schema_pin.clone();
        let request_sha256 = c.request_artifact.sha256.clone();
        let request_bytes = c.request_artifact.bytes;
        let evidence = &mut self.evidence;
        let clock = Arc::clone(&self.clock);
        let mut milestone_evidence_failed = false;
        let mut milestone = |milestone: NetworkMilestone| {
            if milestone_evidence_failed {
                return Err(NetworkFailure::Evidence);
            }
            let (event_type, event_evidence) = match milestone {
                NetworkMilestone::DnsResolved {
                    dns_answers,
                    connection_target,
                } => (
                    "dns_resolved",
                    json!({
                        "dns_answer_set_sha256": hash_addresses(&dns_answers),
                        "connected_ip_commitment": hex::encode(Sha256::digest(connection_target.to_string())),
                    }),
                ),
                NetworkMilestone::TlsVerified {
                    tls_peer_chain_sha256,
                } => (
                    "tls_verified",
                    json!({"tls_peer_chain_sha256":tls_peer_chain_sha256,"tls_version":"TLSv1.3"}),
                ),
                NetworkMilestone::RequestSent => (
                    "request_sent",
                    json!({"request_sha256":request_sha256,"request_bytes":request_bytes}),
                ),
            };
            let event = Event {
                schema_version: crate::EVENT_VERSION,
                schema_pin: event_schema_pin.clone(),
                event_id: String::new(),
                manifest_id: manifest_id.clone(),
                capability_id: capability_id.clone(),
                candidate_id: candidate_id.clone(),
                stage_id: stage_id.clone(),
                exchange_ordinal: ordinal,
                sequence: evidence.events.len(),
                event_type,
                occurred_at: clock.now(),
                outcome: "accepted",
                evidence: event_evidence,
            };
            if evidence.append(event).is_err() {
                milestone_evidence_failed = true;
                return Err(NetworkFailure::Evidence);
            }
            Ok(())
        };
        let network_result = network.exchange(request, &mut milestone);
        if milestone_evidence_failed {
            self.failed_closed = true;
            return Err(ExchangeError::Evidence);
        }
        let response = match network_result {
            Ok(v) => v,
            Err(NetworkFailure::Evidence) => {
                self.failed_closed = true;
                return Err(ExchangeError::Evidence);
            }
            Err(e) => {
                let code = network_code(e);
                self.terminal_failure(code, ordinal)?;
                return Err(ExchangeError::Failed(code));
            }
        };
        let failure = if response.location.is_some() || (300..400).contains(&response.status) {
            Some("redirect_forbidden")
        } else if response
            .content_encoding
            .as_deref()
            .is_some_and(|v| v != "identity")
            || response.transfer_encoding.is_some()
            || response.content_length.is_none()
            || response.content_length != Some(response.body.len() as u64)
        {
            Some("protocol_error")
        } else if !c.allowed_response_statuses.contains(&response.status) {
            Some("response_status_forbidden")
        } else if !c
            .allowed_response_media_types
            .contains(&response.media_type)
        {
            Some("response_type_forbidden")
        } else if response.body.len() as u64 > c.response_byte_cap {
            Some("response_too_large")
        } else {
            None
        };
        if let Some(code) = failure {
            self.terminal_failure(code, ordinal)?;
            return Err(ExchangeError::Failed(code));
        }
        let committed = match crate::evidence::commit_output(
            &self.config.output_directory,
            &c.raw_response_output_role,
            &response.body,
        ) {
            Ok(committed) => committed,
            Err(_) => {
                self.terminal_failure("output_commit_failed", ordinal)?;
                return Err(ExchangeError::Failed("output_commit_failed"));
            }
        };
        self.append(ordinal, "response_committed", "accepted", json!({"response_status":response.status,"response_media_type":"application/json","response_sha256":committed.sha256,"response_bytes":committed.bytes}))?;
        Ok(OutputArtifact {
            artifact_role: c.raw_response_output_role.clone(),
            sha256: committed.sha256,
            bytes: committed.bytes,
            media_type: "application/json".into(),
            status: response.status,
        })
    }

    fn append(
        &mut self,
        ordinal: usize,
        event_type: &'static str,
        outcome: &'static str,
        evidence: serde_json::Value,
    ) -> Result<(), ExchangeError> {
        let c = &self.config.manifest.capabilities[ordinal];
        let event = Event {
            schema_version: crate::EVENT_VERSION,
            schema_pin: self.evidence.event_schema_pin.clone(),
            event_id: String::new(),
            manifest_id: self.config.manifest.manifest_id.clone(),
            capability_id: c.capability_id.clone(),
            candidate_id: self.config.manifest.candidate_id.clone(),
            stage_id: self.config.manifest.stage_id.clone(),
            exchange_ordinal: ordinal,
            sequence: self.evidence.events.len(),
            event_type,
            occurred_at: self.clock.now(),
            outcome,
            evidence,
        };
        if self.evidence.append(event).is_err() {
            self.failed_closed = true;
            return Err(ExchangeError::Evidence);
        }
        Ok(())
    }
    fn fail(&mut self, code: &'static str, ordinal: usize) -> Result<(), ExchangeError> {
        self.append(
            ordinal,
            "exchange_failed",
            "failed_closed",
            json!({"failure_code":code}),
        )
    }

    fn terminal_failure(
        &mut self,
        code: &'static str,
        ordinal: usize,
    ) -> Result<(), ExchangeError> {
        self.failed_closed = true;
        self.fail(code, ordinal)
    }

    pub(crate) fn terminate_protocol_failure(
        &mut self,
        code: &'static str,
    ) -> Result<(), ExchangeError> {
        if self.is_terminal() {
            return Ok(());
        }
        let ordinal = self.next_ordinal;
        let capability = self.config.manifest.capabilities[ordinal].clone();
        self.next_ordinal += 1;
        self.append(
            ordinal,
            "handle_consumed",
            "accepted",
            json!({"request_sha256":capability.request_artifact.sha256,"request_bytes":capability.request_artifact.bytes}),
        )?;
        self.terminal_failure(code, ordinal)
    }

    pub fn seal_transcript(&mut self) -> Result<String, ExchangeError> {
        let (completed, complete) = self.validate_terminal_lifecycle()?;
        let mut transcript = transcript_base(self.evidence.transcript_schema_pin.clone());
        transcript.manifest_id = self.config.manifest.manifest_id.clone();
        transcript.candidate_id = self.config.manifest.candidate_id.clone();
        transcript.stage_id = self.config.manifest.stage_id.clone();
        transcript.run_token_commitment =
            hex::encode(Sha256::digest(self.config.run_token.expose()));
        transcript.socket_identity_sha256 = self.config.socket_identity_sha256.clone();
        transcript.started_at = self.started_at.clone();
        transcript.ended_at = self.clock.now();
        transcript.expected_exchange_count = self.config.manifest.exact_exchange_count;
        transcript.attempted_exchange_count = self.next_ordinal;
        transcript.completed_exchange_count = completed;
        transcript.final_outcome = if complete {
            "complete"
        } else {
            "failed_closed"
        };
        transcript.events = self.evidence.events.clone();
        match self.evidence.seal(transcript) {
            Ok((_, id)) => Ok(id),
            Err(_) => {
                self.failed_closed = true;
                Err(ExchangeError::Evidence)
            }
        }
    }

    fn validate_terminal_lifecycle(&self) -> Result<(usize, bool), ExchangeError> {
        const LIFECYCLE: [&str; 5] = [
            "handle_consumed",
            "dns_resolved",
            "tls_verified",
            "request_sent",
            "response_committed",
        ];
        let mut ordinal = 0usize;
        let mut lifecycle_index = 0usize;
        let mut attempted = 0usize;
        let mut completed = 0usize;
        let mut failure_seen = false;
        for (sequence, event) in self.evidence.events.iter().enumerate() {
            let capability = self
                .config
                .manifest
                .capabilities
                .get(ordinal)
                .ok_or(ExchangeError::Evidence)?;
            if failure_seen
                || event.sequence != sequence
                || event.exchange_ordinal != ordinal
                || event.capability_id != capability.capability_id
            {
                return Err(ExchangeError::Evidence);
            }
            if lifecycle_index == 0 {
                attempted += 1;
            }
            if event.event_type == "exchange_failed" {
                if lifecycle_index == 0 || lifecycle_index >= LIFECYCLE.len() {
                    return Err(ExchangeError::Evidence);
                }
                failure_seen = true;
            } else {
                if event.event_type != LIFECYCLE[lifecycle_index] {
                    return Err(ExchangeError::Evidence);
                }
                lifecycle_index += 1;
                if event.event_type == "response_committed" {
                    completed += 1;
                    ordinal += 1;
                    lifecycle_index = 0;
                }
            }
        }
        let complete = !self.failed_closed
            && !failure_seen
            && lifecycle_index == 0
            && ordinal == self.config.manifest.exact_exchange_count;
        let failed_terminal = self.failed_closed && failure_seen;
        if attempted != self.next_ordinal || (!complete && !failed_terminal) {
            return Err(ExchangeError::Evidence);
        }
        Ok((completed, complete))
    }
}

fn network_code(value: NetworkFailure) -> &'static str {
    match value {
        NetworkFailure::DnsForbidden => "dns_forbidden",
        NetworkFailure::DnsRebinding => "dns_rebinding",
        NetworkFailure::Tls => "tls_failure",
        NetworkFailure::Deadline => "deadline_exceeded",
        NetworkFailure::Overflow => "response_too_large",
        NetworkFailure::Framing => "protocol_error",
        NetworkFailure::Evidence => "protocol_error",
    }
}

pub(crate) fn uds_failure_code(code: &'static str) -> &'static str {
    match code {
        "invalid_token"
        | "invalid_handle"
        | "replay"
        | "out_of_order"
        | "request_artifact_mismatch"
        | "dns_forbidden"
        | "dns_rebinding"
        | "tls_failure"
        | "redirect_forbidden"
        | "response_status_forbidden"
        | "response_type_forbidden"
        | "request_too_large"
        | "response_too_large"
        | "deadline_exceeded"
        | "protocol_error" => code,
        _ => "protocol_error",
    }
}
fn hash_addresses(addresses: &[IpAddr]) -> String {
    let joined = addresses
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    hex::encode(Sha256::digest(joined))
}

pub fn socket_identity_commitment(
    session_id: &str,
    attempt_id: &str,
    manifest_id: &str,
    uid: u32,
) -> String {
    let mut hash = Sha256::new();
    hash.update(b"gate-h2-owner-socket-identity-v1\0");
    for value in [session_id, attempt_id, manifest_id] {
        hash.update(value.as_bytes());
        hash.update(b"\0");
    }
    hash.update(uid.to_be_bytes());
    hex::encode(hash.finalize())
}
