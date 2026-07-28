use std::{
    fs::File,
    io::{self, Read, Seek, Write},
    os::unix::net::UnixStream,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::fs::MetadataExt,
    },
    path::Path,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::model::{ExchangeRequest, ExchangeResponse};

const STAGE_SCHEMA_SHA256: &str =
    "6d2a30170cf640279292ab4fd40ef70ccf46f47ac504bfee57a791842a301c2c";
const MAX_PROGRAM_BYTES: usize = 64 * 1024;
const MAX_AUTHORITY_BYTES: usize = 64 * 1024;
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_UDS_RESPONSE_BYTES: usize = 64 * 1024;
const EXCHANGE_TIMEOUT: Duration = Duration::from_millis(crate::policy::MAX_EXCHANGE_DEADLINE_MS);
const TERMINAL_ACK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy)]
struct StageTimeouts {
    exchange: Duration,
    terminal_ack: Duration,
}

const STAGE_TIMEOUTS: StageTimeouts = StageTimeouts {
    exchange: EXCHANGE_TIMEOUT,
    terminal_ack: TERMINAL_ACK_TIMEOUT,
};

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
    output_artifact_roles: Vec<String>,
    allowed_response_statuses: Vec<Vec<u16>>,
}

#[derive(Serialize)]
struct TerminalDeliveryAck<'a> {
    schema_version: &'static str,
    acceptance_state: &'static str,
    owner_uid: u32,
    manifest_id: &'a str,
    capability_id: &'a str,
    exchange_ordinal: usize,
    request_id: &'a str,
    response_sha256: &'a str,
    run_token: &'a str,
    request_artifact_role: &'a str,
    output_index: u64,
    output_artifact_role: &'a str,
    output_sha256: &'a str,
    output_bytes: u64,
    output_status: u16,
    receipt_sha256: &'a str,
}

struct TerminalAcceptance<'a> {
    request: &'a ExchangeRequest,
    authority: &'a StageAuthority,
    ordinal: usize,
    response_bytes: &'a [u8],
    output: &'a crate::model::OutputArtifact,
    receipt_sha256: &'a str,
}

pub fn run_fixed() -> Result<(), Box<dyn std::error::Error>> {
    run_impl(
        Path::new("/stage"),
        Path::new("/run/gate-h2"),
        true,
        STAGE_TIMEOUTS,
    )
}

#[cfg(test)]
pub(crate) fn run(stage_path: &Path, run_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    run_impl(stage_path, run_path, false, STAGE_TIMEOUTS)
}

fn run_impl(
    stage_path: &Path,
    run_path: &Path,
    inherited_channels: bool,
    timeouts: StageTimeouts,
) -> Result<(), Box<dyn std::error::Error>> {
    let stage = SecureRoot::open(stage_path)?;
    let run = SecureRoot::open(run_path)?;
    let program_bytes = stage.read_direct("program.json", MAX_PROGRAM_BYTES)?;
    let authority_bytes = run.read_direct("stage-authority.json", MAX_AUTHORITY_BYTES)?;
    let program: StageProgram =
        serde_json::from_value(crate::uds::parse_strict_json(&program_bytes)?)?;
    let authority: StageAuthority =
        serde_json::from_value(crate::uds::parse_strict_json(&authority_bytes)?)?;
    validate_program(&program, &program_bytes, &authority)?;
    if inherited_channels {
        start_container_liveness_watchdog(program.https_exchange_handles.len())?;
    }
    let token = Zeroizing::new(run.read_direct("run-token", 128)?);
    if token.len() != 43
        || !token
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(byte))
    {
        return Err("invalid one-run token".into());
    }
    if !inherited_channels {
        run.validate_socket("broker.sock")?;
    }

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
        let exchange_deadline = Instant::now()
            .checked_add(timeouts.exchange)
            .ok_or("invalid stage exchange deadline")?;
        let stream = stage_channel(inherited_channels, ordinal, run_path)?;
        let (response, response_bytes) = call(
            stream,
            &authority.capability_ids[ordinal],
            &request,
            exchange_deadline,
        )?;
        let output = response
            .output_artifact
            .as_ref()
            .ok_or("missing output artifact")?;
        let mut retained = stage.open_retained_nested(
            "outputs",
            &format!("{}.bin", authority.output_artifact_roles[ordinal]),
            output.bytes,
        )?;
        let retained_bytes = retained.validate_content(&output.sha256)?;
        validate_accepted_response(
            &response,
            &request,
            &authority.output_artifact_roles[ordinal],
            &authority.allowed_response_statuses[ordinal],
            &retained_bytes,
        )?;
        let receipt = serde_json::to_vec(&response)?;
        let receipt_sha256 = stage.commit_nested(
            "outputs",
            &format!("{}.receipt.json", program.output_indexes[ordinal]),
            &receipt,
        )?;
        if ordinal + 1 == program.https_exchange_handles.len() {
            let terminal_ack_deadline = Instant::now()
                .checked_add(timeouts.terminal_ack)
                .ok_or("invalid stage terminal ACK deadline")?;
            acknowledge_terminal_acceptance(
                stage_channel(
                    inherited_channels,
                    program.https_exchange_handles.len(),
                    run_path,
                )?,
                TerminalAcceptance {
                    request: &request,
                    authority: &authority,
                    ordinal,
                    response_bytes: &response_bytes,
                    output,
                    receipt_sha256: &receipt_sha256,
                },
                &mut retained,
                terminal_ack_deadline,
            )?;
        }
    }
    Ok(())
}

fn container_liveness_fd(exchange_count: usize) -> io::Result<i32> {
    let offset = if exchange_count == 0 {
        0
    } else {
        exchange_count
            .checked_add(1)
            .ok_or_else(|| io::Error::other("container liveness FD overflow"))?
    };
    i32::try_from(
        3_usize
            .checked_add(offset)
            .ok_or_else(|| io::Error::other("container liveness FD overflow"))?,
    )
    .map_err(|_| io::Error::other("container liveness FD overflow"))
}

fn start_container_liveness_watchdog(exchange_count: usize) -> io::Result<()> {
    let fd = container_liveness_fd(exchange_count)?;
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstat(fd, &mut stat) } < 0 {
        return Err(io::Error::last_os_error());
    }
    if stat.st_mode & libc::S_IFMT != libc::S_IFIFO {
        return Err(io::Error::other(
            "container liveness capability is not a fixed inherited pipe",
        ));
    }
    let liveness = unsafe { OwnedFd::from_raw_fd(fd) };
    thread::Builder::new()
        .name("gate-h2-container-liveness".into())
        .spawn(move || {
            // The stage program is data, not executable code. This fixed runtime
            // owns the only container copy of the liveness read end and terminates
            // the entire container process on EOF or any malformed write.
            let _ = wait_for_container_liveness_eof(liveness.as_raw_fd());
            unsafe { libc::_exit(247) };
        })?;
    Ok(())
}

fn wait_for_container_liveness_eof(fd: i32) -> io::Result<()> {
    let mut byte = [0_u8; 1];
    loop {
        let read = unsafe { libc::read(fd, byte.as_mut_ptr().cast(), byte.len()) };
        if read == 0 {
            return Ok(());
        }
        if read > 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "container liveness capability received data instead of EOF",
            ));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn validate_accepted_response(
    response: &ExchangeResponse,
    request: &ExchangeRequest,
    expected_role: &str,
    allowed_statuses: &[u16],
    retained: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let output = response
        .output_artifact
        .as_ref()
        .ok_or("missing output artifact")?;
    if response.schema_version != crate::PROTOCOL_VERSION
        || response.message_type != "exchange_response"
        || response.request_id != request.request_id
        || response.outcome != "accepted"
        || !response.exchange_consumed
        || response.failure_code.is_some()
        || output.artifact_role != expected_role
        || output.sha256.len() != 64
        || !output.sha256.bytes().all(is_lower_hex)
        || output.media_type != "application/json"
        || !allowed_statuses.contains(&output.status)
        || retained.len() as u64 != output.bytes
        || hex::encode(Sha256::digest(retained)) != output.sha256
    {
        return Err("broker response is not bound to the requested retained output".into());
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
        || authority.output_artifact_roles.len() != count
        || authority
            .output_artifact_roles
            .iter()
            .any(|role| !valid_role(role))
        || has_duplicates(&authority.output_artifact_roles)
        || authority.allowed_response_statuses.len() != count
        || authority.allowed_response_statuses.iter().any(|statuses| {
            statuses.is_empty()
                || statuses.len() > 16
                || statuses.iter().any(|status| !(200..=599).contains(status))
                || {
                    let mut seen = std::collections::HashSet::new();
                    statuses.iter().any(|status| !seen.insert(status))
                }
        })
    {
        return Err("invalid or unauthorized stage program".into());
    }
    Ok(())
}

fn call(
    mut stream: UnixStream,
    capability_id: &str,
    request: &ExchangeRequest,
    deadline: Instant,
) -> Result<(ExchangeResponse, Vec<u8>), Box<dyn std::error::Error>> {
    let body = Zeroizing::new(serde_json::to_vec(request)?);
    let header = format!(
        "POST /v1/exchange/{capability_id} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        body.len()
    );
    configure_nonblocking(&stream)?;
    write_bytes_before(&mut stream, header.as_bytes(), deadline)?;
    write_bytes_before(&mut stream, &body, deadline)?;
    flush_before(&mut stream, deadline)?;
    stream.shutdown(std::net::Shutdown::Write)?;
    let response = read_to_end_before(&mut stream, MAX_UDS_RESPONSE_BYTES, deadline)?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("malformed broker response")?
        + 4;
    let body = response[header_end..].to_vec();
    Ok((parse_response(&response)?, body))
}

fn acknowledge_terminal_acceptance(
    mut stream: UnixStream,
    acceptance: TerminalAcceptance<'_>,
    retained_output: &mut RetainedOutput,
    deadline: Instant,
) -> Result<(), Box<dyn std::error::Error>> {
    let TerminalAcceptance {
        request,
        authority,
        ordinal,
        response_bytes,
        output,
        receipt_sha256,
    } = acceptance;
    let response_sha256 = hex::encode(Sha256::digest(response_bytes));
    let body = Zeroizing::new(serde_json::to_vec(&TerminalDeliveryAck {
        schema_version: "gate_h2_terminal_delivery_ack_v1.0.0",
        acceptance_state: "validated_output_and_receipt_durably_committed",
        owner_uid: unsafe { libc::geteuid() },
        manifest_id: &authority.manifest_id,
        capability_id: &authority.capability_ids[ordinal],
        exchange_ordinal: ordinal,
        request_id: &request.request_id,
        response_sha256: &response_sha256,
        run_token: &request.run_token,
        request_artifact_role: &request.request_artifact_role,
        output_index: authority.output_indexes[ordinal],
        output_artifact_role: &output.artifact_role,
        output_sha256: &output.sha256,
        output_bytes: output.bytes,
        output_status: output.status,
        receipt_sha256,
    })?);
    let header = format!(
        "POST /v1/delivery-ack HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        body.len()
    );
    retained_output.validate_content(&output.sha256)?;
    configure_nonblocking(&stream)?;
    write_bytes_before(&mut stream, header.as_bytes(), deadline)?;
    write_bytes_before(&mut stream, &body, deadline)?;
    flush_before(&mut stream, deadline)?;
    stream.shutdown(std::net::Shutdown::Write)?;
    // Acceptance is already durable before the authenticated ACK is sent. The
    // broker's 204 is advisory: losing it must never turn accepted work into a
    // stage rejection after the broker may already have sealed `complete`.
    let _ = read_to_end_before(&mut stream, 1024, deadline);
    Ok(())
}

fn configure_nonblocking(stream: &UnixStream) -> io::Result<()> {
    stream.set_read_timeout(None)?;
    stream.set_write_timeout(None)?;
    stream.set_nonblocking(true)
}

fn write_bytes_before(stream: &mut UnixStream, bytes: &[u8], deadline: Instant) -> io::Result<()> {
    write_bytes_before_with_clock(stream, bytes, deadline, &mut Instant::now)
}

fn write_bytes_before_with_clock(
    stream: &mut UnixStream,
    mut bytes: &[u8],
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    while !bytes.is_empty() {
        match io_before_deadline(deadline, now, || stream.write(bytes)) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "stage UDS write made no progress",
                ));
            }
            Ok(written) => bytes = &bytes[written..],
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_before_with_clock(stream.as_raw_fd(), libc::POLLOUT, deadline, now)?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn flush_before(stream: &mut UnixStream, deadline: Instant) -> io::Result<()> {
    flush_before_with_clock(stream, deadline, &mut Instant::now)
}

fn flush_before_with_clock(
    stream: &mut UnixStream,
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    loop {
        match io_before_deadline(deadline, now, || stream.flush()) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_before_with_clock(stream.as_raw_fd(), libc::POLLOUT, deadline, now)?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

fn read_to_end_before(
    stream: &mut UnixStream,
    cap: usize,
    deadline: Instant,
) -> io::Result<Vec<u8>> {
    read_to_end_before_with_clock(stream, cap, deadline, &mut Instant::now)
}

fn read_to_end_before_with_clock(
    stream: &mut UnixStream,
    cap: usize,
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        match io_before_deadline(deadline, now, || stream.read(&mut chunk)) {
            Ok(0) => return Ok(bytes),
            Ok(read) => {
                if bytes.len().saturating_add(read) > cap {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "broker response exceeds cap",
                    ));
                }
                bytes.extend_from_slice(&chunk[..read]);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_before_with_clock(stream.as_raw_fd(), libc::POLLIN, deadline, now)?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

fn ensure_before_with_clock(
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<Duration> {
    deadline
        .checked_duration_since(now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "stage UDS deadline"))
}

fn io_before_deadline<T>(
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
    operation: impl FnOnce() -> io::Result<T>,
) -> io::Result<T> {
    ensure_before_with_clock(deadline, now)?;
    let result = operation();
    ensure_before_with_clock(deadline, now)?;
    result
}

fn wait_before_with_clock(
    fd: i32,
    events: i16,
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    loop {
        let remaining = ensure_before_with_clock(deadline, now)?;
        let timeout_ms = i32::try_from(remaining.as_millis().max(1)).unwrap_or(i32::MAX);
        let mut poll_fd = libc::pollfd {
            fd,
            events,
            revents: 0,
        };
        let polled = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
        ensure_before_with_clock(deadline, now)?;
        if polled > 0 {
            if poll_fd.revents & (events | libc::POLLHUP | libc::POLLERR) != 0 {
                return Ok(());
            }
            return Err(io::Error::other("stage UDS poll failed"));
        }
        if polled == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "stage UDS deadline",
            ));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn stage_channel(inherited: bool, ordinal: usize, run_path: &Path) -> io::Result<UnixStream> {
    let stream = if inherited {
        let fd: i32 = (3_usize.checked_add(ordinal).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "stage channel FD overflow")
        })?)
        .try_into()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "stage channel FD overflow"))?;
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        validate_stage_channel_kind(fd.as_raw_fd())?;
        UnixStream::from(fd)
    } else {
        UnixStream::connect(run_path.join("broker.sock"))?
    };
    validate_stage_channel(&stream, inherited)?;
    Ok(stream)
}

fn validate_stage_channel(stream: &UnixStream, inherited: bool) -> io::Result<()> {
    validate_stage_channel_kind(stream.as_raw_fd())?;
    let metadata = stream.peer_addr()?;
    if metadata.is_unnamed() && !inherited {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unexpected unnamed broker peer",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        let mut credential: libc::ucred = unsafe { std::mem::zeroed() };
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                &mut credential as *mut _ as *mut _,
                &mut length,
            )
        } != 0
            || credential.uid != unsafe { libc::geteuid() }
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker channel peer identity mismatch",
            ));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut uid = 0;
        let mut gid = 0;
        if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0
            || uid != unsafe { libc::geteuid() }
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "broker channel peer identity mismatch",
            ));
        }
    }
    Ok(())
}

fn validate_stage_channel_kind(fd: i32) -> io::Result<()> {
    let socket_type = socket_option(fd, libc::SO_TYPE)?;
    if socket_type != libc::SOCK_STREAM {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "stage channel is not a stream socket",
        ));
    }

    let domain = socket_domain(fd)?;
    if domain != libc::AF_UNIX {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "stage channel is not a Unix-domain socket",
        ));
    }
    Ok(())
}

fn socket_option(fd: i32, option: i32) -> io::Result<i32> {
    let mut value: libc::c_int = 0;
    let mut length = std::mem::size_of_val(&value) as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            option,
            (&mut value as *mut libc::c_int).cast(),
            &mut length,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if length as usize != std::mem::size_of_val(&value) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "stage channel socket option has an invalid size",
        ));
    }
    Ok(value)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn socket_domain(fd: i32) -> io::Result<i32> {
    socket_option(fd, libc::SO_DOMAIN)
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn socket_domain(fd: i32) -> io::Result<i32> {
    let mut address: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
    let mut length = std::mem::size_of_val(&address) as libc::socklen_t;
    if unsafe {
        libc::getsockname(
            fd,
            (&mut address as *mut libc::sockaddr_storage).cast(),
            &mut length,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if (length as usize) < std::mem::size_of::<libc::sa_family_t>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "stage channel socket domain is unavailable",
        ));
    }
    let address =
        unsafe { &*((&address as *const libc::sockaddr_storage).cast::<libc::sockaddr>()) };
    Ok(i32::from(address.sa_family))
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

struct RetainedOutput {
    file: File,
    identity: std::fs::Metadata,
    bytes: usize,
}

impl RetainedOutput {
    fn validate_content(&mut self, expected_sha256: &str) -> io::Result<Vec<u8>> {
        let before = validate_owned_file(&self.file, 0o600, self.bytes as u64)?;
        if !same_file_identity(&self.identity, &before) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "retained raw output identity changed",
            ));
        }
        let bytes = read_retained_exact(&mut self.file, self.bytes)?;
        let after = validate_owned_file(&self.file, 0o600, self.bytes as u64)?;
        if !same_file_identity(&before, &after)
            || hex::encode(Sha256::digest(&bytes)) != expected_sha256
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "retained raw output content changed",
            ));
        }
        Ok(bytes)
    }
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

    fn open_retained_nested(
        &self,
        directory: &str,
        name: &str,
        expected_bytes: u64,
    ) -> io::Result<RetainedOutput> {
        if expected_bytes > MAX_INPUT_BYTES as u64 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "raw output exceeds cap",
            ));
        }
        let bytes = usize::try_from(expected_bytes).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "raw output size is not usable")
        })?;
        let child = open_directory_at(self.0.as_raw_fd(), directory)?;
        let file = open_file_at(child.as_raw_fd(), name, libc::O_RDONLY, 0)?;
        let identity = validate_owned_file(&file, 0o600, expected_bytes)?;
        Ok(RetainedOutput {
            file,
            identity,
            bytes,
        })
    }

    fn commit_nested(&self, directory: &str, name: &str, bytes: &[u8]) -> io::Result<String> {
        self.commit_nested_inner(directory, name, bytes, |_| Ok(()), |_| Ok(()))
    }

    fn commit_nested_inner(
        &self,
        directory: &str,
        name: &str,
        bytes: &[u8],
        after_create: impl FnOnce(&File) -> io::Result<()>,
        after_rename: impl FnOnce(&File) -> io::Result<()>,
    ) -> io::Result<String> {
        use std::os::unix::fs::MetadataExt;
        let child = open_directory_at(self.0.as_raw_fd(), directory)?;
        let temporary = format!(".{name}.tmp");
        let mut file = open_file_at(
            child.as_raw_fd(),
            &temporary,
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
            0o600,
        )?;
        set_exact_mode(&file, 0o600)?;
        validate_owned_file(&file, 0o600, 0)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        let initial = validate_owned_file(&file, 0o600, bytes.len() as u64)?;
        let initial_bytes = read_retained_exact(&mut file, bytes.len())?;
        if initial_bytes != bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stage output content mismatch after fsync",
            ));
        }
        after_create(&file)?;
        let after_create_metadata = validate_owned_file(&file, 0o600, bytes.len() as u64)?;
        let after_create_bytes = read_retained_exact(&mut file, bytes.len())?;
        if !same_file_identity(&initial, &after_create_metadata)
            || after_create_bytes != initial_bytes
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stage output changed after create",
            ));
        }
        rename_at(child.as_raw_fd(), &temporary, name)?;
        after_rename(&file)?;
        child.sync_all()?;
        let destination = std::ffi::CString::new(name)?;
        let mut status: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                child.as_raw_fd(),
                destination.as_ptr(),
                &mut status,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        if status.st_mode & libc::S_IFMT != libc::S_IFREG
            || status.st_uid != unsafe { libc::geteuid() }
            || u32::from(status.st_mode & 0o7777) != 0o600
            || status.st_nlink != 1
            || status.st_size as u64 != bytes.len() as u64
            || status.st_dev as u64 != initial.dev()
            || status.st_ino != initial.ino()
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe committed stage output",
            ));
        }
        let retained = validate_owned_file(&file, 0o600, bytes.len() as u64)?;
        let retained_bytes = read_retained_exact(&mut file, bytes.len())?;
        let retained_after_read = validate_owned_file(&file, 0o600, bytes.len() as u64)?;
        if !same_file_identity(&initial, &retained)
            || !same_file_identity(&retained, &retained_after_read)
            || retained_bytes != initial_bytes
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stage output changed across rename",
            ));
        }
        Ok(hex::encode(Sha256::digest(&retained_bytes)))
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
            || u32::from(stat.st_mode & 0o7777) != 0o600
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
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe stage directory",
        ));
    }
    Ok(())
}

fn set_exact_mode(file: &File, mode: u32) -> io::Result<()> {
    if unsafe { libc::fchmod(file.as_raw_fd(), mode as libc::mode_t) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn validate_owned_file(file: &File, mode: u32, bytes: u64) -> io::Result<std::fs::Metadata> {
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
            "unsafe stage output file",
        ));
    }
    Ok(metadata)
}

fn read_retained_exact(file: &mut File, expected: usize) -> io::Result<Vec<u8>> {
    file.rewind()?;
    let mut bytes = Vec::with_capacity(expected);
    Read::by_ref(file)
        .take(expected as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "stage output retained length mismatch",
        ));
    }
    Ok(bytes)
}

fn same_file_identity(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.mode() == right.mode()
        && left.nlink() == right.nlink()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
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
    use std::{
        fs,
        net::{TcpListener, TcpStream},
        os::unix::fs::PermissionsExt,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
        thread,
    };

    fn socket_pair(socket_type: i32) -> (OwnedFd, OwnedFd) {
        let mut descriptors = [-1; 2];
        assert_eq!(
            unsafe { libc::socketpair(libc::AF_UNIX, socket_type, 0, descriptors.as_mut_ptr(),) },
            0
        );
        unsafe {
            (
                OwnedFd::from_raw_fd(descriptors[0]),
                OwnedFd::from_raw_fd(descriptors[1]),
            )
        }
    }

    fn crossing_clock(deadline: Instant) -> impl FnMut() -> Instant {
        let mut calls = 0;
        move || {
            calls += 1;
            if calls == 1 {
                deadline - Duration::from_nanos(1)
            } else {
                deadline
            }
        }
    }

    #[test]
    fn successful_stage_read_finishing_at_deadline_is_rejected() {
        let (mut reader, mut writer) = UnixStream::pair().unwrap();
        configure_nonblocking(&reader).unwrap();
        writer.write_all(b"x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error =
            read_to_end_before_with_clock(&mut reader, 1, deadline, &mut crossing_clock(deadline))
                .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_stage_eof_finishing_at_deadline_is_rejected() {
        let (mut reader, writer) = UnixStream::pair().unwrap();
        configure_nonblocking(&reader).unwrap();
        writer.shutdown(std::net::Shutdown::Write).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error =
            read_to_end_before_with_clock(&mut reader, 1, deadline, &mut crossing_clock(deadline))
                .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_stage_write_finishing_at_deadline_is_rejected() {
        let (mut writer, mut reader) = UnixStream::pair().unwrap();
        configure_nonblocking(&writer).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error = write_bytes_before_with_clock(
            &mut writer,
            b"x",
            deadline,
            &mut crossing_clock(deadline),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        let mut byte = [0_u8; 1];
        reader.read_exact(&mut byte).unwrap();
        assert_eq!(byte, *b"x");
    }

    #[test]
    fn successful_stage_flush_finishing_at_deadline_is_rejected() {
        let (mut stream, _peer) = UnixStream::pair().unwrap();
        configure_nonblocking(&stream).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error = flush_before_with_clock(&mut stream, deadline, &mut crossing_clock(deadline))
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_stage_readiness_finishing_at_deadline_is_rejected() {
        let (reader, mut writer) = UnixStream::pair().unwrap();
        writer.write_all(b"x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error = wait_before_with_clock(
            reader.as_raw_fd(),
            libc::POLLIN,
            deadline,
            &mut crossing_clock(deadline),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn inherited_channel_accepts_connected_unix_stream() {
        let (stream, _peer) = UnixStream::pair().unwrap();
        validate_stage_channel(&stream, true).unwrap();
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[test]
    fn inherited_channel_rejects_connected_unix_seqpacket() {
        let (stream, _peer) = socket_pair(libc::SOCK_SEQPACKET);
        let error = validate_stage_channel_kind(stream.as_raw_fd()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "stage channel is not a stream socket");
    }

    #[test]
    fn inherited_channel_rejects_connected_unix_datagram() {
        let (stream, _peer) = socket_pair(libc::SOCK_DGRAM);
        let error = validate_stage_channel_kind(stream.as_raw_fd()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "stage channel is not a stream socket");
    }

    #[test]
    fn inherited_channel_rejects_tcp_stream() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_server, _) = listener.accept().unwrap();
        let error = validate_stage_channel_kind(client.as_raw_fd()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(
            error.to_string(),
            "stage channel is not a Unix-domain socket"
        );
    }

    #[test]
    fn inherited_channel_rejects_unconnected_unix_stream() {
        let descriptor = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
        assert!(descriptor >= 0);
        let stream = UnixStream::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
        let error = validate_stage_channel(&stream, true).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::ENOTCONN));
    }

    #[test]
    fn fixed_container_liveness_fd_and_eof_contract_are_deterministic() {
        assert_eq!(container_liveness_fd(0).unwrap(), 3);
        assert_eq!(container_liveness_fd(1).unwrap(), 5);
        assert_eq!(container_liveness_fd(16).unwrap(), 20);

        let mut pipe = [-1; 2];
        assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
        let read = unsafe { OwnedFd::from_raw_fd(pipe[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(pipe[1]) };
        drop(write);
        wait_for_container_liveness_eof(read.as_raw_fd()).unwrap();
    }

    fn add_mode(file: &File, bits: u32) -> io::Result<()> {
        let mode = file.metadata()?.permissions().mode() & 0o7777;
        if unsafe { libc::fchmod(file.as_raw_fd(), (mode | bits) as libc::mode_t) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn replace_content_same_length(file: &File) -> io::Result<()> {
        let replacement = b"[]";
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

    fn assert_partial_write_obeys_absolute_deadline(label: &str) {
        let (mut writer, reader) = UnixStream::pair().unwrap();
        let send_buffer: libc::c_int = 1024;
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    writer.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_SNDBUF,
                    (&send_buffer as *const libc::c_int).cast(),
                    std::mem::size_of_val(&send_buffer) as libc::socklen_t,
                )
            },
            0
        );
        configure_nonblocking(&writer).unwrap();
        let payload = vec![b'x'; 1024 * 1024];
        let started = Instant::now();
        let error = write_bytes_before(&mut writer, &payload, started + Duration::from_millis(40))
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut, "{label}");
        assert!(started.elapsed() < Duration::from_millis(500), "{label}");
        let mut queued: libc::c_int = 0;
        assert_eq!(
            unsafe { libc::ioctl(reader.as_raw_fd(), libc::FIONREAD, &mut queued) },
            0
        );
        assert!(queued > 0 && (queued as usize) < payload.len(), "{label}");
    }

    fn test_exchange_request() -> ExchangeRequest {
        ExchangeRequest {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_request".into(),
            request_id: "0".repeat(32),
            run_token: "A".repeat(43),
            capability_handle: "h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            request_artifact_role: "request".into(),
            request_artifact_sha256: "a".repeat(64),
            request_artifact_bytes: 4,
        }
    }

    fn delayed_exchange(
        delay: Duration,
        budget: Duration,
    ) -> (ExchangeRequest, ExchangeResponse, Vec<u8>) {
        let request = test_exchange_request();
        let (stage_stream, mut broker_stream) = UnixStream::pair().unwrap();
        let request_id = request.request_id.clone();
        let server = thread::spawn(move || {
            let mut emitted = Vec::new();
            broker_stream.read_to_end(&mut emitted).unwrap();
            thread::sleep(delay);
            let body = serde_json::to_vec(&serde_json::json!({
                "schema_version":crate::PROTOCOL_VERSION,
                "message_type":"exchange_response",
                "request_id":request_id,
                "outcome":"accepted",
                "exchange_consumed":true,
                "output_artifact":{
                    "artifact_role":"raw_https_response",
                    "sha256":hex::encode(Sha256::digest(b"body")),
                    "bytes":4,
                    "media_type":"application/json",
                    "status":200
                }
            }))
            .unwrap();
            write!(broker_stream, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()).unwrap();
            broker_stream.write_all(&body).unwrap();
        });
        let (response, response_bytes) = call(
            stage_stream,
            &"b".repeat(64),
            &request,
            Instant::now() + budget,
        )
        .unwrap();
        server.join().unwrap();
        (request, response, response_bytes)
    }

    #[test]
    fn authorized_exchange_can_outlive_old_stage_cap() {
        let old_test_cap = Duration::from_millis(30);
        let started = Instant::now();
        delayed_exchange(Duration::from_millis(55), Duration::from_millis(120));
        assert!(started.elapsed() > old_test_cap);
    }

    #[test]
    fn response_near_exchange_deadline_gets_fresh_terminal_ack_window() {
        let exchange_budget = Duration::from_millis(90);
        let started = Instant::now();
        let (request, response, response_bytes) =
            delayed_exchange(Duration::from_millis(65), exchange_budget);
        let output = response.output_artifact.as_ref().unwrap();

        let root = tempfile::tempdir().unwrap();
        let outputs = root.path().join("outputs");
        fs::create_dir(&outputs).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&outputs, fs::Permissions::from_mode(0o700)).unwrap();
        let path = outputs.join("raw_https_response.bin");
        fs::write(&path, b"body").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let secure = SecureRoot::open(root.path()).unwrap();
        let mut retained = secure
            .open_retained_nested("outputs", "raw_https_response.bin", 4)
            .unwrap();
        let authority = StageAuthority {
            schema_version: "gate_h2_stage_program_authority_v1.0.0".into(),
            program_sha256: "b".repeat(64),
            program_bytes: 1,
            manifest_id: "c".repeat(64),
            capability_ids: vec!["d".repeat(64)],
            input_artifact_roles: vec!["request".into()],
            output_indexes: vec![0, 1],
            output_artifact_roles: vec!["raw_https_response".into()],
            allowed_response_statuses: vec![vec![200]],
        };
        let (stage_stream, mut broker_stream) = UnixStream::pair().unwrap();
        let server = thread::spawn(move || {
            let mut emitted = Vec::new();
            broker_stream.read_to_end(&mut emitted).unwrap();
            assert!(emitted.starts_with(b"POST /v1/delivery-ack "));
            thread::sleep(Duration::from_millis(45));
        });
        acknowledge_terminal_acceptance(
            stage_stream,
            TerminalAcceptance {
                request: &request,
                authority: &authority,
                ordinal: 0,
                response_bytes: &response_bytes,
                output,
                receipt_sha256: &"e".repeat(64),
            },
            &mut retained,
            Instant::now() + Duration::from_millis(80),
        )
        .unwrap();
        server.join().unwrap();
        assert!(started.elapsed() > exchange_budget);
    }

    #[test]
    fn partial_progress_request_write_does_not_renew_stage_deadline() {
        assert_partial_write_obeys_absolute_deadline("request");
    }

    #[test]
    fn partial_progress_terminal_ack_write_does_not_renew_stage_deadline() {
        assert_partial_write_obeys_absolute_deadline("terminal ACK");
    }

    #[test]
    fn trickled_response_reads_do_not_renew_stage_deadline() {
        let (mut reader, mut writer) = UnixStream::pair().unwrap();
        configure_nonblocking(&reader).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let writes = Arc::new(AtomicUsize::new(0));
        let server_stop = Arc::clone(&stop);
        let server_writes = Arc::clone(&writes);
        let server = thread::spawn(move || {
            while !server_stop.load(Ordering::SeqCst) {
                if writer.write(b"x").is_err() {
                    break;
                }
                server_writes.fetch_add(1, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(8));
            }
        });
        let started = Instant::now();
        let error =
            read_to_end_before(&mut reader, 1024, started + Duration::from_millis(45)).unwrap_err();
        stop.store(true, Ordering::SeqCst);
        drop(reader);
        server.join().unwrap();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(writes.load(Ordering::SeqCst) > 1);
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn terminal_ack_rechecks_same_retained_output_inode_after_receipt_commit() {
        let root = tempfile::tempdir().unwrap();
        let outputs = root.path().join("outputs");
        fs::create_dir(&outputs).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&outputs, fs::Permissions::from_mode(0o700)).unwrap();
        let path = outputs.join("raw_https_response.bin");
        fs::write(&path, b"body").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let secure = SecureRoot::open(root.path()).unwrap();
        let digest = hex::encode(Sha256::digest(b"body"));
        let mut retained = secure
            .open_retained_nested("outputs", "raw_https_response.bin", 4)
            .unwrap();
        retained.validate_content(&digest).unwrap();

        let mutating_fd = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        replace_content_same_length(&mutating_fd).unwrap();
        let request = ExchangeRequest {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_request".into(),
            request_id: "0".repeat(32),
            run_token: "A".repeat(43),
            capability_handle: "h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            request_artifact_role: "request".into(),
            request_artifact_sha256: "a".repeat(64),
            request_artifact_bytes: 4,
        };
        let authority = StageAuthority {
            schema_version: "gate_h2_stage_program_authority_v1.0.0".into(),
            program_sha256: "b".repeat(64),
            program_bytes: 1,
            manifest_id: "c".repeat(64),
            capability_ids: vec!["d".repeat(64)],
            input_artifact_roles: vec!["request".into()],
            output_indexes: vec![0, 1],
            output_artifact_roles: vec!["raw_https_response".into()],
            allowed_response_statuses: vec![vec![200]],
        };
        let output = crate::model::OutputArtifact {
            artifact_role: "raw_https_response".into(),
            sha256: digest,
            bytes: 4,
            media_type: "application/json".into(),
            status: 200,
        };
        let (stage_stream, mut broker_stream) = UnixStream::pair().unwrap();
        let result = acknowledge_terminal_acceptance(
            stage_stream,
            TerminalAcceptance {
                request: &request,
                authority: &authority,
                ordinal: 0,
                response_bytes: b"response",
                output: &output,
                receipt_sha256: &"e".repeat(64),
            },
            &mut retained,
            Instant::now() + Duration::from_millis(100),
        );
        assert!(result.is_err());
        let mut emitted = Vec::new();
        broker_stream.read_to_end(&mut emitted).unwrap();
        assert!(emitted.is_empty());
    }

    #[test]
    fn stage_directories_and_pathname_socket_require_exact_modes() {
        for mode in [0o4700, 0o2700, 0o1700] {
            let root = tempfile::tempdir().unwrap();
            fs::set_permissions(root.path(), fs::Permissions::from_mode(mode)).unwrap();
            assert!(SecureRoot::open(root.path()).is_err(), "{mode:o}");
        }

        for mode in [0o4600, 0o2600, 0o1600] {
            let root = tempfile::tempdir().unwrap();
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
            let socket = root.path().join("broker.sock");
            let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
            fs::set_permissions(&socket, fs::Permissions::from_mode(mode)).unwrap();
            assert!(
                SecureRoot::open(root.path())
                    .unwrap()
                    .validate_socket("broker.sock")
                    .is_err(),
                "{mode:o}"
            );
        }
    }

    #[test]
    fn stage_output_mode_mutations_after_create_and_rename_fail_closed() {
        for after_rename in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let outputs = root.path().join("outputs");
            fs::create_dir(&outputs).unwrap();
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&outputs, fs::Permissions::from_mode(0o700)).unwrap();
            let secure = SecureRoot::open(root.path()).unwrap();
            let result = if after_rename {
                secure.commit_nested_inner(
                    "outputs",
                    "receipt.json",
                    b"{}",
                    |_| Ok(()),
                    |file| add_mode(file, 0o1000),
                )
            } else {
                secure.commit_nested_inner(
                    "outputs",
                    "receipt.json",
                    b"{}",
                    |file| add_mode(file, 0o2000),
                    |_| Ok(()),
                )
            };
            assert!(result.is_err(), "after_rename={after_rename}");
        }
    }

    #[test]
    fn stage_receipt_same_length_mutations_after_create_and_rename_fail_closed() {
        for after_rename in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let outputs = root.path().join("outputs");
            fs::create_dir(&outputs).unwrap();
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&outputs, fs::Permissions::from_mode(0o700)).unwrap();
            let secure = SecureRoot::open(root.path()).unwrap();
            let result = if after_rename {
                secure.commit_nested_inner(
                    "outputs",
                    "receipt.json",
                    b"{}",
                    |_| Ok(()),
                    replace_content_same_length,
                )
            } else {
                secure.commit_nested_inner(
                    "outputs",
                    "receipt.json",
                    b"{}",
                    replace_content_same_length,
                    |_| Ok(()),
                )
            };
            assert!(result.is_err(), "after_rename={after_rename}");
        }
    }

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
            "output_indexes":[0,1],
            "output_artifact_roles":["raw_https_response"],
            "allowed_response_statuses":[[200]]
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
        let server_stage = stage.clone();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            stream.read_to_end(&mut request).unwrap();
            assert!(request.starts_with(b"POST /v1/exchange/"));
            let retained = br#"{"ok":true}"#;
            fs::write(
                server_stage.join("outputs/raw_https_response.bin"),
                retained,
            )
            .unwrap();
            fs::set_permissions(
                server_stage.join("outputs/raw_https_response.bin"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
            let response = serde_json::json!({
                "schema_version":crate::PROTOCOL_VERSION,
                "message_type":"exchange_response",
                "request_id":"00000000000000000000000000000000",
                "outcome":"accepted",
                "exchange_consumed":true,
                "output_artifact":{
                    "artifact_role":"raw_https_response",
                    "sha256":hex::encode(Sha256::digest(retained)),
                    "bytes":11,
                    "media_type":"application/json",
                    "status":200
                }
            });
            let body = serde_json::to_vec(&response).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(&body).unwrap();
            drop(stream);
            let (mut ack, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            ack.read_to_end(&mut request).unwrap();
            assert!(request.starts_with(b"POST /v1/delivery-ack "));
            // The broker may have sealed complete even if its optional 204 is
            // lost. Closing here must not reverse the stage's prior acceptance.
            drop(ack);
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

        let unknown = br#"{"schema_version":"gate_h2_https_exchange_uds_v1.0.0","message_type":"exchange_response","request_id":"00000000000000000000000000000000","outcome":"rejected","exchange_consumed":true,"output_artifact":null,"failure_code":"protocol_error","extra":true}"#;
        let mut framed = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            unknown.len()
        )
        .into_bytes();
        framed.extend_from_slice(unknown);
        assert!(parse_response(&framed).is_err());
    }

    #[test]
    fn accepted_response_must_join_request_role_status_and_retained_bytes() {
        let retained = br#"{"ok":true}"#;
        let request = ExchangeRequest {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_request".into(),
            request_id: "0".repeat(32),
            run_token: "A".repeat(43),
            capability_handle: "h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            request_artifact_role: "request".into(),
            request_artifact_sha256: "a".repeat(64),
            request_artifact_bytes: 1,
        };
        let response = ExchangeResponse {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_response".into(),
            request_id: request.request_id.clone(),
            outcome: "accepted".into(),
            exchange_consumed: true,
            output_artifact: Some(crate::model::OutputArtifact {
                artifact_role: "raw_https_response".into(),
                sha256: hex::encode(Sha256::digest(retained)),
                bytes: retained.len() as u64,
                media_type: "application/json".into(),
                status: 200,
            }),
            failure_code: None,
        };
        assert!(
            validate_accepted_response(&response, &request, "raw_https_response", &[200], retained)
                .is_ok()
        );
        let mut stale = response;
        stale.request_id = "f".repeat(32);
        assert!(
            validate_accepted_response(&stale, &request, "raw_https_response", &[200], retained)
                .is_err()
        );
        stale.request_id = request.request_id.clone();
        assert!(
            validate_accepted_response(&stale, &request, "other_role", &[200], retained).is_err()
        );
        assert!(
            validate_accepted_response(&stale, &request, "raw_https_response", &[201], retained)
                .is_err()
        );
        assert!(
            validate_accepted_response(
                &stale,
                &request,
                "raw_https_response",
                &[200],
                b"substituted"
            )
            .is_err()
        );
    }
}
