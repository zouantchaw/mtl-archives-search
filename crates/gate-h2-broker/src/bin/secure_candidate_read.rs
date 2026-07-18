use std::{
    collections::BTreeSet,
    env,
    ffi::{CStr, CString},
    fs::File,
    io::{self, Write},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};

const AGGREGATE_CAP: u64 = 256 * 1024 * 1024;
const MEMBERS: [(&str, u32, u64); 6] = [
    ("INNER-CANDIDATE", 0o444, 64),
    ("gate-h2-broker", 0o555, 32 * 1024 * 1024),
    ("gate-h2-stage.oci.tar", 0o444, 160 * 1024 * 1024),
    ("provenance.json", 0o444, 64 * 1024),
    ("rootfs.tar", 0o444, 80 * 1024 * 1024),
    ("sbom.cdx.json", 0o444, 4 * 1024 * 1024),
];

struct Member {
    name: &'static str,
    file: File,
    status: libc::stat,
}

fn validate_sizes(sizes: &[u64]) -> io::Result<()> {
    if sizes.len() != MEMBERS.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "six candidate sizes required",
        ));
    }
    let mut aggregate = 0_u64;
    for ((name, _, cap), size) in MEMBERS.iter().zip(sizes) {
        if size > cap {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("candidate artifact cap exceeded: {name}"),
            ));
        }
        aggregate = aggregate.checked_add(*size).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "candidate aggregate overflow")
        })?;
    }
    if aggregate > AGGREGATE_CAP {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "candidate aggregate cap exceeded",
        ));
    }
    Ok(())
}

#[cfg(feature = "test-fault-injection")]
fn fault(point: &str) -> io::Result<()> {
    if env::var("GATE_H2_TEST_SECURE_READ_FAULT").ok().as_deref() == Some(point) {
        return Err(io::Error::other(format!(
            "injected secure-read fault at {point}"
        )));
    }
    Ok(())
}

#[cfg(not(feature = "test-fault-injection"))]
fn fault(_: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(feature = "test-fault-injection")]
fn attack_directory(path: &Path, point: &str) -> io::Result<()> {
    if env::var("GATE_H2_TEST_SECURE_READ_ATTACK").ok().as_deref() != Some(point) {
        return Ok(());
    }
    use std::os::unix::fs::symlink;
    let moved = path.with_extension(format!("descriptor-pinned-{}", std::process::id()));
    std::fs::rename(path, &moved)?;
    symlink("/", path)
}

#[cfg(not(feature = "test-fault-injection"))]
fn attack_directory(_: &Path, _: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(feature = "test-fault-injection")]
fn attack_member(path: &Path, name: &str, point: &str) -> io::Result<()> {
    if env::var("GATE_H2_TEST_SECURE_READ_ATTACK").ok().as_deref() != Some(point) {
        return Ok(());
    }
    use std::os::unix::fs::symlink;
    let member = path.join(name);
    std::fs::rename(&member, path.join(format!(".{name}.swapped")))?;
    symlink("/etc/passwd", member)
}

#[cfg(not(feature = "test-fault-injection"))]
fn attack_member(_: &Path, _: &str, _: &str) -> io::Result<()> {
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

fn same_identity(left: &libc::stat, right: &libc::stat) -> bool {
    left.st_dev == right.st_dev
        && left.st_ino == right.st_ino
        && left.st_mode == right.st_mode
        && left.st_uid == right.st_uid
        && left.st_nlink == right.st_nlink
        && left.st_size == right.st_size
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
            unsafe {
                *errno_pointer() = libc::EIO;
            }
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

fn run(path: &Path) -> io::Result<()> {
    let original_path = path.to_path_buf();
    let path = CString::new(path.as_os_str().as_bytes())?;
    let raw = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if raw < 0 {
        return Err(io::Error::last_os_error());
    }
    let directory = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
    let initial = directory.metadata()?;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    if !initial.is_dir()
        || initial.uid() != unsafe { libc::geteuid() }
        || initial.permissions().mode() & 0o7777 != 0o700
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe candidate directory",
        ));
    }
    fault("directory-open")?;
    attack_directory(&original_path, "directory-after-open")?;
    let names = enumerate(directory.as_raw_fd())?;
    let expected: BTreeSet<Vec<u8>> = MEMBERS
        .iter()
        .map(|(name, _, _)| name.as_bytes().to_vec())
        .collect();
    if names != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "candidate exact member set mismatch",
        ));
    }
    fault("enumerated")?;
    attack_directory(&original_path, "directory-after-enumerate")?;
    let mut sizes = Vec::new();
    let mut opened = Vec::new();
    for (name, mode, cap) in MEMBERS {
        fault(&format!("before-open-{name}"))?;
        attack_member(&original_path, name, &format!("member-before-open-{name}"))?;
        let c_name = CString::new(name)?;
        let raw = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                c_name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        let file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
        let status = stat_at(directory.as_raw_fd(), &c_name)?;
        let opened_status = file.metadata()?;
        if status.st_mode & libc::S_IFMT != libc::S_IFREG
            || status.st_nlink != 1
            || status.st_uid != unsafe { libc::geteuid() }
            || u32::from(status.st_mode & 0o7777) != mode
            || status.st_size < 0
            || status.st_size as u64 > cap
            || opened_status.dev() != status.st_dev as u64
            || opened_status.ino() != status.st_ino as u64
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("unsafe candidate member: {name}"),
            ));
        }
        sizes.push(status.st_size as u64);
        opened.push(Member { name, file, status });
        attack_member(&original_path, name, &format!("member-after-open-{name}"))?;
        fault(&format!("after-open-{name}"))?;
    }
    validate_sizes(&sizes)?;
    fault("all-open")?;
    let final_directory = directory.metadata()?;
    if initial.dev() != final_directory.dev()
        || initial.ino() != final_directory.ino()
        || initial.mode() != final_directory.mode()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "candidate directory identity changed",
        ));
    }
    for member in &opened {
        let name = CString::new(member.name)?;
        let final_status = stat_at(directory.as_raw_fd(), &name)?;
        if !same_identity(&member.status, &final_status) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("candidate member binding changed: {}", member.name),
            ));
        }
    }
    fault("final-binding")?;
    let stdout = io::stdout();
    let mut output = stdout.lock();
    output.write_all(b"GATEH2SNAP1\n")?;
    for mut member in opened {
        let name = member.name.as_bytes();
        output.write_all(&(name.len() as u16).to_be_bytes())?;
        output.write_all(name)?;
        output.write_all(&(member.status.st_size as u64).to_be_bytes())?;
        io::copy(&mut member.file, &mut output)?;
    }
    output.flush()
}

fn main() {
    let arguments: Vec<_> = env::args_os().skip(1).collect();
    if arguments.first().and_then(|value| value.to_str()) == Some("--check-sizes") {
        let sizes: Result<Vec<u64>, _> = arguments
            .iter()
            .skip(1)
            .map(|value| value.to_string_lossy().parse())
            .collect();
        match sizes
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid size"))
            .and_then(|sizes| validate_sizes(&sizes))
        {
            Ok(()) => return,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(74);
            }
        }
    }
    if arguments.len() != 1 {
        eprintln!("usage: gate-h2-secure-candidate-read CANDIDATE");
        std::process::exit(64);
    }
    if let Err(error) = run(Path::new(&arguments[0])) {
        eprintln!("{error}");
        std::process::exit(74);
    }
}
