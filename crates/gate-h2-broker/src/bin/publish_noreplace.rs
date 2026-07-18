use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    env,
    ffi::{CStr, CString},
    fs::{self, File},
    io::{self, Read, Seek, Write},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::fs::{MetadataExt, PermissionsExt},
    },
};

const AGGREGATE_CAP: u64 = 256 * 1024 * 1024;
const MEMBERS: [(&str, u32, u64); 6] = [
    ("gate-h2-broker", 0o555, 32 * 1024 * 1024),
    ("gate-h2-stage.oci.tar", 0o444, 160 * 1024 * 1024),
    ("provenance.json", 0o444, 64 * 1024),
    ("reproducibility.env", 0o444, 64 * 1024),
    ("rootfs.tar", 0o444, 80 * 1024 * 1024),
    ("sbom.cdx.json", 0o444, 4 * 1024 * 1024),
];

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmissionDescriptor {
    schema: String,
    source_dev: u64,
    source_ino: u64,
    parent_dev: u64,
    parent_ino: u64,
    members: Vec<AdmittedMember>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AdmittedMember {
    name: String,
    mode: u32,
    bytes: u64,
    sha256: String,
}

#[cfg(feature = "test-fault-injection")]
fn injected(name: &str) -> io::Result<()> {
    if env::var("GATE_H2_TEST_FAIL_FSYNC_STAGE").ok().as_deref() == Some(name) {
        return Err(io::Error::other(format!("injected {name} failure")));
    }
    Ok(())
}
#[cfg(not(feature = "test-fault-injection"))]
fn injected(_: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(feature = "test-fault-injection")]
fn inject_special_mode(file: &File, point: &str) -> io::Result<()> {
    if env::var("GATE_H2_TEST_PUBLICATION_SPECIAL_MODE")
        .ok()
        .as_deref()
        != Some(point)
    {
        return Ok(());
    }
    let current = file.metadata()?.permissions().mode() & 0o7777;
    if unsafe { libc::fchmod(file.as_raw_fd(), (current | 0o4000) as libc::mode_t) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(feature = "test-fault-injection"))]
fn inject_special_mode(_: &File, _: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
unsafe fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__errno_location() }
}
#[cfg(target_os = "macos")]
unsafe fn errno_pointer() -> *mut libc::c_int {
    unsafe { libc::__error() }
}

fn sync_directory(directory: &File, fault: &str) -> io::Result<()> {
    injected(fault)?;
    directory.sync_all()
}

fn duplicate_inherited(fd: i32) -> io::Result<File> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 12) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(duplicate) }))
}

fn enumerate(directory: i32) -> io::Result<BTreeSet<Vec<u8>>> {
    let duplicate = unsafe { libc::dup(directory) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(io::Error::last_os_error());
    }
    let mut names = BTreeSet::new();
    #[cfg(feature = "test-fault-injection")]
    let mut index = 0_usize;
    loop {
        #[cfg(feature = "test-fault-injection")]
        if env::var("GATE_H2_TEST_READDIR_ERROR").ok().as_deref()
            == Some(index.to_string().as_str())
        {
            unsafe { libc::closedir(stream) };
            return Err(io::Error::from_raw_os_error(libc::EIO));
        }
        unsafe {
            *errno_pointer() = 0;
        }
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            let error = unsafe { *errno_pointer() };
            if error != 0 {
                unsafe { libc::closedir(stream) };
                return Err(io::Error::from_raw_os_error(error));
            }
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name != b"." && name != b".." {
            names.insert(name.to_vec());
        }
        #[cfg(feature = "test-fault-injection")]
        {
            index += 1;
        }
    }
    if unsafe { libc::closedir(stream) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(names)
}

fn stat_at(directory: i32, name: &CString) -> io::Result<libc::stat> {
    let mut status = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe {
        libc::fstatat(
            directory,
            name.as_ptr(),
            status.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { status.assume_init() })
}

fn read_descriptor(expected_sha256: &str) -> io::Result<(AdmissionDescriptor, String)> {
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid expected descriptor digest",
        ));
    }
    let mut file = duplicate_inherited(4)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o7777 != 0o444
        || metadata.nlink() != 0
        || metadata.len() > 64 * 1024
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "admission descriptor type/size rejected before read",
        ));
    }
    file.rewind()?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != metadata.len() || bytes.len() > 64 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "admission descriptor changed or exceeds cap",
        ));
    }
    let descriptor_sha256 = hex::encode(Sha256::digest(&bytes));
    if descriptor_sha256 != expected_sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "admission descriptor digest mismatch",
        ));
    }
    let descriptor: AdmissionDescriptor = serde_json::from_slice(&bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid admission descriptor"))?;
    if descriptor.schema != "gate_h2_oci_admission_descriptor_v1"
        || descriptor.members.len() != MEMBERS.len()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "admission descriptor shape mismatch",
        ));
    }
    let mut aggregate = 0_u64;
    for ((name, mode, cap), member) in MEMBERS.iter().zip(&descriptor.members) {
        if member.name != *name
            || member.mode != *mode
            || member.bytes > *cap
            || member.sha256.len() != 64
            || !member
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "admission descriptor member mismatch",
            ));
        }
        aggregate = aggregate.checked_add(member.bytes).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "publication aggregate overflow")
        })?;
    }
    if aggregate > AGGREGATE_CAP {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "publication aggregate cap exceeded",
        ));
    }
    let final_metadata = file.metadata()?;
    if !same_identity(&metadata, &final_metadata) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "admission descriptor identity changed during verification",
        ));
    }
    Ok((descriptor, descriptor_sha256))
}

fn same_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.mode() == right.mode()
        && left.nlink() == right.nlink()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

fn hash_exact(file: &mut File, expected: u64) -> io::Result<String> {
    file.rewind()?;
    let mut remaining = expected;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    while remaining != 0 {
        let limit = usize::try_from(remaining.min(buffer.len() as u64)).unwrap();
        let count = file.read(&mut buffer[..limit])?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "artifact shorter than admitted length",
            ));
        }
        hash.update(&buffer[..count]);
        remaining -= count as u64;
    }
    let mut overflow = [0_u8; 1];
    if file.read(&mut overflow)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "artifact exceeds admitted length",
        ));
    }
    file.rewind()?;
    Ok(hex::encode(hash.finalize()))
}

fn write_new_at(directory: i32, name: &CString, mode: u32, bytes: &[u8]) -> io::Result<()> {
    let fd = unsafe {
        libc::openat(
            directory,
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            mode,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut file = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    file.write_all(bytes)?;
    file.sync_all()
}

fn replace_state(parent: &File, state: &CString, bytes: &[u8], fault: &str) -> io::Result<()> {
    let temporary = CString::new(format!(
        ".publication-state-transition-{}",
        std::process::id()
    ))?;
    write_new_at(parent.as_raw_fd(), &temporary, 0o600, bytes)?;
    if unsafe {
        libc::renameat(
            parent.as_raw_fd(),
            temporary.as_ptr(),
            parent.as_raw_fd(),
            state.as_ptr(),
        )
    } != 0
    {
        unsafe {
            libc::unlinkat(parent.as_raw_fd(), temporary.as_ptr(), 0);
        }
        return Err(io::Error::last_os_error());
    }
    sync_directory(parent, fault)
}

#[cfg(target_os = "linux")]
fn rename_noreplace(parent: i32, source: &CString, destination: &CString) -> io::Result<()> {
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            parent,
            source.as_ptr(),
            parent,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn rename_noreplace(parent: i32, source: &CString, destination: &CString) -> io::Result<()> {
    unsafe extern "C" {
        fn renameatx_np(
            fromfd: libc::c_int,
            from: *const libc::c_char,
            tofd: libc::c_int,
            to: *const libc::c_char,
            flags: u32,
        ) -> libc::c_int;
    }
    const RENAME_EXCL: u32 = 0x0000_0004;
    if unsafe {
        renameatx_np(
            parent,
            source.as_ptr(),
            parent,
            destination.as_ptr(),
            RENAME_EXCL,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn rename_noreplace(_: i32, _: &CString, _: &CString) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "publication unsupported on this platform",
    ))
}

fn run(destination_text: &str, expected_descriptor_sha256: &str) -> io::Result<()> {
    if destination_text.is_empty()
        || matches!(destination_text, "." | "..")
        || !destination_text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe destination name",
        ));
    }
    let (descriptor, descriptor_sha256) = read_descriptor(expected_descriptor_sha256)?;
    let destination = CString::new(destination_text)?;
    let state = CString::new(format!(".{destination_text}.publication-state"))?;
    let parent = duplicate_inherited(5)?;
    let parent_initial = parent.metadata()?;
    if parent_initial.uid() != unsafe { libc::geteuid() }
        || !parent_initial.file_type().is_dir()
        || parent_initial.permissions().mode() & 0o7022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe publication parent directory",
        ));
    }
    if descriptor.parent_dev != parent_initial.dev()
        || descriptor.parent_ino != parent_initial.ino()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "admission capability identity mismatch",
        ));
    }
    match stat_at(parent.as_raw_fd(), &state) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "publication state requires explicit recovery",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let mut opened = Vec::new();
    for (index, ((name, mode, _), admitted)) in
        MEMBERS.into_iter().zip(descriptor.members).enumerate()
    {
        let mut file = duplicate_inherited(6 + index as i32)?;
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file()
            || metadata.nlink() != 0
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o7777 != mode
            || metadata.len() != admitted.bytes
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("unsafe publication member: {name}"),
            ));
        }
        if hash_exact(&mut file, admitted.bytes)? != admitted.sha256 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("publication source hash mismatch: {name}"),
            ));
        }
        let verified = file.metadata()?;
        if !same_identity(&metadata, &verified) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("retained publication member changed: {name}"),
            ));
        }
        opened.push((name, mode, file, verified, admitted));
    }
    let staging = CString::new(format!(
        ".{destination_text}.staging-{}",
        std::process::id()
    ))?;
    if unsafe { libc::mkdirat(parent.as_raw_fd(), staging.as_ptr(), 0o700) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let staging_fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            staging.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if staging_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let staging_directory = File::from(unsafe { OwnedFd::from_raw_fd(staging_fd) });
    sync_directory(&parent, "publication-staging-parent")?;
    let mut source_hash = Sha256::new();
    let mut staged_members = Vec::new();
    for (name, mode, mut input, retained_identity, admitted) in opened {
        let output_fd = unsafe {
            libc::openat(
                staging_directory.as_raw_fd(),
                CString::new(name)?.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                mode,
            )
        };
        if output_fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut output = File::from(unsafe { OwnedFd::from_raw_fd(output_fd) });
        if unsafe { libc::fchmod(output.as_raw_fd(), mode as libc::mode_t) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = [0_u8; 64 * 1024];
        let mut remaining = admitted.bytes;
        let mut input_hash = Sha256::new();
        while remaining != 0 {
            let limit = usize::try_from(remaining.min(buffer.len() as u64)).unwrap();
            let count = input.read(&mut buffer[..limit])?;
            if count == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "source truncated during publication",
                ));
            }
            source_hash.update(name.as_bytes());
            source_hash.update((count as u64).to_be_bytes());
            source_hash.update(&buffer[..count]);
            input_hash.update(&buffer[..count]);
            output.write_all(&buffer[..count])?;
            remaining -= count as u64;
        }
        if input.read(&mut buffer[..1])? != 0
            || hex::encode(input_hash.finalize()) != admitted.sha256
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "source changed during exact publication copy",
            ));
        }
        output.sync_all()?;
        inject_special_mode(&output, &format!("staged-{name}"))?;
        let output_metadata = output.metadata()?;
        if output_metadata.len() != admitted.bytes || output_metadata.mode() & 0o7777 != mode {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "staged artifact metadata mismatch",
            ));
        }
        if hash_exact(&mut output, admitted.bytes)? != admitted.sha256
            || hash_exact(&mut input, admitted.bytes)? != admitted.sha256
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "source or staged artifact hash changed",
            ));
        }
        let source_after = input.metadata()?;
        if !same_identity(&retained_identity, &source_after) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "source identity changed after publication copy",
            ));
        }
        staged_members.push((
            name,
            mode,
            admitted.bytes,
            admitted.sha256,
            output_metadata.dev(),
            output_metadata.ino(),
        ));
    }
    staging_directory.sync_all()?;
    let parent_final = parent.metadata()?;
    if parent_initial.dev() != parent_final.dev() || parent_initial.ino() != parent_final.ino() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "publication parent identity changed",
        ));
    }
    let attempt = format!(
        "{}-{}",
        std::process::id(),
        hex::encode(source_hash.finalize())
    );
    let prepared = format!(
        "{{\"schema\":\"gate_h2_publication_state_v2\",\"state\":\"prepared\",\"attempt\":\"{attempt}\",\"descriptor_sha256\":\"{descriptor_sha256}\",\"source_dev\":{},\"source_ino\":{}}}\n",
        descriptor.source_dev, descriptor.source_ino
    );
    write_new_at(parent.as_raw_fd(), &state, 0o600, prepared.as_bytes())?;
    sync_directory(&parent, "prepared-parent-fsync")?;
    #[cfg(feature = "test-fault-injection")]
    if env::var_os("GATE_H2_TEST_INTERRUPT_BEFORE_RENAME").is_some() {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "injected interruption before rename",
        ));
    }
    #[cfg(feature = "test-fault-injection")]
    if env::var_os("GATE_H2_TEST_DESTINATION_RACE").is_some() {
        if unsafe { libc::mkdirat(parent.as_raw_fd(), destination.as_ptr(), 0o700) } != 0 {
            return Err(io::Error::last_os_error());
        }
        sync_directory(&parent, "race-parent-fsync")?;
    }
    #[cfg(feature = "test-fault-injection")]
    let rename_result = if env::var_os("GATE_H2_TEST_RENAME_UNKNOWN").is_some() {
        Err(io::Error::from_raw_os_error(libc::EIO))
    } else {
        rename_noreplace(parent.as_raw_fd(), &staging, &destination)
    };
    #[cfg(not(feature = "test-fault-injection"))]
    let rename_result = rename_noreplace(parent.as_raw_fd(), &staging, &destination);
    if let Err(rename_error) = rename_result {
        let observed = stat_at(parent.as_raw_fd(), &destination).ok();
        if let Some(observed) =
            observed.filter(|_| rename_error.raw_os_error() == Some(libc::EEXIST))
        {
            let conflict = format!(
                "{{\"schema\":\"gate_h2_publication_state_v3\",\"state\":\"conflict_not_published\",\"attempt\":\"{attempt}\",\"descriptor_sha256\":\"{descriptor_sha256}\",\"source_dev\":{},\"source_ino\":{},\"destination_dev\":{},\"destination_ino\":{},\"destination_mode\":{}}}\n",
                descriptor.source_dev,
                descriptor.source_ino,
                observed.st_dev,
                observed.st_ino,
                observed.st_mode
            );
            replace_state(
                &parent,
                &state,
                conflict.as_bytes(),
                "conflict-state-parent-fsync",
            )?;
            #[cfg(feature = "test-fault-injection")]
            if env::var_os("GATE_H2_TEST_INTERRUPT_AFTER_CONFLICT_STATE").is_some() {
                return Err(io::Error::other(
                    "injected interruption after durable conflict state",
                ));
            }
        } else {
            let unknown = format!(
                "{{\"schema\":\"gate_h2_publication_state_v3\",\"state\":\"rename_failed_unknown\",\"attempt\":\"{attempt}\",\"descriptor_sha256\":\"{descriptor_sha256}\",\"errno\":{}}}\n",
                rename_error.raw_os_error().unwrap_or(0)
            );
            replace_state(
                &parent,
                &state,
                unknown.as_bytes(),
                "rename-unknown-state-parent-fsync",
            )?;
        }
        return Err(rename_error);
    }
    #[cfg(feature = "test-fault-injection")]
    if env::var_os("GATE_H2_TEST_INTERRUPT_AFTER_RENAME").is_some() {
        return Err(io::Error::other(
            "destination visible; prepared marker requires recovery",
        ));
    }
    sync_directory(&parent, "post-rename-parent-fsync")?;
    let destination_fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            destination.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if destination_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let destination_directory = File::from(unsafe { OwnedFd::from_raw_fd(destination_fd) });
    let destination_meta = destination_directory.metadata()?;
    let staging_meta = staging_directory.metadata()?;
    if destination_meta.dev() != staging_meta.dev() || destination_meta.ino() != staging_meta.ino()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "published destination inode differs from retained staging inode",
        ));
    }
    let expected_names: BTreeSet<Vec<u8>> = staged_members
        .iter()
        .map(|member| member.0.as_bytes().to_vec())
        .collect();
    if enumerate(destination_directory.as_raw_fd())? != expected_names {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "published destination member set mismatch",
        ));
    }
    for (name, mode, bytes, sha256, staged_dev, staged_ino) in &staged_members {
        let name_c = CString::new(*name)?;
        let fd = unsafe {
            libc::openat(
                destination_directory.as_raw_fd(),
                name_c.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut file = File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        inject_special_mode(&file, &format!("published-{name}"))?;
        let metadata = file.metadata()?;
        if metadata.dev() != *staged_dev
            || metadata.ino() != *staged_ino
            || metadata.len() != *bytes
            || metadata.mode() & 0o7777 != *mode
            || hash_exact(&mut file, *bytes)? != *sha256
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "published destination artifact binding mismatch",
            ));
        }
    }
    let published = format!(
        "{{\"schema\":\"gate_h2_publication_state_v3\",\"state\":\"published\",\"attempt\":\"{attempt}\",\"descriptor_sha256\":\"{descriptor_sha256}\",\"parent_dev\":{},\"parent_ino\":{},\"destination_dev\":{},\"destination_ino\":{}}}\n",
        parent_initial.dev(),
        parent_initial.ino(),
        destination_meta.dev(),
        destination_meta.ino()
    );
    replace_state(
        &parent,
        &state,
        published.as_bytes(),
        "published-state-parent-fsync",
    )?;
    print!("{published}");
    Ok(())
}

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    if arguments.len() != 2 {
        eprintln!("usage: gate-h2-publish-noreplace DESTINATION_NAME DESCRIPTOR_SHA256");
        std::process::exit(64);
    }
    if let Err(error) = run(&arguments[0], &arguments[1]) {
        eprintln!("{error}");
        std::process::exit(74);
    }
}
