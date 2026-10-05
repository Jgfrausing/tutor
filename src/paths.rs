use std::collections::HashMap;
use std::ffi::{CStr, CString, OsStr};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

fn split(p: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let i = p.iter().rposition(|&c| c == b'/').map_or(0, |i| i + 1);
    let (head, tail) = p.split_at(i);
    let mut head = head.to_vec();
    if !head.is_empty() && head.iter().any(|&c| c != b'/') {
        while head.last() == Some(&b'/') {
            head.pop();
        }
    }
    (head, tail.to_vec())
}

fn join(a: &[u8], b: &[u8]) -> Vec<u8> {
    if b.starts_with(b"/") {
        return b.to_vec();
    }
    let mut out = a.to_vec();
    if !out.is_empty() && !out.ends_with(b"/") {
        out.push(b'/');
    }
    out.extend_from_slice(b);
    out
}

fn as_path(b: &[u8]) -> &Path {
    Path::new(OsStr::from_bytes(b))
}

type Seen = HashMap<Vec<u8>, Option<Vec<u8>>>;

fn join_real(path: &[u8], rest: &[u8], seen: &mut Seen) -> (Vec<u8>, bool) {
    let mut path = path.to_vec();
    let mut rest = rest.to_vec();
    if rest.starts_with(b"/") {
        rest.remove(0);
        path = b"/".to_vec();
    }
    while !rest.is_empty() {
        let (name, remainder) = match rest.iter().position(|&c| c == b'/') {
            Some(i) => (rest[..i].to_vec(), rest[i + 1..].to_vec()),
            None => (rest.clone(), Vec::new()),
        };
        rest = remainder;
        if name.is_empty() || name == b"." {
            continue;
        }
        if name == b".." {
            if !path.is_empty() {
                let (head, tail) = split(&path);
                path = head;
                if tail == b".." {
                    path = join(&join(&path, b".."), b"..");
                }
            } else {
                path = b"..".to_vec();
            }
            continue;
        }
        let newpath = join(&path, &name);
        let is_link = std::fs::symlink_metadata(as_path(&newpath))
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if !is_link {
            path = newpath;
            continue;
        }
        if let Some(entry) = seen.get(&newpath) {
            match entry {
                Some(p) => {
                    path = p.clone();
                    continue;
                }
                None => return (join(&newpath, &rest), false),
            }
        }
        seen.insert(newpath.clone(), None);
        let target = match std::fs::read_link(as_path(&newpath)) {
            Ok(t) => t.as_os_str().as_bytes().to_vec(),
            Err(_) => {
                path = newpath;
                continue;
            }
        };
        let (p, ok) = join_real(&path, &target, seen);
        if !ok {
            return (join(&p, &rest), false);
        }
        path = p;
        seen.insert(newpath, Some(path.clone()));
    }
    (path, true)
}

fn normpath(p: &[u8]) -> Vec<u8> {
    if p.is_empty() {
        return b".".to_vec();
    }
    let initial = if p.starts_with(b"/") {
        if p.starts_with(b"//") && !p.starts_with(b"///") {
            2
        } else {
            1
        }
    } else {
        0
    };
    let mut comps: Vec<&[u8]> = Vec::new();
    for comp in p.split(|&c| c == b'/') {
        if comp.is_empty() || comp == b"." {
            continue;
        }
        if comp != b".." || (initial == 0 && comps.is_empty()) || comps.last() == Some(&&b".."[..])
        {
            comps.push(comp);
        } else if !comps.is_empty() {
            comps.pop();
        }
    }
    let mut out = vec![b'/'; initial];
    out.extend_from_slice(&comps.join(&b'/'));
    if out.is_empty() {
        b".".to_vec()
    } else {
        out
    }
}

pub fn realpath(p: &Path) -> PathBuf {
    let mut seen = Seen::new();
    let (path, _) = join_real(b"", p.as_os_str().as_bytes(), &mut seen);
    let abs = if path.starts_with(b"/") {
        path
    } else {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        join(cwd.as_os_str().as_bytes(), &path)
    };
    PathBuf::from(OsStr::from_bytes(&normpath(&abs)))
}

fn passwd_home(name: Option<&str>) -> Option<String> {
    unsafe {
        let pw = match name {
            Some(n) => {
                let c = CString::new(n).ok()?;
                libc::getpwnam(c.as_ptr())
            }
            None => libc::getpwuid(libc::getuid()),
        };
        if pw.is_null() || (*pw).pw_dir.is_null() {
            return None;
        }
        Some(CStr::from_ptr((*pw).pw_dir).to_string_lossy().into_owned())
    }
}

fn os_expanduser(path: &str) -> String {
    if !path.starts_with('~') {
        return path.to_string();
    }
    let i = path[1..].find('/').map_or(path.len(), |i| i + 1);
    let home = if i == 1 {
        match std::env::var("HOME") {
            Ok(h) => Some(h),
            Err(_) => passwd_home(None),
        }
    } else {
        passwd_home(Some(&path[1..i]))
    };
    match home {
        None => path.to_string(),
        Some(h) => {
            let joined = format!("{}{}", h.trim_end_matches('/'), &path[i..]);
            if joined.is_empty() {
                "/".into()
            } else {
                joined
            }
        }
    }
}

pub fn expanduser(path: &str) -> Result<String, String> {
    if !path.starts_with('~') {
        return Ok(path.to_string());
    }
    let first = path.split('/').next().unwrap_or("");
    let home = os_expanduser(first);
    if home.starts_with('~') {
        return Err("RuntimeError: Could not determine home directory.".into());
    }
    Ok(format!("{}{}", home, &path[first.len()..]))
}

pub fn home() -> PathBuf {
    PathBuf::from(os_expanduser("~"))
}

pub fn display_path(p: &Path) -> String {
    match p.strip_prefix(home()) {
        Ok(rel) if rel.as_os_str().is_empty() => "~/.".into(),
        Ok(rel) => format!("~/{}", rel.display()),
        Err(_) => p.display().to_string(),
    }
}

pub fn access_x(p: &Path) -> bool {
    match CString::new(p.as_os_str().as_bytes()) {
        Ok(c) => unsafe { libc::access(c.as_ptr(), libc::X_OK) == 0 },
        Err(_) => false,
    }
}

fn runnable(p: &Path) -> bool {
    p.exists() && access_x(p) && !p.is_dir()
}

pub fn which(cmd: &str) -> Option<PathBuf> {
    if cmd.contains('/') {
        return runnable(Path::new(cmd)).then(|| PathBuf::from(cmd));
    }
    let path =
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string());
    if path.is_empty() {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    for dir in path.split(':') {
        if !seen.insert(dir.to_string()) {
            continue;
        }
        let name = PathBuf::from(
            String::from_utf8_lossy(&join(dir.as_bytes(), cmd.as_bytes())).into_owned(),
        );
        if runnable(&name) {
            return Some(name);
        }
    }
    None
}
