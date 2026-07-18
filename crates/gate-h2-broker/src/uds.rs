use std::{
    ffi::{CStr, CString},
    fs::{self, File},
    io::{self, Read, Write},
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::net::{UnixListener, UnixStream},
    os::unix::{
        ffi::OsStrExt,
        fs::{FileTypeExt, MetadataExt, PermissionsExt},
    },
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::{
    Broker,
    model::{ExchangeRequest, ExchangeResponse},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024;
const ACCEPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DeliveryAck {
    schema_version: String,
    acceptance_state: String,
    owner_uid: u32,
    manifest_id: String,
    capability_id: String,
    exchange_ordinal: usize,
    request_id: String,
    response_sha256: String,
    run_token: String,
    request_artifact_role: String,
    output_index: u64,
    output_artifact_role: String,
    output_sha256: String,
    output_bytes: u64,
    output_status: u16,
    receipt_sha256: String,
}

enum DeliveryAckFailure {
    Delivery(io::Error),
    Evidence(io::Error),
}

pub struct SocketGuard {
    parent: File,
    directory: File,
    directory_name: CString,
    directory_identity: FileIdentity,
    socket_audit: Option<CreationAudit>,
    socket_identity: Option<FileIdentity>,
    socket_created: bool,
    socket_removed: bool,
    directory_removed: bool,
    cleanup_on_drop: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

impl FileIdentity {
    fn from_metadata(metadata: &fs::Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }

    fn from_stat(stat: &libc::stat) -> Self {
        Self {
            device: stat.st_dev as u64,
            inode: stat.st_ino,
        }
    }
}

const SOCKET_NAME: &CStr = c"broker.sock";

#[cfg(target_os = "linux")]
struct CreationAudit {
    descriptor: OwnedFd,
    watch: i32,
    failed: bool,
}

#[cfg(target_os = "linux")]
impl CreationAudit {
    fn new(directory: &File) -> io::Result<Self> {
        let descriptor = unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(descriptor) };
        let path = CString::new(format!("/proc/self/fd/{}", directory.as_raw_fd()))?;
        let mask = libc::IN_CREATE
            | libc::IN_DELETE
            | libc::IN_MOVED_FROM
            | libc::IN_MOVED_TO
            | libc::IN_DELETE_SELF
            | libc::IN_MOVE_SELF;
        let watch = unsafe { libc::inotify_add_watch(descriptor.as_raw_fd(), path.as_ptr(), mask) };
        if watch < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut audit = Self {
            descriptor,
            watch,
            failed: false,
        };
        audit.drain(None, false)?;
        Ok(audit)
    }

    fn verify(&mut self, expected_name: &CStr, expected_directory: bool) -> io::Result<()> {
        if self.failed {
            return Err(io::Error::other("created entry identity audit failed"));
        }
        let result = self
            .drain(Some(expected_name), expected_directory)
            .and_then(|creates| {
                if creates == 1 {
                    Ok(())
                } else {
                    Err(io::Error::other(
                        "created entry identity could not be proven",
                    ))
                }
            });
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn drain(
        &mut self,
        expected_name: Option<&CStr>,
        expected_directory: bool,
    ) -> io::Result<usize> {
        let descriptor = self.descriptor.as_raw_fd();
        self.drain_with_reader(expected_name, expected_directory, |buffer| {
            let read = unsafe { libc::read(descriptor, buffer.as_mut_ptr().cast(), buffer.len()) };
            if read < 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(read as usize)
            }
        })
    }

    fn drain_with_reader(
        &mut self,
        expected_name: Option<&CStr>,
        expected_directory: bool,
        mut read_event: impl FnMut(&mut [u8]) -> io::Result<usize>,
    ) -> io::Result<usize> {
        if self.failed {
            return Err(io::Error::other("created entry identity audit failed"));
        }
        let result = self.drain_events(expected_name, expected_directory, &mut read_event);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn drain_events(
        &mut self,
        expected_name: Option<&CStr>,
        expected_directory: bool,
        read_event: &mut impl FnMut(&mut [u8]) -> io::Result<usize>,
    ) -> io::Result<usize> {
        let mut expected_creates = 0;
        let mut buffer = [0_u8; 4096];
        loop {
            let read = match read_event(&mut buffer) {
                Ok(read) => read,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            if read == 0 {
                break;
            }
            expected_creates +=
                self.observe_events(&buffer[..read], expected_name, expected_directory)?;
        }
        Ok(expected_creates)
    }

    fn observe_events(
        &mut self,
        buffer: &[u8],
        expected_name: Option<&CStr>,
        expected_directory: bool,
    ) -> io::Result<usize> {
        if self.failed {
            return Err(io::Error::other("created entry identity audit failed"));
        }
        let result = (|| {
            let mut expected_creates = 0;
            let mut offset = 0;
            while offset < buffer.len() {
                if buffer.len() - offset < std::mem::size_of::<libc::inotify_event>() {
                    return Err(io::Error::other("truncated creation audit event"));
                }
                let event = unsafe {
                    std::ptr::read_unaligned(
                        buffer.as_ptr().add(offset).cast::<libc::inotify_event>(),
                    )
                };
                let event_size = std::mem::size_of::<libc::inotify_event>() + event.len as usize;
                if event_size > buffer.len() - offset {
                    return Err(io::Error::other("truncated creation audit event"));
                }

                let invalidating = libc::IN_Q_OVERFLOW
                    | libc::IN_DELETE_SELF
                    | libc::IN_MOVE_SELF
                    | libc::IN_IGNORED
                    | libc::IN_UNMOUNT;
                let operations =
                    libc::IN_CREATE | libc::IN_DELETE | libc::IN_MOVED_FROM | libc::IN_MOVED_TO;
                let known = invalidating | operations | libc::IN_ISDIR;
                if event.wd != self.watch
                    || event.mask & invalidating != 0
                    || event.mask & !known != 0
                    || (event.mask & operations).count_ones() != 1
                {
                    return Err(io::Error::other("ambiguous creation audit event"));
                }

                if let Some(expected_name) = expected_name {
                    let name_bytes = &buffer
                        [offset + std::mem::size_of::<libc::inotify_event>()..offset + event_size];
                    let name_length = name_bytes
                        .iter()
                        .position(|byte| *byte == 0)
                        .unwrap_or(name_bytes.len());
                    if &name_bytes[..name_length] == expected_name.to_bytes() {
                        let is_expected_create = event.mask & libc::IN_CREATE != 0
                            && (event.mask & libc::IN_ISDIR != 0) == expected_directory;
                        if !is_expected_create {
                            return Err(io::Error::other(
                                "created entry was replaced before identity capture",
                            ));
                        }
                        expected_creates += 1;
                    }
                }
                offset += event_size;
            }
            Ok(expected_creates)
        })();
        if result.is_err() {
            self.failed = true;
        }
        result
    }
}

#[cfg(all(not(target_os = "linux"), not(test)))]
struct CreationAudit;

#[cfg(all(not(target_os = "linux"), not(test)))]
impl CreationAudit {
    fn new(_: &File) -> io::Result<Self> {
        Err(portable_creation_audit_error())
    }

    fn verify(&mut self, _: &CStr, _: bool) -> io::Result<()> {
        Err(portable_creation_audit_error())
    }
}

#[cfg(all(not(target_os = "linux"), test))]
struct CreationAudit;

// Existing platform-independent broker tests need a pathname listener on the
// Darwin host. Production builds never compile this test-only compatibility shim.
#[cfg(all(not(target_os = "linux"), test))]
impl CreationAudit {
    fn new(_: &File) -> io::Result<Self> {
        Ok(Self)
    }

    fn verify(&mut self, _: &CStr, _: bool) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
fn portable_creation_audit_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "exact created-entry identity audit requires Linux inotify",
    )
}

#[cfg(feature = "test-fault-injection")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BindFaultPoint {
    DirectoryIdentityInspection,
    DirectoryIdentityCaptured,
    DirectoryOpened,
    DirectoryPermissionsSet,
    DirectoryValidated,
    SocketIdentityInspection,
    SocketIdentityCaptured,
    SocketPermissionsSet,
    NamedSocketInspected,
    RetainedSocketInspected,
}

struct SocketInitializationGuard {
    parent: Option<File>,
    directory_name: Option<CString>,
    directory_audit: Option<CreationAudit>,
    directory_identity: Option<FileIdentity>,
    armed: bool,
}

impl SocketInitializationGuard {
    fn new(parent: File, directory_name: CString, directory_audit: CreationAudit) -> Self {
        Self {
            parent: Some(parent),
            directory_name: Some(directory_name),
            directory_audit: Some(directory_audit),
            directory_identity: None,
            armed: true,
        }
    }

    fn parent(&self) -> &File {
        self.parent
            .as_ref()
            .expect("initialization parent retained")
    }

    fn directory_name(&self) -> &CStr {
        self.directory_name
            .as_deref()
            .expect("initialization directory name retained")
    }

    fn cleanup_exact(&mut self) -> io::Result<()> {
        if !self.armed {
            return Ok(());
        }
        let expected = self.capture_directory_identity()?;
        let stat = stat_entry(self.parent(), self.directory_name())?;
        if FileIdentity::from_stat(&stat) != expected
            || stat.st_mode & libc::S_IFMT != libc::S_IFDIR
        {
            return Err(io::Error::other(
                "broker socket directory path identity changed",
            ));
        }
        unlink_entry(self.parent(), self.directory_name(), libc::AT_REMOVEDIR)?;
        self.parent().sync_all()?;
        self.armed = false;
        Ok(())
    }

    fn capture_directory_identity(&mut self) -> io::Result<FileIdentity> {
        if let Some(identity) = self.directory_identity {
            return Ok(identity);
        }
        let stat = stat_entry(self.parent(), self.directory_name())?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFDIR {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe broker socket directory",
            ));
        }
        let directory_name = self.directory_name().to_owned();
        self.directory_audit
            .as_mut()
            .expect("directory creation audit retained")
            .verify(&directory_name, true)?;
        let identity = FileIdentity::from_stat(&stat);
        self.directory_identity = Some(identity);
        self.directory_audit = None;
        Ok(identity)
    }

    fn into_socket_guard(mut self, directory: File) -> SocketGuard {
        self.armed = false;
        SocketGuard {
            parent: self.parent.take().expect("initialization parent retained"),
            directory,
            directory_name: self
                .directory_name
                .take()
                .expect("initialization directory name retained"),
            directory_identity: self
                .directory_identity
                .expect("initialization directory identity captured"),
            socket_audit: None,
            socket_identity: None,
            socket_created: false,
            socket_removed: false,
            directory_removed: false,
            cleanup_on_drop: true,
        }
    }
}

impl Drop for SocketInitializationGuard {
    fn drop(&mut self) {
        let _ = self.cleanup_exact();
    }
}

impl SocketGuard {
    pub fn cleanup(mut self) -> io::Result<()> {
        let result = self.cleanup_exact(false);
        self.cleanup_on_drop = false;
        result
    }

    fn cleanup_exact(&mut self, fail_socket_removal: bool) -> io::Result<()> {
        if !self.socket_removed {
            if self.socket_created && self.socket_identity.is_none() {
                self.capture_socket_identity()?;
            }
            if let Some(expected) = self.socket_identity {
                let socket_stat = stat_entry(&self.directory, SOCKET_NAME)?;
                if FileIdentity::from_stat(&socket_stat) != expected
                    || socket_stat.st_mode & libc::S_IFMT != libc::S_IFSOCK
                {
                    return Err(io::Error::other("broker socket path identity changed"));
                }
                if fail_socket_removal {
                    return Err(io::Error::other("injected broker socket removal failure"));
                }
                unlink_entry(&self.directory, SOCKET_NAME, 0)?;
                self.socket_removed = true;
                self.directory.sync_all()?;
            }
            self.socket_removed = true;
        }

        if !self.directory_removed {
            let directory_stat = stat_entry(&self.parent, &self.directory_name)?;
            if FileIdentity::from_stat(&directory_stat) != self.directory_identity
                || directory_stat.st_mode & libc::S_IFMT != libc::S_IFDIR
            {
                return Err(io::Error::other(
                    "broker socket directory path identity changed",
                ));
            }
            unlink_entry(&self.parent, &self.directory_name, libc::AT_REMOVEDIR)?;
            self.directory_removed = true;
            self.parent.sync_all()?;
        }
        Ok(())
    }

    fn capture_socket_identity(&mut self) -> io::Result<FileIdentity> {
        if let Some(identity) = self.socket_identity {
            return Ok(identity);
        }
        if !self.socket_created {
            return Err(io::Error::other("broker socket was not created"));
        }
        let stat = stat_entry(&self.directory, SOCKET_NAME)?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFSOCK {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe broker socket",
            ));
        }
        self.socket_audit
            .as_mut()
            .expect("socket creation audit retained")
            .verify(SOCKET_NAME, false)?;
        let identity = FileIdentity::from_stat(&stat);
        self.socket_identity = Some(identity);
        self.socket_audit = None;
        Ok(identity)
    }

    #[cfg(test)]
    pub(crate) fn cleanup_with_socket_removal_fault_for_test(mut self) -> io::Result<()> {
        let result = self.cleanup_exact(true);
        self.cleanup_on_drop = false;
        result
    }
}

impl Drop for SocketGuard {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            let _ = self.cleanup_exact(false);
        }
    }
}

fn open_directory(path: &Path) -> io::Result<File> {
    let path = CString::new(path.as_os_str().as_bytes())?;
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

fn open_directory_at(parent: &File, name: &CStr) -> io::Result<File> {
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

fn stat_entry(directory: &File, name: &CStr) -> io::Result<libc::stat> {
    let mut stat = unsafe { std::mem::zeroed() };
    if unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            name.as_ptr(),
            &mut stat,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(stat)
}

fn unlink_entry(directory: &File, name: &CStr, flags: i32) -> io::Result<()> {
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), flags) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub fn bind_owner_only(directory: &Path) -> io::Result<(UnixListener, SocketGuard)> {
    bind_owner_only_impl(
        directory,
        #[cfg(feature = "test-fault-injection")]
        None,
    )
}

fn bind_owner_only_impl(
    directory: &Path,
    #[cfg(feature = "test-fault-injection")] fault: Option<BindFaultPoint>,
) -> io::Result<(UnixListener, SocketGuard)> {
    let parent = directory.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "socket directory has no parent",
        )
    })?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    let name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid socket directory"))?;
    if !parent_metadata.file_type().is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.uid() != unsafe { libc::geteuid() }
        || parent_metadata.permissions().mode() & 0o022 != 0
        || name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe socket parent or directory name",
        ));
    }
    let parent_fd = open_directory(parent)?;
    let retained_parent_metadata = parent_fd.metadata()?;
    if FileIdentity::from_metadata(&parent_metadata)
        != FileIdentity::from_metadata(&retained_parent_metadata)
    {
        return Err(io::Error::other("socket parent path identity changed"));
    }
    let directory_name = CString::new(name)?;
    let directory_audit = CreationAudit::new(&parent_fd)?;
    if unsafe { libc::mkdirat(parent_fd.as_raw_fd(), directory_name.as_ptr(), 0o700) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let mut initialization_guard =
        SocketInitializationGuard::new(parent_fd, directory_name, directory_audit);
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::DirectoryIdentityInspection)?;
    let initialization_identity = initialization_guard.capture_directory_identity()?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::DirectoryIdentityCaptured)?;

    let directory_fd = open_directory_at(
        initialization_guard.parent(),
        initialization_guard.directory_name(),
    )?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::DirectoryOpened)?;
    if unsafe { libc::fchmod(directory_fd.as_raw_fd(), 0o700) } != 0 {
        return Err(io::Error::last_os_error());
    }
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::DirectoryPermissionsSet)?;
    let directory_metadata = directory_fd.metadata()?;
    let directory_identity = FileIdentity::from_metadata(&directory_metadata);
    let named_directory_stat = stat_entry(
        initialization_guard.parent(),
        initialization_guard.directory_name(),
    )?;
    if directory_identity != initialization_identity
        || FileIdentity::from_stat(&named_directory_stat) != initialization_identity
        || named_directory_stat.st_mode & libc::S_IFMT != libc::S_IFDIR
        || !directory_metadata.file_type().is_dir()
        || directory_metadata.uid() != unsafe { libc::geteuid() }
        || directory_metadata.permissions().mode() & 0o7777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe broker socket directory",
        ));
    }
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::DirectoryValidated)?;
    let mut guard = initialization_guard.into_socket_guard(directory_fd);
    let socket = retained_socket_path(&guard.directory, directory);
    let socket_audit = CreationAudit::new(&guard.directory)?;
    let listener = UnixListener::bind(&socket)?;
    guard.socket_created = true;
    guard.socket_audit = Some(socket_audit);
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::SocketIdentityInspection)?;
    let retained_socket_identity = guard.capture_socket_identity()?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::SocketIdentityCaptured)?;

    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::SocketPermissionsSet)?;

    let socket_metadata = fs::symlink_metadata(&socket)?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::NamedSocketInspected)?;

    let final_retained_socket_stat = stat_entry(&guard.directory, SOCKET_NAME)?;
    #[cfg(feature = "test-fault-injection")]
    inject_bind_fault(fault, BindFaultPoint::RetainedSocketInspected)?;
    if !socket_metadata.file_type().is_socket()
        || socket_metadata.uid() != unsafe { libc::geteuid() }
        || socket_metadata.permissions().mode() & 0o7777 != 0o600
        || FileIdentity::from_metadata(&socket_metadata) != retained_socket_identity
        || FileIdentity::from_stat(&final_retained_socket_stat) != retained_socket_identity
        || final_retained_socket_stat.st_mode & libc::S_IFMT != libc::S_IFSOCK
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe broker socket",
        ));
    }
    Ok((listener, guard))
}

#[cfg(target_os = "linux")]
fn retained_socket_path(directory: &File, _: &Path) -> std::path::PathBuf {
    std::path::PathBuf::from(format!(
        "/proc/self/fd/{}/broker.sock",
        directory.as_raw_fd()
    ))
}

#[cfg(not(target_os = "linux"))]
fn retained_socket_path(_: &File, directory: &Path) -> std::path::PathBuf {
    directory.join("broker.sock")
}

#[cfg(feature = "test-fault-injection")]
fn inject_bind_fault(selected: Option<BindFaultPoint>, current: BindFaultPoint) -> io::Result<()> {
    if selected == Some(current) {
        return Err(io::Error::other(format!(
            "injected broker bind fault at {current:?}"
        )));
    }
    Ok(())
}

pub fn serve(listener: UnixListener, broker: Arc<Mutex<Broker>>) -> io::Result<()> {
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, default_hooks())
}

#[derive(Clone, Copy)]
struct ServeHooks {
    accept: fn(&UnixListener) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)>,
    configure: fn(&UnixStream) -> io::Result<()>,
    identify_peer: fn(&UnixStream) -> io::Result<u32>,
    seal: fn(&mut Broker) -> io::Result<()>,
    deliver: fn(&mut UnixStream, &ExchangeResponse) -> io::Result<()>,
    confirm: fn(&mut UnixStream) -> io::Result<()>,
    now: fn() -> Instant,
}

fn default_hooks() -> ServeHooks {
    ServeHooks {
        accept: accept_stream,
        configure: configure_stream,
        identify_peer: peer_uid,
        seal: seal_broker,
        deliver: write_response,
        confirm: write_confirmation,
        now: Instant::now,
    }
}

fn serve_with_hooks(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
    accept_timeout: std::time::Duration,
    hooks: ServeHooks,
) -> io::Result<()> {
    loop {
        let accept_deadline = deadline_after(accept_timeout, hooks.now, "broker accept deadline")?;
        let (mut stream, _) = match accept_before(&listener, accept_deadline, hooks) {
            Ok(value) => value,
            Err(error) => {
                let code = if error.kind() == io::ErrorKind::TimedOut {
                    "deadline_exceeded"
                } else {
                    "protocol_error"
                };
                terminate_and_seal(&broker, code)?;
                return Err(error);
            }
        };
        if let Err(error) = (hooks.configure)(&stream) {
            terminate_and_seal(&broker, "protocol_error")?;
            return Err(error);
        }
        let expected_uid = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?
            .expected_uid();
        let (peer_matches, code) = match (hooks.identify_peer)(&stream) {
            Ok(uid) => (uid == expected_uid, "wrong_peer"),
            Err(_) => (false, "protocol_error"),
        };
        if !peer_matches {
            terminate_and_seal(&broker, code)?;
            let _ = write_rejection(&mut stream, "00000000000000000000000000000000", code);
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, code));
        }
        let response = match handle_stream(&mut stream, &broker) {
            Ok(response) => response,
            Err(_) => {
                terminate_and_seal(&broker, "protocol_error")?;
                let _ = write_rejection(
                    &mut stream,
                    "00000000000000000000000000000000",
                    "protocol_error",
                );
                return Err(io::Error::new(io::ErrorKind::InvalidData, "protocol_error"));
            }
        };
        let terminal = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?
            .is_terminal();
        if terminal {
            if response.outcome == "accepted" {
                let response_sha256 = hex::encode(Sha256::digest(serde_json::to_vec(&response)?));
                let output = response.output_artifact.as_ref().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "accepted response lacks output")
                })?;
                if let Err(delivery_error) = (hooks.deliver)(&mut stream, &response) {
                    terminal_delivery_failed_and_seal(&broker)?;
                    return Err(delivery_error);
                }
                drop(stream);
                if let Err(ack_error) = receive_delivery_ack(
                    &listener,
                    &broker,
                    &response.request_id,
                    &response_sha256,
                    output,
                    accept_timeout,
                    hooks,
                ) {
                    return match ack_error {
                        DeliveryAckFailure::Delivery(error) => {
                            terminal_delivery_failed_and_seal(&broker)?;
                            Err(error)
                        }
                        DeliveryAckFailure::Evidence(error) => Err(error),
                    };
                }
                return Ok(());
            }
            let mut state = broker
                .lock()
                .map_err(|_| io::Error::other("broker state poisoned"))?;
            (hooks.seal)(&mut state)?;
            drop(state);
            (hooks.deliver)(&mut stream, &response)?;
            return if response.outcome == "accepted" {
                Ok(())
            } else {
                Err(io::Error::other("exchange failed closed"))
            };
        }
        if let Err(delivery_error) = (hooks.deliver)(&mut stream, &response) {
            terminate_and_seal(&broker, "protocol_error")?;
            return Err(delivery_error);
        }
    }
}

fn receive_delivery_ack(
    listener: &UnixListener,
    broker: &Arc<Mutex<Broker>>,
    expected_request_id: &str,
    expected_response_sha256: &str,
    expected_output: &crate::model::OutputArtifact,
    timeout: Duration,
    hooks: ServeHooks,
) -> Result<(), DeliveryAckFailure> {
    let deadline = deadline_after(timeout, hooks.now, "broker accept deadline")
        .map_err(DeliveryAckFailure::Delivery)?;
    let (mut stream, _) =
        accept_before(listener, deadline, hooks).map_err(DeliveryAckFailure::Delivery)?;
    (hooks.configure)(&stream).map_err(DeliveryAckFailure::Delivery)?;
    let expected_uid = broker
        .lock()
        .map_err(|_| DeliveryAckFailure::Evidence(io::Error::other("broker state poisoned")))?
        .expected_uid();
    if (hooks.identify_peer)(&stream).map_err(DeliveryAckFailure::Delivery)? != expected_uid {
        return Err(DeliveryAckFailure::Delivery(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "wrong delivery acknowledgement peer",
        )));
    }
    let (path, body) = read_request(&mut stream).map_err(DeliveryAckFailure::Delivery)?;
    if path != "/v1/delivery-ack" {
        return Err(DeliveryAckFailure::Delivery(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid delivery acknowledgement path",
        )));
    }
    let mut ack: DeliveryAck =
        serde_json::from_value(parse_strict_json(&body).map_err(DeliveryAckFailure::Delivery)?)
            .map_err(|_| {
                DeliveryAckFailure::Delivery(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid delivery acknowledgement",
                ))
            })?;
    let valid = ack.schema_version == "gate_h2_terminal_delivery_ack_v1.0.0"
        && ack.acceptance_state == "validated_output_and_receipt_durably_committed"
        && ack.output_index == ack.exchange_ordinal as u64
        && ack.receipt_sha256 == expected_response_sha256
        && broker
            .lock()
            .map_err(|_| DeliveryAckFailure::Evidence(io::Error::other("broker state poisoned")))?
            .consume_delivery_ack(
                &ack.run_token,
                ack.owner_uid,
                &ack.request_id,
                &ack.response_sha256,
                &ack.manifest_id,
                &ack.capability_id,
                ack.exchange_ordinal,
                &ack.request_artifact_role,
                &ack.output_artifact_role,
                &ack.output_sha256,
                ack.output_bytes,
                ack.output_status,
                expected_request_id,
                expected_response_sha256,
                &expected_output.artifact_role,
                &expected_output.sha256,
                expected_output.bytes,
                expected_output.status,
            );
    ack.run_token.zeroize();
    if !valid {
        return Err(DeliveryAckFailure::Delivery(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "invalid delivery acknowledgement",
        )));
    }
    {
        let mut state = broker
            .lock()
            .map_err(|_| DeliveryAckFailure::Evidence(io::Error::other("broker state poisoned")))?;
        (hooks.seal)(&mut state).map_err(DeliveryAckFailure::Evidence)?;
    }
    // The complete transcript is already sealed and the ACK proves that the
    // stage accepted first. Confirmation is optional and cannot affect truth.
    let _ = (hooks.confirm)(&mut stream);
    Ok(())
}

fn terminal_delivery_failed_and_seal(broker: &Arc<Mutex<Broker>>) -> io::Result<()> {
    let mut state = broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?;
    state
        .terminal_delivery_failure()
        .map_err(|_| io::Error::other("terminal delivery evidence failed"))?;
    state
        .seal_transcript()
        .map_err(|_| io::Error::other("transcript seal failed"))?;
    Ok(())
}

fn configure_stream(stream: &UnixStream) -> io::Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))
}

fn accept_stream(
    listener: &UnixListener,
) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
    listener.accept()
}

fn seal_broker(broker: &mut Broker) -> io::Result<()> {
    broker
        .seal_transcript()
        .map(|_| ())
        .map_err(|_| io::Error::other("transcript seal failed"))
}

fn write_confirmation(stream: &mut UnixStream) -> io::Result<()> {
    let deadline = Instant::now() + IO_TIMEOUT;
    write_bytes_before(
        stream,
        b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
        deadline,
    )?;
    flush_before(stream, deadline)
}

#[cfg(test)]
pub(crate) fn serve_with_timeout_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
    timeout: std::time::Duration,
) -> io::Result<()> {
    serve_with_hooks(listener, broker, timeout, default_hooks())
}

#[cfg(test)]
pub(crate) fn serve_with_wrong_peer_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn wrong_peer(_: &UnixStream) -> io::Result<u32> {
        Ok(unsafe { libc::geteuid() }.wrapping_add(1))
    }
    let mut hooks = default_hooks();
    hooks.identify_peer = wrong_peer;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_peer_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn peer_error(_: &UnixStream) -> io::Result<u32> {
        Err(io::Error::other("injected peer credential failure"))
    }
    let mut hooks = default_hooks();
    hooks.identify_peer = peer_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_configure_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn configure_error(_: &UnixStream) -> io::Result<()> {
        Err(io::Error::other("injected timeout setup failure"))
    }
    let mut hooks = default_hooks();
    hooks.configure = configure_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_seal_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn seal_error(_: &mut Broker) -> io::Result<()> {
        Err(io::Error::other("injected seal failure"))
    }
    let mut hooks = default_hooks();
    hooks.seal = seal_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_confirmation_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn confirmation_error(_: &mut UnixStream) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "injected optional confirmation failure",
        ))
    }
    let mut hooks = default_hooks();
    hooks.confirm = confirmation_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_accept_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn accept_error(_: &UnixListener) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
        Err(io::Error::other("injected accept failure"))
    }
    let mut hooks = default_hooks();
    hooks.accept = accept_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_delivery_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn delivery_error(_: &mut UnixStream, response: &ExchangeResponse) -> io::Result<()> {
        *DELIVERY_ERROR_RESPONSE.lock().unwrap() = Some(serde_json::to_vec(response).unwrap());
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "injected response delivery failure",
        ))
    }
    let mut hooks = default_hooks();
    hooks.deliver = delivery_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
pub(crate) fn serve_with_uncaptured_delivery_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn delivery_error(_: &mut UnixStream, _: &ExchangeResponse) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "injected terminal response delivery failure",
        ))
    }
    let mut hooks = default_hooks();
    hooks.deliver = delivery_error;
    serve_with_hooks(listener, broker, ACCEPT_TIMEOUT, hooks)
}

#[cfg(test)]
static DELIVERY_ERROR_RESPONSE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn take_delivery_error_response_for_test() -> Option<ExchangeResponse> {
    DELIVERY_ERROR_RESPONSE
        .lock()
        .unwrap()
        .take()
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
}

/*
 * Before accept there is no peer stream to answer. The only admissible action is
 * to consume the next capability, durably seal a failed transcript, and return
 * an error/close to the launcher. Once a stream exists, rejection bytes are
 * released only after that same terminal evidence is durable.
 */

fn terminate_and_seal(broker: &Arc<Mutex<Broker>>, code: &'static str) -> io::Result<()> {
    let mut state = broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?;
    state
        .terminate_protocol_failure(code)
        .map_err(|_| io::Error::other("terminal evidence failed"))?;
    state
        .seal_transcript()
        .map_err(|_| io::Error::other("transcript seal failed"))?;
    Ok(())
}

fn handle_stream(
    stream: &mut UnixStream,
    broker: &Arc<Mutex<Broker>>,
) -> io::Result<ExchangeResponse> {
    let (path, body) = read_request(stream)?;
    let capability_id = path
        .strip_prefix("/v1/exchange/")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid exchange path"))?;
    let request: ExchangeRequest = serde_json::from_value(parse_strict_json(&body)?)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid protocol body"))?;
    broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?
        .exchange(capability_id, request)
        .map_err(|_| io::Error::other("exchange state failure"))
}

pub(crate) fn parse_strict_json(bytes: &[u8]) -> io::Result<serde_json::Value> {
    use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
    struct Seed;
    impl<'de> DeserializeSeed<'de> for Seed {
        type Value = serde_json::Value;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
            d.deserialize_any(ValueVisitor)
        }
    }
    struct ValueVisitor;
    impl<'de> Visitor<'de> for ValueVisitor {
        type Value = serde_json::Value;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("strict JSON")
        }
        fn visit_bool<E: Error>(self, v: bool) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_i64<E: Error>(self, v: i64) -> Result<Self::Value, E> {
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&v) {
                return Err(E::custom("JSON integer outside safe range"));
            }
            Ok(v.into())
        }
        fn visit_u64<E: Error>(self, v: u64) -> Result<Self::Value, E> {
            if v > 9_007_199_254_740_991 {
                return Err(E::custom("JSON integer outside safe range"));
            }
            Ok(v.into())
        }
        fn visit_str<E: Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_string<E: Error>(self, v: String) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_none<E: Error>(self) -> Result<Self::Value, E> {
            Ok(serde_json::Value::Null)
        }
        fn visit_unit<E: Error>(self) -> Result<Self::Value, E> {
            Ok(serde_json::Value::Null)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some(v) = a.next_element_seed(Seed)? {
                out.push(v)
            }
            Ok(out.into())
        }
        fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
            let mut out = serde_json::Map::new();
            while let Some(k) = a.next_key::<String>()? {
                if out.contains_key(&k) {
                    return Err(A::Error::custom("duplicate JSON key"));
                }
                let v = a.next_value_seed(Seed)?;
                out.insert(k, v);
            }
            Ok(out.into())
        }
        fn visit_f64<E: Error>(self, _: f64) -> Result<Self::Value, E> {
            Err(E::custom("floating-point JSON forbidden"))
        }
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    let value = Seed
        .deserialize(&mut de)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid strict JSON"))?;
    de.end()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "trailing JSON"))?;
    Ok(value)
}

fn read_request(stream: &mut UnixStream) -> io::Result<(String, Zeroizing<Vec<u8>>)> {
    read_request_with_timeout(stream, IO_TIMEOUT)
}

fn read_request_with_timeout(
    stream: &mut UnixStream,
    timeout: Duration,
) -> io::Result<(String, Zeroizing<Vec<u8>>)> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid read deadline"))?;
    let mut bytes = Zeroizing::new(Vec::new());
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let read = read_before(stream, &mut chunk, deadline)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated request",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request headers too large",
            ));
        }
        if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let mut headers = [httparse::EMPTY_HEADER; 16];
    let mut request = httparse::Request::new(&mut headers);
    request
        .parse(&bytes[..header_end])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "malformed HTTP request"))?;
    if request.method != Some("POST") || request.version != Some(1) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "only HTTP/1.1 POST is permitted",
        ));
    }
    let path = request.path.unwrap().to_owned();
    let mut length = None;
    let mut host = None;
    let mut content_type = None;
    let mut connection = None;
    for header in request.headers.iter() {
        if header.name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate content length",
                ));
            }
            length = Some(
                std::str::from_utf8(header.value)
                    .ok()
                    .and_then(|v| v.parse::<usize>().ok())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::InvalidData, "invalid content length")
                    })?,
            );
        } else if header.name.eq_ignore_ascii_case("host") {
            if host.replace(header.value).is_some() {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "duplicate host"));
            }
        } else if header.name.eq_ignore_ascii_case("content-type") {
            if content_type.replace(header.value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate content type",
                ));
            }
        } else if header.name.eq_ignore_ascii_case("connection") {
            if connection.replace(header.value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate connection",
                ));
            }
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected request header",
            ));
        }
    }
    let length = length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing content length"))?;
    if host != Some(b"gate-h2".as_slice())
        || content_type != Some(b"application/json".as_slice())
        || connection != Some(b"close".as_slice())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid required protocol headers",
        ));
    }
    if length > MAX_BODY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "protocol body too large",
        ));
    }
    while bytes.len() < header_end + length {
        let read = read_before(stream, &mut chunk, deadline)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated body",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    if bytes.len() != header_end + length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request smuggling bytes",
        ));
    }
    let mut trailing = [0_u8; 1];
    if read_before(stream, &mut trailing, deadline)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request smuggling bytes",
        ));
    }
    Ok((path, Zeroizing::new(bytes[header_end..].to_vec())))
}

fn read_before(stream: &mut UnixStream, bytes: &mut [u8], deadline: Instant) -> io::Result<usize> {
    read_before_with_clock(stream, bytes, deadline, &mut Instant::now)
}

fn read_before_with_clock(
    stream: &mut UnixStream,
    bytes: &mut [u8],
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<usize> {
    let remaining = deadline
        .checked_duration_since(now())
        .filter(|value| !value.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "broker request deadline"))?;
    stream.set_read_timeout(Some(remaining))?;
    let result = stream.read(bytes);
    ensure_broker_before(deadline, now, "broker request deadline")?;
    result.map_err(|error| {
        if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
        ) {
            io::Error::new(io::ErrorKind::TimedOut, "broker request deadline")
        } else {
            error
        }
    })
}

fn deadline_after(
    timeout: Duration,
    now: fn() -> Instant,
    message: &'static str,
) -> io::Result<Instant> {
    now()
        .checked_add(timeout)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, message))
}

fn accept_before(
    listener: &UnixListener,
    deadline: Instant,
    hooks: ServeHooks,
) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
    let mut now = hooks.now;
    accept_before_with_clock(listener, deadline, hooks.accept, &mut now)
}

fn accept_before_with_clock(
    listener: &UnixListener,
    deadline: Instant,
    accept: fn(&UnixListener) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)>,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
    wait_readable_before_with_clock(
        listener.as_raw_fd(),
        deadline,
        "broker accept deadline",
        now,
    )?;
    let result = accept(listener);
    ensure_broker_before(deadline, now, "broker accept deadline")?;
    result
}

fn wait_readable_before_with_clock(
    fd: i32,
    deadline: Instant,
    message: &'static str,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    loop {
        let remaining = ensure_broker_before(deadline, now, message)?;
        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let timeout_ms = i32::try_from(remaining.as_millis().max(1)).unwrap_or(i32::MAX);
        let result = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
        ensure_broker_before(deadline, now, message)?;
        if result > 0 && poll_fd.revents & libc::POLLIN != 0 {
            return Ok(());
        }
        if result == 0 {
            return Err(io::Error::new(io::ErrorKind::TimedOut, message));
        }
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        return Err(io::Error::other("broker listener failed"));
    }
}

fn write_response(stream: &mut UnixStream, response: &ExchangeResponse) -> io::Result<()> {
    let body = serde_json::to_vec(response)?;
    let header = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    let deadline = Instant::now() + IO_TIMEOUT;
    write_bytes_before(stream, header.as_bytes(), deadline)?;
    write_bytes_before(stream, &body, deadline)?;
    flush_before(stream, deadline)
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
    let fd = stream.as_raw_fd();
    let original_flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if original_flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let changed_flags = original_flags & libc::O_NONBLOCK == 0;
    if changed_flags
        && unsafe { libc::fcntl(fd, libc::F_SETFL, original_flags | libc::O_NONBLOCK) } < 0
    {
        return Err(io::Error::last_os_error());
    }

    let result = (|| {
        while !bytes.is_empty() {
            ensure_broker_before(deadline, now, "broker write deadline")?;
            let write_result = stream.write(bytes);
            ensure_broker_before(deadline, now, "broker write deadline")?;
            match write_result {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "broker write made no progress",
                    ));
                }
                Ok(count) => bytes = &bytes[count..],
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    wait_writable_before_with_clock(fd, deadline, now)?;
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })();

    if changed_flags && unsafe { libc::fcntl(fd, libc::F_SETFL, original_flags) } < 0 {
        return result.and(Err(io::Error::last_os_error()));
    }
    result
}

fn wait_writable_before_with_clock(
    fd: i32,
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    loop {
        let remaining = ensure_broker_before(deadline, now, "broker write deadline")?;
        let timeout_ms = i32::try_from(remaining.as_millis().max(1)).unwrap_or(i32::MAX);
        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        let polled = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
        ensure_broker_before(deadline, now, "broker write deadline")?;
        if polled > 0 {
            return Ok(());
        }
        if polled == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "broker write deadline",
            ));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn flush_before(stream: &mut UnixStream, deadline: Instant) -> io::Result<()> {
    flush_before_with_clock(stream, deadline, &mut Instant::now)
}

fn flush_before_with_clock(
    stream: &mut UnixStream,
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
) -> io::Result<()> {
    let remaining = deadline
        .checked_duration_since(now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "broker write deadline"))?;
    stream.set_write_timeout(Some(remaining))?;
    let result = stream.flush();
    ensure_broker_before(deadline, now, "broker write deadline")?;
    result
}

fn ensure_broker_before(
    deadline: Instant,
    now: &mut impl FnMut() -> Instant,
    message: &'static str,
) -> io::Result<Duration> {
    deadline
        .checked_duration_since(now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, message))
}

fn write_rejection(
    stream: &mut UnixStream,
    request_id: &str,
    code: &'static str,
) -> io::Result<()> {
    write_response(
        stream,
        &ExchangeResponse {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_response".into(),
            request_id: request_id.into(),
            outcome: "rejected".into(),
            exchange_consumed: true,
            output_artifact: None,
            failure_code: Some(crate::broker::uds_failure_code(code).into()),
        },
    )
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    if rc == 0 {
        Ok(cred.uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut uid = 0;
    let mut gid = 0;
    let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if rc == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[cfg(target_os = "linux")]
    fn inotify_event_bytes(wd: i32, mask: u32, name: Option<&CStr>) -> Vec<u8> {
        let mut name_bytes = name
            .map(|name| name.to_bytes_with_nul().to_vec())
            .unwrap_or_default();
        let padded_length = (name_bytes.len() + 3) & !3;
        name_bytes.resize(padded_length, 0);
        let mut bytes =
            Vec::with_capacity(std::mem::size_of::<libc::inotify_event>() + padded_length);
        bytes.extend_from_slice(&wd.to_ne_bytes());
        bytes.extend_from_slice(&mask.to_ne_bytes());
        bytes.extend_from_slice(&0_u32.to_ne_bytes());
        bytes.extend_from_slice(&(padded_length as u32).to_ne_bytes());
        bytes.extend_from_slice(&name_bytes);
        bytes
    }

    #[cfg(target_os = "linux")]
    fn creation_audit_for_test() -> (tempfile::TempDir, CreationAudit) {
        let root = tempfile::tempdir().unwrap();
        let directory = open_directory(root.path()).unwrap();
        let audit = CreationAudit::new(&directory).unwrap();
        (root, audit)
    }

    #[cfg(target_os = "linux")]
    fn assert_creation_audit_cannot_recover(audit: &mut CreationAudit) {
        assert!(audit.failed);
        let create = inotify_event_bytes(audit.watch, libc::IN_CREATE, Some(SOCKET_NAME));
        assert_eq!(
            audit
                .observe_events(&create, Some(SOCKET_NAME), false)
                .unwrap_err()
                .to_string(),
            "created entry identity audit failed"
        );
        assert_eq!(
            audit.verify(SOCKET_NAME, false).unwrap_err().to_string(),
            "created entry identity audit failed"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_invalidations_are_sticky_before_and_after_expected_create() {
        for invalidating_mask in [
            libc::IN_Q_OVERFLOW,
            libc::IN_DELETE_SELF,
            libc::IN_MOVE_SELF,
        ] {
            for invalidation_after_create in [false, true] {
                let (_root, mut audit) = creation_audit_for_test();
                let create = inotify_event_bytes(audit.watch, libc::IN_CREATE, Some(SOCKET_NAME));
                let invalidation = inotify_event_bytes(audit.watch, invalidating_mask, None);
                let events = if invalidation_after_create {
                    [create, invalidation].concat()
                } else {
                    [invalidation, create].concat()
                };

                assert_eq!(
                    audit
                        .observe_events(&events, Some(SOCKET_NAME), false)
                        .unwrap_err()
                        .to_string(),
                    "ambiguous creation audit event"
                );
                assert_creation_audit_cannot_recover(&mut audit);
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_parser_failures_are_sticky() {
        let event_header_size = std::mem::size_of::<libc::inotify_event>();
        let truncated_header = vec![0_u8; event_header_size - 1];

        let (_root, mut audit) = creation_audit_for_test();
        assert_eq!(
            audit
                .observe_events(&truncated_header, Some(SOCKET_NAME), false)
                .unwrap_err()
                .to_string(),
            "truncated creation audit event"
        );
        assert_creation_audit_cannot_recover(&mut audit);

        let (_root, mut audit) = creation_audit_for_test();
        let mut oversized_name = inotify_event_bytes(audit.watch, libc::IN_CREATE, None);
        let name_length_offset = std::mem::size_of::<i32>() + 2 * std::mem::size_of::<u32>();
        oversized_name[name_length_offset..name_length_offset + std::mem::size_of::<u32>()]
            .copy_from_slice(&4_u32.to_ne_bytes());
        assert_eq!(
            audit
                .observe_events(&oversized_name, Some(SOCKET_NAME), false)
                .unwrap_err()
                .to_string(),
            "truncated creation audit event"
        );
        assert_creation_audit_cannot_recover(&mut audit);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_event_read_failure_is_sticky() {
        let (_root, mut audit) = creation_audit_for_test();
        let error = audit
            .drain_with_reader(Some(SOCKET_NAME), false, |_| {
                Err(io::Error::other("injected creation audit read failure"))
            })
            .unwrap_err();
        assert_eq!(error.to_string(), "injected creation audit read failure");
        assert_creation_audit_cannot_recover(&mut audit);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_is_sticky_after_watch_loss_following_expected_create() {
        for invalidating_mask in [libc::IN_IGNORED, libc::IN_UNMOUNT] {
            let (_root, mut audit) = creation_audit_for_test();
            let mut events = inotify_event_bytes(audit.watch, libc::IN_CREATE, Some(SOCKET_NAME));
            events.extend(inotify_event_bytes(audit.watch, invalidating_mask, None));
            assert_eq!(
                audit
                    .observe_events(&events, Some(SOCKET_NAME), false)
                    .unwrap_err()
                    .to_string(),
                "ambiguous creation audit event"
            );
            let create = inotify_event_bytes(audit.watch, libc::IN_CREATE, Some(SOCKET_NAME));
            assert_eq!(
                audit
                    .observe_events(&create, Some(SOCKET_NAME), false)
                    .unwrap_err()
                    .to_string(),
                "created entry identity audit failed"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_rejects_watch_loss_before_expected_create() {
        for invalidating_mask in [libc::IN_IGNORED, libc::IN_UNMOUNT] {
            let (_root, mut audit) = creation_audit_for_test();
            let mut events = inotify_event_bytes(audit.watch, invalidating_mask, None);
            events.extend(inotify_event_bytes(
                audit.watch,
                libc::IN_CREATE,
                Some(SOCKET_NAME),
            ));
            assert!(
                audit
                    .observe_events(&events, Some(SOCKET_NAME), false)
                    .is_err()
            );
            assert!(audit.failed);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn creation_audit_rejects_watch_descriptor_and_mask_ambiguity() {
        for (wd_delta, mask) in [
            (1, libc::IN_CREATE),
            (0, libc::IN_ATTRIB),
            (0, libc::IN_CREATE | libc::IN_DELETE),
        ] {
            let (_root, mut audit) = creation_audit_for_test();
            let event = inotify_event_bytes(audit.watch + wd_delta, mask, Some(SOCKET_NAME));
            assert_eq!(
                audit
                    .observe_events(&event, Some(SOCKET_NAME), false)
                    .unwrap_err()
                    .to_string(),
                "ambiguous creation audit event"
            );
            assert!(audit.failed);
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
    fn successful_broker_read_finishing_at_deadline_is_rejected() {
        let (mut reader, mut writer) = UnixStream::pair().unwrap();
        writer.write_all(b"x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let mut byte = [0_u8; 1];
        let error = read_before_with_clock(
            &mut reader,
            &mut byte,
            deadline,
            &mut crossing_clock(deadline),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_broker_eof_finishing_at_deadline_is_rejected() {
        let (mut reader, writer) = UnixStream::pair().unwrap();
        writer.shutdown(std::net::Shutdown::Write).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let mut byte = [0_u8; 1];
        let error = read_before_with_clock(
            &mut reader,
            &mut byte,
            deadline,
            &mut crossing_clock(deadline),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_broker_write_finishing_at_deadline_is_rejected() {
        let (mut writer, mut reader) = UnixStream::pair().unwrap();
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
    fn successful_broker_flush_finishing_at_deadline_is_rejected() {
        let (mut stream, _peer) = UnixStream::pair().unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error = flush_before_with_clock(&mut stream, deadline, &mut crossing_clock(deadline))
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_broker_readiness_finishing_at_deadline_is_rejected() {
        let (reader, mut writer) = UnixStream::pair().unwrap();
        writer.write_all(b"x").unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let error = wait_readable_before_with_clock(
            reader.as_raw_fd(),
            deadline,
            "broker accept deadline",
            &mut crossing_clock(deadline),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn successful_broker_accept_finishing_at_deadline_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let socket = root.path().join("accept.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let _client = UnixStream::connect(&socket).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        let mut calls = 0;
        let mut clock = || {
            calls += 1;
            if calls <= 2 {
                deadline - Duration::from_nanos(1)
            } else {
                deadline
            }
        };
        let error =
            accept_before_with_clock(&listener, deadline, accept_stream, &mut clock).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn owner_only_socket_is_removed_by_explicit_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let (listener, guard) = bind_owner_only(&directory).unwrap();
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o7777,
            0o700
        );
        assert_eq!(
            fs::metadata(directory.join("broker.sock"))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            0o600
        );
        drop(listener);
        guard.cleanup().unwrap();
        assert!(!directory.exists());
    }

    #[cfg(all(feature = "test-fault-injection", target_os = "linux"))]
    #[test]
    fn post_bind_initialization_faults_remove_socket_and_directory() {
        for point in [
            BindFaultPoint::DirectoryIdentityInspection,
            BindFaultPoint::DirectoryIdentityCaptured,
            BindFaultPoint::DirectoryOpened,
            BindFaultPoint::DirectoryPermissionsSet,
            BindFaultPoint::DirectoryValidated,
            BindFaultPoint::SocketIdentityInspection,
            BindFaultPoint::SocketIdentityCaptured,
            BindFaultPoint::SocketPermissionsSet,
            BindFaultPoint::NamedSocketInspected,
            BindFaultPoint::RetainedSocketInspected,
        ] {
            let root = tempfile::tempdir().unwrap();
            let directory = root.path().join("stage-socket");
            let error = match bind_owner_only_impl(&directory, Some(point)) {
                Ok(_) => panic!("fault did not fail at {point:?}"),
                Err(error) => error,
            };
            assert_eq!(
                error.to_string(),
                format!("injected broker bind fault at {point:?}")
            );
            assert!(!directory.join("broker.sock").exists(), "point={point:?}");
            assert!(!directory.exists(), "point={point:?}");
        }
    }

    #[cfg(all(feature = "test-fault-injection", target_os = "linux"))]
    #[test]
    fn initialization_cleanup_rejects_replacement_without_removing_it() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let moved = root.path().join("moved-stage-socket");
        let marker = directory.join("replacement-marker");
        let parent = open_directory(root.path()).unwrap();
        let name = CString::new("stage-socket").unwrap();
        let audit = CreationAudit::new(&parent).unwrap();
        assert_eq!(
            unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) },
            0
        );
        let mut guard = SocketInitializationGuard::new(parent, name, audit);
        guard.capture_directory_identity().unwrap();

        fs::rename(&directory, &moved).unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(&marker, b"keep").unwrap();
        drop(guard);

        assert_eq!(fs::read(&marker).unwrap(), b"keep");
        assert!(moved.is_dir());
        fs::remove_dir(&moved).unwrap();
        fs::remove_file(&marker).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn directory_replacement_before_first_identity_capture_is_not_adopted() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let moved = root.path().join("created-stage-socket");
        let marker = directory.join("replacement-marker");
        let parent = open_directory(root.path()).unwrap();
        let name = CString::new("stage-socket").unwrap();
        let audit = CreationAudit::new(&parent).unwrap();
        assert_eq!(
            unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) },
            0
        );
        let mut guard = SocketInitializationGuard::new(parent, name, audit);

        fs::rename(&directory, &moved).unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(&marker, b"keep").unwrap();
        let error = guard.capture_directory_identity().unwrap_err();
        assert_eq!(
            error.to_string(),
            "created entry was replaced before identity capture"
        );
        drop(guard);

        assert_eq!(fs::read(&marker).unwrap(), b"keep");
        assert!(moved.is_dir());
        fs::remove_dir(&moved).unwrap();
        fs::remove_file(&marker).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn socket_replacement_before_first_identity_capture_is_not_adopted() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        fs::create_dir(&directory).unwrap();
        let directory_fd = open_directory(&directory).unwrap();
        let socket = directory.join("broker.sock");
        let moved = directory.join("created.sock");
        let audit = CreationAudit::new(&directory_fd).unwrap();
        let created_listener = UnixListener::bind(&socket).unwrap();

        fs::rename(&socket, &moved).unwrap();
        let replacement_listener = UnixListener::bind(&socket).unwrap();
        let mut guard = SocketGuard {
            parent: open_directory(root.path()).unwrap(),
            directory: directory_fd,
            directory_name: CString::new("stage-socket").unwrap(),
            directory_identity: FileIdentity::from_metadata(&fs::metadata(&directory).unwrap()),
            socket_audit: Some(audit),
            socket_identity: None,
            socket_created: true,
            socket_removed: false,
            directory_removed: false,
            cleanup_on_drop: true,
        };
        let error = guard.capture_socket_identity().unwrap_err();
        assert_eq!(
            error.to_string(),
            "created entry was replaced before identity capture"
        );
        drop(guard);

        assert!(
            fs::symlink_metadata(&socket)
                .unwrap()
                .file_type()
                .is_socket()
        );
        drop(created_listener);
        drop(replacement_listener);
        fs::remove_file(&moved).unwrap();
        fs::remove_file(&socket).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn portable_production_audit_fails_closed_before_creation() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let error = portable_creation_audit_error();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert!(!directory.exists());
    }

    #[test]
    fn explicit_cleanup_propagates_injected_socket_removal_failure() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let (listener, guard) = bind_owner_only(&directory).unwrap();
        drop(listener);
        let error = guard
            .cleanup_with_socket_removal_fault_for_test()
            .unwrap_err();
        assert_eq!(error.to_string(), "injected broker socket removal failure");
        assert!(
            directory.join("broker.sock").exists(),
            "explicit cleanup failure must not be retried by Drop"
        );
        fs::remove_file(directory.join("broker.sock")).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn cleanup_rejects_directory_path_replacement_without_removing_it() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let moved = root.path().join("moved-stage-socket");
        let marker = directory.join("unrelated-marker");
        let (listener, guard) = bind_owner_only(&directory).unwrap();
        drop(listener);
        fs::rename(&directory, &moved).unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(&marker, b"keep").unwrap();

        let error = guard.cleanup().unwrap_err();
        assert_eq!(
            error.to_string(),
            "broker socket directory path identity changed"
        );
        assert_eq!(fs::read(&marker).unwrap(), b"keep");
        assert!(moved.is_dir());
        assert!(!moved.join("broker.sock").exists());

        fs::remove_dir(&moved).unwrap();
        fs::remove_file(&marker).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn cleanup_rejects_socket_path_replacement_without_removing_it() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let socket = directory.join("broker.sock");
        let (listener, guard) = bind_owner_only(&directory).unwrap();
        drop(listener);
        fs::remove_file(&socket).unwrap();
        let replacement_listener = UnixListener::bind(&socket).unwrap();

        let error = guard.cleanup().unwrap_err();
        assert_eq!(error.to_string(), "broker socket path identity changed");
        assert!(
            fs::symlink_metadata(&socket)
                .unwrap()
                .file_type()
                .is_socket()
        );

        drop(replacement_listener);
        fs::remove_file(&socket).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn malformed_method_and_duplicate_length_are_rejected() {
        fn parse(raw: &[u8]) -> io::Result<(String, Zeroizing<Vec<u8>>)> {
            let (mut writer, mut reader) = UnixStream::pair()?;
            writer.write_all(raw)?;
            writer.shutdown(std::net::Shutdown::Write)?;
            read_request(&mut reader)
        }
        assert!(parse(b"CONNECT x HTTP/1.1\r\ncontent-length: 0\r\n\r\n").is_err());
        assert!(
            parse(
                b"POST /v1/exchange/x HTTP/1.1\r\ncontent-length: 0\r\ncontent-length: 0\r\n\r\n"
            )
            .is_err()
        );
        assert!(parse(b"POST /v1/exchange/x HTTP/1.1\r\ntransfer-encoding: chunked\r\ncontent-length: 0\r\n\r\n").is_err());
        assert!(parse_strict_json(br#"{"x":1,"x":2}"#).is_err());
        assert!(parse_strict_json(br#"{"x":9007199254740992}"#).is_err());
        assert!(parse_strict_json(br#"{"x":-9007199254740992}"#).is_err());
        assert!(parse_strict_json(br#"{"x":9007199254740991}"#).is_ok());
    }

    #[test]
    fn request_reads_share_one_monotonic_deadline() {
        let (mut writer, mut reader) = UnixStream::pair().unwrap();
        let sender = std::thread::spawn(move || {
            for byte in b"POST /" {
                if writer.write_all(&[*byte]).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(8));
            }
        });
        let started = Instant::now();
        let error = read_request_with_timeout(&mut reader, Duration::from_millis(20)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_millis(100));
        drop(reader);
        sender.join().unwrap();
    }

    #[test]
    fn response_writes_share_one_monotonic_deadline_despite_partial_progress() {
        let (mut writer, mut reader) = UnixStream::pair().unwrap();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader_stop = stop.clone();
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
        reader
            .set_read_timeout(Some(Duration::from_millis(10)))
            .unwrap();
        let slow_reader = std::thread::spawn(move || {
            let mut byte = [0_u8; 1];
            while !reader_stop.load(std::sync::atomic::Ordering::Relaxed)
                && reader.read(&mut byte).unwrap_or(0) != 0
            {
                std::thread::sleep(Duration::from_millis(4));
            }
        });
        let started = Instant::now();
        let result = write_bytes_before(
            &mut writer,
            &vec![0x5a; 1024 * 1024],
            started + Duration::from_millis(30),
        );
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let error = result.unwrap_err();
        assert!(matches!(
            error.kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
        ));
        assert!(started.elapsed() < Duration::from_millis(150));
        drop(writer);
        slow_reader.join().unwrap();
    }
}
