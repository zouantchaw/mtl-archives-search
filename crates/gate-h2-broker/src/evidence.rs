use std::{
    fs::{self, File, OpenOptions},
    io::{self, Seek, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    TRANSCRIPT_VERSION,
    credential::SecretBytes,
    model::{FilePin, SchemaPin},
};

const EVENT_DOMAIN: &[u8] = b"gate-h2-https-broker-event-v1-schema-bound\0";
const TRANSCRIPT_DOMAIN: &[u8] = b"gate-h2-https-broker-transcript-v1-schema-bound\0";
const AUTHORITY_DOMAIN: &[u8] = b"gate-h2-https-broker-authority-envelope-v2-schema-bound\0";
const SIGNATURE_DOMAIN: &[u8] = b"gate-h2-https-broker-authority-signature-ed25519-v2\0";
pub const SIGNING_KEY_BASE64URL_BYTES: usize = 43;
const EVENT_SCHEMA_SHA256: &str =
    "5c33ce7a3dcee39b87b65f6c8dd196c1a56b8fc8d31ef5ad30684735121e152f";
const TRANSCRIPT_SCHEMA_SHA256: &str =
    "15fc05df41acd422321ccf8e2b834526059f594424d5f675a7f0ce3248169db2";
const AUTHORITY_SCHEMA_SHA256: &str =
    "d7752a9c8325ed7537a58cbe3515cee146e5fb1c122c7a536d1ed8eedf79e079";

#[derive(Clone, Debug, Serialize)]
pub struct Event {
    pub schema_version: &'static str,
    pub schema_pin: SchemaPin,
    pub event_id: String,
    pub manifest_id: String,
    pub capability_id: String,
    pub candidate_id: String,
    pub stage_id: String,
    pub exchange_ordinal: usize,
    pub sequence: usize,
    pub event_type: &'static str,
    pub occurred_at: String,
    pub outcome: &'static str,
    pub evidence: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct Transcript {
    pub schema_version: &'static str,
    pub schema_pin: SchemaPin,
    pub transcript_id: String,
    pub manifest_id: String,
    pub candidate_id: String,
    pub stage_id: String,
    pub run_token_commitment: String,
    pub socket_identity_sha256: String,
    pub started_at: String,
    pub ended_at: String,
    pub expected_exchange_count: usize,
    pub attempted_exchange_count: usize,
    pub completed_exchange_count: usize,
    pub final_outcome: &'static str,
    pub events: Vec<Event>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuthorityBindings {
    pub schema_pin: SchemaPin,
    pub d1_attempt_id: String,
    pub d1_begin_sha256: String,
    pub session_id: String,
    pub attempt_id: String,
    pub broker_binary: FilePin,
    pub stage_runtime: FilePin,
    pub trust_roots: FilePin,
    pub signer_id: String,
    pub signer_trust_entry_sha256: String,
}

#[derive(Debug, Serialize)]
struct AuthorityEnvelope {
    schema_version: &'static str,
    schema_pin: SchemaPin,
    envelope_id: String,
    transcript_id: String,
    transcript_sha256: String,
    manifest_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    session_id: String,
    attempt_id: String,
    broker_binary: FilePin,
    stage_runtime: FilePin,
    trust_roots: FilePin,
    socket_identity_sha256: String,
    run_token_commitment: String,
    final_outcome: &'static str,
    signer_id: String,
    signer_trust_entry_sha256: String,
    public_key_base64url: String,
    signature_algorithm: &'static str,
    signature_base64url: String,
}

pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}

#[derive(Default)]
pub struct SystemClock {
    last_millis: Mutex<u128>,
}

impl Clock for SystemClock {
    fn now(&self) -> String {
        let wall = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_millis();
        let millis = {
            let mut last = self.last_millis.lock().expect("clock mutex poisoned");
            let next = wall.max(last.saturating_add(1));
            *last = next;
            next
        };
        format_unix_millis(millis)
    }
}

pub struct EvidenceWriter {
    directory: PathBuf,
    signing_key: SigningKey,
    authority: AuthorityBindings,
    store: Box<dyn EvidenceStore>,
    pub events: Vec<Event>,
    pub event_schema_pin: SchemaPin,
    pub transcript_schema_pin: SchemaPin,
    sealed: bool,
}

impl EvidenceWriter {
    pub fn new(
        directory: PathBuf,
        signing_key_material: SecretBytes,
        event_schema_pin: SchemaPin,
        transcript_schema_pin: SchemaPin,
        authority: AuthorityBindings,
    ) -> io::Result<Self> {
        Self::new_with_store(
            directory,
            signing_key_material,
            event_schema_pin,
            transcript_schema_pin,
            authority,
            Box::new(FilesystemEvidenceStore),
        )
    }

    fn new_with_store(
        directory: PathBuf,
        signing_key_material: SecretBytes,
        event_schema_pin: SchemaPin,
        transcript_schema_pin: SchemaPin,
        authority: AuthorityBindings,
        store: Box<dyn EvidenceStore>,
    ) -> io::Result<Self> {
        validate_schema_pin(
            &event_schema_pin,
            EVENT_SCHEMA_SHA256,
            3920,
            "gate_h2_https_broker_event_v1.0.0",
        )?;
        validate_schema_pin(
            &transcript_schema_pin,
            TRANSCRIPT_SCHEMA_SHA256,
            2045,
            TRANSCRIPT_VERSION,
        )?;
        validate_authority(&authority)?;
        let seed = decode_signing_key(signing_key_material.expose())?;
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = URL_SAFE_NO_PAD.encode(signing_key.verifying_key().as_bytes());
        let derived_signer_id = hex::encode(Sha256::digest(
            [
                b"gate-h2-ed25519-signer-v1\0".as_slice(),
                public_key.as_bytes(),
            ]
            .concat(),
        ));
        if derived_signer_id != authority.signer_id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "signing key does not match signer identity",
            ));
        }
        store.create_private_directory(&directory)?;
        Ok(Self {
            directory,
            signing_key,
            authority,
            store,
            events: Vec::new(),
            event_schema_pin,
            transcript_schema_pin,
            sealed: false,
        })
    }

    #[cfg(test)]
    pub(crate) fn new_faulting_for_test(
        directory: PathBuf,
        signing_key_material: SecretBytes,
        event_schema_pin: SchemaPin,
        transcript_schema_pin: SchemaPin,
        authority: AuthorityBindings,
        target: EvidenceFaultTarget,
        point: EvidenceFaultPoint,
    ) -> io::Result<Self> {
        Self::new_with_store(
            directory,
            signing_key_material,
            event_schema_pin,
            transcript_schema_pin,
            authority,
            Box::new(FaultEvidenceStore::new(target, point)),
        )
    }

    pub fn append(&mut self, mut event: Event) -> io::Result<()> {
        if self.sealed {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "evidence is sealed",
            ));
        }
        event.event_id = domain_id(EVENT_DOMAIN, &event, "event_id")?;
        let bytes = canonical_json_line(&serde_json::to_value(&event)?);
        self.store.persist(
            EvidenceRecord::Event,
            &self
                .directory
                .join(format!("event-{:04}.json", event.sequence)),
            &bytes,
            0o600,
        )?;
        self.events.push(event);
        Ok(())
    }

    pub fn replace_last(&mut self, mut event: Event) -> io::Result<()> {
        if self.sealed {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "evidence is sealed",
            ));
        }
        let last = self
            .events
            .last()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no event to replace"))?;
        if event.sequence != last.sequence
            || event.exchange_ordinal != last.exchange_ordinal
            || event.capability_id != last.capability_id
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "replacement event identity mismatch",
            ));
        }
        event.event_id = domain_id(EVENT_DOMAIN, &event, "event_id")?;
        let bytes = canonical_json_line(&serde_json::to_value(&event)?);
        self.store.persist(
            EvidenceRecord::Event,
            &self
                .directory
                .join(format!("event-{:04}.json", event.sequence)),
            &bytes,
            0o600,
        )?;
        *self.events.last_mut().expect("last event checked above") = event;
        Ok(())
    }

    pub fn seal(&mut self, mut transcript: Transcript) -> io::Result<(PathBuf, String)> {
        if self.sealed {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "evidence is sealed",
            ));
        }
        transcript.transcript_id = domain_id(TRANSCRIPT_DOMAIN, &transcript, "transcript_id")?;
        let transcript_bytes = canonical_json_line(&serde_json::to_value(&transcript)?);
        let transcript_path = self.directory.join("transcript.v1.json");
        self.store.persist(
            EvidenceRecord::Transcript,
            &transcript_path,
            &transcript_bytes,
            0o600,
        )?;

        let public_key_base64url =
            URL_SAFE_NO_PAD.encode(self.signing_key.verifying_key().as_bytes());
        let mut envelope = AuthorityEnvelope {
            schema_version: "gate_h2_https_broker_authority_envelope_v2.0.0",
            schema_pin: self.authority.schema_pin.clone(),
            envelope_id: String::new(),
            transcript_id: transcript.transcript_id.clone(),
            transcript_sha256: hex::encode(Sha256::digest(&transcript_bytes)),
            manifest_id: transcript.manifest_id.clone(),
            d1_attempt_id: self.authority.d1_attempt_id.clone(),
            d1_begin_sha256: self.authority.d1_begin_sha256.clone(),
            session_id: self.authority.session_id.clone(),
            attempt_id: self.authority.attempt_id.clone(),
            broker_binary: self.authority.broker_binary.clone(),
            stage_runtime: self.authority.stage_runtime.clone(),
            trust_roots: self.authority.trust_roots.clone(),
            socket_identity_sha256: transcript.socket_identity_sha256.clone(),
            run_token_commitment: transcript.run_token_commitment.clone(),
            final_outcome: transcript.final_outcome,
            signer_id: self.authority.signer_id.clone(),
            signer_trust_entry_sha256: self.authority.signer_trust_entry_sha256.clone(),
            public_key_base64url,
            signature_algorithm: "ed25519",
            signature_base64url: String::new(),
        };
        envelope.envelope_id = authority_envelope_id(&envelope)?;
        let unsigned = unsigned_envelope_bytes(&envelope)?;
        let signature = self
            .signing_key
            .sign(&[SIGNATURE_DOMAIN, unsigned.as_bytes()].concat());
        envelope.signature_base64url = URL_SAFE_NO_PAD.encode(signature.to_bytes());
        let envelope_bytes = canonical_json_line(&serde_json::to_value(&envelope)?);
        self.store.persist(
            EvidenceRecord::Envelope,
            &self.directory.join("transcript.authority.v2.json"),
            &envelope_bytes,
            0o600,
        )?;
        self.store.sync_directory(&self.directory)?;
        self.sealed = true;
        Ok((transcript_path, transcript.transcript_id))
    }
}

fn decode_signing_key(encoded: &[u8]) -> io::Result<Zeroizing<[u8; 32]>> {
    if encoded.len() != SIGNING_KEY_BASE64URL_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid signing key representation",
        ));
    }
    let mut decoded = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid signing key"))?,
    );
    if URL_SAFE_NO_PAD.encode(&*decoded).as_bytes() != encoded {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "noncanonical signing key representation",
        ));
    }
    let seed = Zeroizing::new(
        decoded
            .as_slice()
            .try_into()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid signing key"))?,
    );
    decoded.zeroize();
    Ok(seed)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EvidenceRecord {
    Event,
    Transcript,
    Envelope,
}

trait EvidenceStore: Send {
    fn create_private_directory(&self, path: &Path) -> io::Result<()>;
    fn persist(
        &self,
        record: EvidenceRecord,
        path: &Path,
        bytes: &[u8],
        mode: u32,
    ) -> io::Result<()>;
    fn sync_directory(&self, directory: &Path) -> io::Result<()>;
}

struct FilesystemEvidenceStore;

impl EvidenceStore for FilesystemEvidenceStore {
    fn create_private_directory(&self, path: &Path) -> io::Result<()> {
        create_private_directory_and_sync(path)
    }

    fn persist(
        &self,
        _record: EvidenceRecord,
        path: &Path,
        bytes: &[u8],
        mode: u32,
    ) -> io::Result<()> {
        atomic_fsync(path, bytes, mode)
    }

    fn sync_directory(&self, directory: &Path) -> io::Result<()> {
        File::open(directory)?.sync_all()
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EvidenceFaultTarget {
    DirectoryParentSync,
    Event(usize),
    Transcript,
    Envelope,
    FinalDirectorySync,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EvidenceFaultPoint {
    Append,
    Fsync,
}

#[cfg(test)]
struct FaultEvidenceStore {
    target: EvidenceFaultTarget,
    point: EvidenceFaultPoint,
    event_index: Mutex<usize>,
}

#[cfg(test)]
impl FaultEvidenceStore {
    fn new(target: EvidenceFaultTarget, point: EvidenceFaultPoint) -> Self {
        Self {
            target,
            point,
            event_index: Mutex::new(0),
        }
    }

    fn targets(&self, record: EvidenceRecord) -> bool {
        match (self.target, record) {
            (EvidenceFaultTarget::Event(expected), EvidenceRecord::Event) => {
                let mut index = self.event_index.lock().expect("fault counter poisoned");
                let matches = *index == expected;
                *index += 1;
                matches
            }
            (EvidenceFaultTarget::Transcript, EvidenceRecord::Transcript)
            | (EvidenceFaultTarget::Envelope, EvidenceRecord::Envelope) => true,
            _ => false,
        }
    }
}

#[cfg(test)]
impl EvidenceStore for FaultEvidenceStore {
    fn create_private_directory(&self, path: &Path) -> io::Result<()> {
        create_private_directory_without_sync(path)?;
        if self.target == EvidenceFaultTarget::DirectoryParentSync {
            return Err(io::Error::other(
                "injected evidence directory parent fsync failure",
            ));
        }
        File::open(path.parent().expect("evidence directory has parent"))?.sync_all()
    }

    fn persist(
        &self,
        record: EvidenceRecord,
        path: &Path,
        bytes: &[u8],
        mode: u32,
    ) -> io::Result<()> {
        if !self.targets(record) {
            return atomic_fsync(path, bytes, mode);
        }
        if self.point == EvidenceFaultPoint::Append {
            return Err(io::Error::other("injected evidence append failure"));
        }
        atomic_write_without_sync(path, bytes, mode)?;
        Err(io::Error::other("injected evidence fsync failure"))
    }

    fn sync_directory(&self, directory: &Path) -> io::Result<()> {
        if self.target == EvidenceFaultTarget::FinalDirectorySync {
            return Err(io::Error::other("injected final directory fsync failure"));
        }
        File::open(directory)?.sync_all()
    }
}

pub fn transcript_base(schema_pin: SchemaPin) -> Transcript {
    Transcript {
        schema_version: TRANSCRIPT_VERSION,
        schema_pin,
        transcript_id: String::new(),
        manifest_id: String::new(),
        candidate_id: String::new(),
        stage_id: String::new(),
        run_token_commitment: String::new(),
        socket_identity_sha256: String::new(),
        started_at: String::new(),
        ended_at: String::new(),
        expected_exchange_count: 0,
        attempted_exchange_count: 0,
        completed_exchange_count: 0,
        final_outcome: "failed_closed",
        events: Vec::new(),
    }
}

pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).expect("serializable JSON scalar")
        }
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let sorted: std::collections::BTreeMap<&String, &Value> = values.iter().collect();
            format!(
                "{{{}}}",
                sorted
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("serializable JSON key"),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn canonical_json_line(value: &Value) -> Vec<u8> {
    let mut bytes = canonical_json(value).into_bytes();
    bytes.push(b'\n');
    bytes
}

fn unsigned_envelope_bytes(envelope: &AuthorityEnvelope) -> io::Result<String> {
    let mut value = serde_json::to_value(envelope)?;
    value
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "authority object required"))?
        .remove("signature_base64url");
    Ok(canonical_json(&value))
}

fn authority_envelope_id(envelope: &AuthorityEnvelope) -> io::Result<String> {
    let mut value = serde_json::to_value(envelope)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "authority object required"))?;
    object.remove("envelope_id");
    object.remove("signature_base64url");
    let mut hash = Sha256::new();
    hash.update(AUTHORITY_DOMAIN);
    hash.update(canonical_json(&value));
    Ok(hex::encode(hash.finalize()))
}

fn domain_id<T: Serialize>(domain: &[u8], value: &T, id_field: &str) -> io::Result<String> {
    let mut object = match serde_json::to_value(value)? {
        Value::Object(value) => value,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "ID object required",
            ));
        }
    };
    object.remove(id_field);
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(canonical_json(&Value::Object(object)));
    Ok(hex::encode(hash.finalize()))
}

fn validate_schema_pin(pin: &SchemaPin, sha256: &str, bytes: u64, version: &str) -> io::Result<()> {
    if pin.sha256 != sha256 || pin.bytes != bytes || pin.schema_version != version {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "untrusted schema pin",
        ));
    }
    Ok(())
}

fn validate_authority(authority: &AuthorityBindings) -> io::Result<()> {
    validate_schema_pin(
        &authority.schema_pin,
        AUTHORITY_SCHEMA_SHA256,
        2697,
        "gate_h2_https_broker_authority_envelope_v2.0.0",
    )?;
    let identifiers = [
        &authority.d1_attempt_id,
        &authority.session_id,
        &authority.attempt_id,
    ];
    if identifiers.iter().any(|value| {
        value.is_empty()
            || !value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)
            })
    }) || !is_sha256(&authority.d1_begin_sha256)
        || !is_sha256(&authority.signer_id)
        || !is_sha256(&authority.signer_trust_entry_sha256)
        || !valid_file_pin(&authority.broker_binary)
        || !valid_file_pin(&authority.stage_runtime)
        || !valid_file_pin(&authority.trust_roots)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid evidence authority",
        ));
    }
    Ok(())
}

fn valid_file_pin(pin: &FilePin) -> bool {
    is_sha256(&pin.sha256) && pin.bytes > 0 && !pin.version.is_empty()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn create_private_directory_without_sync(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "directory has no parent"))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.file_type().is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.uid() != unsafe { libc::geteuid() }
        || parent_metadata.permissions().mode() & 0o022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe evidence/output parent directory",
        ));
    }
    fs::create_dir(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o7777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe evidence directory",
        ));
    }
    Ok(())
}

fn create_private_directory_and_sync(path: &Path) -> io::Result<()> {
    create_private_directory_without_sync(path)?;
    File::open(path.parent().expect("directory has parent"))?.sync_all()
}

#[cfg(test)]
pub(crate) fn create_private_directory_with_parent_fsync_fault_for_test(
    path: &Path,
) -> io::Result<()> {
    create_private_directory_without_sync(path)?;
    Err(io::Error::other(
        "injected evidence/output directory parent fsync failure",
    ))
}

fn atomic_fsync(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    atomic_fsync_inner(path, bytes, mode)
}

fn atomic_fsync_inner(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(mode);
    let mut file = options.open(&temporary)?;
    set_exact_mode(&file, mode)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    let initial = validate_private_file(&file, mode, bytes.len() as u64)?;
    drop(file);
    fs::rename(&temporary, path)?;
    let committed = OpenOptions::new().read(true).open(path)?;
    let final_metadata = validate_private_file(&committed, mode, bytes.len() as u64)?;
    if initial.dev() != final_metadata.dev() || initial.ino() != final_metadata.ino() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "evidence file inode binding mismatch",
        ));
    }
    File::open(path.parent().expect("path has parent"))?.sync_all()
}

#[cfg(test)]
fn atomic_write_without_sync(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let temporary = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(temporary)?;
    set_exact_mode(&file, mode)?;
    file.write_all(bytes)
}

fn set_exact_mode(file: &File, mode: u32) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::fchmod(file.as_raw_fd(), mode as libc::mode_t) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn validate_private_file(file: &File, mode: u32, bytes: u64) -> io::Result<fs::Metadata> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o7777 != mode
        || metadata.nlink() != 1
        || metadata.len() != bytes
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe private output file",
        ));
    }
    Ok(metadata)
}

pub struct CommittedOutput {
    pub path: PathBuf,
    pub sha256: String,
    pub bytes: u64,
}

pub fn commit_output(directory: &Path, role: &str, bytes: &[u8]) -> io::Result<CommittedOutput> {
    commit_output_inner(directory, role, bytes, |_| Ok(()), |_| Ok(()))
}

fn commit_output_inner(
    directory: &Path,
    role: &str,
    bytes: &[u8],
    after_create: impl FnOnce(&File) -> io::Result<()>,
    after_rename: impl FnOnce(&File) -> io::Result<()>,
) -> io::Result<CommittedOutput> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::{
                ffi::OsStrExt,
                fs::{MetadataExt, PermissionsExt},
            },
        },
    };
    if role.is_empty()
        || !role
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid output role",
        ));
    }
    if !directory.exists() {
        create_private_directory_and_sync(directory)?;
    }
    let directory_name = CString::new(directory.as_os_str().as_bytes())?;
    let directory_fd = unsafe {
        libc::open(
            directory_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if directory_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let retained_directory = File::from(unsafe { OwnedFd::from_raw_fd(directory_fd) });
    let metadata = retained_directory.metadata()?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o7777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe output directory",
        ));
    }
    let path = directory.join(format!("{role}.bin"));
    let destination = CString::new(format!("{role}.bin"))?;
    let temporary = CString::new(format!(".{role}.{}.tmp", std::process::id()))?;
    let output_fd = unsafe {
        libc::openat(
            retained_directory.as_raw_fd(),
            temporary.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if output_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut committed = File::from(unsafe { OwnedFd::from_raw_fd(output_fd) });
    set_exact_mode(&committed, 0o600)?;
    after_create(&committed)?;
    validate_private_file(&committed, 0o600, 0)?;
    committed.write_all(bytes)?;
    committed.sync_all()?;
    let initial = validate_private_file(&committed, 0o600, bytes.len() as u64)?;
    committed.rewind()?;
    let mut hash = Sha256::new();
    let read_bytes = io::copy(&mut committed, &mut hash)?;
    let digest = hex::encode(hash.finalize());
    if read_bytes != initial.len() || digest != hex::encode(Sha256::digest(bytes)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output readback mismatch",
        ));
    }
    let after_read = validate_private_file(&committed, 0o600, read_bytes)?;
    if after_read.dev() != initial.dev()
        || after_read.ino() != initial.ino()
        || after_read.uid() != initial.uid()
        || after_read.permissions().mode() & 0o7777 != initial.permissions().mode() & 0o7777
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output changed during retained readback",
        ));
    }
    if unsafe {
        libc::renameat(
            retained_directory.as_raw_fd(),
            temporary.as_ptr(),
            retained_directory.as_raw_fd(),
            destination.as_ptr(),
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    after_rename(&committed)?;
    retained_directory.sync_all()?;
    let mut final_status = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe {
        libc::fstatat(
            retained_directory.as_raw_fd(),
            destination.as_ptr(),
            final_status.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    let final_status = unsafe { final_status.assume_init() };
    if final_status.st_dev as u64 != initial.dev()
        || final_status.st_ino != initial.ino()
        || final_status.st_size as u64 != read_bytes
        || final_status.st_nlink != 1
        || final_status.st_uid != unsafe { libc::geteuid() }
        || u32::from(final_status.st_mode & 0o7777) != 0o600
        || final_status.st_mode & libc::S_IFMT != libc::S_IFREG
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output inode binding mismatch",
        ));
    }
    let retained_before = validate_private_file(&committed, 0o600, read_bytes)?;
    committed.rewind()?;
    let mut final_hash = Sha256::new();
    let final_read_bytes = io::copy(&mut committed, &mut final_hash)?;
    let final_digest = hex::encode(final_hash.finalize());
    let retained_after = validate_private_file(&committed, 0o600, read_bytes)?;
    if !same_output_identity(&initial, &retained_before)
        || !same_output_identity(&retained_before, &retained_after)
        || final_read_bytes != read_bytes
        || final_digest != digest
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output changed across rename",
        ));
    }
    Ok(CommittedOutput {
        path,
        sha256: final_digest,
        bytes: final_read_bytes,
    })
}

fn same_output_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.permissions().mode() == right.permissions().mode()
        && left.nlink() == right.nlink()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
}

#[cfg(test)]
mod output_mode_tests {
    use super::*;
    use std::os::{fd::AsRawFd, unix::fs::PermissionsExt};

    fn add_mode(file: &File, bits: u32) -> io::Result<()> {
        let mode = file.metadata()?.permissions().mode() & 0o7777;
        if unsafe { libc::fchmod(file.as_raw_fd(), (mode | bits) as libc::mode_t) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn replace_content_same_length(file: &File) -> io::Result<()> {
        let replacement = b"fail";
        if unsafe {
            libc::pwrite(
                file.as_raw_fd(),
                replacement.as_ptr().cast(),
                replacement.len(),
                0,
            )
        } != replacement.len() as isize
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    #[test]
    fn preexisting_output_directories_require_exact_0700() {
        for mode in [0o4700, 0o2700, 0o1700] {
            let root = tempfile::tempdir().unwrap();
            let output = root.path().join(format!("output-{mode:o}"));
            fs::create_dir(&output).unwrap();
            fs::set_permissions(&output, fs::Permissions::from_mode(mode)).unwrap();
            assert!(
                commit_output(&output, "response", b"body").is_err(),
                "{mode:o}"
            );
        }
    }

    #[test]
    fn output_mode_mutations_after_create_and_rename_fail_closed() {
        for after_rename in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let output = root.path().join("output");
            fs::create_dir(&output).unwrap();
            fs::set_permissions(&output, fs::Permissions::from_mode(0o700)).unwrap();
            let result = if after_rename {
                commit_output_inner(
                    &output,
                    "response",
                    b"body",
                    |_| Ok(()),
                    |file| add_mode(file, 0o1000),
                )
            } else {
                commit_output_inner(
                    &output,
                    "response",
                    b"body",
                    |file| add_mode(file, 0o4000),
                    |_| Ok(()),
                )
            };
            assert!(result.is_err(), "after_rename={after_rename}");
        }
    }

    #[test]
    fn output_same_length_content_change_after_rename_fails_closed() {
        let root = tempfile::tempdir().unwrap();
        let output = root.path().join("output");
        fs::create_dir(&output).unwrap();
        fs::set_permissions(&output, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(
            commit_output_inner(
                &output,
                "response",
                b"body",
                |_| Ok(()),
                replace_content_same_length,
            )
            .is_err()
        );
    }
}

fn format_unix_millis(millis: u128) -> String {
    let seconds = (millis / 1000) as libc::time_t;
    let mut broken_down: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::gmtime_r(&seconds, &mut broken_down) };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        broken_down.tm_year + 1900,
        broken_down.tm_mon + 1,
        broken_down.tm_mday,
        broken_down.tm_hour,
        broken_down.tm_min,
        broken_down.tm_sec,
        millis % 1000
    )
}

#[cfg(test)]
mod signing_key_representation_tests {
    use super::*;

    #[test]
    fn canonical_unpadded_base64url_seed_is_exactly_43_bytes() {
        let encoded = URL_SAFE_NO_PAD.encode([7_u8; 32]);
        assert_eq!(encoded.len(), SIGNING_KEY_BASE64URL_BYTES);
        assert_eq!(*decode_signing_key(encoded.as_bytes()).unwrap(), [7_u8; 32]);
    }

    #[test]
    fn signing_key_representation_rejects_noncanonical_short_long_and_alphabet() {
        let canonical = URL_SAFE_NO_PAD.encode([8_u8; 32]);
        assert!(decode_signing_key(&canonical.as_bytes()[..42]).is_err());
        assert!(decode_signing_key(format!("{canonical}=").as_bytes()).is_err());
        let mut invalid = canonical.into_bytes();
        invalid[0] = b'+';
        assert!(decode_signing_key(&invalid).is_err());
    }
}
