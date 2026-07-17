use std::{
    fs::File,
    io::{self, Read, Write},
    os::unix::net::UnixStream,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::fs::MetadataExt,
    },
    path::Path,
    time::Duration,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::model::{ExchangeRequest, ExchangeResponse};

const STAGE_SCHEMA_SHA256: &str =
    "6d2a30170cf640279292ab4fd40ef70ccf46f47ac504bfee57a791842a301c2c";
const MAX_PROGRAM_BYTES: usize = 64 * 1024;
const MAX_AUTHORITY_BYTES: usize = 64 * 1024;
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_UDS_RESPONSE_BYTES: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StageProgram {
    schema_version: String,
    schema_sha256: String,
    executor_contract: String,
    action: String,
    input_artifact_roles: Vec<String>,
    output_indexes: Vec<u64>,
    broker_socket_role: String,
    one_run_token_role: String,
    https_exchange_handles: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StageAuthority {
    schema_version: String,
    program_sha256: String,
    program_bytes: u64,
    manifest_id: String,
    capability_ids: Vec<String>,
    input_artifact_roles: Vec<String>,
    output_indexes: Vec<u64>,
}

pub fn run_fixed() -> Result<(), Box<dyn std::error::Error>> {
    run(Path::new("/stage"), Path::new("/run/gate-h2"))
}

pub fn run(stage_path: &Path, run_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let stage = SecureRoot::open(stage_path)?;
    let run = SecureRoot::open(run_path)?;
    let program_bytes = stage.read_direct("program.json", MAX_PROGRAM_BYTES)?;
    let authority_bytes = run.read_direct("stage-authority.json", MAX_AUTHORITY_BYTES)?;
    let program: StageProgram =
        serde_json::from_value(crate::uds::parse_strict_json(&program_bytes)?)?;
    let authority: StageAuthority =
        serde_json::from_value(crate::uds::parse_strict_json(&authority_bytes)?)?;
    validate_program(&program, &program_bytes, &authority)?;
    let token = Zeroizing::new(run.read_direct("run-token", 128)?);
    if token.len() != 43
        || !token
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(byte))
    {
        return Err("invalid one-run token".into());
    }
    run.validate_socket("broker.sock")?;

    for ordinal in 0..program.https_exchange_handles.len() {
        let role = &program.input_artifact_roles[ordinal];
        let body = stage.read_nested("inputs", &format!("{role}.json"), MAX_INPUT_BYTES)?;
        let request = ExchangeRequest {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_request".into(),
            request_id: format!("{ordinal:032x}"),
            run_token: std::str::from_utf8(&token)?.to_owned(),
            capability_handle: program.https_exchange_handles[ordinal].clone(),
            request_artifact_role: role.clone(),
            request_artifact_sha256: hex::encode(Sha256::digest(&body)),
            request_artifact_bytes: body.len() as u64,
        };
        let response = call(
            &run_path.join("broker.sock"),
            &authority.capability_ids[ordinal],
            &request,
        )?;
        if response.outcome != "accepted" || !response.exchange_consumed {
            return Err("broker exchange failed closed".into());
        }
        let output = response
            .output_artifact
            .as_ref()
            .ok_or("missing output artifact")?;
        if !valid_role(&output.artifact_role)
            || output.sha256.len() != 64
            || !output.sha256.bytes().all(is_lower_hex)
            || output.media_type != "application/json"
            || output.bytes == 0
        {
            return Err("invalid broker output artifact".into());
        }
        let receipt = serde_json::to_vec(&response)?;
        stage.commit_nested(
            "outputs",
            &format!("{}.receipt.json", program.output_indexes[ordinal]),
            &receipt,
        )?;
    }
    Ok(())
}

fn validate_program(
    program: &StageProgram,
    bytes: &[u8],
    authority: &StageAuthority,
) -> Result<(), Box<dyn std::error::Error>> {
    let count = program.https_exchange_handles.len();
    if program.schema_version != "reviewed_metrics_stage_program_v2.2.0"
        || program.schema_sha256 != STAGE_SCHEMA_SHA256
        || program.executor_contract != "gate_h2_static_stage_program_executor_v2"
        || program.action != "invoke_exact_https_exchange"
        || program.broker_socket_role != "owner_bound_https_exchange_socket"
        || program.one_run_token_role != "broker_one_run_token"
        || count == 0
        || count > 16
        || program.input_artifact_roles.len() != count
        || program.output_indexes.len() != count + 1
        || program.output_indexes.iter().copied().ne(0..=count as u64)
        || has_duplicates(&program.input_artifact_roles)
        || has_duplicates(&program.https_exchange_handles)
        || program
            .input_artifact_roles
            .iter()
            .any(|role| !valid_role(role))
        || program
            .https_exchange_handles
            .iter()
            .any(|handle| !valid_handle(handle))
        || authority.schema_version != "gate_h2_stage_program_authority_v1.0.0"
        || authority.program_sha256 != hex::encode(Sha256::digest(bytes))
        || authority.program_bytes != bytes.len() as u64
        || !is_sha256(&authority.manifest_id)
        || authority.capability_ids.len() != count
        || authority.capability_ids.iter().any(|id| !is_sha256(id))
        || has_duplicates(&authority.capability_ids)
        || authority.input_artifact_roles != program.input_artifact_roles
        || authority.output_indexes != program.output_indexes
    {
        return Err("invalid or unauthorized stage program".into());
    }
    Ok(())
}

fn call(
    socket: &Path,
    capability_id: &str,
    request: &ExchangeRequest,
) -> Result<ExchangeResponse, Box<dyn std::error::Error>> {
    let body = Zeroizing::new(serde_json::to_vec(request)?);
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    write!(
        stream,
        "POST /v1/exchange/{capability_id} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.shutdown(std::net::Shutdown::Write)?;
    let mut response = Vec::new();
    stream
        .take((MAX_UDS_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut response)?;
    if response.len() > MAX_UDS_RESPONSE_BYTES {
        return Err("broker response exceeds cap".into());
    }
    parse_response(&response)
}

fn parse_response(bytes: &[u8]) -> Result<ExchangeResponse, Box<dyn std::error::Error>> {
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("malformed broker response")?
        + 4;
    let mut headers = [httparse::EMPTY_HEADER; 8];
    let mut response = httparse::Response::new(&mut headers);
    if response.parse(&bytes[..header_end])? != httparse::Status::Complete(header_end)
        || response.version != Some(1)
        || response.code != Some(200)
    {
        return Err("invalid broker HTTP status".into());
    }
    let mut content_type = None;
    let mut connection = None;
    let mut content_length = None;
    for header in response.headers {
        let value = std::str::from_utf8(header.value)?;
        let slot = if header.name == "content-type" {
            &mut content_type
        } else if header.name == "connection" {
            &mut connection
        } else if header.name == "content-length" {
            if content_length.is_some() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err("duplicate or invalid response length".into());
            }
            content_length = Some(value.parse::<usize>()?);
            continue;
        } else {
            return Err("unexpected broker response header".into());
        };
        if slot.replace(value).is_some() {
            return Err("duplicate broker response header".into());
        }
    }
    let length = content_length.ok_or("missing broker response length")?;
    if content_type != Some("application/json")
        || connection != Some("close")
        || bytes.len() != header_end + length
    {
        return Err("invalid broker response framing".into());
    }
    let value = crate::uds::parse_strict_json(&bytes[header_end..])?;
    Ok(serde_json::from_value(value)?)
}

struct SecureRoot(File);

impl SecureRoot {
    fn open(path: &Path) -> io::Result<Self> {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let file = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        validate_directory(&file)?;
        Ok(Self(file))
    }

    fn read_direct(&self, name: &str, cap: usize) -> io::Result<Vec<u8>> {
        read_at(self.0.as_raw_fd(), name, cap)
    }

    fn read_nested(&self, directory: &str, name: &str, cap: usize) -> io::Result<Vec<u8>> {
        let child = open_directory_at(self.0.as_raw_fd(), directory)?;
        read_at(child.as_raw_fd(), name, cap)
    }

    fn commit_nested(&self, directory: &str, name: &str, bytes: &[u8]) -> io::Result<()> {
        let child = open_directory_at(self.0.as_raw_fd(), directory)?;
        let temporary = format!(".{name}.tmp");
        let mut file = open_file_at(
            child.as_raw_fd(),
            &temporary,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
            0o600,
        )?;
        file.write_all(bytes)?;
        file.sync_all()?;
        rename_at(child.as_raw_fd(), &temporary, name)?;
        child.sync_all()
    }

    fn validate_socket(&self, name: &str) -> io::Result<()> {
        if !valid_component(name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid socket name",
            ));
        }
        let name = std::ffi::CString::new(name)?;
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                self.0.as_raw_fd(),
                name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        if stat.st_mode & libc::S_IFMT != libc::S_IFSOCK
            || stat.st_uid != unsafe { libc::geteuid() }
            || stat.st_mode & 0o077 != 0
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe broker socket",
            ));
        }
        Ok(())
    }
}

fn open_directory_at(parent: i32, name: &str) -> io::Result<File> {
    let file = open_file_at(parent, name, libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
    validate_directory(&file)?;
    Ok(file)
}

fn read_at(parent: i32, name: &str, cap: usize) -> io::Result<Vec<u8>> {
    let mut file = open_file_at(parent, name, libc::O_RDONLY, 0)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.nlink() != 1 || metadata.len() > cap as u64 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe stage file",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take((cap + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > cap {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "stage file exceeds cap",
        ));
    }
    Ok(bytes)
}

fn open_file_at(parent: i32, name: &str, flags: i32, mode: libc::mode_t) -> io::Result<File> {
    if !valid_component(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid path component",
        ));
    }
    let name = std::ffi::CString::new(name)?;
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            mode as libc::c_uint,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
    }
}

fn rename_at(parent: i32, from: &str, to: &str) -> io::Result<()> {
    let from = std::ffi::CString::new(from)?;
    let to = std::ffi::CString::new(to)?;
    if unsafe { libc::renameat(parent, from.as_ptr(), parent, to.as_ptr()) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn validate_directory(file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe stage directory",
        ));
    }
    Ok(())
}

fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains('/')
        && !value.contains('\\')
        && !value.as_bytes().contains(&0)
}

fn valid_role(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_handle(value: &str) -> bool {
    (36..=90).contains(&value.len())
        && value.starts_with("h2h_")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(is_lower_hex)
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn has_duplicates(values: &[String]) -> bool {
    let mut seen = std::collections::HashSet::new();
    values.iter().any(|value| !seen.insert(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, thread};

    #[test]
    fn stage_runtime_executes_exact_authorized_program_over_uds() {
        let root = tempfile::tempdir().unwrap();
        let stage = root.path().join("stage");
        let run_root = root.path().join("run");
        for directory in [
            stage.clone(),
            stage.join("inputs"),
            stage.join("outputs"),
            run_root.clone(),
        ] {
            fs::create_dir(&directory).unwrap();
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let program = include_bytes!(
            "../../../docs/dataset-factory/fixtures/https-exchange-contract-v1/stage-program-v2.2.json"
        );
        fs::write(stage.join("program.json"), program).unwrap();
        fs::write(stage.join("inputs/reviewed_request_body.json"), b"{}").unwrap();
        fs::write(
            run_root.join("run-token"),
            b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )
        .unwrap();
        let capability_id = "a".repeat(64);
        let authority = serde_json::json!({
            "schema_version":"gate_h2_stage_program_authority_v1.0.0",
            "program_sha256":hex::encode(Sha256::digest(program)),
            "program_bytes":program.len(),
            "manifest_id":"b".repeat(64),
            "capability_ids":[capability_id],
            "input_artifact_roles":["reviewed_request_body"],
            "output_indexes":[0,1]
        });
        fs::write(
            run_root.join("stage-authority.json"),
            serde_json::to_vec(&authority).unwrap(),
        )
        .unwrap();
        let listener =
            std::os::unix::net::UnixListener::bind(run_root.join("broker.sock")).unwrap();
        fs::set_permissions(
            run_root.join("broker.sock"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            stream.read_to_end(&mut request).unwrap();
            assert!(request.starts_with(b"POST /v1/exchange/"));
            let response = serde_json::json!({
                "schema_version":crate::PROTOCOL_VERSION,
                "message_type":"exchange_response",
                "request_id":"00000000000000000000000000000000",
                "outcome":"accepted",
                "exchange_consumed":true,
                "output_artifact":{
                    "artifact_role":"raw_https_response",
                    "sha256":"c".repeat(64),
                    "bytes":11,
                    "media_type":"application/json",
                    "status":200
                }
            });
            let body = serde_json::to_vec(&response).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(&body).unwrap();
        });
        run(&stage, &run_root).unwrap();
        server.join().unwrap();
        assert!(stage.join("outputs/0.receipt.json").is_file());
    }

    #[test]
    fn response_parser_rejects_trailing_bytes_and_wrong_headers() {
        let body = br#"{"schema_version":"x"}"#;
        let mut trailing = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        trailing.extend_from_slice(body);
        trailing.push(b'x');
        assert!(parse_response(&trailing).is_err());
        assert!(valid_role("reviewed_request_body"));
        assert!(!valid_role("../escape"));
        assert!(!valid_component("../escape"));
    }
}
