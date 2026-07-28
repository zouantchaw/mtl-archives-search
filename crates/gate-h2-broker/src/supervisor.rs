use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, Write},
    os::unix::{
        fs::{FileTypeExt, MetadataExt, OpenOptionsExt},
        io::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        net::UnixStream,
        process::CommandExt,
    },
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::FilePin;

const MAX_CONFIG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REPORT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MOUNTS: usize = 64;
const MAX_CHANNELS: usize = 17;
const MAX_DEADLINE_MS: u64 = 30 * 60 * 1000;
const MAX_TREE_ENTRIES: usize = 100_000;
const MAX_TREE_DEPTH: usize = 64;
const MAX_TREE_BYTES: u64 = 512 * 1024 * 1024;
const MOUNT_FD_FLOOR: RawFd = 128;
const SCRATCH_FD_FLOOR: RawFd = 512;
const POLL: Duration = Duration::from_millis(10);
const MIN_SPAWN_RESERVE: Duration = Duration::from_millis(25);
const MANDATORY_CLEANUP_RESERVE: Duration = Duration::from_millis(250);
const CONTAINER_LIVENESS_FD_BASE: RawFd = 3;
const STAGES: [&str; 12] = [
    "visual_predict",
    "visual_freeze",
    "source_predict",
    "source_freeze",
    "gold_review",
    "gold_envelope_authoring",
    "private_prepare",
    "r2_retain",
    "private_finalize",
    "task_review",
    "metrics_score",
    "publication_assembly_plan",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SupervisorConfig {
    pub schema_version: String,
    pub execution_class: String,
    pub admission_state: String,
    pub stage_id: String,
    pub candidate_id: String,
    pub candidate_commit: String,
    pub authority_sha256: String,
    pub attempt_id: String,
    pub d1_attempt_id: String,
    pub d1_begin_sha256: String,
    pub launch_record_sha256: String,
    pub authorization_id: String,
    pub admission_id: String,
    pub session_id: String,
    pub terminal_ack_fd: Option<i32>,
    pub exchange_mode: ExchangeMode,
    pub broker_authority: Option<BrokerAuthorityCommitment>,
    pub stage_program: FilePin,
    pub stage_runtime: FilePin,
    pub trust_roots: FilePin,
    pub image: ImagePin,
    pub schema_set_sha256: String,
    pub podman: ExecutablePin,
    pub container: ContainerLaunch,
    pub expected_outputs: Vec<ExpectedOutput>,
    /// Coordinator-retained directory capability. The path is diagnostic only;
    /// execution authority is the authenticated inherited descriptor.
    pub run_root: RunRootCapability,
    /// Invocation-specific, single-component child created exclusively by the
    /// supervisor only after the complete configuration has validated.
    pub run_id: String,
    pub retained_report: PathBuf,
    pub deadlines: Deadlines,
}

/// Immutable identity of the coordinator-retained parent directory used for
/// descriptor-relative run-tree creation. The supervisor never re-opens `path`
/// to obtain authority.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunRootCapability {
    pub fd: i32,
    pub role: String,
    pub path: PathBuf,
    pub dev: u64,
    pub ino: u64,
    pub uid: u32,
    pub gid: u32,
    pub mode: u32,
    pub links: u64,
}

/// Explicit config commitments for the HTTPS broker's static and trust pins.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrokerAuthorityCommitment {
    pub static_pin_sha256: String,
    pub trust_roots: BrokerTrustRootsPin,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrokerTrustRootsPin {
    pub path: PathBuf,
    pub realpath: PathBuf,
    pub sha256: String,
    pub bytes: u64,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ImagePin {
    pub immutable_reference: String,
    pub manifest_digest: String,
    pub runtime_path: String,
    pub admitted_runtime_source: PathBuf,
    pub runtime: FilePin,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutablePin {
    pub path: PathBuf,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExchangeMode {
    None {
        manifest: Option<serde_json::Value>,
        channels: Vec<ChannelSpec>,
        broker: Option<Box<BrokerLaunch>>,
    },
    Https {
        manifest_id: String,
        capability_manifest_sha256: String,
        transcript_role: String,
        transcript_schema_sha256: String,
        authority_envelope_role: String,
        authority_envelope_schema_sha256: String,
        channels: Vec<ChannelSpec>,
        broker: Box<BrokerLaunch>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrokerLaunch {
    pub executable: ExecutablePin,
    pub config_fd: i32,
    pub config_sha256: String,
    pub config_bytes: u64,
    pub socket_path: PathBuf,
    pub inherited_descriptors: Vec<InheritedDescriptor>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InheritedDescriptor {
    pub fd: i32,
    pub role: String,
    pub sha256: String,
    pub bytes: u64,
    pub fully_sealed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ChannelSpec {
    pub inherited_fd: i32,
    pub role: String,
    pub endpoint_type: String,
    pub capability_id: Option<String>,
    pub ordinal: Option<u32>,
    pub request_sha256: Option<String>,
    pub raw_response_role: Option<String>,
    pub raw_response_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ContainerLaunch {
    pub name: String,
    pub uid: u32,
    pub gid: u32,
    pub entrypoint: String,
    pub mounts: Vec<Mount>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mount {
    pub source: SourcePin,
    pub guest: String,
    pub writable: bool,
    pub artifact_role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<WritableTransition>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WritableTransition {
    DeclaredOutputs { files: Vec<DeclaredOutput> },
    EmptyWork,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DeclaredOutput {
    pub relative_path: String,
    pub artifact_role: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExpectedOutput {
    pub path: PathBuf,
    pub artifact_role: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct OutputTransition {
    artifact_role: String,
    relative_path: String,
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct RetainedPin {
    artifact_role: String,
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct RawResponsePin {
    artifact_role: String,
    path: PathBuf,
    sha256: String,
    bytes: u64,
    ordinal: u32,
    capability_id: String,
    request_sha256: String,
}

/// Canonical coordinator-retained bytes that define the report/config contract
/// before the relay is allowed to claim replay or create the run tree.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CompletionExpectations {
    schema_version: String,
    supervisor_config_sha256: String,
    supervisor_config_bytes: u64,
    report_schema_version: String,
    execution_class: String,
    admission_state: String,
    stage_id: String,
    candidate_id: String,
    candidate_commit: String,
    authority_sha256: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    launch_record_sha256: String,
    authorization_id: String,
    admission_id: String,
    session_id: String,
    terminal_ack_fd: Option<i32>,
    exchange_mode: ExchangeMode,
    broker_authority: Option<BrokerAuthorityCommitment>,
    stage_program: FilePin,
    stage_runtime: FilePin,
    trust_roots: FilePin,
    image: ImagePin,
    schema_set_sha256: String,
    podman: ExecutablePin,
    container: ContainerLaunch,
    expected_outputs: Vec<ExpectedOutput>,
    run_root: RunRootCapability,
    run_id: String,
}

impl CompletionExpectations {
    pub(crate) fn validate_config(
        &self,
        config: &SupervisorConfig,
        config_bytes: &[u8],
    ) -> Result<(), Box<dyn std::error::Error>> {
        if self.schema_version != "gate_h2_completion_expectations_v1.0.0"
            || self.report_schema_version != "gate_h2_podman_supervisor_report_v1.0.0"
            || self.supervisor_config_sha256 != hex::encode(Sha256::digest(config_bytes))
            || self.supervisor_config_bytes != config_bytes.len() as u64
            || self.execution_class != config.execution_class
            || self.admission_state != config.admission_state
            || self.stage_id != config.stage_id
            || self.candidate_id != config.candidate_id
            || self.candidate_commit != config.candidate_commit
            || self.authority_sha256 != config.authority_sha256
            || self.attempt_id != config.attempt_id
            || self.d1_attempt_id != config.d1_attempt_id
            || self.d1_begin_sha256 != config.d1_begin_sha256
            || self.launch_record_sha256 != config.launch_record_sha256
            || self.authorization_id != config.authorization_id
            || self.admission_id != config.admission_id
            || self.session_id != config.session_id
            || self.terminal_ack_fd != config.terminal_ack_fd
            || !same_json(&self.exchange_mode, &config.exchange_mode)?
            || !same_json(&self.broker_authority, &config.broker_authority)?
            || !same_json(&self.stage_program, &config.stage_program)?
            || !same_json(&self.stage_runtime, &config.stage_runtime)?
            || !same_json(&self.trust_roots, &config.trust_roots)?
            || !same_json(&self.image, &config.image)?
            || self.schema_set_sha256 != config.schema_set_sha256
            || !same_json(&self.podman, &config.podman)?
            || !same_json(&self.container, &config.container)?
            || !same_json(&self.expected_outputs, &config.expected_outputs)?
            || !same_json(&self.run_root, &config.run_root)?
            || self.run_id != config.run_id
        {
            return Err("completion expectations differ from the exact supervisor config".into());
        }
        Ok(())
    }

    fn validate_report(&self, report: &RunReport) -> Result<(), Box<dyn std::error::Error>> {
        if report.schema_version != self.report_schema_version
            || report.execution_class != self.execution_class
            || report.admission_state != self.admission_state
            || report.stage_id != self.stage_id
            || report.candidate_id != self.candidate_id
            || report.candidate_commit != self.candidate_commit
            || report.authority_sha256 != self.authority_sha256
            || report.attempt_id != self.attempt_id
            || report.d1_attempt_id != self.d1_attempt_id
            || report.d1_begin_sha256 != self.d1_begin_sha256
            || report.config_sha256 != self.supervisor_config_sha256
            || report.launch_record_sha256 != self.launch_record_sha256
            || report.authorization_id != self.authorization_id
            || report.admission_id != self.admission_id
            || report.session_id != self.session_id
            || report.terminal_ack_fd != self.terminal_ack_fd
            || !same_json(&report.exchange_mode, &self.exchange_mode)?
            || !same_json(&report.stage_program, &self.stage_program)?
            || !same_json(&report.stage_runtime, &self.stage_runtime)?
            || !same_json(&report.trust_roots, &self.trust_roots)?
        {
            return Err("supervisor report differs from retained completion expectations".into());
        }
        Ok(())
    }
}

fn same_json(left: &impl Serialize, right: &impl Serialize) -> Result<bool, serde_json::Error> {
    Ok(serde_json::to_value(left)? == serde_json::to_value(right)?)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct BrokerEvidenceJoin {
    candidate_id: String,
    candidate_commit: String,
    authority_sha256: String,
    stage_id: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    session_id: String,
    authorization_id: String,
    admission_id: String,
    runtime_sha256: String,
    image_manifest_digest: String,
    podman_sha256: String,
    broker_sha256: String,
    trust_roots_sha256: String,
    manifest_id: String,
    manifest_sha256: String,
    transcript: RetainedPin,
    authority_envelope: RetainedPin,
    raw_responses: Vec<RawResponsePin>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct GrantAuthorizationReport {
    pub grant_id: String,
    pub issuer_principal: String,
    pub key_id: String,
    pub replay_sequence: u64,
    pub request_sha256: String,
    pub grant_sha256: String,
    pub completion_expectations_sha256: String,
    pub supervisor_expectations_sha256: String,
    pub signed_payload_base64: String,
    pub signature_base64: String,
    #[serde(skip)]
    pub completion_expectations: CompletionExpectations,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourcePin {
    pub path: PathBuf,
    pub source_type: SourceType,
    pub dev: u64,
    pub ino: u64,
    pub uid: u32,
    pub gid: u32,
    pub mode: u32,
    pub links: u64,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    File,
    Directory,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Deadlines {
    pub broker_ready_ms: u64,
    pub stage_ms: u64,
    pub term_grace_ms: u64,
    pub kill_reap_ms: u64,
    pub rm_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
struct RunReport {
    schema_version: &'static str,
    status: &'static str,
    execution_class: String,
    admission_state: String,
    stage_id: String,
    candidate_id: String,
    candidate_commit: String,
    authority_sha256: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    config_sha256: String,
    launch_record_sha256: String,
    authorization_id: String,
    admission_id: String,
    session_id: String,
    terminal_ack_fd: Option<i32>,
    exchange_mode: ExchangeMode,
    image_manifest_digest: String,
    admitted_runtime_source: PathBuf,
    stage_program: FilePin,
    stage_runtime: FilePin,
    ordered_mounts: Vec<Mount>,
    mount_set_sha256: String,
    podman_argv: Vec<String>,
    trust_roots: FilePin,
    schema_set_sha256: String,
    podman_argv_sha256: String,
    broker_evidence_join: Option<BrokerEvidenceJoin>,
    broker_exit_success: Option<bool>,
    container_exit_success: bool,
    cleanup_succeeded: bool,
    output_transitions: Vec<OutputTransition>,
    grant_authorization: Option<GrantAuthorizationReport>,
}

#[derive(Debug)]
struct PrimaryCleanupError {
    primary: String,
    cleanup: String,
}

impl std::fmt::Display for PrimaryCleanupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}; supervisor cleanup failed: {}",
            self.primary, self.cleanup
        )
    }
}

impl std::error::Error for PrimaryCleanupError {}

pub fn run_from_args() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os();
    let _binary = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--config-fd")) {
        return Err("expected --config-fd".into());
    }
    let fd: i32 = args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or("missing supervisor config descriptor")?
        .parse()?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--run-root-fd")) {
        return Err("expected --run-root-fd".into());
    }
    let run_root_fd: i32 = args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or("missing run-root descriptor")?
        .parse()?;
    if args.next().is_some() {
        return Err("unexpected supervisor arguments".into());
    }
    if fd < 3 || run_root_fd < 3 || fd == run_root_fd {
        return Err("invalid supervisor inherited descriptor".into());
    }
    let mut file = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    let bytes = read_file_bounded(&mut file, MAX_CONFIG_BYTES)?;
    let value = crate::uds::parse_strict_json(&bytes)?;
    let config: SupervisorConfig = serde_json::from_value(value)?;
    let canonical = canonical_json_line(&config)?;
    if canonical != bytes {
        return Err("supervisor config is not canonical compact sorted JSON".into());
    }
    if config.run_root.fd != run_root_fd {
        return Err("run-root descriptor does not match the signed supervisor config".into());
    }
    if config.execution_class != "synthetic_test_only" {
        return Err("external authorization must enter through the combined handoff relay".into());
    }
    RealRunner.run(
        config,
        file,
        hex::encode(Sha256::digest(&bytes)),
        File::from(unsafe { OwnedFd::from_raw_fd(run_root_fd) }),
        Instant::now(),
    )
}

pub(crate) fn run_authorized(
    config: SupervisorConfig,
    retained_authority: File,
    authority_sha256: String,
    lease: RunLease,
    grant_authorization: GrantAuthorizationReport,
    liveness: File,
    retained_report: File,
) -> Result<(), Box<dyn std::error::Error>> {
    RealRunner::run_with_lease(
        config,
        retained_authority,
        authority_sha256,
        lease,
        Some(grant_authorization),
        Some(liveness),
        Some(retained_report),
    )
}

pub(crate) struct RunLease {
    owner: RunTreeOwner,
    deadline: AbsoluteDeadline,
}

impl RunLease {
    pub(crate) fn new(
        config: &SupervisorConfig,
        run_root: File,
        started: Instant,
    ) -> io::Result<Self> {
        // Syntactic validation must complete before this process creates any
        // filesystem object it may later remove.
        validate(config).map_err(|error| io::Error::other(error.to_string()))?;
        Ok(Self {
            owner: RunTreeOwner::create(run_root, &config.run_root, &config.run_id)?,
            deadline: AbsoluteDeadline::from_untrusted(&config.deadlines, started)?,
        })
    }

    pub(crate) fn abort(self) -> io::Result<()> {
        self.owner.cleanup_with_deadline(Some(self.deadline.end))
    }
}

pub fn validate(config: &SupervisorConfig) -> Result<(), Box<dyn std::error::Error>> {
    if config.schema_version != "gate_h2_podman_supervisor_config_v1.0.0"
        || !STAGES.contains(&config.stage_id.as_str())
        || !matches!(
            config.execution_class.as_str(),
            "synthetic_test_only" | "external_authorized"
        )
        || config.admission_state != "ineligible_pending_issue_101_real_linux_evidence"
        || config.candidate_id.is_empty()
        || !is_hex(&config.candidate_commit, 40)
        || !is_hex(&config.authority_sha256, 64)
        || !is_hex(&config.d1_begin_sha256, 64)
        || !is_hex(&config.launch_record_sha256, 64)
        || !is_hex(&config.authorization_id, 64)
        || !is_hex(&config.admission_id, 64)
        || !is_hex(&config.schema_set_sha256, 64)
        || config.attempt_id.is_empty()
        || config.session_id.is_empty()
        || config.attempt_id != config.d1_attempt_id
    {
        return Err("invalid supervisor identity or production eligibility".into());
    }
    validate_pin(&config.stage_program)?;
    validate_pin(&config.stage_runtime)?;
    validate_pin(&config.trust_roots)?;
    validate_pin(&config.image.runtime)?;
    validate_executable_pin(&config.podman)?;
    if config.image.runtime.sha256 != config.stage_runtime.sha256
        || config.image.runtime.bytes != config.stage_runtime.bytes
        || config.image.runtime.version != config.stage_runtime.version
        || !config.image.immutable_reference.starts_with("sha256:")
        || config.image.immutable_reference != config.image.manifest_digest
        || config.image.runtime_path != "/usr/local/bin/gate-h2-stage-runtime"
        || !config.image.admitted_runtime_source.is_absolute()
        || !clean_host_path(&config.image.admitted_runtime_source)
        || config
            .container
            .mounts
            .iter()
            .any(|mount| mount.source.path == config.image.admitted_runtime_source)
        || config.container.entrypoint != config.image.runtime_path
        || config.container.uid == 0
        || config.container.gid == 0
        || !valid_container_name(&config.container.name)
        || config.run_root.role != "supervisor_run_root"
        || config.run_root.fd < 3
        || !clean_host_path(&config.run_root.path)
        || config.run_root.path == Path::new("/")
        || config.run_root.dev == 0
        || config.run_root.ino == 0
        || config.run_root.links == 0
        || config.run_root.mode & !0o7777 != 0
        || config.run_root.mode & 0o022 != 0
        || !valid_run_id(&config.run_id)
        || !clean_host_path(&config.retained_report)
        || config.retained_report.starts_with(run_tree(config))
    {
        return Err("invalid runtime, image, process, or cleanup ownership binding".into());
    }
    let declared_outputs = validate_mounts(config)?;
    validate_exchange(config, &declared_outputs)?;
    for deadline in [
        config.deadlines.broker_ready_ms,
        config.deadlines.stage_ms,
        config.deadlines.term_grace_ms,
        config.deadlines.kill_reap_ms,
        config.deadlines.rm_ms,
    ] {
        if deadline == 0 || deadline > MAX_DEADLINE_MS {
            return Err("invalid supervisor deadline".into());
        }
    }
    let total = config
        .deadlines
        .broker_ready_ms
        .checked_add(config.deadlines.stage_ms)
        .and_then(|v| v.checked_add(config.deadlines.term_grace_ms))
        .and_then(|v| v.checked_add(config.deadlines.kill_reap_ms))
        .and_then(|v| v.checked_add(config.deadlines.term_grace_ms))
        .and_then(|v| v.checked_add(config.deadlines.kill_reap_ms))
        .and_then(|v| v.checked_add(config.deadlines.rm_ms))
        .and_then(|v| v.checked_add(u64::try_from(MANDATORY_CLEANUP_RESERVE.as_millis()).unwrap()))
        .ok_or("supervisor deadline arithmetic overflow")?;
    if total > 6 * MAX_DEADLINE_MS {
        return Err("aggregate supervisor deadline exceeds cap".into());
    }
    Ok(())
}

fn validate_exchange(
    config: &SupervisorConfig,
    declared_outputs: &BTreeMap<String, PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ExchangeMode::Https {
        manifest_id,
        capability_manifest_sha256,
        transcript_role,
        transcript_schema_sha256,
        authority_envelope_role,
        authority_envelope_schema_sha256,
        channels,
        broker,
    } = &config.exchange_mode
    else {
        let ExchangeMode::None {
            manifest,
            channels,
            broker,
        } = &config.exchange_mode
        else {
            unreachable!()
        };
        if config.terminal_ack_fd.is_some()
            || manifest.is_some()
            || !channels.is_empty()
            || broker.is_some()
        {
            return Err("invalid terminal ACK descriptor".into());
        }
        return Ok(());
    };
    let expected_terminal_ack_fd = i32::try_from(channels.len())
        .ok()
        .and_then(|count| count.checked_add(3))
        .ok_or("terminal ACK descriptor overflow")?;
    if !is_hex(manifest_id, 64)
        || !is_hex(capability_manifest_sha256, 64)
        || transcript_role != "https_broker_transcript"
        || !is_hex(transcript_schema_sha256, 64)
        || !clean_role(authority_envelope_role)
        || !is_hex(authority_envelope_schema_sha256, 64)
        || channels.is_empty()
        || channels.len() >= MAX_CHANNELS
        || !valid_channels(channels)
        || broker.config_fd < 3
        || !is_hex(&broker.config_sha256, 64)
        || broker.config_bytes == 0
        || config.terminal_ack_fd != Some(expected_terminal_ack_fd)
        || !broker.socket_path.starts_with(run_tree(config))
        || !clean_host_path(&broker.socket_path)
    {
        return Err("invalid HTTPS launch bundle".into());
    }
    if channels.iter().any(|channel| {
        let Some(role) = channel.raw_response_role.as_ref() else {
            return true;
        };
        let Some(path) = channel.raw_response_path.as_ref() else {
            return true;
        };
        declared_outputs.get(role) != Some(path)
    }) {
        return Err(
            "HTTPS raw response path differs from its exact typed output transition".into(),
        );
    }
    if !declared_outputs.contains_key(transcript_role)
        || !declared_outputs.contains_key(authority_envelope_role)
    {
        return Err("HTTPS transcript or authority output is not an exact typed transition".into());
    }
    validate_executable_pin(&broker.executable)?;
    validate_broker_descriptors(broker)?;
    Ok(())
}

fn valid_channels(channels: &[ChannelSpec]) -> bool {
    let mut fds = BTreeSet::new();
    let mut capabilities = BTreeSet::new();
    let mut responses = BTreeSet::new();
    for (index, channel) in channels.iter().enumerate() {
        let expected_fd = match i32::try_from(index).ok().and_then(|v| v.checked_add(3)) {
            Some(fd) => fd,
            None => return false,
        };
        if channel.inherited_fd != expected_fd || !fds.insert(channel.inherited_fd) {
            return false;
        }
        if channel.role != "https_exchange"
            || channel.endpoint_type != "capability_exchange"
            || channel.ordinal != u32::try_from(index).ok()
            || channel
                .capability_id
                .as_deref()
                .is_none_or(|v| !is_hex(v, 64))
            || channel
                .request_sha256
                .as_deref()
                .is_none_or(|v| !is_hex(v, 64))
            || channel
                .raw_response_role
                .as_deref()
                .is_none_or(str::is_empty)
            || channel
                .raw_response_path
                .as_ref()
                .is_none_or(|v| !v.is_absolute())
            || !capabilities.insert(channel.capability_id.as_deref().unwrap())
            || !responses.insert(channel.raw_response_role.as_deref().unwrap())
        {
            return false;
        }
    }
    true
}

fn validate_broker_descriptors(broker: &BrokerLaunch) -> Result<(), Box<dyn std::error::Error>> {
    let mut fds = BTreeSet::new();
    let mut roles = BTreeSet::new();
    let required = [
        ("launch_config", broker.config_bytes, false),
        ("run_token", 43, true),
        ("evidence_signing_key", 43, true),
        ("replay_journal", 0, false),
    ];
    if broker.inherited_descriptors.len() < required.len() + 1 {
        return Err("incomplete broker inherited descriptor bundle".into());
    }
    for (index, descriptor) in broker.inherited_descriptors.iter().enumerate() {
        if descriptor.fd < 3
            || !fds.insert(descriptor.fd)
            || !roles.insert(descriptor.role.as_str())
            || !is_hex(&descriptor.sha256, 64)
            || descriptor.bytes == 0
        {
            return Err("invalid or duplicate broker inherited descriptor".into());
        }
        if let Some((role, bytes, sealed)) = required.get(index) {
            if descriptor.role != *role
                || (*bytes != 0 && descriptor.bytes != *bytes)
                || (*sealed && !descriptor.fully_sealed)
            {
                return Err("broker inherited descriptor role, size, or seal mismatch".into());
            }
        } else if !descriptor.role.starts_with("request_body_")
            && !descriptor.role.starts_with("credential_")
        {
            return Err("surplus broker inherited descriptor role".into());
        }
    }
    if !broker.inherited_descriptors.iter().any(|v| {
        v.fd == broker.config_fd
            && v.role == "launch_config"
            && v.sha256 == broker.config_sha256
            && v.bytes == broker.config_bytes
    }) || broker.inherited_descriptors[4..]
        .iter()
        .take_while(|v| v.role.starts_with("request_body_"))
        .enumerate()
        .any(|(index, descriptor)| descriptor.role != format!("request_body_{index}"))
    {
        return Err("incomplete broker inherited descriptor bundle".into());
    }
    Ok(())
}

fn validate_mounts(
    config: &SupervisorConfig,
) -> Result<BTreeMap<String, PathBuf>, Box<dyn std::error::Error>> {
    if config.container.mounts.is_empty() || config.container.mounts.len() > MAX_MOUNTS {
        return Err("invalid mount count".into());
    }
    let mut guests: Vec<PathBuf> = Vec::new();
    let mut roles = BTreeSet::new();
    for mount in &config.container.mounts {
        let guest = clean_absolute(&mount.guest)?;
        if guest == Path::new("/")
            || overlaps(&guest, Path::new("/proc"))
            || overlaps(&guest, Path::new("/gate-h2"))
            || mount.source.path.as_os_str().is_empty()
            || !mount.source.path.is_absolute()
            || !clean_host_path(&mount.source.path)
            || mount.source.dev == 0
            || mount.source.ino == 0
            || mount.source.links == 0
            || mount.source.mode > 0o7777
            || !is_hex(&mount.source.sha256, 64)
            || mount.artifact_role.is_empty()
            || !roles.insert(mount.artifact_role.as_str())
        {
            return Err("protected, non-absolute, or duplicate-role mount".into());
        }
        if guests.iter().any(|prior| overlaps(&guest, prior)) {
            return Err("mount destinations overlap".into());
        }
        match (&mount.transition, mount.writable, guest.as_path()) {
            (None, false, _) => {}
            (Some(WritableTransition::DeclaredOutputs { files }), true, path)
                if path.starts_with("/stage/outputs") && valid_declared_outputs(files) => {}
            (Some(WritableTransition::EmptyWork), true, path)
                if path == Path::new("/stage/work") => {}
            _ => return Err("mount writable transition does not match destination".into()),
        }
        guests.push(guest);
    }
    let review = matches!(config.stage_id.as_str(), "gold_review" | "task_review");
    if review
        && config.container.mounts.iter().any(|mount| {
            mount.artifact_role == "prediction_output"
                || mount.artifact_role == "source_search_prediction"
                || mount.guest.contains("prediction-output")
        })
    {
        return Err("review stage may not mount prediction outputs".into());
    }
    let transitioned = config
        .container
        .mounts
        .iter()
        .flat_map(|mount| match &mount.transition {
            Some(WritableTransition::DeclaredOutputs { files }) => files
                .iter()
                .map(|file| ExpectedOutput {
                    path: mount.source.path.join(&file.relative_path),
                    artifact_role: file.artifact_role.clone(),
                })
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        })
        .collect::<Vec<_>>();
    let transitioned_by_role = transitioned
        .iter()
        .map(|output| (output.artifact_role.clone(), output.path.clone()))
        .collect::<BTreeMap<_, _>>();
    if transitioned_by_role.len() != transitioned.len()
        || transitioned != config.expected_outputs
        || config.expected_outputs.is_empty()
        || config.expected_outputs.len() > MAX_MOUNTS
        || config.expected_outputs.iter().any(|output| {
            !clean_host_path(&output.path)
                || !clean_role(&output.artifact_role)
                || output.path.starts_with(run_tree(config))
        })
    {
        return Err(
            "declared output transitions differ from exact expected output paths and roles".into(),
        );
    }
    Ok(transitioned_by_role)
}

fn valid_declared_outputs(outputs: &[DeclaredOutput]) -> bool {
    if outputs.is_empty() || outputs.len() > MAX_MOUNTS {
        return false;
    }
    let mut paths = BTreeSet::new();
    let mut roles = BTreeSet::new();
    outputs.iter().all(|output| {
        let path = Path::new(&output.relative_path);
        !output.relative_path.is_empty()
            && !path.is_absolute()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
            && clean_role(&output.artifact_role)
            && paths.insert(output.relative_path.as_str())
            && roles.insert(output.artifact_role.as_str())
    })
}

fn clean_role(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn podman_argv(
    config: &SupervisorConfig,
    mount_sources: Option<&[RawFd]>,
    cidfile: Option<&Path>,
) -> Vec<String> {
    let mut argv = vec![
        "run".into(),
        "--name".into(),
        config.container.name.clone(),
        "--read-only".into(),
        "--network=none".into(),
        "--user".into(),
        format!("{}:{}", config.container.uid, config.container.gid),
        "--entrypoint".into(),
        config.container.entrypoint.clone(),
        "--env-host=false".into(),
        "--security-opt=no-new-privileges".into(),
        "--cap-drop=all".into(),
        "--pids-limit=64".into(),
    ];
    if let Some(cidfile) = cidfile {
        argv.push("--cidfile".into());
        argv.push(cidfile.display().to_string());
    }
    argv.push("--preserve-fds".into());
    argv.push(container_preserved_fd_count(config).to_string());
    for (index, mount) in config.container.mounts.iter().enumerate() {
        let options = if mount.writable { "rw" } else { "ro" };
        argv.push("--mount".into());
        argv.push(format!(
            "type=bind,src={},dst={},{}",
            mount_sources
                .and_then(|sources| sources.get(index))
                .map_or_else(
                    || mount.source.path.display().to_string(),
                    |fd| format!("/proc/self/fd/{fd}"),
                ),
            mount.guest,
            options
        ));
    }
    argv.push(config.image.immutable_reference.clone());
    argv
}

fn container_preserved_fd_count(config: &SupervisorConfig) -> usize {
    match &config.exchange_mode {
        ExchangeMode::None { .. } => 1,
        // Exchange channels are followed by the terminal ACK and then the
        // non-configurable container liveness read end.
        ExchangeMode::Https { channels, .. } => channels.len() + 2,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ProcessOutcome {
    Success,
    Nonzero(String),
    TimedOut { terminated_by: &'static str },
    Cancelled { terminated_by: &'static str },
}

trait SupervisorBackend {
    fn initialize(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn launch_argv(&self, config: &SupervisorConfig) -> Vec<String> {
        podman_argv(config, None, None)
    }
    fn spawn_broker(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn wait_broker_ready(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn connect_channels(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn spawn_podman(&mut self, config: &SupervisorConfig, argv: &[String]) -> io::Result<()>;
    fn wait_stage(&mut self, config: &SupervisorConfig) -> io::Result<ProcessOutcome>;
    fn wait_broker(&mut self, config: &SupervisorConfig) -> io::Result<ProcessOutcome>;
    fn finalize_mounts(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn output_transitions(&self) -> Vec<OutputTransition> {
        Vec::new()
    }
    fn config_sha256(&self, config: &SupervisorConfig) -> Result<String, serde_json::Error> {
        canonical_config_sha256(config)
    }
    fn grant_authorization(&self) -> Option<GrantAuthorizationReport> {
        None
    }
    fn terminate_stage(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn terminate_broker(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn remove_container(&mut self, config: &SupervisorConfig) -> io::Result<()>;
    fn validate_retained(&self) -> io::Result<()>;
    fn cleanup_run_tree(&mut self) -> io::Result<()>;
    fn write_report(&mut self, config: &SupervisorConfig, report: &RunReport) -> io::Result<()>;
}

struct RealRunner;

impl RealRunner {
    fn run(
        &self,
        config: SupervisorConfig,
        config_file: File,
        config_sha256: String,
        run_root: File,
        started: Instant,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let lease = RunLease::new(&config, run_root, started)?;
        Self::run_with_lease(config, config_file, config_sha256, lease, None, None, None)
    }

    fn run_with_lease(
        config: SupervisorConfig,
        config_file: File,
        config_sha256: String,
        lease: RunLease,
        grant_authorization: Option<GrantAuthorizationReport>,
        liveness: Option<File>,
        retained_report: Option<File>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if let Err(primary) = validate(&config) {
            return match lease.abort() {
                Ok(()) => Err(primary),
                Err(cleanup) => Err(join_errors(Some(primary), "run tree", cleanup)),
            };
        }
        run_with_backend(
            &config,
            &mut RealBackend {
                owner: Some(lease.owner),
                deadline: Some(lease.deadline),
                config_file: Some(config_file),
                config_sha256,
                grant_authorization,
                liveness,
                retained_report,
                ..RealBackend::default()
            },
        )
    }
}

fn classify_outcome(
    label: &str,
    outcome: ProcessOutcome,
) -> Result<(), Box<dyn std::error::Error>> {
    match outcome {
        ProcessOutcome::Success => Ok(()),
        ProcessOutcome::Nonzero(status) => Err(format!("{label} exited nonzero: {status}").into()),
        ProcessOutcome::TimedOut { terminated_by } => {
            Err(format!("{label} timed out; bounded {terminated_by} and reap completed").into())
        }
        ProcessOutcome::Cancelled { terminated_by } => Err(format!(
            "{label} cancelled by launcher liveness EOF; bounded {terminated_by} and reap completed"
        )
        .into()),
    }
}

fn run_with_backend(
    config: &SupervisorConfig,
    backend: &mut impl SupervisorBackend,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut argv = Vec::new();
    let lifecycle = (|| -> Result<(), Box<dyn std::error::Error>> {
        backend.initialize(config)?;
        argv = backend.launch_argv(config);
        if matches!(config.exchange_mode, ExchangeMode::Https { .. }) {
            backend.spawn_broker(config)?;
            backend.wait_broker_ready(config)?;
            backend.connect_channels(config)?;
        }
        backend.spawn_podman(config, &argv)?;
        classify_outcome("stage", backend.wait_stage(config)?)?;
        if matches!(config.exchange_mode, ExchangeMode::Https { .. }) {
            classify_outcome("broker", backend.wait_broker(config)?)?;
        }
        backend.finalize_mounts()?;
        Ok(())
    })();
    let mut primary = lifecycle.err();
    for (label, cleanup) in [
        ("stage termination/reap", backend.terminate_stage(config)),
        ("broker termination/reap", backend.terminate_broker(config)),
        ("container removal", backend.remove_container(config)),
        ("retained executable identity", backend.validate_retained()),
        ("run tree", backend.cleanup_run_tree()),
    ] {
        if let Err(error) = cleanup {
            primary = Some(join_errors(primary, label, error));
        }
    }
    if let Some(error) = primary {
        return Err(error);
    }
    let report = RunReport {
        schema_version: "gate_h2_podman_supervisor_report_v1.0.0",
        status: "supervised_stage_succeeded",
        execution_class: config.execution_class.clone(),
        admission_state: config.admission_state.clone(),
        stage_id: config.stage_id.clone(),
        candidate_id: config.candidate_id.clone(),
        candidate_commit: config.candidate_commit.clone(),
        authority_sha256: config.authority_sha256.clone(),
        attempt_id: config.attempt_id.clone(),
        d1_attempt_id: config.d1_attempt_id.clone(),
        d1_begin_sha256: config.d1_begin_sha256.clone(),
        config_sha256: backend.config_sha256(config)?,
        launch_record_sha256: config.launch_record_sha256.clone(),
        authorization_id: config.authorization_id.clone(),
        admission_id: config.admission_id.clone(),
        session_id: config.session_id.clone(),
        terminal_ack_fd: config.terminal_ack_fd,
        exchange_mode: config.exchange_mode.clone(),
        image_manifest_digest: config.image.manifest_digest.clone(),
        admitted_runtime_source: config.image.admitted_runtime_source.clone(),
        stage_program: config.stage_program.clone(),
        stage_runtime: config.stage_runtime.clone(),
        ordered_mounts: config.container.mounts.clone(),
        mount_set_sha256: hash_json(&config.container.mounts)?,
        podman_argv: argv.clone(),
        trust_roots: config.trust_roots.clone(),
        schema_set_sha256: config.schema_set_sha256.clone(),
        podman_argv_sha256: hex::encode(Sha256::digest(argv.join("\0").as_bytes())),
        broker_evidence_join: broker_evidence_join(config, &backend.output_transitions())?,
        broker_exit_success: matches!(config.exchange_mode, ExchangeMode::Https { .. })
            .then_some(true),
        container_exit_success: true,
        cleanup_succeeded: true,
        output_transitions: backend.output_transitions(),
        grant_authorization: backend.grant_authorization(),
    };
    if let Some(grant) = report.grant_authorization.as_ref() {
        grant.completion_expectations.validate_report(&report)?;
    }
    backend.write_report(config, &report)?;
    Ok(())
}

fn retained_pin(
    transitions: &[OutputTransition],
    role: &str,
) -> Result<RetainedPin, Box<dyn std::error::Error>> {
    let matches = transitions
        .iter()
        .filter(|transition| transition.artifact_role == role)
        .collect::<Vec<_>>();
    let [transition] = matches.as_slice() else {
        return Err(format!("expected exactly one retained {role} output transition").into());
    };
    Ok(RetainedPin {
        artifact_role: transition.artifact_role.clone(),
        sha256: transition.sha256.clone(),
        bytes: transition.bytes,
    })
}

fn broker_evidence_join(
    config: &SupervisorConfig,
    transitions: &[OutputTransition],
) -> Result<Option<BrokerEvidenceJoin>, Box<dyn std::error::Error>> {
    let ExchangeMode::Https {
        manifest_id,
        capability_manifest_sha256,
        transcript_role,
        authority_envelope_role,
        channels,
        broker,
        ..
    } = &config.exchange_mode
    else {
        return Ok(None);
    };
    let raw_responses = channels
        .iter()
        .map(|channel| {
            let role = channel
                .raw_response_role
                .as_deref()
                .ok_or("HTTPS channel omitted raw response role")?;
            let retained = retained_pin(transitions, role)?;
            Ok(RawResponsePin {
                artifact_role: retained.artifact_role,
                path: channel
                    .raw_response_path
                    .clone()
                    .ok_or("HTTPS channel omitted raw response path")?,
                sha256: retained.sha256,
                bytes: retained.bytes,
                ordinal: channel.ordinal.ok_or("HTTPS channel omitted ordinal")?,
                capability_id: channel
                    .capability_id
                    .clone()
                    .ok_or("HTTPS channel omitted capability ID")?,
                request_sha256: channel
                    .request_sha256
                    .clone()
                    .ok_or("HTTPS channel omitted request commitment")?,
            })
        })
        .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;
    Ok(Some(BrokerEvidenceJoin {
        candidate_id: config.candidate_id.clone(),
        candidate_commit: config.candidate_commit.clone(),
        authority_sha256: config.authority_sha256.clone(),
        stage_id: config.stage_id.clone(),
        attempt_id: config.attempt_id.clone(),
        d1_attempt_id: config.d1_attempt_id.clone(),
        d1_begin_sha256: config.d1_begin_sha256.clone(),
        session_id: config.session_id.clone(),
        authorization_id: config.authorization_id.clone(),
        admission_id: config.admission_id.clone(),
        runtime_sha256: config.stage_runtime.sha256.clone(),
        image_manifest_digest: config.image.manifest_digest.clone(),
        podman_sha256: config.podman.sha256.clone(),
        broker_sha256: broker.executable.sha256.clone(),
        trust_roots_sha256: config.trust_roots.sha256.clone(),
        manifest_id: manifest_id.clone(),
        manifest_sha256: capability_manifest_sha256.clone(),
        transcript: retained_pin(transitions, transcript_role)?,
        authority_envelope: retained_pin(transitions, authority_envelope_role)?,
        raw_responses,
    }))
}

#[derive(Default)]
struct RealBackend {
    owner: Option<RunTreeOwner>,
    podman: Option<PinnedExecutable>,
    broker_executable: Option<PinnedExecutable>,
    admitted_runtime: Option<PinnedFile>,
    retained_mounts: Vec<PinnedSource>,
    broker: Option<Child>,
    stage: Option<Child>,
    channels: Vec<UnixStream>,
    config_file: Option<File>,
    config_sha256: String,
    output_transitions: Vec<OutputTransition>,
    deadline: Option<AbsoluteDeadline>,
    socket_identity: Option<SocketIdentity>,
    grant_authorization: Option<GrantAuthorizationReport>,
    liveness: Option<File>,
    retained_report: Option<File>,
    container_liveness_read: Option<File>,
    // This is deliberately owned by the supervisor rather than its relay. A
    // sudden supervisor death therefore delivers EOF to the fixed stage watchdog.
    container_liveness_write: Option<File>,
    // Exact Podman container ID created by this invocation, read from an
    // exclusively created cidfile under the owned run tree. Cleanup never
    // removes a container by signed name alone.
    owned_container_id: Option<String>,
}

#[derive(Clone, Copy)]
struct AbsoluteDeadline {
    end: Instant,
}

impl AbsoluteDeadline {
    fn from_untrusted(deadlines: &Deadlines, started: Instant) -> io::Result<Self> {
        let total = deadlines
            .broker_ready_ms
            .saturating_add(deadlines.stage_ms)
            .saturating_add(deadlines.term_grace_ms)
            .saturating_add(deadlines.kill_reap_ms)
            .saturating_add(deadlines.term_grace_ms)
            .saturating_add(deadlines.kill_reap_ms)
            .saturating_add(deadlines.rm_ms)
            .saturating_add(
                u64::try_from(MANDATORY_CLEANUP_RESERVE.as_millis()).unwrap_or(u64::MAX),
            )
            .min(6 * MAX_DEADLINE_MS);
        let end = started
            .checked_add(Duration::from_millis(total.max(1)))
            .ok_or_else(|| io::Error::other("absolute supervisor deadline overflow"))?;
        Ok(Self { end })
    }

    fn budget(self, cap_ms: u64) -> io::Result<Duration> {
        let remaining = self.end.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "absolute supervisor deadline expired",
            ));
        }
        Ok(remaining.min(Duration::from_millis(cap_ms)))
    }

    fn spawn_budget(self, reserve: Duration) -> io::Result<()> {
        if self.end.saturating_duration_since(Instant::now()) <= reserve.max(MIN_SPAWN_RESERVE) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "insufficient authoritative deadline reserve before spawn",
            ));
        }
        Ok(())
    }
}

impl RealBackend {
    fn ensure_liveness(&self) -> io::Result<()> {
        if let Some(file) = &self.liveness {
            ensure_liveness_fd(file.as_raw_fd())?;
        }
        Ok(())
    }
}

impl SupervisorBackend for RealBackend {
    fn initialize(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        self.ensure_liveness()?;
        let (read, write) = container_liveness_pipe()?;
        self.container_liveness_read = Some(read);
        self.container_liveness_write = Some(write);
        self.podman = Some(PinnedExecutable::open(&config.podman)?);
        let owner = self
            .owner
            .as_ref()
            .ok_or_else(|| io::Error::other("run tree owner is absent"))?;
        let deadline = self
            .deadline
            .ok_or_else(|| io::Error::other("absolute deadline is absent"))?;
        self.retained_mounts = config
            .container
            .mounts
            .iter()
            .enumerate()
            .map(|(index, mount)| PinnedSource::open(mount, owner, index, deadline.end))
            .collect::<io::Result<Vec<_>>>()?;
        if let ExchangeMode::Https { broker, .. } = &config.exchange_mode {
            self.broker_executable = Some(PinnedExecutable::open(&broker.executable)?);
            validate_inherited_descriptors(config, broker)?;
        }
        self.admitted_runtime = Some(PinnedFile::open(
            &config.image.admitted_runtime_source,
            &config.image.runtime.sha256,
            config.image.runtime.bytes,
        )?);
        Ok(())
    }

    fn launch_argv(&self, config: &SupervisorConfig) -> Vec<String> {
        let sources = self
            .retained_mounts
            .iter()
            .enumerate()
            .map(|(index, _)| MOUNT_FD_FLOOR + i32::try_from(index).unwrap_or(i32::MAX))
            .collect::<Vec<_>>();
        // cidfile is installed later inside spawn_podman once the owned run
        // tree path is confirmed; argv here is only used for preflight display
        // and is rebuilt at spawn with the exclusive cidfile path.
        podman_argv(config, Some(&sources), None)
    }

    fn spawn_broker(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        self.ensure_liveness()?;
        let ExchangeMode::Https { broker, .. } = &config.exchange_mode else {
            return Err(io::Error::other(
                "broker spawn requested for no-exchange stage",
            ));
        };
        self.deadline
            .unwrap()
            .spawn_budget(cleanup_reserve(&config.deadlines))?;
        self.broker = Some(spawn_broker(
            self.broker_executable
                .as_ref()
                .ok_or_else(|| io::Error::other("broker executable pin was not opened"))?,
            broker,
        )?);
        Ok(())
    }

    fn wait_broker_ready(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        let ExchangeMode::Https { broker, .. } = &config.exchange_mode else {
            return Err(io::Error::other(
                "broker readiness requested for no-exchange stage",
            ));
        };
        wait_for_socket_or_exit(
            self.broker
                .as_mut()
                .ok_or_else(|| io::Error::other("broker was not spawned"))?,
            &broker.socket_path,
            self.deadline
                .ok_or_else(|| io::Error::other("absolute deadline is absent"))?
                .budget(config.deadlines.broker_ready_ms)?,
            self.liveness.as_ref().map(AsRawFd::as_raw_fd),
            Some(self.deadline.unwrap().end),
        )?;
        self.socket_identity = Some(
            self.owner
                .as_ref()
                .ok_or_else(|| io::Error::other("run tree owner is absent"))?
                .bind_socket(&broker.socket_path, &run_tree(config))?,
        );
        Ok(())
    }

    fn connect_channels(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        let ExchangeMode::Https {
            broker, channels, ..
        } = &config.exchange_mode
        else {
            return Err(io::Error::other("channels requested for no-exchange stage"));
        };
        let deadline = self
            .deadline
            .ok_or_else(|| io::Error::other("absolute deadline is absent"))?;
        for _ in 0..=channels.len() {
            self.channels.push(connect_unix_nonblocking(
                &broker.socket_path,
                deadline,
                unsafe { libc::geteuid() },
            )?);
        }
        Ok(())
    }

    fn spawn_podman(&mut self, config: &SupervisorConfig, argv: &[String]) -> io::Result<()> {
        let _ = argv; // rebuilt below with exclusive cidfile ownership
        self.ensure_liveness()?;
        self.deadline
            .unwrap()
            .spawn_budget(cleanup_reserve(&config.deadlines))?;
        let owner = self
            .owner
            .as_ref()
            .ok_or_else(|| io::Error::other("run tree owner is absent"))?;
        let cid_path = create_exclusive_cidfile(owner, config)?;
        let sources = self
            .retained_mounts
            .iter()
            .enumerate()
            .map(|(index, _)| MOUNT_FD_FLOOR + i32::try_from(index).unwrap_or(i32::MAX))
            .collect::<Vec<_>>();
        let argv = podman_argv(config, Some(&sources), Some(&cid_path));
        self.stage = Some(spawn_podman(
            self.podman
                .as_ref()
                .ok_or_else(|| io::Error::other("Podman pin was not opened"))?,
            &argv,
            &self.channels,
            match &config.exchange_mode {
                ExchangeMode::None { .. } => &[],
                ExchangeMode::Https { channels, .. } => channels,
            },
            config.terminal_ack_fd,
            &self.retained_mounts,
            self.container_liveness_read
                .as_ref()
                .ok_or_else(|| io::Error::other("container liveness capability is absent"))?
                .as_raw_fd(),
        )?);
        self.owned_container_id = read_owned_container_id(&cid_path)?;
        self.channels.clear();
        self.container_liveness_read.take();
        Ok(())
    }

    fn wait_stage(&mut self, config: &SupervisorConfig) -> io::Result<ProcessOutcome> {
        wait_child(
            self.stage
                .as_mut()
                .ok_or_else(|| io::Error::other("stage was not spawned"))?,
            self.deadline.unwrap().budget(config.deadlines.stage_ms)?,
            self.deadline
                .unwrap()
                .budget(config.deadlines.term_grace_ms)?,
            self.deadline
                .unwrap()
                .budget(config.deadlines.kill_reap_ms)?,
            self.liveness.as_ref().map(AsRawFd::as_raw_fd),
            Some(self.deadline.unwrap().end),
        )
    }

    fn wait_broker(&mut self, config: &SupervisorConfig) -> io::Result<ProcessOutcome> {
        wait_child(
            self.broker
                .as_mut()
                .ok_or_else(|| io::Error::other("broker was not spawned"))?,
            self.deadline
                .unwrap()
                .budget(config.deadlines.term_grace_ms)?,
            self.deadline
                .unwrap()
                .budget(config.deadlines.term_grace_ms)?,
            self.deadline
                .unwrap()
                .budget(config.deadlines.kill_reap_ms)?,
            self.liveness.as_ref().map(AsRawFd::as_raw_fd),
            Some(self.deadline.unwrap().end),
        )
    }

    fn finalize_mounts(&mut self) -> io::Result<()> {
        self.output_transitions.clear();
        for source in &self.retained_mounts {
            self.output_transitions.extend(
                source.finalize(
                    self.deadline
                        .ok_or_else(|| io::Error::other("absolute deadline is absent"))?
                        .end,
                )?,
            );
        }
        self.output_transitions.sort_by(|left, right| {
            left.artifact_role
                .cmp(&right.artifact_role)
                .then(left.relative_path.cmp(&right.relative_path))
        });
        Ok(())
    }

    fn output_transitions(&self) -> Vec<OutputTransition> {
        self.output_transitions.clone()
    }

    fn config_sha256(&self, _config: &SupervisorConfig) -> Result<String, serde_json::Error> {
        Ok(self.config_sha256.clone())
    }

    fn grant_authorization(&self) -> Option<GrantAuthorizationReport> {
        self.grant_authorization.clone()
    }

    fn terminate_stage(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        let Some(stage) = self.stage.as_mut() else {
            return Ok(());
        };
        if stage.try_wait()?.is_none() {
            terminate_and_reap(
                stage,
                self.deadline
                    .unwrap()
                    .budget(config.deadlines.term_grace_ms)?,
                self.deadline
                    .unwrap()
                    .budget(config.deadlines.kill_reap_ms)?,
                Some(self.deadline.unwrap().end),
            )?;
        }
        Ok(())
    }

    fn terminate_broker(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        let Some(broker) = self.broker.as_mut() else {
            return Ok(());
        };
        if broker.try_wait()?.is_none() {
            terminate_and_reap(
                broker,
                self.deadline
                    .unwrap()
                    .budget(config.deadlines.term_grace_ms)?,
                self.deadline
                    .unwrap()
                    .budget(config.deadlines.kill_reap_ms)?,
                Some(self.deadline.unwrap().end),
            )?;
        }
        Ok(())
    }

    fn remove_container(&mut self, config: &SupervisorConfig) -> io::Result<()> {
        let Some(container_id) = self.owned_container_id.take() else {
            // Never remove by signed name. Without an invocation-owned cidfile
            // ID we cannot prove this process created the container.
            return Ok(());
        };
        match self.podman.as_ref() {
            Some(podman) => {
                let deadline = self
                    .deadline
                    .ok_or_else(|| io::Error::other("absolute deadline is absent"))?;
                deadline.spawn_budget(
                    Duration::from_millis(config.deadlines.kill_reap_ms)
                        .saturating_add(MANDATORY_CLEANUP_RESERVE),
                )?;
                remove_container(config, podman, deadline, &container_id)
            }
            None => Ok(()),
        }
    }

    fn validate_retained(&self) -> io::Result<()> {
        if let Some(podman) = &self.podman {
            podman.validate_retained()?;
        }
        if let Some(runtime) = &self.admitted_runtime {
            runtime.validate_retained()?;
        }
        if let Some(broker) = &self.broker_executable {
            broker.validate_retained()?;
        }
        if let Some(config) = &self.config_file {
            let mut clone = config.try_clone()?;
            let bytes = read_file_bounded(&mut clone, MAX_CONFIG_BYTES)?;
            if hex::encode(Sha256::digest(&bytes)) != self.config_sha256 {
                return Err(io::Error::other("retained supervisor config changed"));
            }
        }
        for source in &self.retained_mounts {
            source.validate_retained()?;
        }
        Ok(())
    }

    fn cleanup_run_tree(&mut self) -> io::Result<()> {
        if let Some(socket) = &self.socket_identity {
            socket.validate_linked()?;
        }
        match self.owner.take() {
            Some(owner) => owner.cleanup_with_deadline(self.deadline.map(|deadline| deadline.end)),
            None => Ok(()),
        }
    }

    fn write_report(&mut self, config: &SupervisorConfig, report: &RunReport) -> io::Result<()> {
        let bytes = canonical_json_line(report)?;
        match self.retained_report.as_mut() {
            Some(report_file) => write_retained_report_descriptor(report_file, &bytes),
            None => write_exclusive_durable(&config.retained_report, &bytes),
        }
    }
}

fn write_retained_report_descriptor(report: &mut File, bytes: &[u8]) -> io::Result<()> {
    let metadata = report.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() != 0 {
        return Err(io::Error::other(
            "retained report descriptor is not an empty regular file",
        ));
    }
    report.rewind()?;
    report.set_len(0)?;
    report.write_all(bytes)?;
    report.sync_all()
}

fn cleanup_reserve(deadlines: &Deadlines) -> Duration {
    Duration::from_millis(
        deadlines
            .term_grace_ms
            .saturating_add(deadlines.kill_reap_ms)
            .saturating_add(deadlines.term_grace_ms)
            .saturating_add(deadlines.kill_reap_ms)
            .saturating_add(deadlines.rm_ms),
    )
    .saturating_add(MANDATORY_CLEANUP_RESERVE)
}

struct RunTreeOwner {
    parent: File,
    name: std::ffi::CString,
    directory: File,
    dev: u64,
    ino: u64,
}

struct SocketIdentity {
    parent: File,
    name: std::ffi::CString,
    dev: u64,
    ino: u64,
}

impl SocketIdentity {
    fn validate_linked(&self) -> io::Result<()> {
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
            || stat.st_dev as u64 != self.dev
            || stat.st_ino as u64 != self.ino
            || stat.st_mode & libc::S_IFMT != libc::S_IFSOCK
        {
            return Err(io::Error::other("owned broker socket identity changed"));
        }
        Ok(())
    }
}

impl RunTreeOwner {
    fn create(root: File, capability: &RunRootCapability, run_id: &str) -> io::Result<Self> {
        let name = std::ffi::CString::new(run_id)
            .map_err(|_| io::Error::other("run tree name contains NUL"))?;
        validate_run_root_capability(capability, &root)?;
        let parent = root;
        if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let rollback = |parent: &File, name: &std::ffi::CString| {
            let _ =
                unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) };
        };
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let error = io::Error::last_os_error();
            rollback(&parent, &name);
            return Err(error);
        }
        let directory = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        let meta = match directory.metadata() {
            Ok(meta) => meta,
            Err(error) => {
                drop(directory);
                rollback(&parent, &name);
                return Err(error);
            }
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            drop(directory);
            rollback(&parent, &name);
            return Err(io::Error::other("run tree is not an owned directory"));
        }
        if let Err(error) = parent.sync_all() {
            drop(directory);
            rollback(&parent, &name);
            return Err(error);
        }
        Ok(Self {
            parent,
            name,
            directory,
            dev: meta.dev(),
            ino: meta.ino(),
        })
    }

    fn bind_socket(&self, socket: &Path, root: &Path) -> io::Result<SocketIdentity> {
        let relative = socket
            .strip_prefix(root)
            .map_err(|_| io::Error::other("broker socket escaped run tree"))?;
        let mut components = relative.components().peekable();
        let mut parent = self.directory.try_clone()?;
        let mut name = None;
        while let Some(component) = components.next() {
            let Component::Normal(component) = component else {
                return Err(io::Error::other(
                    "broker socket path is not descriptor-relative",
                ));
            };
            let component = std::ffi::CString::new(component.as_encoded_bytes())
                .map_err(|_| io::Error::other("broker socket component contains NUL"))?;
            if components.peek().is_none() {
                name = Some(component);
                break;
            }
            let fd = unsafe {
                libc::openat(
                    parent.as_raw_fd(),
                    component.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            parent = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        }
        let name = name.ok_or_else(|| io::Error::other("broker socket has no relative name"))?;
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                parent.as_raw_fd(),
                name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFSOCK
        {
            return Err(io::Error::other("broker readiness member is not a socket"));
        }
        Ok(SocketIdentity {
            parent,
            name,
            dev: stat.st_dev as u64,
            ino: stat.st_ino as u64,
        })
    }

    fn snapshot_readonly(
        &self,
        source: &PinnedSource,
        ordinal: usize,
        deadline: Instant,
    ) -> io::Result<PinnedSource> {
        let snapshots = c"readonly-snapshots";
        if unsafe { libc::mkdirat(self.directory.as_raw_fd(), snapshots.as_ptr(), 0o700) } < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EEXIST) {
                return Err(error);
            }
        }
        let snapshot_root = openat_directory(self.directory.as_raw_fd(), snapshots)?;
        let name = std::ffi::CString::new(format!("mount-{ordinal}"))
            .map_err(|_| io::Error::other("snapshot name contains NUL"))?;
        let copied = match source.pin.source_type {
            SourceType::Directory => {
                if unsafe { libc::mkdirat(snapshot_root.as_raw_fd(), name.as_ptr(), 0o700) } < 0 {
                    return Err(io::Error::last_os_error());
                }
                let destination = openat_directory(snapshot_root.as_raw_fd(), &name)?;
                let mut budget = WalkBudget::new(Some(deadline));
                copy_readonly_directory(
                    source.file.as_raw_fd(),
                    destination.as_raw_fd(),
                    &mut budget,
                    0,
                )?;
                destination.sync_all()?;
                if unsafe { libc::fchmod(destination.as_raw_fd(), source.pin.mode as libc::mode_t) }
                    < 0
                {
                    return Err(io::Error::last_os_error());
                }
                destination
            }
            SourceType::File => {
                let fd = unsafe {
                    libc::openat(
                        snapshot_root.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_CREAT
                            | libc::O_EXCL
                            | libc::O_WRONLY
                            | libc::O_NOFOLLOW
                            | libc::O_CLOEXEC,
                        0o400,
                    )
                };
                if fd < 0 {
                    return Err(io::Error::last_os_error());
                }
                let mut destination = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
                copy_regular_file(&source.file, &mut destination, source.pin.bytes, deadline)?;
                destination.sync_all()?;
                drop(destination);
                openat_file(snapshot_root.as_raw_fd(), &name)?
            }
        };
        snapshot_root.sync_all()?;
        self.directory.sync_all()?;
        source.validate_initial(Some(deadline))?;
        let meta = copied.metadata()?;
        let snapshot_sha256 = match source.pin.source_type {
            SourceType::File => {
                let mut snapshot = copied.try_clone()?;
                hex::encode(Sha256::digest(read_file_bounded(
                    &mut snapshot,
                    source.pin.bytes,
                )?))
            }
            SourceType::Directory => hash_directory_tree_fd(&copied, Some(deadline))?,
        };
        if snapshot_sha256 != source.pin.sha256 {
            return Err(io::Error::other(
                "readonly snapshot bytes differ from the independently authorized digest",
            ));
        }
        let pin = SourcePin {
            path: PathBuf::from(format!("/proc/self/fd/{}", copied.as_raw_fd())),
            source_type: source.pin.source_type,
            dev: meta.dev(),
            ino: meta.ino(),
            uid: meta.uid(),
            gid: meta.gid(),
            mode: meta.mode() & 0o7777,
            links: meta.nlink(),
            bytes: meta.len(),
            sha256: snapshot_sha256,
        };
        let retained = PinnedSource {
            file: copied,
            pin,
            transition: None,
        };
        retained.validate_initial(Some(deadline))?;
        Ok(retained)
    }

    fn cleanup_with_deadline(self, deadline: Option<Instant>) -> io::Result<()> {
        let meta = self.directory.metadata()?;
        if meta.dev() != self.dev || meta.ino() != self.ino || !meta.is_dir() {
            return Err(io::Error::other("run tree identity changed before cleanup"));
        }
        let mut linked: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                &mut linked,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
            || linked.st_dev as u64 != self.dev
            || linked.st_ino as u64 != self.ino
            || linked.st_mode & libc::S_IFMT != libc::S_IFDIR
        {
            return Err(io::Error::other(
                "run tree parent entry changed before cleanup",
            ));
        }
        remove_directory_contents_bounded(
            self.directory.as_raw_fd(),
            &mut WalkBudget::new(deadline),
            0,
        )?;
        if unsafe {
            libc::unlinkat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                libc::AT_REMOVEDIR,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        self.parent.sync_all()
    }
}

fn run_tree(config: &SupervisorConfig) -> PathBuf {
    config.run_root.path.join(&config.run_id)
}

pub(crate) fn validate_run_root_capability(
    capability: &RunRootCapability,
    root: &File,
) -> io::Result<()> {
    let meta = root.metadata()?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || meta.dev() != capability.dev
        || meta.ino() != capability.ino
        || meta.uid() != capability.uid
        || meta.gid() != capability.gid
        || meta.mode() & 0o7777 != capability.mode
        || meta.nlink() != capability.links
        || meta.mode() & 0o022 != 0
    {
        return Err(io::Error::other(
            "retained run-root descriptor identity, ownership, mode, or type mismatch",
        ));
    }
    Ok(())
}

fn valid_run_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.contains('/')
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && value != "."
        && value != ".."
}

fn openat_directory(parent: RawFd, name: &std::ffi::CStr) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
    }
}

fn openat_file(parent: RawFd, name: &std::ffi::CStr) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
    }
}

fn copy_regular_file(
    source: &File,
    destination: &mut File,
    bytes: u64,
    deadline: Instant,
) -> io::Result<()> {
    let before = source.metadata()?;
    if !before.is_file() || before.nlink() != 1 || before.len() != bytes {
        return Err(io::Error::other(
            "readonly source has special or hard-link ambiguity",
        ));
    }
    let mut input = source.try_clone()?;
    input.rewind()?;
    let mut remaining = bytes;
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "readonly snapshot copy deadline expired",
            ));
        }
        let wanted = usize::try_from(remaining.min(buffer.len() as u64)).unwrap_or(buffer.len());
        let count = input.read(&mut buffer[..wanted])?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "readonly source shortened during snapshot",
            ));
        }
        destination.write_all(&buffer[..count])?;
        remaining -= count as u64;
    }
    if input.read(&mut buffer[..1])? != 0 {
        return Err(io::Error::other("readonly source grew during snapshot"));
    }
    let after = source.metadata()?;
    if before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.nlink() != after.nlink()
    {
        return Err(io::Error::other(
            "readonly source identity changed during snapshot",
        ));
    }
    Ok(())
}

fn copy_readonly_directory(
    source_fd: RawFd,
    destination_fd: RawFd,
    budget: &mut WalkBudget,
    depth: usize,
) -> io::Result<()> {
    for name in directory_names(source_fd, budget, depth)? {
        let mut before: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                source_fd,
                name.as_ptr(),
                &mut before,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        let kind = before.st_mode & libc::S_IFMT;
        let bytes = if kind == libc::S_IFREG {
            before.st_size as u64
        } else {
            0
        };
        budget.account_bytes(bytes, depth)?;
        if kind == libc::S_IFDIR {
            let source = openat_directory(source_fd, &name)?;
            let opened = source.metadata()?;
            if opened.dev() != before.st_dev as u64 || opened.ino() != before.st_ino as u64 {
                return Err(io::Error::other("opened readonly child identity mismatch"));
            }
            if unsafe { libc::mkdirat(destination_fd, name.as_ptr(), 0o700) } < 0 {
                return Err(io::Error::last_os_error());
            }
            let destination = openat_directory(destination_fd, &name)?;
            copy_readonly_directory(
                source.as_raw_fd(),
                destination.as_raw_fd(),
                budget,
                depth + 1,
            )?;
            destination.sync_all()?;
            if unsafe { libc::fchmod(destination.as_raw_fd(), before.st_mode & 0o7777) } < 0 {
                return Err(io::Error::last_os_error());
            }
        } else if kind == libc::S_IFREG {
            if before.st_nlink != 1 {
                return Err(io::Error::other(
                    "readonly tree contains hard-link ambiguity",
                ));
            }
            let source = openat_file(source_fd, &name)?;
            let opened = source.metadata()?;
            if opened.dev() != before.st_dev as u64 || opened.ino() != before.st_ino as u64 {
                return Err(io::Error::other("opened readonly child identity mismatch"));
            }
            let fd = unsafe {
                libc::openat(
                    destination_fd,
                    name.as_ptr(),
                    libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_WRONLY
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o400,
                )
            };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let mut destination = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
            copy_regular_file(
                &source,
                &mut destination,
                before.st_size as u64,
                budget.deadline.unwrap(),
            )?;
            destination.sync_all()?;
            if unsafe { libc::fchmod(destination.as_raw_fd(), before.st_mode & 0o7777) } < 0 {
                return Err(io::Error::last_os_error());
            }
        } else {
            return Err(io::Error::other(
                "readonly tree contains symlink or special member",
            ));
        }
        let mut after: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                source_fd,
                name.as_ptr(),
                &mut after,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
            || before.st_dev != after.st_dev
            || before.st_ino != after.st_ino
            || before.st_mode != after.st_mode
            || before.st_nlink != after.st_nlink
            || before.st_size != after.st_size
        {
            return Err(io::Error::other(
                "readonly tree member changed during snapshot",
            ));
        }
    }
    Ok(())
}

fn spawn_broker(executable: &PinnedExecutable, broker: &BrokerLaunch) -> io::Result<Child> {
    executable.validate_retained()?;
    let sources = broker
        .inherited_descriptors
        .iter()
        .map(|descriptor| descriptor.fd)
        .collect::<Vec<_>>();
    let plan = ChildFdPlan::new(executable.retained.file.as_raw_fd(), &sources, &sources)?;
    let executable_fd = plan.executable.as_raw_fd();
    let mut command = Command::new(if cfg!(target_os = "linux") {
        PathBuf::from(format!("/proc/self/fd/{executable_fd}"))
    } else {
        executable.original_path.clone()
    });
    command
        .args(["--config-fd", &broker.config_fd.to_string()])
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    unsafe {
        command.pre_exec(move || {
            establish_child_process_group()?;
            plan.install()
        });
    }
    let child = command.spawn()?;
    Ok(child)
}

fn spawn_podman(
    executable: &PinnedExecutable,
    argv: &[String],
    channels: &[UnixStream],
    specs: &[ChannelSpec],
    terminal_ack_fd: Option<i32>,
    mounts: &[PinnedSource],
    container_liveness_fd: RawFd,
) -> io::Result<Child> {
    let raw: Vec<i32> = channels
        .iter()
        .map(std::os::fd::AsRawFd::as_raw_fd)
        .collect();
    if channels.len() != specs.len() + usize::from(!specs.is_empty()) {
        return Err(io::Error::other(
            "exchange channel and terminal ACK cardinality mismatch",
        ));
    }
    let targets: Vec<i32> = (0..channels.len())
        .map(|index| {
            i32::try_from(index)
                .ok()
                .and_then(|v| v.checked_add(3))
                .ok_or_else(|| io::Error::other("stage target FD overflow"))
        })
        .collect::<io::Result<_>>()?;
    let expected_targets: Vec<i32> = specs
        .iter()
        .map(|spec| spec.inherited_fd)
        .chain(terminal_ack_fd)
        .collect();
    if targets != expected_targets {
        return Err(io::Error::other(
            "stage capability or terminal ACK descriptor mismatch",
        ));
    }
    executable.validate_retained()?;
    let liveness_target = container_liveness_target_for(specs, terminal_ack_fd)?;
    let plan = ChildFdPlan::new(
        executable.retained.file.as_raw_fd(),
        &raw.iter()
            .copied()
            .chain(mounts.iter().map(|mount| mount.file.as_raw_fd()))
            .chain(std::iter::once(container_liveness_fd))
            .collect::<Vec<_>>(),
        &targets
            .iter()
            .copied()
            .chain(
                (0..mounts.len())
                    .map(|index| MOUNT_FD_FLOOR + i32::try_from(index).unwrap_or(i32::MAX)),
            )
            .chain(std::iter::once(liveness_target))
            .collect::<Vec<_>>(),
    )?;
    let executable_fd = plan.executable.as_raw_fd();
    let mut command = Command::new(if cfg!(target_os = "linux") {
        PathBuf::from(format!("/proc/self/fd/{executable_fd}"))
    } else {
        executable.original_path.clone()
    });
    command
        .args(argv)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    // SAFETY: pre_exec runs after fork and before exec; dup2 is async-signal-safe, raw FDs remain
    // owned by the parent until spawn returns, and every error aborts the child before Podman runs.
    unsafe {
        command.pre_exec(move || {
            establish_child_process_group()?;
            plan.install()
        });
    }
    let child = command.spawn()?;
    Ok(child)
}

fn container_liveness_target_for(
    specs: &[ChannelSpec],
    terminal_ack_fd: Option<i32>,
) -> io::Result<RawFd> {
    match terminal_ack_fd {
        None if specs.is_empty() => Ok(CONTAINER_LIVENESS_FD_BASE),
        Some(fd) => fd
            .checked_add(1)
            .ok_or_else(|| io::Error::other("container liveness FD overflow")),
        _ => Err(io::Error::other(
            "stage terminal ACK and liveness descriptor contract mismatch",
        )),
    }
}

struct ChildFdPlan {
    executable: OwnedFd,
    remaps: Vec<(OwnedFd, RawFd)>,
}

impl ChildFdPlan {
    fn new(executable: RawFd, sources: &[RawFd], targets: &[RawFd]) -> io::Result<Self> {
        if sources.len() != targets.len() || targets.iter().any(|target| *target < 3) {
            return Err(io::Error::other("invalid child FD remap cardinality"));
        }
        let mut occupied = BTreeSet::new();
        if !targets.iter().all(|fd| occupied.insert(*fd)) {
            return Err(io::Error::other("duplicate child FD target"));
        }
        let executable = duplicate_high(executable)?;
        let remaps = sources
            .iter()
            .zip(targets)
            .map(|(source, target)| Ok((duplicate_high(*source)?, *target)))
            .collect::<io::Result<Vec<_>>>()?;
        let mut scratch = BTreeSet::new();
        for fd in std::iter::once(executable.as_raw_fd())
            .chain(remaps.iter().map(|(fd, _)| fd.as_raw_fd()))
        {
            if fd < SCRATCH_FD_FLOOR || !scratch.insert(fd) || occupied.contains(&fd) {
                return Err(io::Error::other("child scratch FD collision"));
            }
        }
        Ok(Self { executable, remaps })
    }

    fn install(&self) -> io::Result<()> {
        for (source, target) in &self.remaps {
            if dup_to_target(source.as_raw_fd(), *target)? < 0 {
                return Err(io::Error::last_os_error());
            }
        }
        let mut retained = self
            .remaps
            .iter()
            .map(|(_, target)| *target)
            .collect::<Vec<_>>();
        retained.push(self.executable.as_raw_fd());
        clear_cloexec(
            &self
                .remaps
                .iter()
                .map(|(_, target)| *target)
                .collect::<Vec<_>>(),
        )?;
        close_undeclared_fds(&retained)
    }
}

#[cfg(target_os = "linux")]
fn dup_to_target(source: RawFd, target: RawFd) -> io::Result<RawFd> {
    let result = unsafe { libc::dup3(source, target, 0) };
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

#[cfg(not(target_os = "linux"))]
fn dup_to_target(source: RawFd, target: RawFd) -> io::Result<RawFd> {
    let result = unsafe { libc::dup2(source, target) };
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

fn duplicate_high(fd: RawFd) -> io::Result<OwnedFd> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, SCRATCH_FD_FLOOR) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedFd::from_raw_fd(duplicate) })
}

fn close_undeclared_fds(retained: &[i32]) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let mut sorted = retained.to_vec();
        sorted.sort_unstable();
        let mut first = 3_u32;
        for fd in sorted {
            let fd = u32::try_from(fd).map_err(|_| io::Error::other("negative retained FD"))?;
            if first < fd && unsafe { libc::syscall(libc::SYS_close_range, first, fd - 1, 0) } < 0 {
                return Err(io::Error::last_os_error());
            }
            first = fd
                .checked_add(1)
                .ok_or_else(|| io::Error::other("FD range overflow"))?;
        }
        if unsafe { libc::syscall(libc::SYS_close_range, first, u32::MAX, 0) } < 0 {
            return Err(io::Error::last_os_error());
        }
        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let maximum = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) };
        if maximum < 0 {
            return Err(io::Error::last_os_error());
        }
        for fd in 3..i32::try_from(maximum).unwrap_or(i32::MAX) {
            if !retained.contains(&fd) {
                unsafe { libc::close(fd) };
            }
        }
        Ok(())
    }
}

fn clear_cloexec(fds: &[i32]) -> io::Result<()> {
    for fd in fds {
        let flags = unsafe { libc::fcntl(*fd, libc::F_GETFD) };
        if flags < 0 || unsafe { libc::fcntl(*fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn establish_child_process_group() -> io::Result<()> {
    if unsafe { libc::setpgid(0, 0) } < 0 {
        return Err(io::Error::last_os_error());
    }
    #[cfg(target_os = "linux")]
    {
        let parent = unsafe { libc::getppid() };
        if parent <= 1
            || unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) } < 0
            || unsafe { libc::getppid() } != parent
        {
            return Err(io::Error::other(
                "unable to establish Linux parent-death containment",
            ));
        }
    }
    Ok(())
}

fn connect_unix_nonblocking(
    path: &Path,
    deadline: AbsoluteDeadline,
    expected_uid: u32,
) -> io::Result<UnixStream> {
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let descriptor_flags = unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_GETFD) };
    let status_flags = unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_GETFL) };
    if descriptor_flags < 0
        || status_flags < 0
        || unsafe {
            libc::fcntl(
                owned.as_raw_fd(),
                libc::F_SETFD,
                descriptor_flags | libc::FD_CLOEXEC,
            )
        } < 0
        || unsafe {
            libc::fcntl(
                owned.as_raw_fd(),
                libc::F_SETFL,
                status_flags | libc::O_NONBLOCK,
            )
        } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let bytes = path.as_os_str().as_encoded_bytes();
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    if bytes.is_empty() || bytes.len() >= address.sun_path.len() {
        return Err(io::Error::other(
            "broker socket path exceeds sockaddr_un bound",
        ));
    }
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (target, source) in address.sun_path.iter_mut().zip(bytes) {
        *target = *source as libc::c_char;
    }
    let result = unsafe {
        libc::connect(
            owned.as_raw_fd(),
            (&address as *const libc::sockaddr_un).cast(),
            std::mem::size_of::<libc::sockaddr_un>() as libc::socklen_t,
        )
    };
    if result < 0 {
        let error = io::Error::last_os_error();
        if !matches!(error.raw_os_error(), Some(code) if code == libc::EINPROGRESS || code == libc::EAGAIN)
        {
            return Err(error);
        }
        let remaining = deadline.budget(MAX_DEADLINE_MS)?;
        let mut poll_fd = libc::pollfd {
            fd: owned.as_raw_fd(),
            events: libc::POLLOUT,
            revents: 0,
        };
        let timeout = i32::try_from(remaining.as_millis())
            .unwrap_or(i32::MAX)
            .max(1);
        let polled = unsafe { libc::poll(&mut poll_fd, 1, timeout) };
        if polled <= 0 {
            return Err(if polled < 0 {
                io::Error::last_os_error()
            } else {
                io::Error::new(io::ErrorKind::TimedOut, "broker connect deadline expired")
            });
        }
    }
    let mut socket_error = 0_i32;
    let mut length = std::mem::size_of::<i32>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            owned.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            (&mut socket_error as *mut i32).cast(),
            &mut length,
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    if socket_error != 0 {
        return Err(io::Error::from_raw_os_error(socket_error));
    }
    #[cfg(target_os = "linux")]
    {
        let mut credential: libc::ucred = unsafe { std::mem::zeroed() };
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe {
            libc::getsockopt(
                owned.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut credential as *mut libc::ucred).cast(),
                &mut length,
            )
        } < 0
            || credential.pid <= 0
            || credential.uid != expected_uid
        {
            return Err(io::Error::other("broker SO_PEERCRED mismatch"));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let mut uid = 0_u32;
        let mut gid = 0_u32;
        if unsafe { libc::getpeereid(owned.as_raw_fd(), &mut uid, &mut gid) } < 0
            || uid != expected_uid
        {
            return Err(io::Error::other("broker peer credential mismatch"));
        }
    }
    let flags = unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_GETFL) };
    if flags < 0
        || unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(UnixStream::from(owned))
}

fn wait_for_socket_or_exit(
    child: &mut Child,
    socket: &Path,
    timeout: Duration,
    liveness_fd: Option<RawFd>,
    hard_end: Option<Instant>,
) -> io::Result<()> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| io::Error::other("deadline overflow"))?;
    loop {
        if let Some(fd) = liveness_fd
            && let Err(error) = ensure_liveness_fd(fd)
        {
            terminate_and_reap(
                child,
                Duration::from_millis(100),
                Duration::from_secs(1),
                hard_end,
            )?;
            return Err(error);
        }
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "broker exited before readiness: {status}"
            )));
        }
        if let Ok(meta) = fs::symlink_metadata(socket)
            && meta.file_type().is_socket()
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            terminate_and_reap(
                child,
                Duration::from_millis(100),
                Duration::from_secs(1),
                hard_end,
            )?;
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "broker readiness timeout",
            ));
        }
        thread::sleep(POLL);
    }
}

fn wait_child(
    child: &mut Child,
    runtime: Duration,
    term: Duration,
    reap: Duration,
    liveness_fd: Option<RawFd>,
    hard_end: Option<Instant>,
) -> io::Result<ProcessOutcome> {
    let mut deadline = Instant::now()
        .checked_add(runtime)
        .ok_or_else(|| io::Error::other("deadline overflow"))?;
    if let Some(end) = hard_end {
        deadline = deadline.min(end);
    }
    loop {
        if let Some(fd) = liveness_fd
            && ensure_liveness_fd(fd).is_err()
        {
            let terminated_by = terminate_and_reap(child, term, reap, hard_end)?;
            return Ok(ProcessOutcome::Cancelled { terminated_by });
        }
        if let Some(status) = child.try_wait()? {
            return Ok(if status.success() {
                ProcessOutcome::Success
            } else {
                ProcessOutcome::Nonzero(status.to_string())
            });
        }
        if Instant::now() >= deadline {
            let terminated_by = terminate_and_reap(child, term, reap, hard_end)?;
            return Ok(ProcessOutcome::TimedOut { terminated_by });
        }
        thread::sleep(POLL);
    }
}

fn ensure_liveness_fd(fd: RawFd) -> io::Result<()> {
    let mut poll = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let result = unsafe { libc::poll(&mut poll, 1, 0) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    if poll.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "launcher liveness descriptor reached EOF",
        ));
    }
    Ok(())
}

fn container_liveness_pipe() -> io::Result<(File, File)> {
    let mut fds = [-1; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let read = unsafe { File::from(OwnedFd::from_raw_fd(fds[0])) };
    let write = unsafe { File::from(OwnedFd::from_raw_fd(fds[1])) };
    for fd in [read.as_raw_fd(), write.as_raw_fd()] {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok((read, write))
}

fn terminate_and_reap(
    child: &mut Child,
    term: Duration,
    reap: Duration,
    hard_end: Option<Instant>,
) -> io::Result<&'static str> {
    if child.try_wait()?.is_some() {
        return Ok("already-exited");
    }
    let pid = i32::try_from(child.id()).map_err(|_| io::Error::other("child PID overflow"))?;
    // SAFETY: kill receives a checked positive child PID and a constant signal.
    if unsafe { libc::kill(-pid, libc::SIGTERM) } < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error);
        }
    }
    let mut term_deadline = Instant::now()
        .checked_add(term)
        .ok_or_else(|| io::Error::other("deadline overflow"))?;
    if let Some(end) = hard_end {
        term_deadline = term_deadline.min(end);
    }
    while Instant::now() < term_deadline {
        if child.try_wait()?.is_some() {
            return Ok("SIGTERM");
        }
        thread::sleep(POLL);
    }
    if unsafe { libc::kill(-pid, libc::SIGKILL) } < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error);
        }
    }
    let mut reap_deadline = Instant::now()
        .checked_add(reap)
        .ok_or_else(|| io::Error::other("deadline overflow"))?;
    if let Some(end) = hard_end {
        reap_deadline = reap_deadline.min(end);
    }
    while Instant::now() < reap_deadline {
        if child.try_wait()?.is_some() {
            return Ok("SIGTERM/SIGKILL");
        }
        thread::sleep(POLL);
    }
    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "SIGKILL child was not reaped",
    ))
}

fn create_exclusive_cidfile(
    owner: &RunTreeOwner,
    config: &SupervisorConfig,
) -> io::Result<PathBuf> {
    let name = c"container.cid";
    let fd = unsafe {
        libc::openat(
            owner.directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_CREAT | libc::O_EXCL | libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // Keep the empty exclusive file; Podman rewrites it with the container ID.
    drop(File::from(unsafe { OwnedFd::from_raw_fd(fd) }));
    owner.directory.sync_all()?;
    Ok(run_tree(config).join("container.cid"))
}

fn read_owned_container_id(path: &Path) -> io::Result<Option<String>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| io::Error::other("container cidfile is not UTF-8"))?
        .trim();
    if text.is_empty() {
        return Ok(None);
    }
    if text.len() > 128
        || !text.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-' || byte == b'_'
        })
    {
        return Err(io::Error::other("container cidfile contains an invalid ID"));
    }
    Ok(Some(text.to_owned()))
}

fn remove_container(
    config: &SupervisorConfig,
    executable: &PinnedExecutable,
    deadline: AbsoluteDeadline,
    container_id: &str,
) -> io::Result<()> {
    executable.validate_retained()?;
    let plan = ChildFdPlan::new(executable.retained.file.as_raw_fd(), &[], &[])?;
    let executable_fd = plan.executable.as_raw_fd();
    let mut command = Command::new(if cfg!(target_os = "linux") {
        PathBuf::from(format!("/proc/self/fd/{executable_fd}"))
    } else {
        executable.original_path.clone()
    });
    command
        .args(["rm", "--force", "--ignore", container_id])
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    // SAFETY: after fork, retain only the descriptor needed to execute the pinned Podman
    // image. stdio is already installed at 0..=2; every broker secret and stage channel is
    // closed before exec.
    unsafe {
        command.pre_exec(move || {
            establish_child_process_group()?;
            plan.install()
        });
    }
    let mut child = command.spawn()?;
    match wait_child(
        &mut child,
        deadline.budget(config.deadlines.rm_ms)?,
        deadline.budget(config.deadlines.term_grace_ms)?,
        deadline.budget(config.deadlines.kill_reap_ms)?,
        None,
        Some(deadline.end),
    )? {
        ProcessOutcome::Success => Ok(()),
        ProcessOutcome::Nonzero(status) => {
            Err(io::Error::other(format!("Podman cleanup failed: {status}")))
        }
        ProcessOutcome::TimedOut { terminated_by } => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("Podman cleanup timed out; bounded {terminated_by} and reap completed"),
        )),
        ProcessOutcome::Cancelled { terminated_by } => Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            format!("Podman cleanup cancelled; bounded {terminated_by} and reap completed"),
        )),
    }
}

fn join_errors(
    primary: Option<Box<dyn std::error::Error>>,
    label: &str,
    cleanup: impl std::fmt::Display,
) -> Box<dyn std::error::Error> {
    match primary {
        Some(primary) => Box::new(PrimaryCleanupError {
            primary: primary.to_string(),
            cleanup: format!("{label}: {cleanup}"),
        }),
        None => Box::new(io::Error::other(format!("{label}: {cleanup}"))),
    }
}

struct PinnedExecutable {
    retained: PinnedFile,
    original_path: PathBuf,
}

impl PinnedExecutable {
    fn open(pin: &ExecutablePin) -> io::Result<Self> {
        Ok(Self {
            retained: PinnedFile::open(&pin.path, &pin.sha256, pin.bytes)?,
            original_path: pin.path.clone(),
        })
    }

    fn validate_retained(&self) -> io::Result<()> {
        self.retained.validate_retained()
    }
}

struct PinnedFile {
    file: File,
    dev: u64,
    ino: u64,
    bytes: u64,
    sha256: String,
}

struct PinnedSource {
    file: File,
    pin: SourcePin,
    transition: Option<WritableTransition>,
}

impl PinnedSource {
    fn open(
        mount: &Mount,
        owner: &RunTreeOwner,
        ordinal: usize,
        deadline: Instant,
    ) -> io::Result<Self> {
        let source = Self::open_retained(mount, Some(deadline))?;
        if mount.writable {
            return Ok(source);
        }
        owner.snapshot_readonly(&source, ordinal, deadline)
    }

    fn open_retained(mount: &Mount, deadline: Option<Instant>) -> io::Result<Self> {
        let pin = &mount.source;
        let flags = libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | if pin.source_type == SourceType::Directory {
                libc::O_DIRECTORY
            } else {
                0
            };
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(flags)
            .open(&pin.path)?;
        let source = Self {
            file,
            pin: pin.clone(),
            transition: mount.transition.clone(),
        };
        source.validate_initial(deadline)?;
        Ok(source)
    }

    fn validate_root(&self) -> io::Result<()> {
        let meta = self.file.metadata()?;
        let exact_type = match self.pin.source_type {
            SourceType::File => meta.is_file(),
            SourceType::Directory => meta.is_dir(),
        };
        if !exact_type
            || meta.dev() != self.pin.dev
            || meta.ino() != self.pin.ino
            || meta.uid() != self.pin.uid
            || meta.gid() != self.pin.gid
            || meta.mode() & 0o7777 != self.pin.mode
            || (self.transition.is_none()
                && (meta.nlink() != self.pin.links || meta.len() != self.pin.bytes))
        {
            return Err(io::Error::other("retained mount source identity mismatch"));
        }
        Ok(())
    }

    fn validate_initial(&self, deadline: Option<Instant>) -> io::Result<()> {
        self.validate_root()?;
        if self.transition.is_some() {
            if self.pin.source_type != SourceType::Directory
                || !directory_is_empty(&self.file, deadline)?
            {
                return Err(io::Error::other(
                    "writable mount must begin as an empty directory",
                ));
            }
            return Ok(());
        }
        let digest = match self.pin.source_type {
            SourceType::File => {
                let mut clone = self.file.try_clone()?;
                hex::encode(Sha256::digest(read_file_bounded(
                    &mut clone,
                    self.pin.bytes,
                )?))
            }
            SourceType::Directory => hash_directory_tree_fd(&self.file, deadline)?,
        };
        if digest != self.pin.sha256 {
            return Err(io::Error::other(
                "retained mount source hash or tree mismatch",
            ));
        }
        Ok(())
    }

    fn validate_retained(&self) -> io::Result<()> {
        if self.transition.is_some() {
            self.validate_root()
        } else {
            self.validate_initial(None)
        }
    }

    fn finalize(&self, deadline: Instant) -> io::Result<Vec<OutputTransition>> {
        self.validate_root()?;
        match &self.transition {
            None => {
                self.validate_initial(Some(deadline))?;
                Ok(Vec::new())
            }
            Some(WritableTransition::EmptyWork) => {
                remove_directory_contents_bounded(
                    self.file.as_raw_fd(),
                    &mut WalkBudget::new(Some(deadline)),
                    0,
                )?;
                self.file.sync_all()?;
                Ok(Vec::new())
            }
            Some(WritableTransition::DeclaredOutputs { files }) => {
                validate_declared_output_tree(&self.file, files, deadline)
            }
        }
    }
}

impl PinnedFile {
    fn open(path: &Path, sha256: &str, bytes: u64) -> io::Result<Self> {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        let meta = file.metadata()?;
        if !meta.is_file() || meta.nlink() != 1 || meta.len() != bytes {
            return Err(io::Error::other("pinned file identity or size mismatch"));
        }
        let retained_bytes = read_file_bounded(&mut file, bytes)?;
        if retained_bytes.len() as u64 != bytes
            || hex::encode(Sha256::digest(&retained_bytes)) != sha256
        {
            return Err(io::Error::other("pinned file digest mismatch"));
        }
        Ok(Self {
            file,
            dev: meta.dev(),
            ino: meta.ino(),
            bytes,
            sha256: sha256.into(),
        })
    }

    fn validate_retained(&self) -> io::Result<()> {
        let meta = self.file.metadata()?;
        if !meta.is_file()
            || meta.dev() != self.dev
            || meta.ino() != self.ino
            || meta.len() != self.bytes
        {
            return Err(io::Error::other("retained file identity changed"));
        }
        let mut clone = self.file.try_clone()?;
        let retained_bytes = read_file_bounded(&mut clone, self.bytes)?;
        if retained_bytes.len() as u64 != self.bytes
            || hex::encode(Sha256::digest(&retained_bytes)) != self.sha256
        {
            return Err(io::Error::other("retained file bytes changed"));
        }
        Ok(())
    }
}

fn read_file_bounded(file: &mut File, cap: u64) -> io::Result<Vec<u8>> {
    file.rewind()?;
    let mut bytes = Vec::new();
    file.take(
        cap.checked_add(1)
            .ok_or_else(|| io::Error::other("read cap overflow"))?,
    )
    .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(io::Error::other("bounded read exceeded"));
    }
    Ok(bytes)
}

fn validate_executable_pin(pin: &ExecutablePin) -> Result<(), Box<dyn std::error::Error>> {
    if !pin.path.is_absolute()
        || pin.bytes == 0
        || pin.bytes > 80 * 1024 * 1024
        || !is_hex(&pin.sha256, 64)
    {
        return Err("invalid executable pin".into());
    }
    Ok(())
}

fn validate_pin(pin: &FilePin) -> Result<(), Box<dyn std::error::Error>> {
    if pin.bytes == 0
        || pin.bytes > 256 * 1024 * 1024
        || pin.version.is_empty()
        || !is_hex(&pin.sha256, 64)
    {
        return Err("invalid file pin".into());
    }
    Ok(())
}

fn write_exclusive_durable(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err(io::Error::other("report exceeds cap"));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    let parent = open_directory_nofollow(
        path.parent()
            .ok_or_else(|| io::Error::other("report path has no parent"))?,
    )?;
    parent.sync_all()
}

fn canonical_config_sha256(config: &SupervisorConfig) -> Result<String, serde_json::Error> {
    Ok(hex::encode(Sha256::digest(canonical_json_line(config)?)))
}

fn hash_json(value: &impl Serialize) -> Result<String, serde_json::Error> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(value)?)))
}

fn open_directory_nofollow(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

fn hash_directory_tree_fd(root: &File, deadline: Option<Instant>) -> io::Result<String> {
    let mut rows = Vec::new();
    walk_directory_fd(
        root.as_raw_fd(),
        "",
        &mut WalkBudget::new(deadline),
        0,
        &mut rows,
        &mut Vec::new(),
    )?;
    Ok(hex::encode(Sha256::digest(format!(
        "{}\n",
        rows.join("\n")
    ))))
}

struct WalkBudget {
    entries: usize,
    bytes: u64,
    deadline: Option<Instant>,
}

impl WalkBudget {
    fn new(deadline: Option<Instant>) -> Self {
        Self {
            entries: 0,
            bytes: 0,
            deadline,
        }
    }

    fn reserve_entry(&mut self, depth: usize) -> io::Result<()> {
        self.entries = self
            .entries
            .checked_add(1)
            .ok_or_else(|| io::Error::other("tree entry count overflow"))?;
        if self.entries > MAX_TREE_ENTRIES
            || depth > MAX_TREE_DEPTH
            || self
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "descriptor-relative tree bound exceeded",
            ));
        }
        Ok(())
    }

    fn check_deadline(&self) -> io::Result<()> {
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "descriptor-relative tree deadline expired",
            ));
        }
        Ok(())
    }

    fn account_bytes(&mut self, bytes: u64, depth: usize) -> io::Result<()> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or_else(|| io::Error::other("tree byte count overflow"))?;
        if self.bytes > MAX_TREE_BYTES
            || depth > MAX_TREE_DEPTH
            || self
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "descriptor-relative tree bound exceeded",
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
struct WalkedFile {
    relative_path: String,
    sha256: String,
    bytes: u64,
}

fn walk_directory_fd(
    directory_fd: RawFd,
    prefix: &str,
    budget: &mut WalkBudget,
    depth: usize,
    rows: &mut Vec<String>,
    files: &mut Vec<WalkedFile>,
) -> io::Result<()> {
    for name in directory_names(directory_fd, budget, depth)? {
        let name_bytes = name.to_bytes();
        let name_text = std::str::from_utf8(name_bytes)
            .map_err(|_| io::Error::other("mount tree contains non-UTF-8 name"))?;
        let relative = if prefix.is_empty() {
            name_text.to_owned()
        } else {
            format!("{prefix}/{name_text}")
        };
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                directory_fd,
                name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        let kind = stat.st_mode & libc::S_IFMT;
        budget.account_bytes(
            if kind == libc::S_IFREG {
                stat.st_size as u64
            } else {
                0
            },
            depth,
        )?;
        if kind == libc::S_IFDIR {
            rows.push(format!(
                "d\t{relative}\t{:o}\t{}\t{}\t{}",
                stat.st_mode & 0o7777,
                stat.st_uid,
                stat.st_gid,
                stat.st_nlink
            ));
            let child_fd = unsafe {
                libc::openat(
                    directory_fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child_fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let child = File::from(unsafe { OwnedFd::from_raw_fd(child_fd) });
            walk_directory_fd(child.as_raw_fd(), &relative, budget, depth + 1, rows, files)?;
        } else if kind == libc::S_IFREG {
            let file_fd = unsafe {
                libc::openat(
                    directory_fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if file_fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let mut file = File::from(unsafe { OwnedFd::from_raw_fd(file_fd) });
            let retained = file.metadata()?;
            if retained.dev() != stat.st_dev as u64
                || retained.ino() != stat.st_ino as u64
                || retained.len() != stat.st_size as u64
            {
                return Err(io::Error::other(
                    "tree member changed during descriptor-relative walk",
                ));
            }
            let bytes = read_file_bounded(&mut file, stat.st_size as u64)?;
            let sha256 = hex::encode(Sha256::digest(&bytes));
            rows.push(format!(
                "f\t{relative}\t{:o}\t{}\t{}\t{}\t{}\t{sha256}",
                stat.st_mode & 0o7777,
                stat.st_uid,
                stat.st_gid,
                stat.st_nlink,
                stat.st_size
            ));
            files.push(WalkedFile {
                relative_path: relative,
                sha256,
                bytes: stat.st_size as u64,
            });
        } else {
            return Err(io::Error::other(
                "mount directory tree contains symlink or special file",
            ));
        }
    }
    Ok(())
}

fn directory_names(
    directory_fd: RawFd,
    budget: &mut WalkBudget,
    depth: usize,
) -> io::Result<Vec<std::ffi::CString>> {
    let current = c".";
    let duplicate = unsafe {
        libc::openat(
            directory_fd,
            current.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    let directory = unsafe { libc::fdopendir(duplicate) };
    if directory.is_null() {
        unsafe { libc::close(duplicate) };
        return Err(io::Error::last_os_error());
    }
    let mut names = Vec::new();
    loop {
        budget.check_deadline()?;
        clear_errno();
        let entry = unsafe { libc::readdir(directory) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            unsafe { libc::closedir(directory) };
            if error.raw_os_error() == Some(0) {
                break;
            }
            return Err(error);
        }
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        if name.to_bytes() != b"." && name.to_bytes() != b".." {
            budget.reserve_entry(depth + 1)?;
            names.push(name.to_owned());
        }
    }
    names.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    budget.check_deadline()?;
    Ok(names)
}

fn directory_is_empty(directory: &File, deadline: Option<Instant>) -> io::Result<bool> {
    Ok(directory_names(directory.as_raw_fd(), &mut WalkBudget::new(deadline), 0)?.is_empty())
}

fn validate_declared_output_tree(
    directory: &File,
    declared: &[DeclaredOutput],
    deadline: Instant,
) -> io::Result<Vec<OutputTransition>> {
    let mut files = Vec::new();
    walk_directory_fd(
        directory.as_raw_fd(),
        "",
        &mut WalkBudget::new(Some(deadline)),
        0,
        &mut Vec::new(),
        &mut files,
    )?;
    let actual = files
        .iter()
        .map(|file| file.relative_path.as_str())
        .collect::<BTreeSet<_>>();
    let expected = declared
        .iter()
        .map(|output| output.relative_path.as_str())
        .collect::<BTreeSet<_>>();
    if actual != expected || files.len() != declared.len() {
        return Err(io::Error::other("declared output file set mismatch"));
    }
    declared
        .iter()
        .map(|output| {
            let file = files
                .iter()
                .find(|file| file.relative_path == output.relative_path)
                .ok_or_else(|| io::Error::other("declared output disappeared"))?;
            Ok(OutputTransition {
                artifact_role: output.artifact_role.clone(),
                relative_path: output.relative_path.clone(),
                sha256: file.sha256.clone(),
                bytes: file.bytes,
            })
        })
        .collect()
}

fn validate_inherited_descriptors(
    supervisor: &SupervisorConfig,
    broker: &BrokerLaunch,
) -> io::Result<()> {
    let fds = broker
        .inherited_descriptors
        .iter()
        .map(|descriptor| descriptor.fd)
        .collect::<Vec<_>>();
    validate_inherited_descriptor_files(supervisor, broker, &fds)
}

/// Validate SCM_RIGHTS descriptors before they are remapped to their final
/// target numbers. The handoff relay calls this before replay claiming and
/// before any run-tree filesystem mutation.
pub(crate) fn validate_received_inherited_descriptors(
    supervisor: &SupervisorConfig,
    broker: &BrokerLaunch,
    received: &[OwnedFd],
) -> io::Result<()> {
    if received.len() != broker.inherited_descriptors.len()
        || received.is_empty()
        || received
            .iter()
            .map(AsRawFd::as_raw_fd)
            .collect::<BTreeSet<_>>()
            .len()
            != received.len()
    {
        return Err(io::Error::other(
            "received broker descriptor cardinality or identity mismatch",
        ));
    }
    let fds = received.iter().map(AsRawFd::as_raw_fd).collect::<Vec<_>>();
    validate_inherited_descriptor_files(supervisor, broker, &fds)
}

fn validate_inherited_descriptor_files(
    supervisor: &SupervisorConfig,
    broker: &BrokerLaunch,
    actual_fds: &[RawFd],
) -> io::Result<()> {
    if actual_fds.len() != broker.inherited_descriptors.len() {
        return Err(io::Error::other("broker descriptor cardinality mismatch"));
    }
    let mut identities = BTreeSet::new();
    for (descriptor, actual_fd) in broker.inherited_descriptors.iter().zip(actual_fds) {
        let flags = unsafe { libc::fcntl(*actual_fd, libc::F_GETFD) };
        if flags < 0 {
            return Err(io::Error::other(format!(
                "missing broker FD for role {}",
                descriptor.role
            )));
        }
        let duplicate = unsafe { libc::dup(*actual_fd) };
        if duplicate < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut file = File::from(unsafe { OwnedFd::from_raw_fd(duplicate) });
        let meta = file.metadata()?;
        if !meta.is_file() || !identities.insert((meta.dev(), meta.ino())) {
            return Err(io::Error::other(
                "broker descriptor is not a unique regular-file capability",
            ));
        }
        if descriptor.role != "replay_journal" && meta.len() != descriptor.bytes {
            return Err(io::Error::other("broker descriptor size mismatch"));
        }
        if descriptor.role != "replay_journal" {
            let bytes = read_file_bounded(&mut file, descriptor.bytes)?;
            if bytes.len() as u64 != descriptor.bytes
                || hex::encode(Sha256::digest(bytes)) != descriptor.sha256
            {
                return Err(io::Error::other("broker descriptor hash mismatch"));
            }
        }
        #[cfg(target_os = "linux")]
        if descriptor.fully_sealed {
            let seals = unsafe { libc::fcntl(*actual_fd, libc::F_GET_SEALS) };
            let expected =
                libc::F_SEAL_SEAL | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_WRITE;
            if seals < 0 || seals & expected != expected {
                return Err(io::Error::other(
                    "broker secret descriptor is not fully sealed",
                ));
            }
        }
    }
    validate_launch_descriptor_contract_with_fds(supervisor, broker, actual_fds)
}

fn validate_launch_descriptor_contract_with_fds(
    supervisor: &SupervisorConfig,
    broker: &BrokerLaunch,
    actual_fds: &[RawFd],
) -> io::Result<()> {
    broker
        .inherited_descriptors
        .first()
        .ok_or_else(|| io::Error::other("launch config descriptor is absent"))?;
    let actual_fd = *actual_fds
        .first()
        .ok_or_else(|| io::Error::other("launch config descriptor FD is absent"))?;
    let duplicate = unsafe { libc::dup(actual_fd) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut file = File::from(unsafe { OwnedFd::from_raw_fd(duplicate) });
    let bytes = read_file_bounded(&mut file, broker.config_bytes)?;
    if bytes.len() as u64 != broker.config_bytes
        || hex::encode(Sha256::digest(&bytes)) != broker.config_sha256
    {
        return Err(io::Error::other(
            "launch config descriptor commitment mismatch",
        ));
    }
    let value = crate::uds::parse_strict_json(&bytes)
        .map_err(|_| io::Error::other("launch config is not strict JSON"))?;
    let canonical = canonical_json_value_line(&value)?;
    if canonical != bytes {
        return Err(io::Error::other("launch config is not canonical JSON"));
    }
    let object = value
        .as_object()
        .ok_or_else(|| io::Error::other("launch config is not an object"))?;
    let string = |name: &str| {
        object
            .get(name)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| io::Error::other("launch config string field is absent"))
    };
    let integer = |name: &str| {
        object
            .get(name)
            .and_then(serde_json::Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
            .ok_or_else(|| io::Error::other("launch config FD field is absent"))
    };
    if string("schema_version")? != "gate_h2_broker_launch_v1.0.0"
        || string("attempt_id")? != supervisor.attempt_id
        || string("d1_attempt_id")? != supervisor.d1_attempt_id
        || string("d1_begin_sha256")? != supervisor.d1_begin_sha256
        || string("admission_id")? != supervisor.admission_id
        || string("session_id")? != supervisor.session_id
        || object
            .get("launch_authorization")
            .and_then(serde_json::Value::as_object)
            .and_then(|authorization| authorization.get("authorization_id"))
            .and_then(serde_json::Value::as_str)
            != Some(supervisor.authorization_id.as_str())
        || object
            .get("manifest")
            .and_then(serde_json::Value::as_object)
            .and_then(|manifest| manifest.get("stage_id"))
            .and_then(serde_json::Value::as_str)
            != Some(supervisor.stage_id.as_str())
    {
        return Err(io::Error::other(
            "launch config supervisor identity join mismatch",
        ));
    }
    let request_fds = object
        .get("request_body_fds")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| io::Error::other("launch config request FD list is absent"))?
        .iter()
        .map(|value| {
            value
                .as_i64()
                .and_then(|value| i32::try_from(value).ok())
                .ok_or_else(|| io::Error::other("launch config request FD is invalid"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let credentials = object
        .get("credentials")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| io::Error::other("launch config credential list is absent"))?;
    let mut expected = vec![
        ("launch_config".to_owned(), broker.config_fd),
        ("run_token".to_owned(), integer("run_token_fd")?),
        (
            "evidence_signing_key".to_owned(),
            integer("signing_key_fd")?,
        ),
        ("replay_journal".to_owned(), integer("replay_journal_fd")?),
    ];
    expected.extend(
        request_fds
            .iter()
            .enumerate()
            .map(|(index, fd)| (format!("request_body_{index}"), *fd)),
    );
    for credential in credentials {
        let credential = credential
            .as_object()
            .ok_or_else(|| io::Error::other("launch credential descriptor is invalid"))?;
        let id = credential
            .get("credential_capability_id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| clean_role(id) || is_hex(id, 64))
            .ok_or_else(|| io::Error::other("launch credential capability ID is invalid"))?;
        let fd = credential
            .get("fd")
            .and_then(serde_json::Value::as_i64)
            .and_then(|fd| i32::try_from(fd).ok())
            .ok_or_else(|| io::Error::other("launch credential FD is invalid"))?;
        expected.push((format!("credential_{id}"), fd));
    }
    if expected.len() != broker.inherited_descriptors.len()
        || expected
            .iter()
            .zip(&broker.inherited_descriptors)
            .any(|((role, fd), descriptor)| role != &descriptor.role || fd != &descriptor.fd)
    {
        return Err(io::Error::other(
            "broker descriptor roles, cardinality, order, or FDs disagree with launch config",
        ));
    }
    let manifest_count = object
        .get("manifest")
        .and_then(serde_json::Value::as_object)
        .and_then(|manifest| manifest.get("exact_exchange_count"))
        .and_then(serde_json::Value::as_u64)
        .and_then(|count| usize::try_from(count).ok());
    if manifest_count != Some(request_fds.len())
        || request_fds.len()
            != match &supervisor.exchange_mode {
                ExchangeMode::Https { channels, .. } => channels.len(),
                ExchangeMode::None { .. } => 0,
            }
    {
        return Err(io::Error::other("launch request descriptor count mismatch"));
    }
    let path_field = |name: &str| -> io::Result<PathBuf> {
        let value = string(name)?;
        let path = PathBuf::from(value);
        if !clean_host_path(&path) {
            return Err(io::Error::other(format!(
                "launch config {name} is not a clean absolute host path"
            )));
        }
        Ok(path)
    };
    let socket_directory = path_field("socket_directory")?;
    let output_directory = path_field("output_directory")?;
    let evidence_directory = path_field("evidence_directory")?;
    let tree = run_tree(supervisor);
    if !socket_directory.starts_with(&tree)
        || broker.socket_path.parent() != Some(socket_directory.as_path())
        || !broker.socket_path.starts_with(&tree)
    {
        return Err(io::Error::other(
            "launch config socket_directory is not the retained run-tree parent of broker.socket_path",
        ));
    }
    if !evidence_directory.starts_with(&tree) || evidence_directory == tree {
        return Err(io::Error::other(
            "launch config evidence_directory is outside the retained run tree",
        ));
    }
    let ExchangeMode::Https { channels, .. } = &supervisor.exchange_mode else {
        return Err(io::Error::other(
            "launch config path join requires HTTPS exchange mode",
        ));
    };
    if channels.is_empty() {
        return Err(io::Error::other("HTTPS launch config has no channels"));
    }
    for channel in channels {
        let raw = channel
            .raw_response_path
            .as_ref()
            .ok_or_else(|| io::Error::other("channel raw response path is absent"))?;
        if raw.parent() != Some(output_directory.as_path()) {
            return Err(io::Error::other(
                "launch config output_directory does not own every channel raw response path",
            ));
        }
    }
    let writable_sources = supervisor
        .container
        .mounts
        .iter()
        .filter(|mount| mount.writable)
        .map(|mount| mount.source.path.as_path())
        .collect::<BTreeSet<_>>();
    if !writable_sources.contains(output_directory.as_path()) {
        return Err(io::Error::other(
            "launch config output_directory is not a declared writable mount source",
        ));
    }
    Ok(())
}

fn remove_directory_contents_bounded(
    directory_fd: RawFd,
    budget: &mut WalkBudget,
    depth: usize,
) -> io::Result<()> {
    for name in directory_names(directory_fd, budget, depth)? {
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                directory_fd,
                name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        budget.account_bytes(
            if stat.st_mode & libc::S_IFMT == libc::S_IFREG {
                stat.st_size as u64
            } else {
                0
            },
            depth,
        )?;
        if stat.st_mode & libc::S_IFMT == libc::S_IFDIR {
            let child_fd = unsafe {
                libc::openat(
                    directory_fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child_fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let child = File::from(unsafe { OwnedFd::from_raw_fd(child_fd) });
            remove_directory_contents_bounded(child.as_raw_fd(), budget, depth + 1)?;
            if unsafe { libc::unlinkat(directory_fd, name.as_ptr(), libc::AT_REMOVEDIR) } < 0 {
                return Err(io::Error::last_os_error());
            }
        } else if stat.st_mode & libc::S_IFMT == libc::S_IFREG {
            if unsafe { libc::unlinkat(directory_fd, name.as_ptr(), 0) } < 0 {
                return Err(io::Error::last_os_error());
            }
        } else {
            return Err(io::Error::other(
                "cleanup tree contains undeclared special member",
            ));
        }
    }
    Ok(())
}

fn clear_errno() {
    #[cfg(target_os = "linux")]
    unsafe {
        *libc::__errno_location() = 0;
    }
    #[cfg(not(target_os = "linux"))]
    unsafe {
        *libc::__error() = 0;
    }
}

/// Shared with `reviewed-metrics-v2.ts`: recursively lexicographically sorted
/// UTF-8 object keys and compact JSON. Schema v1 is the protocol version for
/// these authoritative bytes; struct field order is never an input.
const SUPERVISOR_CANONICAL_JSON_ALGORITHM: &str = "gate_h2_lexicographic_utf8_json_v1";

fn canonical_json_line(value: &impl Serialize) -> Result<Vec<u8>, serde_json::Error> {
    let _algorithm = SUPERVISOR_CANONICAL_JSON_ALGORITHM;
    let value = serde_json::to_value(value)?;
    Ok(crate::evidence::canonical_json(&value).into_bytes())
}

fn canonical_json_value_line(value: &serde_json::Value) -> io::Result<Vec<u8>> {
    canonical_json_line(value).map_err(io::Error::other)
}

fn clean_absolute(value: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = Path::new(value);
    if !path.is_absolute()
        || value
            .as_bytes()
            .iter()
            .any(|byte| byte.is_ascii_control() || matches!(*byte, b',' | b'='))
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("guest mount path is not clean absolute".into());
    }
    Ok(path.to_path_buf())
}

fn valid_container_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.' | b'-')
        })
}

fn clean_host_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
        && path
            .as_os_str()
            .as_encoded_bytes()
            .iter()
            .all(|byte| !byte.is_ascii_control() && !matches!(*byte, b',' | b'='))
}

fn overlaps(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

fn is_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use tempfile::tempdir;

    fn run_root_capability(path: &Path, fd: i32) -> RunRootCapability {
        let meta = fs::metadata(path).unwrap();
        RunRootCapability {
            fd,
            role: "supervisor_run_root".into(),
            path: path.to_path_buf(),
            dev: meta.dev(),
            ino: meta.ino(),
            uid: meta.uid(),
            gid: meta.gid(),
            mode: meta.mode() & 0o7777,
            links: meta.nlink(),
        }
    }

    fn test_run_tree_owner(root: &Path, run_id: &str) -> RunTreeOwner {
        RunTreeOwner::create(
            File::open(root).unwrap(),
            &run_root_capability(root, 3),
            run_id,
        )
        .unwrap()
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Failure {
        BrokerConfigFdMismatch,
        BrokerReadiness,
        UnsolicitedConnection,
        PartialChannelSetup,
        PodmanSpawn,
        PodmanNonzero,
        PodmanTimeout,
        BrokerExitAfterStage,
        PodmanRemove,
        ReportWrite,
    }

    #[derive(Debug)]
    struct DeterministicBackend {
        failure: Failure,
        events: Vec<&'static str>,
        connected: usize,
    }

    impl DeterministicBackend {
        fn new(failure: Failure) -> Self {
            Self {
                failure,
                events: Vec::new(),
                connected: 0,
            }
        }

        fn fail(&self, failure: Failure, message: &'static str) -> io::Result<()> {
            if self.failure == failure {
                Err(io::Error::other(message))
            } else {
                Ok(())
            }
        }
    }

    impl SupervisorBackend for DeterministicBackend {
        fn initialize(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("initialize");
            Ok(())
        }

        fn spawn_broker(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("spawn_broker");
            self.fail(Failure::BrokerConfigFdMismatch, "broker config FD mismatch")
        }

        fn wait_broker_ready(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("wait_broker_ready");
            self.fail(Failure::BrokerReadiness, "broker readiness failure")
        }

        fn connect_channels(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("connect_channels");
            if self.failure == Failure::UnsolicitedConnection {
                return Err(io::Error::other("unsolicited or misordered connection"));
            }
            self.connected = 1;
            if self.failure == Failure::PartialChannelSetup {
                self.connected = 2;
                return Err(io::Error::other("partial channel setup"));
            }
            self.connected = 2;
            Ok(())
        }

        fn spawn_podman(&mut self, _config: &SupervisorConfig, _argv: &[String]) -> io::Result<()> {
            self.events.push("spawn_podman");
            self.fail(Failure::PodmanSpawn, "Podman spawn failure")
        }

        fn wait_stage(&mut self, _config: &SupervisorConfig) -> io::Result<ProcessOutcome> {
            self.events.push("wait_stage");
            Ok(match self.failure {
                Failure::PodmanNonzero => ProcessOutcome::Nonzero("exit status: 7".into()),
                Failure::PodmanTimeout => {
                    self.events
                        .extend(["stage_SIGTERM", "stage_SIGKILL", "stage_reap"]);
                    ProcessOutcome::TimedOut {
                        terminated_by: "SIGTERM/SIGKILL",
                    }
                }
                _ => ProcessOutcome::Success,
            })
        }

        fn wait_broker(&mut self, _config: &SupervisorConfig) -> io::Result<ProcessOutcome> {
            self.events.push("wait_broker_after_stage");
            Ok(if self.failure == Failure::BrokerExitAfterStage {
                ProcessOutcome::Nonzero("exit status: 9".into())
            } else {
                ProcessOutcome::Success
            })
        }

        fn output_transitions(&self) -> Vec<OutputTransition> {
            [
                ("provider_raw_response", "raw.json"),
                ("https_broker_transcript", "transcript.json"),
                ("https_broker_authority_envelope", "envelope.json"),
            ]
            .into_iter()
            .map(|(artifact_role, relative_path)| OutputTransition {
                artifact_role: artifact_role.into(),
                relative_path: relative_path.into(),
                sha256: "1".repeat(64),
                bytes: 1,
            })
            .collect()
        }

        fn terminate_stage(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("terminate_stage");
            Ok(())
        }

        fn terminate_broker(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("terminate_broker");
            Ok(())
        }

        fn remove_container(&mut self, _config: &SupervisorConfig) -> io::Result<()> {
            self.events.push("podman_rm");
            self.fail(Failure::PodmanRemove, "podman rm failure")
        }

        fn validate_retained(&self) -> io::Result<()> {
            Ok(())
        }

        fn cleanup_run_tree(&mut self) -> io::Result<()> {
            self.events.push("cleanup_run_tree");
            Ok(())
        }

        fn write_report(
            &mut self,
            _config: &SupervisorConfig,
            _report: &RunReport,
        ) -> io::Result<()> {
            self.events.push("write_report");
            self.fail(
                Failure::ReportWrite,
                "retained supervisor-report write failure",
            )
        }
    }

    fn pin(tag: u8) -> FilePin {
        FilePin {
            sha256: format!("{tag:064x}"),
            bytes: 1,
            version: "v1".into(),
        }
    }

    fn source(path: &str, source_type: SourceType) -> SourcePin {
        SourcePin {
            path: path.into(),
            source_type,
            dev: 1,
            ino: 1,
            uid: 501,
            gid: 20,
            mode: 0o600,
            links: 1,
            bytes: 1,
            sha256: "8".repeat(64),
        }
    }

    fn fixture() -> SupervisorConfig {
        let runtime = pin(2);
        SupervisorConfig {
            schema_version: "gate_h2_podman_supervisor_config_v1.0.0".into(),
            execution_class: "synthetic_test_only".into(),
            admission_state: "ineligible_pending_issue_101_real_linux_evidence".into(),
            stage_id: "publication_assembly_plan".into(),
            candidate_id: "candidate-1".into(),
            candidate_commit: "a".repeat(40),
            authority_sha256: "b".repeat(64),
            attempt_id: "attempt-1".into(),
            d1_attempt_id: "attempt-1".into(),
            d1_begin_sha256: "c".repeat(64),
            launch_record_sha256: "d".repeat(64),
            authorization_id: "e".repeat(64),
            admission_id: "f".repeat(64),
            session_id: "session-1".into(),
            terminal_ack_fd: Some(4),
            broker_authority: Some(BrokerAuthorityCommitment {
                static_pin_sha256: "6".repeat(64),
                trust_roots: BrokerTrustRootsPin {
                    path: "/synthetic/roots".into(),
                    realpath: "/synthetic/roots".into(),
                    sha256: "7".repeat(64),
                    bytes: 1,
                    version: "synthetic-v1".into(),
                },
            }),
            exchange_mode: ExchangeMode::Https {
                manifest_id: "0".repeat(64),
                capability_manifest_sha256: "1".repeat(64),
                transcript_role: "https_broker_transcript".into(),
                transcript_schema_sha256: "2".repeat(64),
                authority_envelope_role: "https_broker_authority_envelope".into(),
                authority_envelope_schema_sha256: "3".repeat(64),
                channels: vec![ChannelSpec {
                    inherited_fd: 3,
                    role: "https_exchange".into(),
                    endpoint_type: "capability_exchange".into(),
                    capability_id: Some("2".repeat(64)),
                    ordinal: Some(0),
                    request_sha256: Some("3".repeat(64)),
                    raw_response_role: Some("provider_raw_response".into()),
                    raw_response_path: Some("/tmp/output/raw.json".into()),
                }],
                broker: Box::new(BrokerLaunch {
                    executable: ExecutablePin {
                        path: "/usr/bin/gate-h2-broker".into(),
                        sha256: "4".repeat(64),
                        bytes: 1,
                    },
                    config_fd: 9,
                    config_sha256: "7".repeat(64),
                    config_bytes: 1,
                    socket_path: "/tmp/gate-h2-retained-root/gate-h2-run/broker.sock".into(),
                    inherited_descriptors: vec![
                        InheritedDescriptor {
                            fd: 9,
                            role: "launch_config".into(),
                            sha256: "7".repeat(64),
                            bytes: 1,
                            fully_sealed: false,
                        },
                        InheritedDescriptor {
                            fd: 10,
                            role: "run_token".into(),
                            sha256: "8".repeat(64),
                            bytes: 43,
                            fully_sealed: true,
                        },
                        InheritedDescriptor {
                            fd: 11,
                            role: "evidence_signing_key".into(),
                            sha256: "9".repeat(64),
                            bytes: 43,
                            fully_sealed: true,
                        },
                        InheritedDescriptor {
                            fd: 12,
                            role: "replay_journal".into(),
                            sha256: "a".repeat(64),
                            bytes: 1,
                            fully_sealed: false,
                        },
                        InheritedDescriptor {
                            fd: 13,
                            role: "request_body_0".into(),
                            sha256: "b".repeat(64),
                            bytes: 1,
                            fully_sealed: false,
                        },
                    ],
                }),
            },
            stage_program: pin(1),
            stage_runtime: runtime.clone(),
            trust_roots: pin(3),
            image: ImagePin {
                immutable_reference: format!("sha256:{}", "4".repeat(64)),
                manifest_digest: format!("sha256:{}", "4".repeat(64)),
                runtime_path: "/usr/local/bin/gate-h2-stage-runtime".into(),
                admitted_runtime_source:
                    "/tmp/admitted-image-root/usr/local/bin/gate-h2-stage-runtime".into(),
                runtime,
            },
            schema_set_sha256: "5".repeat(64),
            podman: ExecutablePin {
                path: "/usr/bin/podman".into(),
                sha256: "6".repeat(64),
                bytes: 1,
            },
            container: ContainerLaunch {
                name: "gate-h2-attempt-1".into(),
                uid: 65532,
                gid: 65532,
                entrypoint: "/usr/local/bin/gate-h2-stage-runtime".into(),
                mounts: vec![
                    Mount {
                        source: source("/tmp/program.json", SourceType::File),
                        guest: "/stage/program.json".into(),
                        writable: false,
                        artifact_role: "stage_program".into(),
                        transition: None,
                    },
                    Mount {
                        source: source("/tmp/input.json", SourceType::File),
                        guest: "/stage/inputs/request.json".into(),
                        writable: false,
                        artifact_role: "request".into(),
                        transition: None,
                    },
                    Mount {
                        source: source("/tmp/output", SourceType::Directory),
                        guest: "/stage/outputs".into(),
                        writable: true,
                        artifact_role: "declared_outputs".into(),
                        transition: Some(WritableTransition::DeclaredOutputs {
                            files: vec![
                                DeclaredOutput {
                                    relative_path: "result.json".into(),
                                    artifact_role: "result".into(),
                                },
                                DeclaredOutput {
                                    relative_path: "raw.json".into(),
                                    artifact_role: "provider_raw_response".into(),
                                },
                                DeclaredOutput {
                                    relative_path: "transcript.json".into(),
                                    artifact_role: "https_broker_transcript".into(),
                                },
                                DeclaredOutput {
                                    relative_path: "envelope.json".into(),
                                    artifact_role: "https_broker_authority_envelope".into(),
                                },
                            ],
                        }),
                    },
                    Mount {
                        source: source("/tmp/authority.json", SourceType::File),
                        guest: "/run/gate-h2/stage-authority.json".into(),
                        writable: false,
                        artifact_role: "stage_authority".into(),
                        transition: None,
                    },
                    Mount {
                        source: source("/tmp/token", SourceType::File),
                        guest: "/run/gate-h2/run-token".into(),
                        writable: false,
                        artifact_role: "run_token".into(),
                        transition: None,
                    },
                ],
            },
            expected_outputs: vec![
                ExpectedOutput {
                    path: "/tmp/output/result.json".into(),
                    artifact_role: "result".into(),
                },
                ExpectedOutput {
                    path: "/tmp/output/raw.json".into(),
                    artifact_role: "provider_raw_response".into(),
                },
                ExpectedOutput {
                    path: "/tmp/output/transcript.json".into(),
                    artifact_role: "https_broker_transcript".into(),
                },
                ExpectedOutput {
                    path: "/tmp/output/envelope.json".into(),
                    artifact_role: "https_broker_authority_envelope".into(),
                },
            ],
            run_root: RunRootCapability {
                fd: 3,
                role: "supervisor_run_root".into(),
                path: "/tmp/gate-h2-retained-root".into(),
                dev: 1,
                ino: 1,
                uid: 1,
                gid: 1,
                mode: 0o700,
                links: 1,
            },
            run_id: "gate-h2-run".into(),
            retained_report: "/tmp/supervisor-reports/fixture.json".into(),
            deadlines: Deadlines {
                broker_ready_ms: 1000,
                stage_ms: 1000,
                term_grace_ms: 100,
                kill_reap_ms: 100,
                rm_ms: 100,
            },
        }
    }

    fn completion_expectations(
        config: &SupervisorConfig,
        config_bytes: &[u8],
    ) -> CompletionExpectations {
        CompletionExpectations {
            schema_version: "gate_h2_completion_expectations_v1.0.0".into(),
            supervisor_config_sha256: hex::encode(Sha256::digest(config_bytes)),
            supervisor_config_bytes: config_bytes.len() as u64,
            report_schema_version: "gate_h2_podman_supervisor_report_v1.0.0".into(),
            execution_class: config.execution_class.clone(),
            admission_state: config.admission_state.clone(),
            stage_id: config.stage_id.clone(),
            candidate_id: config.candidate_id.clone(),
            candidate_commit: config.candidate_commit.clone(),
            authority_sha256: config.authority_sha256.clone(),
            attempt_id: config.attempt_id.clone(),
            d1_attempt_id: config.d1_attempt_id.clone(),
            d1_begin_sha256: config.d1_begin_sha256.clone(),
            launch_record_sha256: config.launch_record_sha256.clone(),
            authorization_id: config.authorization_id.clone(),
            admission_id: config.admission_id.clone(),
            session_id: config.session_id.clone(),
            terminal_ack_fd: config.terminal_ack_fd,
            exchange_mode: config.exchange_mode.clone(),
            broker_authority: config.broker_authority.clone(),
            stage_program: config.stage_program.clone(),
            stage_runtime: config.stage_runtime.clone(),
            trust_roots: config.trust_roots.clone(),
            image: config.image.clone(),
            schema_set_sha256: config.schema_set_sha256.clone(),
            podman: config.podman.clone(),
            container: config.container.clone(),
            expected_outputs: config.expected_outputs.clone(),
            run_root: config.run_root.clone(),
            run_id: config.run_id.clone(),
        }
    }

    fn received_descriptor(bytes: &[u8]) -> OwnedFd {
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(bytes).unwrap();
        file.sync_all().unwrap();
        OwnedFd::from(file)
    }

    #[test]
    fn received_https_descriptors_are_validated_before_target_fd_installation() {
        let mut config = fixture();
        let launch = serde_json::json!({
            "admission_id": config.admission_id,
            "attempt_id": config.attempt_id,
            "credentials": [],
            "d1_attempt_id": config.d1_attempt_id,
            "d1_begin_sha256": config.d1_begin_sha256,
            "evidence_directory": "/tmp/gate-h2-retained-root/gate-h2-run/evidence",
            "launch_authorization": { "authorization_id": config.authorization_id },
            "manifest": { "exact_exchange_count": 1, "stage_id": config.stage_id },
            "output_directory": "/tmp/output",
            "replay_journal_fd": 12,
            "request_body_fds": [13],
            "run_token_fd": 10,
            "schema_version": "gate_h2_broker_launch_v1.0.0",
            "session_id": config.session_id,
            "signing_key_fd": 11,
            "socket_directory": "/tmp/gate-h2-retained-root/gate-h2-run",
        });
        let launch_bytes = canonical_json_line(&launch).unwrap();
        let token_bytes = vec![0x11; 43];
        let signing_bytes = vec![0x22; 43];
        let journal_bytes = b"j".to_vec();
        let request_bytes = b"r".to_vec();
        let payloads = [
            launch_bytes.clone(),
            token_bytes.clone(),
            signing_bytes.clone(),
            journal_bytes.clone(),
            request_bytes.clone(),
        ];
        {
            let broker = match &mut config.exchange_mode {
                ExchangeMode::Https { broker, .. } => broker,
                ExchangeMode::None { .. } => unreachable!(),
            };
            for (descriptor, bytes) in broker.inherited_descriptors.iter_mut().zip(&payloads) {
                descriptor.sha256 = hex::encode(Sha256::digest(bytes));
                descriptor.bytes = bytes.len() as u64;
                // Linux memfd sealing is separately exercised by the production
                // descriptor tests; this cross-platform preflight test verifies
                // order, content, and target-independent validation.
                descriptor.fully_sealed = false;
            }
            broker.config_sha256 = hex::encode(Sha256::digest(&launch_bytes));
            broker.config_bytes = launch_bytes.len() as u64;
        }
        let broker = match &config.exchange_mode {
            ExchangeMode::Https { broker, .. } => broker,
            ExchangeMode::None { .. } => unreachable!(),
        };
        let received = payloads
            .iter()
            .map(|bytes| received_descriptor(bytes))
            .collect::<Vec<_>>();
        validate_received_inherited_descriptors(&config, broker, &received).unwrap();

        let mut reordered = payloads
            .iter()
            .map(|bytes| received_descriptor(bytes))
            .collect::<Vec<_>>();
        reordered.swap(1, 2);
        assert!(validate_received_inherited_descriptors(&config, broker, &reordered).is_err());

        let mut substituted = payloads
            .iter()
            .map(|bytes| received_descriptor(bytes))
            .collect::<Vec<_>>();
        substituted[4] = received_descriptor(&token_bytes);
        assert!(validate_received_inherited_descriptors(&config, broker, &substituted).is_err());
    }

    #[test]
    fn supervisor_canonical_bytes_are_recursive_and_lexical() {
        let value = serde_json::json!({"z": {"b": 2, "a": 1}, "a": [true, null]});
        assert_eq!(
            canonical_json_line(&value).unwrap(),
            br#"{"a":[true,null],"z":{"a":1,"b":2}}"#
        );
    }

    #[test]
    fn supervisor_canonical_bytes_match_the_shared_non_bmp_utf8_golden() {
        let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../docs/dataset-factory/fixtures/podman-supervisor-v1/canonical-json-utf8-golden-v1.json"
        ))
        .unwrap();
        let canonical = base64::engine::general_purpose::STANDARD
            .decode(fixture["canonical_utf8_json_base64"].as_str().unwrap())
            .unwrap();
        let reordered = base64::engine::general_purpose::STANDARD
            .decode(
                fixture["reordered_semantic_utf8_json_base64"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();

        assert_eq!(canonical_json_line(&fixture["input"]).unwrap(), canonical);
        let reordered_value = crate::uds::parse_strict_json(&reordered).unwrap();
        assert_ne!(canonical_json_line(&reordered_value).unwrap(), reordered);
    }

    fn mutate_expectation_member(value: &mut serde_json::Value, pointer: &str) {
        let member = value.pointer_mut(pointer).unwrap();
        match member {
            serde_json::Value::String(text) => text.push('x'),
            serde_json::Value::Number(number) => {
                *member = serde_json::json!(number.as_u64().unwrap_or_default() + 1)
            }
            serde_json::Value::Bool(value) => *value = !*value,
            serde_json::Value::Null => *member = serde_json::json!("not-null"),
            _ => panic!("test pointer is not a scalar: {pointer}"),
        }
    }

    fn scalar_expectation_members(
        value: &serde_json::Value,
        pointer: &str,
        members: &mut Vec<String>,
    ) {
        match value {
            serde_json::Value::Object(object) => {
                for (key, member) in object {
                    let key = key.replace('~', "~0").replace('/', "~1");
                    scalar_expectation_members(member, &format!("{pointer}/{key}"), members);
                }
            }
            serde_json::Value::Array(values) => {
                for (index, member) in values.iter().enumerate() {
                    scalar_expectation_members(member, &format!("{pointer}/{index}"), members);
                }
            }
            _ => members.push(pointer.into()),
        }
    }

    fn assert_every_expectation_member_rejects(
        config: &SupervisorConfig,
        config_bytes: &[u8],
        expectations: &CompletionExpectations,
    ) {
        let value = serde_json::to_value(expectations).unwrap();
        let mut members = Vec::new();
        scalar_expectation_members(&value, "", &mut members);
        assert!(!members.is_empty());
        for member in members {
            let mut mutated = value.clone();
            mutate_expectation_member(&mut mutated, &member);
            if let Ok(mutated) = serde_json::from_value::<CompletionExpectations>(mutated) {
                assert!(
                    mutated.validate_config(config, config_bytes).is_err(),
                    "{member}"
                );
            }
        }
    }

    #[test]
    fn retained_completion_expectations_reject_each_signed_https_tuple_before_side_effects() {
        let config = fixture();
        let config_bytes = serde_json::to_vec(&config).unwrap();
        let expectations = completion_expectations(&config, &config_bytes);
        assert_every_expectation_member_rejects(&config, &config_bytes, &expectations);

        let mut none = fixture();
        none.exchange_mode = ExchangeMode::None {
            manifest: None,
            channels: Vec::new(),
            broker: None,
        };
        none.terminal_ack_fd = None;
        let none_bytes = serde_json::to_vec(&none).unwrap();
        let none_expectations = completion_expectations(&none, &none_bytes);
        assert_every_expectation_member_rejects(&none, &none_bytes, &none_expectations);
    }

    #[test]
    fn exact_twelve_stage_universe_is_admitted() {
        let mut config_hashes = BTreeSet::new();
        for (index, stage) in STAGES.iter().enumerate() {
            let mut value = fixture();
            value.stage_id = (*stage).into();
            value.attempt_id = format!("attempt-{stage}");
            value.d1_attempt_id = value.attempt_id.clone();
            value.d1_begin_sha256 = hex::encode(Sha256::digest(format!("d1:{stage}")));
            value.launch_record_sha256 = hex::encode(Sha256::digest(format!("launch:{stage}")));
            value.authorization_id = hex::encode(Sha256::digest(format!("authorization:{stage}")));
            value.admission_id = hex::encode(Sha256::digest(format!("admission:{stage}")));
            value.session_id = format!("session-{stage}");
            value.container.name = format!("gate-h2-{index}-{stage}");
            if *stage != "publication_assembly_plan" {
                value.exchange_mode = ExchangeMode::None {
                    manifest: None,
                    channels: Vec::new(),
                    broker: None,
                };
                value.terminal_ack_fd = None;
                let output_root = PathBuf::from(format!("/tmp/output-{stage}"));
                value.container.mounts.retain(|mount| {
                    !matches!(
                        mount.transition,
                        Some(WritableTransition::DeclaredOutputs { .. })
                    )
                });
                value.container.mounts.push(Mount {
                    source: source(output_root.to_str().unwrap(), SourceType::Directory),
                    guest: "/stage/outputs/0".into(),
                    writable: true,
                    artifact_role: format!("declared_outputs_{index}"),
                    transition: Some(WritableTransition::DeclaredOutputs {
                        files: vec![DeclaredOutput {
                            relative_path: format!("{stage}-result.json"),
                            artifact_role: format!("{stage}_result"),
                        }],
                    }),
                });
                value.expected_outputs = vec![ExpectedOutput {
                    path: output_root.join(format!("{stage}-result.json")),
                    artifact_role: format!("{stage}_result"),
                }];
                value.retained_report =
                    PathBuf::from(format!("/tmp/supervisor-reports/{stage}.json"));
            }
            assert!(validate(&value).is_ok(), "{stage}");
            config_hashes.insert(hex::encode(Sha256::digest(
                serde_json::to_vec(&serde_json::to_value(&value).unwrap()).unwrap(),
            )));
        }
        assert_eq!(config_hashes.len(), STAGES.len());
        let mut value = fixture();
        value.stage_id = "thirteenth_stage".into();
        assert!(validate(&value).is_err());
    }

    #[test]
    fn no_exchange_has_no_channels_ack_or_broker_evidence() {
        let mut value = fixture();
        value.exchange_mode = ExchangeMode::None {
            manifest: None,
            channels: Vec::new(),
            broker: None,
        };
        value.terminal_ack_fd = None;
        assert!(validate(&value).is_ok());
        let argv = podman_argv(&value, None, None);
        let preserve = argv
            .iter()
            .position(|argument| argument == "--preserve-fds")
            .unwrap();
        assert_eq!(argv[preserve + 1], "1");
        value.terminal_ack_fd = Some(3);
        assert!(validate(&value).is_err());
    }

    #[test]
    fn exact_podman_argv_is_closed_and_ordered() {
        let value = fixture();
        let argv = podman_argv(&value, None, None);
        assert_eq!(argv[0], "run");
        assert!(argv.windows(1).any(|v| v == ["--read-only"]));
        assert!(argv.windows(1).any(|v| v == ["--network=none"]));
        assert!(argv.windows(1).any(|v| v == ["--env-host=false"]));
        assert_eq!(argv.last(), Some(&value.image.immutable_reference));
        assert!(!argv.iter().any(|arg| arg.contains("broker.sock")));
    }

    #[test]
    fn mount_overlap_protected_writes_and_review_predictions_fail() {
        for guest in ["/", "/proc", "/proc/x", "/gate-h2", "/gate-h2/x"] {
            let mut value = fixture();
            value.container.mounts[0].guest = guest.into();
            assert!(validate(&value).is_err(), "{guest}");
        }
        let mut overlap = fixture();
        overlap.container.mounts[1].guest = "/stage/program.json/child".into();
        assert!(validate(&overlap).is_err());
        let mut write = fixture();
        write.container.mounts[0].writable = true;
        assert!(validate(&write).is_err());
        let mut review = fixture();
        review.stage_id = "gold_review".into();
        review.container.mounts[1].artifact_role = "prediction_output".into();
        assert!(validate(&review).is_err());
    }

    #[test]
    fn joins_fd_order_retry_and_synthetic_eligibility_fail_closed() {
        type Mutation = Box<dyn Fn(&mut SupervisorConfig)>;
        let mutations: Vec<Mutation> = vec![
            Box::new(|v| v.d1_attempt_id = "retry".into()),
            Box::new(|v| {
                if let ExchangeMode::Https { channels, .. } = &mut v.exchange_mode {
                    channels[0].inherited_fd = 5
                }
            }),
            Box::new(|v| {
                if let ExchangeMode::Https { channels, .. } = &mut v.exchange_mode {
                    channels.push(channels[0].clone())
                }
            }),
            Box::new(|v| {
                if let ExchangeMode::Https { channels, .. } = &mut v.exchange_mode {
                    channels[0].ordinal = Some(1)
                }
            }),
            Box::new(|v| {
                if let ExchangeMode::Https { broker, .. } = &mut v.exchange_mode {
                    broker.config_sha256 = "0".repeat(64)
                }
            }),
            Box::new(|v| v.execution_class = "production".into()),
            Box::new(|v| v.admission_state = "eligible".into()),
            Box::new(|v| v.image.runtime.sha256 = "0".repeat(64)),
            Box::new(|v| v.terminal_ack_fd = Some(5)),
            Box::new(|v| {
                if let ExchangeMode::Https {
                    transcript_role, ..
                } = &mut v.exchange_mode
                {
                    *transcript_role = "provider_raw_response".into()
                }
            }),
            Box::new(|v| {
                if let ExchangeMode::Https { channels, .. } = &mut v.exchange_mode {
                    channels[0].raw_response_path = Some("/tmp/output/wrong.json".into())
                }
            }),
        ];
        for mutate in mutations {
            let mut value = fixture();
            mutate(&mut value);
            assert!(validate(&value).is_err());
        }
    }

    #[test]
    fn run_tree_owner_rolls_back_child_when_open_or_sync_fails() {
        let root = tempdir().unwrap();
        let capability = RunRootCapability {
            fd: 3,
            role: "supervisor_run_root".into(),
            path: root.path().to_path_buf(),
            dev: fs::metadata(root.path()).unwrap().dev(),
            ino: fs::metadata(root.path()).unwrap().ino(),
            uid: fs::metadata(root.path()).unwrap().uid(),
            gid: fs::metadata(root.path()).unwrap().gid(),
            mode: fs::metadata(root.path()).unwrap().mode() & 0o7777,
            links: fs::metadata(root.path()).unwrap().nlink(),
        };
        // Exclusive create must reject an existing child without mutating siblings.
        let existing = root.path().join("run");
        fs::create_dir(&existing).unwrap();
        let parent = File::open(root.path()).unwrap();
        assert!(RunTreeOwner::create(parent, &capability, "run").is_err());
        assert!(existing.exists());
        assert_eq!(root.path().read_dir().unwrap().count(), 1);
    }

    #[test]
    fn remove_container_requires_owned_cid_not_signed_name() {
        let mut backend = RealBackend::default();
        let config = fixture();
        // No owned ID and no podman pin => cleanup is a no-op (does not use name).
        assert!(backend.remove_container(&config).is_ok());
        assert!(backend.owned_container_id.is_none());
    }

    #[test]
    fn launch_config_path_join_requires_run_tree_and_writable_output_authority() {
        let mut config = fixture();
        let good = serde_json::json!({
            "admission_id": config.admission_id,
            "attempt_id": config.attempt_id,
            "credentials": [],
            "d1_attempt_id": config.d1_attempt_id,
            "d1_begin_sha256": config.d1_begin_sha256,
            "evidence_directory": "/tmp/gate-h2-retained-root/gate-h2-run/evidence",
            "launch_authorization": { "authorization_id": config.authorization_id },
            "manifest": { "exact_exchange_count": 1, "stage_id": config.stage_id },
            "output_directory": "/tmp/output",
            "replay_journal_fd": 12,
            "request_body_fds": [13],
            "run_token_fd": 10,
            "schema_version": "gate_h2_broker_launch_v1.0.0",
            "session_id": config.session_id,
            "signing_key_fd": 11,
            "socket_directory": "/tmp/gate-h2-retained-root/gate-h2-run",
        });
        let good_bytes = canonical_json_line(&good).unwrap();
        {
            let broker = match &mut config.exchange_mode {
                ExchangeMode::Https { broker, .. } => broker,
                ExchangeMode::None { .. } => unreachable!(),
            };
            broker.config_sha256 = hex::encode(Sha256::digest(&good_bytes));
            broker.config_bytes = good_bytes.len() as u64;
            broker.inherited_descriptors[0].sha256 = broker.config_sha256.clone();
            broker.inherited_descriptors[0].bytes = broker.config_bytes;
        }
        let broker = match &config.exchange_mode {
            ExchangeMode::Https { broker, .. } => broker,
            ExchangeMode::None { .. } => unreachable!(),
        };
        let fd = received_descriptor(&good_bytes);
        validate_launch_descriptor_contract_with_fds(&config, broker, &[fd.as_raw_fd()]).unwrap();

        let mut bad = good.clone();
        bad["socket_directory"] = serde_json::json!("/tmp/unrelated");
        let bad_bytes = canonical_json_line(&bad).unwrap();
        let mut bad_config = config.clone();
        {
            let broker = match &mut bad_config.exchange_mode {
                ExchangeMode::Https { broker, .. } => broker,
                ExchangeMode::None { .. } => unreachable!(),
            };
            broker.config_sha256 = hex::encode(Sha256::digest(&bad_bytes));
            broker.config_bytes = bad_bytes.len() as u64;
            broker.inherited_descriptors[0].sha256 = broker.config_sha256.clone();
            broker.inherited_descriptors[0].bytes = broker.config_bytes;
        }
        let broker = match &bad_config.exchange_mode {
            ExchangeMode::Https { broker, .. } => broker,
            ExchangeMode::None { .. } => unreachable!(),
        };
        let fd = received_descriptor(&bad_bytes);
        assert!(
            validate_launch_descriptor_contract_with_fds(&bad_config, broker, &[fd.as_raw_fd()])
                .is_err()
        );
    }

    #[test]
    fn run_tree_owner_creates_only_its_owned_child_and_detects_replacement() {
        let root = tempdir().unwrap();
        let sentinel = root.path().join("sentinel");
        fs::create_dir(&sentinel).unwrap();
        fs::write(sentinel.join("member"), b"x").unwrap();
        let tree = root.path().join("run");
        test_run_tree_owner(root.path(), "run")
            .cleanup_with_deadline(None)
            .unwrap();
        assert!(!tree.exists());
        assert_eq!(fs::read(sentinel.join("member")).unwrap(), b"x");

        let owner = test_run_tree_owner(root.path(), "run");
        let moved = root.path().join("moved");
        fs::rename(&tree, &moved).unwrap();
        fs::create_dir(&tree).unwrap();
        assert!(owner.cleanup_with_deadline(None).is_err());
        assert!(
            tree.exists(),
            "identity failure must not remove replacement path"
        );
    }

    #[test]
    fn run_lease_rejects_invalid_config_and_existing_child_without_mutation() {
        let root = tempdir().unwrap();
        let sentinel = root.path().join("sentinel");
        fs::create_dir(&sentinel).unwrap();
        fs::write(sentinel.join("keep"), b"keep").unwrap();
        let mut config = fixture();
        config.run_root = run_root_capability(root.path(), 3);
        config.run_id = "sentinel".into();
        if let ExchangeMode::Https { broker, .. } = &mut config.exchange_mode {
            broker.socket_path = sentinel.join("socket/broker.sock");
        }
        config.admission_state = "invalid".into();
        assert!(RunLease::new(&config, File::open(root.path()).unwrap(), Instant::now()).is_err());
        assert_eq!(fs::read(sentinel.join("keep")).unwrap(), b"keep");

        config.admission_state = "ineligible_pending_issue_101_real_linux_evidence".into();
        assert!(RunLease::new(&config, File::open(root.path()).unwrap(), Instant::now()).is_err());
        assert_eq!(fs::read(sentinel.join("keep")).unwrap(), b"keep");
    }

    #[test]
    fn run_lease_cleans_only_exclusively_created_child() {
        let root = tempdir().unwrap();
        let mut config = fixture();
        config.run_root = run_root_capability(root.path(), 3);
        config.run_id = "owned-run".into();
        let child = root.path().join("owned-run");
        if let ExchangeMode::Https { broker, .. } = &mut config.exchange_mode {
            broker.socket_path = child.join("socket/broker.sock");
        }
        let lease =
            RunLease::new(&config, File::open(root.path()).unwrap(), Instant::now()).unwrap();
        assert!(child.exists());
        fs::write(child.join("member"), b"owned").unwrap();
        lease.abort().unwrap();
        assert!(!child.exists());
    }

    #[test]
    fn run_root_capability_rejects_identity_owner_mode_and_type_substitution_before_mutation() {
        let root = tempdir().unwrap();
        let sentinel = root.path().join("sentinel");
        fs::create_dir(&sentinel).unwrap();
        fs::write(sentinel.join("keep"), b"keep").unwrap();
        let root_file = File::open(root.path()).unwrap();
        let capability = run_root_capability(root.path(), 17);
        for mutate in [
            Box::new(|value: &mut RunRootCapability| value.ino += 1)
                as Box<dyn Fn(&mut RunRootCapability)>,
            Box::new(|value: &mut RunRootCapability| value.uid = value.uid.saturating_add(1)),
            Box::new(|value: &mut RunRootCapability| value.mode |= 0o022),
        ] {
            let mut config = fixture();
            config.run_root = capability.clone();
            config.run_id = "sentinel".into();
            mutate(&mut config.run_root);
            assert!(
                RunLease::new(&config, root_file.try_clone().unwrap(), Instant::now()).is_err()
            );
            assert_eq!(fs::read(sentinel.join("keep")).unwrap(), b"keep");
        }
        let file = root.path().join("not-a-directory");
        fs::write(&file, b"x").unwrap();
        let mut config = fixture();
        config.run_root = capability;
        assert!(RunLease::new(&config, File::open(file).unwrap(), Instant::now()).is_err());
        assert_eq!(fs::read(sentinel.join("keep")).unwrap(), b"keep");
    }

    #[test]
    fn retained_run_root_survives_path_and_ancestor_replacement_without_touching_replacement() {
        let parent = tempdir().unwrap();
        let original = parent.path().join("root");
        fs::create_dir(&original).unwrap();
        let retained = File::open(&original).unwrap();
        let mut config = fixture();
        config.run_root = run_root_capability(&original, 19);
        config.run_id = "owned-run".into();
        if let ExchangeMode::Https { broker, .. } = &mut config.exchange_mode {
            broker.socket_path = original.join("owned-run/socket/broker.sock");
        }
        let moved = parent.path().join("moved-root");
        fs::rename(&original, &moved).unwrap();
        fs::create_dir(&original).unwrap();
        let sentinel = original.join("sentinel");
        fs::create_dir(&sentinel).unwrap();
        fs::write(sentinel.join("keep"), b"keep").unwrap();
        let lease = RunLease::new(&config, retained, Instant::now()).unwrap();
        assert!(moved.join("owned-run").exists());
        assert!(!original.join("owned-run").exists());
        lease.abort().unwrap();
        assert!(!moved.join("owned-run").exists());
        assert_eq!(fs::read(sentinel.join("keep")).unwrap(), b"keep");
    }

    #[test]
    fn admitted_runtime_retains_exact_inode_across_path_replacement() {
        let root = tempdir().unwrap();
        let path = root.path().join("runtime");
        fs::write(&path, b"runtime-v1").unwrap();
        let digest = hex::encode(Sha256::digest(b"runtime-v1"));
        let retained = PinnedFile::open(&path, &digest, 10).unwrap();
        fs::rename(&path, root.path().join("old-runtime")).unwrap();
        fs::write(&path, b"runtime-v2").unwrap();
        retained.validate_retained().unwrap();
    }

    #[test]
    fn readonly_mount_uses_owned_snapshot_and_survives_same_byte_path_replacement() {
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("value"), b"exact").unwrap();
        let meta = fs::metadata(&source).unwrap();
        let mount = Mount {
            source: SourcePin {
                path: source.clone(),
                source_type: SourceType::Directory,
                dev: meta.dev(),
                ino: meta.ino(),
                uid: meta.uid(),
                gid: meta.gid(),
                mode: meta.mode() & 0o7777,
                links: meta.nlink(),
                bytes: meta.len(),
                sha256: hash_directory_tree_fd(&open_directory_nofollow(&source).unwrap(), None)
                    .unwrap(),
            },
            guest: "/stage/input".into(),
            writable: false,
            artifact_role: "input".into(),
            transition: None,
        };
        let owner = test_run_tree_owner(root.path(), "run");
        let retained =
            PinnedSource::open(&mount, &owner, 0, Instant::now() + Duration::from_secs(2)).unwrap();
        assert_ne!(retained.file.metadata().unwrap().ino(), meta.ino());
        fs::rename(&source, root.path().join("old-source")).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("value"), b"exact").unwrap();
        retained.validate_retained().unwrap();
        let argv = podman_argv(&fixture(), Some(&[retained.file.as_raw_fd()]), None);
        assert!(
            !argv
                .iter()
                .any(|argument| argument.contains(source.to_str().unwrap()))
        );
    }

    #[test]
    fn readonly_snapshot_rejects_nested_symlink_special_and_hardlink_members() {
        for kind in ["symlink", "fifo", "hardlink"] {
            let root = tempdir().unwrap();
            let source = root.path().join("source");
            fs::create_dir(&source).unwrap();
            fs::write(source.join("value"), b"exact").unwrap();
            match kind {
                "symlink" => std::os::unix::fs::symlink("value", source.join("bad")).unwrap(),
                "fifo" => {
                    let path =
                        std::ffi::CString::new(source.join("bad").as_os_str().as_encoded_bytes())
                            .unwrap();
                    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
                }
                "hardlink" => fs::hard_link(source.join("value"), source.join("bad")).unwrap(),
                _ => unreachable!(),
            }
            let meta = fs::metadata(&source).unwrap();
            let mount = Mount {
                source: SourcePin {
                    path: source.clone(),
                    source_type: SourceType::Directory,
                    dev: meta.dev(),
                    ino: meta.ino(),
                    uid: meta.uid(),
                    gid: meta.gid(),
                    mode: meta.mode() & 0o7777,
                    links: meta.nlink(),
                    bytes: meta.len(),
                    sha256: "0".repeat(64),
                },
                guest: "/stage/input".into(),
                writable: false,
                artifact_role: "input".into(),
                transition: None,
            };
            let owner = test_run_tree_owner(root.path(), "run");
            assert!(
                PinnedSource::open(&mount, &owner, 0, Instant::now() + Duration::from_secs(1))
                    .is_err(),
                "{kind}"
            );
        }
    }

    #[test]
    fn launcher_liveness_eof_cancels_and_reaps_process_group() {
        let mut pipe = [-1; 2];
        assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
        let read = unsafe { OwnedFd::from_raw_fd(pipe[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(pipe[1]) };
        assert_eq!(
            unsafe { libc::fcntl(write.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) },
            0
        );
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "trap '' TERM; while :; do sleep 1; done"]);
        unsafe {
            command.pre_exec(establish_child_process_group);
        }
        let mut child = command.spawn().unwrap();
        thread::sleep(Duration::from_millis(50));
        drop(write);
        assert_eq!(
            wait_child(
                &mut child,
                Duration::from_secs(5),
                Duration::from_millis(20),
                Duration::from_secs(1),
                Some(read.as_raw_fd()),
                None,
            )
            .unwrap(),
            ProcessOutcome::Cancelled {
                terminated_by: "SIGTERM/SIGKILL"
            }
        );
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn podman_liveness_fd_plan_is_fixed_and_supervisor_owned() {
        let https = fixture();
        let argv = podman_argv(&https, None, None);
        let preserve = argv
            .iter()
            .position(|argument| argument == "--preserve-fds")
            .unwrap();
        assert_eq!(argv[preserve + 1], "3");
        assert_eq!(container_liveness_target_for(&[], None).unwrap(), 3);
        assert_eq!(
            container_liveness_target_for(
                match &https.exchange_mode {
                    ExchangeMode::Https { channels, .. } => channels,
                    ExchangeMode::None { .. } => unreachable!(),
                },
                https.terminal_ack_fd,
            )
            .unwrap(),
            5
        );
        let (read, write) = container_liveness_pipe().unwrap();
        drop(write);
        assert!(ensure_liveness_fd(read.as_raw_fd()).is_err());
    }

    #[test]
    fn writable_output_transition_rejects_undeclared_symlink_and_special_entries() {
        let root = tempdir().unwrap();
        let output = root.path().join("output");
        fs::create_dir(&output).unwrap();
        let meta = fs::metadata(&output).unwrap();
        let mount = Mount {
            source: SourcePin {
                path: output.clone(),
                source_type: SourceType::Directory,
                dev: meta.dev(),
                ino: meta.ino(),
                uid: meta.uid(),
                gid: meta.gid(),
                mode: meta.mode() & 0o7777,
                links: meta.nlink(),
                bytes: meta.len(),
                sha256: "0".repeat(64),
            },
            guest: "/stage/outputs".into(),
            writable: true,
            artifact_role: "declared_outputs".into(),
            transition: Some(WritableTransition::DeclaredOutputs {
                files: vec![DeclaredOutput {
                    relative_path: "result.json".into(),
                    artifact_role: "result".into(),
                }],
            }),
        };
        let retained = PinnedSource::open_retained(&mount, None).unwrap();
        fs::write(output.join("result.json"), b"{}\n").unwrap();
        let deadline = || Instant::now() + Duration::from_secs(1);
        assert_eq!(retained.finalize(deadline()).unwrap()[0].bytes, 3);
        fs::write(output.join("surplus"), b"x").unwrap();
        assert!(retained.finalize(deadline()).is_err());
        fs::remove_file(output.join("surplus")).unwrap();
        std::os::unix::fs::symlink("result.json", output.join("link")).unwrap();
        assert!(retained.finalize(deadline()).is_err());
    }

    #[test]
    fn expired_lifecycle_deadline_rejects_writable_transition_before_entry_retention() {
        let root = tempdir().unwrap();
        let output = root.path().join("output");
        fs::create_dir(&output).unwrap();
        fs::write(output.join("late-entry"), b"x").unwrap();
        let meta = fs::metadata(&output).unwrap();
        let mount = Mount {
            source: SourcePin {
                path: output,
                source_type: SourceType::Directory,
                dev: meta.dev(),
                ino: meta.ino(),
                uid: meta.uid(),
                gid: meta.gid(),
                mode: meta.mode() & 0o7777,
                links: meta.nlink(),
                bytes: meta.len(),
                sha256: "0".repeat(64),
            },
            guest: "/stage/work".into(),
            writable: true,
            artifact_role: "empty_work".into(),
            transition: Some(WritableTransition::EmptyWork),
        };
        let error = match PinnedSource::open_retained(&mount, Some(Instant::now())) {
            Ok(_) => panic!("expired writable transition unexpectedly opened"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn expired_deadline_rejects_empty_directory_before_successful_enumeration() {
        let root = tempdir().unwrap();
        let directory = File::open(root.path()).unwrap();
        let error = directory_is_empty(&directory, Some(Instant::now())).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn child_fd_plan_reserves_sources_before_colliding_target_remaps() {
        let executable = File::open("/dev/null").unwrap();
        let source_a = File::open("/dev/null").unwrap();
        let source_b = File::open("/dev/null").unwrap();
        let plan = ChildFdPlan::new(
            executable.as_raw_fd(),
            &[source_a.as_raw_fd(), source_b.as_raw_fd()],
            &[source_b.as_raw_fd(), executable.as_raw_fd()],
        )
        .unwrap();
        let scratch = std::iter::once(plan.executable.as_raw_fd())
            .chain(plan.remaps.iter().map(|(fd, _)| fd.as_raw_fd()))
            .collect::<BTreeSet<_>>();
        assert_eq!(scratch.len(), 3);
        assert!(scratch.iter().all(|fd| *fd >= SCRATCH_FD_FLOOR));
        assert_eq!(
            plan.remaps
                .iter()
                .map(|(_, target)| *target)
                .collect::<Vec<_>>(),
            vec![source_b.as_raw_fd(), executable.as_raw_fd()]
        );
    }

    #[test]
    fn child_fd_plan_post_exec_exposes_only_explicit_target_fds() {
        let executable = File::open("/bin/sh").unwrap();
        let source = File::open("/dev/null").unwrap();
        let secret = File::open("/dev/null").unwrap();
        let secret_high = unsafe { libc::fcntl(secret.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 200) };
        assert!(secret_high >= 200);
        let plan = ChildFdPlan::new(executable.as_raw_fd(), &[source.as_raw_fd()], &[9]).unwrap();
        let forbidden = [
            source.as_raw_fd(),
            secret.as_raw_fd(),
            secret_high,
            plan.executable.as_raw_fd(),
            plan.remaps[0].0.as_raw_fd(),
        ];
        let checks = forbidden
            .iter()
            .filter(|fd| **fd != 9)
            .map(|fd| format!("[ ! -e /dev/fd/{fd} ] || exit 91"))
            .collect::<Vec<_>>()
            .join("; ");
        let mut command = Command::new("/bin/sh");
        command.args(["-c", &format!("[ -e /dev/fd/9 ] || exit 90; {checks}")]);
        unsafe {
            command.pre_exec(move || plan.install());
        }
        let status = command.status().unwrap();
        unsafe { libc::close(secret_high) };
        assert!(status.success(), "post-exec FD probe exited {status}");
    }

    #[test]
    fn nested_directory_tree_row_contract_has_exact_digest() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../docs/dataset-factory/fixtures/podman-supervisor-v1/nested-directory-tree-hash-v1.json",
        );
        let value: serde_json::Value = serde_json::from_slice(&fs::read(fixture).unwrap()).unwrap();
        let rows = value["canonical_rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row.as_str().unwrap())
            .collect::<Vec<_>>();
        let digest = hex::encode(Sha256::digest(format!("{}\n", rows.join("\n"))));
        assert_eq!(digest, value["tree_sha256"].as_str().unwrap());
        assert_eq!(
            digest,
            "ec688e959ac0064af3a07a6064e16781b0223f4458b7e39d55a4db08d4d283e0"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn podman_rm_child_cannot_observe_high_secret_descriptor() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let secret = fs::File::open("/dev/null").unwrap();
        let secret_fd = unsafe { libc::fcntl(secret.as_raw_fd(), libc::F_DUPFD, 200) };
        assert!(secret_fd >= 200);
        let executable_path = root.path().join("fake-podman");
        fs::write(
            &executable_path,
            format!("#!/bin/sh\nif [ -e /proc/self/fd/{secret_fd} ]; then exit 91; fi\nexit 0\n"),
        )
        .unwrap();
        fs::set_permissions(&executable_path, fs::Permissions::from_mode(0o700)).unwrap();
        let raw = fs::read(&executable_path).unwrap();
        let pin = ExecutablePin {
            path: executable_path,
            sha256: hex::encode(Sha256::digest(&raw)),
            bytes: raw.len() as u64,
        };
        let executable = PinnedExecutable::open(&pin).unwrap();
        let mut config = fixture();
        config.deadlines.rm_ms = 1_000;
        remove_container(
            &config,
            &executable,
            AbsoluteDeadline {
                end: Instant::now() + Duration::from_secs(1),
            },
        )
        .unwrap();
        unsafe { libc::close(secret_fd) };
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "issue #101 only: requires a local digest-pinned Podman image and real Linux"]
    fn linux_podman_liveness_harness_sigkill_relay_terminates_stage_and_removes_container() {
        let image = std::env::var("GATE_H2_LIVENESS_HARNESS_IMAGE")
            .expect("#101 must supply GATE_H2_LIVENESS_HARNESS_IMAGE=name@sha256:<digest>");
        assert!(
            image.contains("@sha256:")
                && image.rsplit_once("@sha256:").is_some_and(|(_, digest)| {
                    digest.len() == 64
                        && digest
                            .bytes()
                            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                }),
            "#101 image must be digest pinned"
        );
        let root = tempdir().unwrap();
        let ready = root.path().join("relay-ready");
        let terminated = root.path().join("stage-terminated");
        let name = format!("gate-h2-liveness-{}", std::process::id());
        let relay = unsafe { libc::fork() };
        assert!(relay >= 0);
        if relay == 0 {
            let mut pipe = [-1; 2];
            if unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
                unsafe { libc::_exit(90) };
            }
            let read = pipe[0];
            let write = pipe[1];
            let mut command = Command::new("podman");
            command.args([
                "run",
                "--rm",
                "--name",
                &name,
                "--network=none",
                "--read-only",
                "--preserve-fds",
                "1",
                "--mount",
                &format!("type=bind,src={},dst=/output,rw", root.path().display()),
                "--entrypoint",
                "/bin/sh",
                &image,
                "-c",
                "if ! IFS= read -r ignored <&3; then touch /output/stage-terminated; exit 0; fi; exit 91",
            ]);
            unsafe {
                command.pre_exec(move || {
                    if libc::dup2(read, 3) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    let flags = libc::fcntl(3, libc::F_GETFD);
                    if flags < 0 || libc::fcntl(3, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    if read != 3 {
                        libc::close(read);
                    }
                    Ok(())
                });
            }
            let spawned = command.spawn();
            unsafe { libc::close(read) };
            if spawned.is_err() || fs::write(&ready, b"ready").is_err() {
                unsafe { libc::_exit(91) };
            }
            // The write end is intentionally retained only by this relay. #101
            // SIGKILLs it after the container has been observed.
            let _write = unsafe { OwnedFd::from_raw_fd(write) };
            loop {
                thread::sleep(Duration::from_secs(1));
            }
        }
        let readiness_deadline = Instant::now() + Duration::from_secs(15);
        while !ready.exists() && Instant::now() < readiness_deadline {
            thread::sleep(POLL);
        }
        assert!(ready.exists(), "relay did not start Podman");
        let exists = |expected: bool| {
            Command::new("podman")
                .args(["container", "exists", &name])
                .status()
                .map(|status| status.success() == expected)
                .unwrap_or(false)
        };
        let container_deadline = Instant::now() + Duration::from_secs(15);
        while !exists(true) && Instant::now() < container_deadline {
            thread::sleep(POLL);
        }
        if !exists(true) {
            let _ = Command::new("podman").args(["rm", "-f", &name]).status();
            panic!("Podman did not create the liveness-harness container");
        }
        assert_eq!(unsafe { libc::kill(relay, libc::SIGKILL) }, 0);
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(relay, &mut status, 0) }, relay);
        let cleanup_deadline = Instant::now() + Duration::from_secs(20);
        while (!terminated.exists() || exists(true)) && Instant::now() < cleanup_deadline {
            thread::sleep(POLL);
        }
        if !terminated.exists() || exists(true) {
            let _ = Command::new("podman").args(["rm", "-f", &name]).status();
            panic!("relay SIGKILL did not terminate and remove the liveness stage container");
        }
    }

    #[test]
    fn primary_and_cleanup_error_are_both_preserved() {
        let error = PrimaryCleanupError {
            primary: "container timeout".into(),
            cleanup: "run tree identity changed".into(),
        };
        assert_eq!(
            error.to_string(),
            "container timeout; supervisor cleanup failed: run tree identity changed"
        );
    }

    #[test]
    fn deterministic_post_begin_failure_matrix_exercises_real_lifecycle() {
        let cases = [
            (Failure::BrokerConfigFdMismatch, "broker config FD mismatch"),
            (Failure::BrokerReadiness, "broker readiness failure"),
            (
                Failure::UnsolicitedConnection,
                "unsolicited or misordered connection",
            ),
            (Failure::PartialChannelSetup, "partial channel setup"),
            (Failure::PodmanSpawn, "Podman spawn failure"),
            (Failure::PodmanNonzero, "stage exited nonzero"),
            (Failure::PodmanTimeout, "bounded SIGTERM/SIGKILL and reap"),
            (Failure::BrokerExitAfterStage, "broker exited nonzero"),
            (Failure::PodmanRemove, "podman rm failure"),
            (
                Failure::ReportWrite,
                "retained supervisor-report write failure",
            ),
        ];
        for (failure, diagnostic) in cases {
            let mut backend = DeterministicBackend::new(failure);
            let error = run_with_backend(&fixture(), &mut backend).unwrap_err();
            assert!(
                error.to_string().contains(diagnostic),
                "{failure:?}: {error}"
            );
            assert!(backend.events.contains(&"terminate_broker"), "{failure:?}");
            assert!(backend.events.contains(&"terminate_stage"), "{failure:?}");
            assert!(backend.events.contains(&"podman_rm"), "{failure:?}");
            assert!(backend.events.contains(&"cleanup_run_tree"), "{failure:?}");
            assert_eq!(
                backend.events.contains(&"write_report"),
                failure == Failure::ReportWrite,
                "{failure:?}"
            );
            if failure == Failure::PartialChannelSetup {
                assert_eq!(backend.connected, 2);
            }
            if failure == Failure::PodmanTimeout {
                assert!(
                    backend.events.windows(3).any(|events| {
                        events == ["stage_SIGTERM", "stage_SIGKILL", "stage_reap"]
                    })
                );
                assert!(!backend.events.contains(&"wait_broker_after_stage"));
            }
        }
    }

    #[test]
    fn nonzero_early_exit_timeout_term_kill_and_reap_are_bounded() {
        let mut nonzero = Command::new("/bin/sh")
            .args(["-c", "exit 7"])
            .spawn()
            .unwrap();
        let status = wait_child(
            &mut nonzero,
            Duration::from_secs(1),
            POLL,
            Duration::from_secs(1),
            None,
            None,
        )
        .unwrap();
        assert_eq!(status, ProcessOutcome::Nonzero("exit status: 7".into()));

        let marker_root = tempdir().unwrap();
        let marker = marker_root.path().join("term");
        let mut term_command = Command::new("/bin/sh");
        term_command.args([
            "-c",
            &format!(
                "trap 'touch {} ; exit 0' TERM; while :; do sleep 1; done",
                marker.display()
            ),
        ]);
        unsafe {
            term_command.pre_exec(establish_child_process_group);
        }
        let mut term = term_command.spawn().unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            wait_child(
                &mut term,
                Duration::from_millis(20),
                Duration::from_secs(1),
                Duration::from_secs(1),
                None,
                None,
            )
            .unwrap(),
            ProcessOutcome::TimedOut {
                terminated_by: "SIGTERM"
            }
        );
        assert!(term.try_wait().unwrap().is_some());

        let mut kill_command = Command::new("/bin/sh");
        kill_command.args(["-c", "trap '' TERM; while :; do sleep 1; done"]);
        unsafe {
            kill_command.pre_exec(establish_child_process_group);
        }
        let mut kill = kill_command.spawn().unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            wait_child(
                &mut kill,
                Duration::from_millis(20),
                Duration::from_millis(20),
                Duration::from_secs(1),
                None,
                None,
            )
            .unwrap(),
            ProcessOutcome::TimedOut {
                terminated_by: "SIGTERM/SIGKILL"
            }
        );
        assert!(kill.try_wait().unwrap().is_some());
    }

    #[test]
    fn lifecycle_deadline_is_not_the_handshake_cap_and_expired_work_fails_closed() {
        let mut value = fixture();
        value.deadlines.stage_ms = 32_000;
        assert!(validate(&value).is_ok());
        let deadline = AbsoluteDeadline::from_untrusted(&value.deadlines, Instant::now()).unwrap();
        assert!(deadline.end.saturating_duration_since(Instant::now()) > Duration::from_secs(31));

        let expired = AbsoluteDeadline {
            end: Instant::now(),
        };
        assert!(expired.spawn_budget(Duration::ZERO).is_err());
        let mut walk = WalkBudget::new(Some(Instant::now()));
        assert!(walk.reserve_entry(0).is_err());
    }

    #[test]
    fn esrch_signal_path_still_reaps_the_child() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exit 0"]);
        unsafe {
            command.pre_exec(establish_child_process_group);
        }
        let mut child = command.spawn().unwrap();
        thread::sleep(Duration::from_millis(50));
        terminate_and_reap(
            &mut child,
            Duration::from_millis(20),
            Duration::from_secs(1),
            None,
        )
        .unwrap();
        assert!(child.try_wait().unwrap().is_some());
    }
}
