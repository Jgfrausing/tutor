use crate::clock;
use crate::json::{self, dict, Dict, LoadError, Value};
use crate::paths::{self, display_path, realpath};
use crate::py::*;
use sha1::{Digest, Sha1};
use std::fs;
use std::io::{ErrorKind, Read};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TYPES: [&str; 3] = ["comment", "question", "request"];
const INTERVALS: [i128; 6] = [1, 2, 4, 8, 16, 32];
const SERVABLE: [&str; 10] = [
    "pdf", "py", "sql", "png", "jpg", "svg", "csv", "json", "md", "txt",
];
const BLOCK_NAMES: [&str; 8] = [
    "h2",
    "h3",
    "p",
    "li",
    "tr",
    "figure",
    "div class=\"codewrap\"",
    "div class=\"math\"",
];

pub struct Resp {
    pub code: u16,
    pub body: Vec<u8>,
    pub ctype: String,
}

impl Resp {
    fn new(code: u16, body: impl Into<Vec<u8>>, ctype: &str) -> Resp {
        Resp {
            code,
            body: body.into(),
            ctype: ctype.to_string(),
        }
    }

    fn json(code: u16, body: impl Into<Vec<u8>>) -> Resp {
        Resp::new(code, body, "application/json")
    }

    fn html(body: String) -> Resp {
        Resp::new(200, body, "text/html; charset=utf-8")
    }

    fn not_found() -> Resp {
        Resp::json(404, r#"{"error":"not found"}"#)
    }
}

pub struct App {
    pub root: PathBuf,
    pub state: PathBuf,
    pub port: AtomicI64,
    exe: PathBuf,
    last_wake: Mutex<f64>,
}

pub struct Lock(#[allow(dead_code)] fs::File);

include!(concat!(env!("OUT_DIR"), "/dist.rs"));

fn embedded(name: &str) -> Option<&'static [u8]> {
    DIST.iter().find(|(n, _)| *n == name).map(|(_, b)| *b)
}

pub fn read_text(path: &Path) -> R<Option<String>> {
    match fs::read(path) {
        Ok(b) => match String::from_utf8(b) {
            Ok(s) if s.contains('\r') => Ok(Some(s.replace("\r\n", "\n").replace('\r', "\n"))),
            Ok(s) => Ok(Some(s)),
            Err(e) => crash(format!("UnicodeDecodeError: {}: {e}", path.display())),
        },
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => crash(format!("{}: {e}", path.display())),
    }
}

fn read_text_required(path: &Path) -> R<String> {
    match read_text(path)? {
        Some(s) => Ok(s),
        None => crash(format!(
            "FileNotFoundError: No such file or directory: '{}'",
            path.display()
        )),
    }
}

pub fn read_json(path: &Path, default: Value) -> R<Value> {
    match read_text(path)? {
        None => Ok(default),
        Some(text) => match json::loads(&text) {
            Ok(v) => Ok(v),
            Err(LoadError::Decode(e)) => {
                eprintln!("bad json in {}: {e}", path.display());
                Ok(default)
            }
            Err(e) => crash(format!("RecursionError: {e}")),
        },
    }
}

fn write_text(path: &Path, text: &str) -> R<()> {
    fs::write(path, text).or_else(|e| crash(format!("{}: {e}", path.display())))
}

fn write_json(path: &Path, v: &Value) -> R<()> {
    let tmp = path.with_extension("tmp");
    write_text(&tmp, &json::dumps_indent(v, 2, false))?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn mkdir(path: &Path) -> R<()> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists && path.is_dir() => Ok(()),
        Err(e) => crash(format!("{}: {e}", path.display())),
    }
}

fn touch(path: &Path) -> R<()> {
    let c = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
        .or_else(|_| crash("bad path"))?;
    if unsafe { libc::utime(c.as_ptr(), std::ptr::null()) } == 0 {
        return Ok(());
    }
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    Ok(())
}

fn exists(p: &Path) -> bool {
    p.exists()
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn new_id() -> String {
    let mut buf = [0u8; 6];
    if fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .is_err()
    {
        let t = clock::time().to_bits().to_le_bytes();
        buf.copy_from_slice(&t[..6]);
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn pybool(b: bool) -> &'static str {
    if b {
        "True"
    } else {
        "False"
    }
}

fn lookup<'a>(pairs: &'a [(Value, Value)], key: &Value) -> R<Option<&'a Value>> {
    require_hashable(key)?;
    Ok(pairs
        .iter()
        .rev()
        .find(|(k, _)| py_eq(k, key))
        .map(|(_, v)| v))
}

fn contains(ids: &[Value], x: &Value) -> R<bool> {
    require_hashable(x)?;
    Ok(ids.iter().any(|i| py_eq(i, x)))
}

fn guess_type(name: &str) -> Option<&'static str> {
    let mut base = name;
    for enc in [".gz", ".Z", ".bz2", ".xz", ".br"] {
        if let Some(b) = name.strip_suffix(enc) {
            base = b;
            break;
        }
    }
    let ext = Path::new(base).extension()?.to_str()?;
    let t = match ext {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "eot" => "application/vnd.ms-fontobject",
        "pdf" => "application/pdf",
        "py" => "text/x-python",
        "sql" => "application/x-sql",
        "csv" => "text/csv",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "xml" => "text/xml",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/x-wav",
        "webmanifest" => "application/manifest+json",
        _ => match ext.to_ascii_lowercase().as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "svg" => "image/svg+xml",
            "pdf" => "application/pdf",
            "json" => "application/json",
            "txt" => "text/plain",
            _ => return None,
        },
    };
    Some(t)
}

fn asset_type(path: &Path) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let t = match ext {
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "map" => "application/json",
        _ => guess_type(&file_name(path)).unwrap_or("application/octet-stream"),
    };
    t.to_string()
}

fn suffix(p: &Path) -> String {
    let name = file_name(p);
    match name.rfind('.') {
        Some(i) if i > 0 && i < name.len() - 1 => name[i + 1..].to_string(),
        _ => String::new(),
    }
}

fn is_lead(b: u8) -> bool {
    (0xc2..=0xf4).contains(&b)
}

fn utf8(b: &[u8], codec: &str) -> R<String> {
    match std::str::from_utf8(b) {
        Ok(s) => Ok(s.to_string()),
        Err(e) => {
            let start = e.valid_up_to();
            let (end, reason) = match e.error_len() {
                None => (b.len(), "unexpected end of data"),
                Some(n) => (
                    start + n,
                    if is_lead(b[start]) {
                        "invalid continuation byte"
                    } else {
                        "invalid start byte"
                    },
                ),
            };
            let what = if end - start == 1 {
                format!("byte 0x{:02x} in position {start}", b[start])
            } else {
                format!("bytes in position {start}-{}", end - 1)
            };
            value_err(format!("'{codec}' codec can't decode {what}: {reason}"))
        }
    }
}

fn truncated(b: &[u8], start: usize, codec: &str) -> PyErr {
    let what = if b.len() - start == 1 {
        format!("byte 0x{:02x} in position {start}", b[start])
    } else {
        format!("bytes in position {start}-{}", b.len() - 1)
    };
    PyErr::Value(format!(
        "'{codec}' codec can't decode {what}: truncated data"
    ))
}

fn utf16(b: &[u8], start: usize, little: bool, codec: &str) -> R<String> {
    let data = &b[start..];
    let whole = data.len() - data.len() % 2;
    let units: Vec<u16> = data[..whole]
        .chunks(2)
        .map(|c| {
            if little {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    if whole < data.len() {
        return Err(truncated(b, start + whole, codec));
    }
    Ok(String::from_utf16_lossy(&units))
}

fn utf32(b: &[u8], start: usize, little: bool, codec: &str) -> R<String> {
    let data = &b[start..];
    let whole = data.len() - data.len() % 4;
    let mut out = String::new();
    for (i, c) in data[..whole].chunks(4).enumerate() {
        let u = if little {
            u32::from_le_bytes([c[0], c[1], c[2], c[3]])
        } else {
            u32::from_be_bytes([c[0], c[1], c[2], c[3]])
        };
        match char::from_u32(u) {
            Some(ch) => out.push(ch),
            None if (0xd800..0xe000).contains(&u) => out.push('\u{fffd}'),
            None => {
                let at = start + i * 4;
                return value_err(format!(
                    "'{codec}' codec can't decode bytes in position {at}-{}: code point not in range(0x110000)",
                    at + 3
                ));
            }
        }
    }
    if whole < data.len() {
        return Err(truncated(b, start + whole, codec));
    }
    Ok(out)
}

fn decode_body(b: &[u8]) -> R<String> {
    if b.starts_with(&[0xff, 0xfe, 0, 0]) {
        return utf32(b, 4, true, "utf-32-le");
    }
    if b.starts_with(&[0, 0, 0xfe, 0xff]) {
        return utf32(b, 4, false, "utf-32-be");
    }
    if b.starts_with(&[0xff, 0xfe]) {
        return utf16(b, 2, true, "utf-16-le");
    }
    if b.starts_with(&[0xfe, 0xff]) {
        return utf16(b, 2, false, "utf-16-be");
    }
    if b.starts_with(&[0xef, 0xbb, 0xbf]) {
        return utf8(&b[3..], "utf-8");
    }
    if b.len() >= 4 {
        if b[0] == 0 {
            return if b[1] != 0 {
                utf16(b, 0, false, "utf-16-be")
            } else {
                utf32(b, 0, false, "utf-32-be")
            };
        }
        if b[1] == 0 {
            return if b[2] != 0 || b[3] != 0 {
                utf16(b, 0, true, "utf-16-le")
            } else {
                utf32(b, 0, true, "utf-32-le")
            };
        }
    } else if b.len() == 2 {
        if b[0] == 0 {
            return utf16(b, 0, false, "utf-16-be");
        }
        if b[1] == 0 {
            return utf16(b, 0, true, "utf-16-le");
        }
    }
    utf8(b, "utf-8")
}

fn loads_body(b: &[u8]) -> R<Value> {
    let text = decode_body(b)?;
    match json::loads_decoded(&text) {
        Ok(v) => Ok(v),
        Err(LoadError::Decode(e)) => value_err(e.to_string()),
        Err(e) => crash(format!("RecursionError: {e}")),
    }
}

fn find_block_tags(fragment: &str, next_id: &mut dyn FnMut() -> R<String>) -> R<String> {
    let mut out = String::with_capacity(fragment.len() + 64);
    let mut pos = 0;
    while let Some(off) = fragment[pos..].find('<') {
        let at = pos + off;
        out.push_str(&fragment[pos..at]);
        let rest = &fragment[at + 1..];
        let mut matched = None;
        for name in BLOCK_NAMES {
            if !rest.starts_with(name) {
                continue;
            }
            let after = at + 1 + name.len();
            let Some(c) = fragment[after..].chars().next() else {
                continue;
            };
            if !(is_space(c) || c == '>') {
                continue;
            }
            if let Some(close) = fragment[after..].find('>') {
                matched = Some((name, after, after + close));
                break;
            }
        }
        match matched {
            Some((name, after, close)) => {
                let attrs = &fragment[after..close];
                if attrs.contains("data-cid=") {
                    out.push_str(&fragment[at..=close]);
                } else {
                    out.push_str(&format!("<{name} data-cid=\"b{}\"{attrs}>", next_id()?));
                }
                pos = close + 1;
            }
            None => {
                out.push('<');
                pos = at + 1;
            }
        }
    }
    out.push_str(&fragment[pos..]);
    Ok(out)
}

pub fn assign_ids(fragment: &str) -> R<String> {
    let mut max: u128 = 0;
    let pat = "data-cid=\"b";
    for (i, _) in fragment.match_indices(pat) {
        let tail = &fragment[i + pat.len()..];
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() && tail[digits.len()..].starts_with('"') {
            let n = digits.parse::<u128>().unwrap_or(u128::MAX);
            max = max.max(n);
        }
    }
    let mut counter = max.saturating_add(1);
    find_block_tags(fragment, &mut || {
        if counter >= 1_000_000_000 {
            return Err(PyErr::Stop);
        }
        let n = counter;
        counter += 1;
        Ok(n.to_string())
    })
}

fn run_timeout(cmd: &mut Command, secs: u64) -> R<(bool, Vec<u8>)> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .or_else(|e| crash(format!("FileNotFoundError: {e}")))?;
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_end(&mut b);
        }
        b
    });
    let t_err = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(e) = err.as_mut() {
            let _ = e.read_to_end(&mut b);
        }
        b
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if start.elapsed() > Duration::from_secs(secs) {
            let _ = child.kill();
            let _ = child.wait();
            return crash(format!("TimeoutExpired: timed out after {secs} seconds"));
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let _ = t_out.join();
    let stderr = t_err.join().unwrap_or_default();
    Ok((status.success(), stderr))
}

impl App {
    pub fn configure(root: &str, port: i64, state: Option<&str>) -> Result<App, String> {
        let root = if root.is_empty() { "." } else { root };
        let root = realpath(Path::new(&paths::expanduser(root)?));
        let default_state = paths::home().join(".tutor").join(slug(&file_name(&root)));
        let state = match state {
            Some(s) if !s.is_empty() => realpath(Path::new(&paths::expanduser(s)?)),
            _ => default_state,
        };
        fs::create_dir_all(&state).map_err(|e| format!("{}: {e}", state.display()))?;
        if !root.join("curriculum.json").exists() {
            return Err(format!("no curriculum.json in {}", root.display()));
        }
        let exe = std::env::current_exe()
            .map(|p| realpath(&p))
            .unwrap_or_else(|_| PathBuf::from("tutor"));
        Ok(App {
            root,
            state,
            port: AtomicI64::new(port),
            exe,
            last_wake: Mutex::new(0.0),
        })
    }

    fn port(&self) -> i64 {
        self.port.load(Ordering::SeqCst)
    }

    fn curriculum_path(&self) -> PathBuf {
        self.root.join("curriculum.json")
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn sfile(&self, name: &str) -> PathBuf {
        self.state.join(name)
    }

    fn app_html(&self) -> R<String> {
        match embedded("index.html") {
            Some(bytes) => Ok(String::from_utf8_lossy(bytes).into_owned()),
            None => crash("the binary was built without dist/index.html"),
        }
    }

    fn locked(&self) -> R<Lock> {
        let f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(self.sfile(".notes.lock"))?;
        unsafe {
            libc::flock(f.as_raw_fd(), libc::LOCK_EX);
        }
        Ok(Lock(f))
    }

    fn curriculum(&self) -> R<Value> {
        read_json(
            &self.curriculum_path(),
            dict([("nodes", Value::List(vec![]))]),
        )
    }

    fn config(&self) -> R<Value> {
        get_or(&self.curriculum()?, "config", Value::Dict(Dict::new()))
    }

    fn nodes(cur: &Value) -> R<Vec<Value>> {
        iter(item(cur, "nodes")?)
    }

    fn ids(cur: &Value) -> R<Vec<Value>> {
        let mut out = Vec::new();
        for n in Self::nodes(cur)? {
            let id = item(&n, "id")?.clone();
            require_hashable(&id)?;
            out.push(id);
        }
        Ok(out)
    }

    fn node_map(cur: &Value) -> R<Vec<(Value, Value)>> {
        let mut out = Vec::new();
        for n in Self::nodes(cur)? {
            let id = item(&n, "id")?.clone();
            require_hashable(&id)?;
            out.push((id, n));
        }
        Ok(out)
    }

    fn xp_for(&self, kind: &Value) -> R<Value> {
        let kinds = get_or(&self.config()?, "kinds", Value::Dict(Dict::new()))?;
        let Value::Dict(map) = &kinds else {
            return crash("AttributeError: kinds has no attribute 'get'");
        };
        require_hashable(kind)?;
        let entry = match kind {
            Value::Str(k) => map.get(k).cloned(),
            _ => None,
        }
        .unwrap_or(Value::Dict(Dict::new()));
        get_or(&entry, "xp", Value::Int(0))
    }

    fn platform_info(&self) -> Value {
        let root = display_path(&self.root);
        let state = display_path(&self.state);
        let port = self.port();
        dict([
            ("root", root.clone().into()),
            ("state", state.clone().into()),
            ("port", Value::Int(port as i128)),
            ("key", slug(&file_name(&self.root)).into()),
            (
                "serve_cmd",
                format!(
                    "{} --root {root} --state {state} --port {port} serve",
                    display_path(&self.exe)
                )
                .into(),
            ),
        ])
    }

    fn load_value(&self) -> R<Value> {
        let v = read_json(
            &self.sfile("notes.json"),
            dict([("notes", Value::List(vec![]))]),
        )?;
        Ok(item(&v, "notes")?.clone())
    }

    fn load(&self) -> R<Vec<Value>> {
        match self.load_value()? {
            Value::List(l) => Ok(l),
            other => crash(format!(
                "AttributeError: notes is a {}, not a list",
                type_name(&other)
            )),
        }
    }

    fn mutate<T>(&self, f: impl FnOnce(&mut Vec<Value>) -> R<T>) -> R<T> {
        let _lock = self.locked()?;
        let mut notes = self.load()?;
        let result = f(&mut notes)?;
        let notes = Value::List(notes);
        write_json(&self.sfile("notes.json"), &dict([("notes", notes.clone())]))?;
        let Value::List(notes) = notes else {
            unreachable!()
        };
        self.export_markdown(&notes)?;
        Ok(result)
    }

    fn topic_fragment(&self, topic: &str, write: bool) -> R<String> {
        let path = self.dir("topics").join(format!("{topic}.html"));
        if !exists(&path) {
            return Ok(String::new());
        }
        let raw = read_text_required(&path)?;
        let with_ids = assign_ids(&raw)?;
        if write && with_ids != raw {
            write_text(&path, &with_ids)?;
        }
        Ok(with_ids)
    }

    fn merged_glossary(&self) -> R<Vec<Value>> {
        let mut base = Vec::new();
        for name in iter(&get_or(
            &self.config()?,
            "glossary_files",
            Value::List(vec![]),
        )?)? {
            let path = self.root.join(as_str(&name)?);
            let v = read_json(&path, dict([("terms", Value::List(vec![]))]))?;
            base.extend(iter(&get_or(&v, "terms", Value::List(vec![]))?)?);
        }
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for t in base {
            let key = as_str(item(&t, "term")?)?.to_lowercase();
            if seen.insert(key) {
                out.push(t);
            }
        }
        for node in Self::nodes(&self.curriculum()?)? {
            let id = item(&node, "id")?.clone();
            let path = self.dir("terms").join(format!("{}.json", py_str(&id)));
            let v = read_json(&path, dict([("terms", Value::List(vec![]))]))?;
            for t in iter(&get_or(&v, "terms", Value::List(vec![]))?)? {
                let Value::Dict(map) = &t else { continue };
                let Some(term) = map.get("term").filter(|v| truthy(v)) else {
                    continue;
                };
                let key = as_str(term)?.to_lowercase();
                if seen.contains(&key) {
                    continue;
                }
                seen.insert(key);
                let mut entry = map.clone();
                entry.insert("topic".into(), id.clone());
                out.push(Value::Dict(entry));
            }
        }
        Ok(out)
    }

    fn content_version(&self) -> R<String> {
        let mut h = Sha1::new();
        if let Some(index) = embedded("index.html") {
            h.update(b"index.html");
            h.update(index);
        }
        let mut paths = vec![self.curriculum_path()];
        for name in iter(&get_or(
            &self.config()?,
            "glossary_files",
            Value::List(vec![]),
        )?)? {
            paths.push(self.root.join(as_str(&name)?));
        }
        for d in ["topics", "quizzes", "cards", "terms"] {
            let mut entries: Vec<PathBuf> = match fs::read_dir(self.dir(d)) {
                Ok(rd) => rd.filter_map(|e| e.ok().map(|e| e.path())).collect(),
                Err(_) => Vec::new(),
            };
            entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
            paths.extend(entries);
        }
        for p in paths {
            if p.is_file() {
                h.update(p.file_name().map(|n| n.as_encoded_bytes()).unwrap_or(b".."));
                h.update(fs::read(&p)?);
            }
        }
        let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
        Ok(hex[..12].to_string())
    }

    fn load_progress(&self) -> R<Value> {
        let mut p = read_json(&self.sfile("progress.json"), Value::Dict(Dict::new()))?;
        let d = match &mut p {
            Value::Dict(d) => d,
            other => {
                return crash(format!(
                    "AttributeError: '{}' object has no attribute 'setdefault'",
                    type_name(other)
                ))
            }
        };
        d.entry("xp".into()).or_insert(Value::Int(0));
        d.entry("visited".into())
            .or_insert(Value::Dict(Dict::new()));
        d.entry("quiz".into()).or_insert(Value::Dict(Dict::new()));
        d.entry("cards".into()).or_insert(Value::Dict(Dict::new()));
        d.entry("events".into()).or_insert(Value::List(vec![]));
        Ok(p)
    }

    fn journal_text(&self, topic: &str) -> R<String> {
        let path = self.sfile("journal").join(format!("{topic}.md"));
        if exists(&path) {
            read_text_required(&path)
        } else {
            Ok(String::new())
        }
    }

    fn render(&self, page: &str, topic: Option<&str>) -> R<String> {
        let cur = self.curriculum()?;
        let nodes = Self::node_map(&cur)?;
        let mut cards: Vec<(Value, Value)> = Vec::new();
        for n in Self::nodes(&cur)? {
            let id = item(&n, "id")?.clone();
            let v = read_json(
                &self.dir("cards").join(format!("{}.json", py_str(&id))),
                Value::Dict(Dict::new()),
            )?;
            let c = get(&v, "cards")?.cloned().unwrap_or(Value::Null);
            require_hashable(&id)?;
            match cards.iter_mut().find(|(k, _)| py_eq(k, &id)) {
                Some(slot) => slot.1 = c,
                None => cards.push((id, c)),
            }
        }
        let mut cards_out = Dict::new();
        for (k, v) in cards {
            if truthy(&v) {
                cards_out.insert(json_key(&k)?, v);
            }
        }
        let topic_truthy = topic.filter(|t| !t.is_empty());
        let quiz = match topic_truthy {
            Some(t) => read_json(&self.dir("quizzes").join(format!("{t}.json")), Value::Null)?,
            None => Value::Null,
        };
        let mut quizzes = Dict::new();
        if page == "review" {
            for n in Self::nodes(&cur)? {
                let id = item(&n, "id")?.clone();
                let q = read_json(
                    &self.dir("quizzes").join(format!("{}.json", py_str(&id))),
                    Value::Null,
                )?;
                if truthy(&q) {
                    quizzes.insert(json_key(&id)?, q);
                }
            }
        }
        let journal = match topic_truthy {
            Some(t) => Value::Str(self.journal_text(t)?),
            None => Value::Null,
        };
        let glossary = Value::List(self.merged_glossary()?);
        let progress = self.load_progress()?;
        let version = self.content_version()?;
        let fragment = if page == "topic" {
            Value::Str(self.topic_fragment(topic.unwrap_or(""), false)?)
        } else {
            Value::Null
        };
        let boot = dict([
            ("page", page.into()),
            ("topic", topic.map_or(Value::Null, Value::from)),
            ("curriculum", cur.clone()),
            ("glossary", glossary),
            ("cards", Value::Dict(cards_out)),
            ("quiz", quiz),
            ("quizzes", Value::Dict(quizzes)),
            ("progress", progress),
            ("journal", journal),
            ("version", version.into()),
            ("platform", self.platform_info()),
            ("fragment", fragment),
        ]);
        let blob = json::dumps(&boot, false).replace('<', "\\u003c");
        let cur_title = get_or(&cur, "title", "Tutor".into())?;
        let title = match page {
            "topic" => {
                let key = Value::from(topic.unwrap_or(""));
                let node = lookup(&nodes, &key)?
                    .ok_or_else(|| PyErr::Crash(format!("KeyError: {}", py_str(&key))))?;
                as_str(item(node, "title")?)?.to_string()
            }
            "cards" => format!("Flip card review: {}", py_str(&cur_title)),
            "review" => format!("Mixed review: {}", py_str(&cur_title)),
            _ => as_str(&cur_title)?.to_string(),
        };
        Ok(self
            .app_html()?
            .replace("__TITLE__", &html_escape(&title, true))
            .replace("__BOOT_JSON__", &blob))
    }

    fn listening(&self) -> bool {
        fs::metadata(self.sfile(".watcher-heartbeat"))
            .and_then(|m| m.modified())
            .map(|t| {
                let mtime = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                clock::time() - mtime < 15.0
            })
            .unwrap_or(false)
    }

    fn wake(&self) -> R<Value> {
        let reply = |ok: bool, detail: &str| dict([("ok", ok.into()), ("detail", detail.into())]);
        if self.listening() {
            return Ok(reply(true, "already listening"));
        }
        let mut last = self.last_wake.lock().unwrap_or_else(|e| e.into_inner());
        if clock::time() - *last < 60.0 {
            return Ok(reply(true, "already woken, give it a minute"));
        }
        let wake = self.sfile(".wake-pane");
        if !exists(&wake) {
            return Ok(reply(false, "no Claude session has listened from tmux yet"));
        }
        let target = match json::loads(&read_text_required(&wake)?) {
            Ok(v) => v,
            Err(LoadError::Decode(e)) => return value_err(e.to_string()),
            Err(e) => return crash(e.to_string()),
        };
        let tmux = paths::which("tmux").unwrap_or_else(|| paths::home().join(".local/bin/tmux"));
        let socket = as_str(item(&target, "socket")?)?.to_string();
        let pane = as_str(item(&target, "pane")?)?.to_string();
        let tmux_cmd = || {
            let mut c = Command::new(&tmux);
            c.arg("-S").arg(&socket);
            c
        };
        let gone = tmux_cmd()
            .args(["has-session", "-t", &pane])
            .stdin(Stdio::inherit())
            .output()
            .or_else(|e| crash(format!("FileNotFoundError: {e}")))?;
        if !gone.status.success() {
            return Ok(reply(
                false,
                "the Claude session that last listened is gone",
            ));
        }
        let msg = format!(
            "Tutor wake button: start the tutor listener again ({} --root {} --state {} wait, in the background) and answer what comes in.",
            self.exe.display(),
            self.root.display(),
            self.state.display()
        );
        let send = |args: &[&str]| -> R<()> {
            let status = tmux_cmd()
                .args(args)
                .status()
                .or_else(|e| crash(format!("FileNotFoundError: {e}")))?;
            if status.success() {
                Ok(())
            } else {
                crash("CalledProcessError: tmux send-keys failed")
            }
        };
        send(&["send-keys", "-t", &pane, "-l", &msg])?;
        std::thread::sleep(Duration::from_millis(400));
        send(&["send-keys", "-t", &pane, "Enter"])?;
        *last = clock::time();
        Ok(reply(true, "woken"))
    }

    fn export_markdown(&self, notes: &[Value]) -> R<()> {
        let md = self.sfile("notes");
        mkdir(&md)?;
        let cur = self.curriculum()?;
        let mut titles: Vec<(Value, Value)> = Vec::new();
        for n in Self::nodes(&cur)? {
            let id = item(&n, "id")?.clone();
            let title = item(&n, "title")?.clone();
            require_hashable(&id)?;
            match titles.iter_mut().find(|(k, _)| py_eq(k, &id)) {
                Some(slot) => slot.1 = title,
                None => titles.push((id, title)),
            }
        }
        let mut by_topic: Vec<(Value, Vec<usize>)> = Vec::new();
        for (i, n) in notes.iter().enumerate() {
            if truthy(get(n, "parent")?.unwrap_or(&Value::Null)) {
                continue;
            }
            let t = topic_of(n)?;
            require_hashable(&t)?;
            match by_topic.iter_mut().find(|(k, _)| py_eq(k, &t)) {
                Some(slot) => slot.1.push(i),
                None => by_topic.push((t, vec![i])),
            }
        }
        for (topic, roots) in &by_topic {
            let title = lookup(&titles, topic)?.cloned().unwrap_or(topic.clone());
            let mut lines: Vec<String> = vec![
                format!("# {}: notes", py_str(&title)),
                String::new(),
                format!(
                    "Lesson: http://127.0.0.1:{}/t/{}",
                    self.port(),
                    py_str(topic)
                ),
                String::new(),
            ];
            let mut keyed = Vec::new();
            for &i in roots {
                let r = &notes[i];
                let s = get(r, "section")?.cloned().unwrap_or(Value::Null);
                let s = if truthy(&s) { s } else { Value::from("") };
                let created = item(r, "created")?.clone();
                keyed.push((s, created, i));
            }
            if keyed.len() > 1 {
                for (s, c, _) in &keyed {
                    as_str(s)?;
                    as_str(c)?;
                }
            }
            keyed.sort_by(|a, b| {
                let k = |v: &Value| match v {
                    Value::Str(s) => s.clone(),
                    _ => String::new(),
                };
                (k(&a.0), k(&a.1)).cmp(&(k(&b.0), k(&b.1)))
            });
            let mut section = Value::Null;
            for (_, _, ri) in keyed {
                let root = &notes[ri];
                let rs = get(root, "section")?.cloned().unwrap_or(Value::Null);
                if !py_eq(&rs, &section) {
                    section = rs;
                    let head = if truthy(&section) {
                        py_str(&section)
                    } else {
                        "Other".into()
                    };
                    lines.push(format!("## {head}"));
                    lines.push(String::new());
                }
                let rtype = item(root, "type")?;
                require_hashable(rtype)?;
                let label = match rtype {
                    Value::Str(s) if s == "question" => "Question".to_string(),
                    Value::Str(s) if s == "request" => "Edit request".to_string(),
                    Value::Str(s) if s == "comment" => "Comment".to_string(),
                    other => as_str(other)?.to_string(),
                };
                let excerpt = get(root, "excerpt")?.cloned().unwrap_or(Value::Null);
                if truthy(&excerpt) {
                    lines.push(format!("> {}", py_str(&excerpt)));
                    lines.push(String::new());
                }
                let root_id = item(root, "id")?.clone();
                for mi in thread_of(notes, &root_id)? {
                    let m = &notes[mi];
                    let who = if is_str(item(m, "author")?, "claude") {
                        "Claude"
                    } else {
                        "You"
                    };
                    let tag = if mi == ri {
                        format!("{who}, {}", label.to_lowercase())
                    } else {
                        who.to_string()
                    };
                    let created = take_chars(as_str(item(m, "created")?)?, 16).replace('T', " ");
                    let text = strip(as_str(item(m, "text")?)?).to_string();
                    lines.push(format!("**{tag}** ({created} UTC)"));
                    lines.push(String::new());
                    lines.push(text);
                    lines.push(String::new());
                }
                lines.push("---".into());
                lines.push(String::new());
            }
            write_text(&md.join(format!("{}.md", py_str(topic))), &lines.join("\n"))?;
        }
        if let Ok(rd) = fs::read_dir(&md) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.ends_with(".md") {
                    continue;
                }
                let path = entry.path();
                let stem = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let stem = Value::Str(stem);
                if !by_topic.iter().any(|(k, _)| py_eq(k, &stem)) {
                    fs::remove_file(&path)?;
                }
            }
        }
        Ok(())
    }

    fn add_from_page(&self, notes: &mut Vec<Value>, body: &Value) -> R<Value> {
        let text = strip(&py_str(&get_or(body, "text", "".into())?)).to_string();
        let block = py_str(&get_or(body, "block", "".into())?);
        if text.is_empty() || block.is_empty() {
            return value_err("text and block are required");
        }
        let topic_v = get_or(body, "topic", Value::Null)?;
        let topic = if truthy(&topic_v) {
            py_str(&topic_v)
        } else {
            block.split('/').next().unwrap_or("").to_string()
        };
        let parent = get_or(body, "parent", Value::Null)?;
        let note = if truthy(&parent) {
            let mut root = None;
            for n in notes.iter() {
                if py_eq(item(n, "id")?, &parent) {
                    root = Some(n.clone());
                    break;
                }
            }
            let root = root.ok_or(PyErr::Stop)?;
            let mut claude = false;
            for i in thread_of(notes, &parent)? {
                if is_str(item(&notes[i], "author")?, "claude") {
                    claude = true;
                    break;
                }
            }
            let status = if !is_str(item(&root, "type")?, "comment") || claude {
                Value::from("pending")
            } else {
                Value::Null
            };
            new_note(
                item(&root, "block")?.clone(),
                text,
                "you",
                vec![
                    ("topic", topic_of(&root)?),
                    ("parent", parent.clone()),
                    ("type", "reply".into()),
                    ("status", status),
                ],
            )
        } else {
            let kind = get_or(body, "type", Value::Null)?;
            require_hashable(&kind)?;
            if !TYPES.iter().any(|t| is_str(&kind, t)) {
                return value_err(format!(
                    "type must be one of [{}]",
                    TYPES.map(|t| format!("'{t}'")).join(", ")
                ));
            }
            let status = if is_str(&kind, "comment") {
                Value::Null
            } else {
                "pending".into()
            };
            let field = |k: &str, n: usize| -> R<Value> {
                Ok(take_chars(&py_str(&get_or(body, k, "".into())?), n).into())
            };
            new_note(
                block.into(),
                text,
                "you",
                vec![
                    ("topic", topic.into()),
                    ("type", kind.clone()),
                    ("status", status),
                    ("section", field("section", 200)?),
                    ("excerpt", field("excerpt", 200)?),
                    ("context", field("context", 4000)?),
                ],
            )
        };
        notes.push(note.clone());
        Ok(note)
    }

    fn update_progress(&self, body: &Value) -> R<Value> {
        let nodes = Self::node_map(&self.curriculum()?)?;
        let _lock = self.locked()?;
        let mut p = self.load_progress()?;
        let kind = get_or(body, "kind", Value::Null)?;
        let mut gained = Num::I(0);
        if is_str(&kind, "visit") {
            let visited = item_mut(&mut p, "visited")?;
            let topic = json_key(item(body, "topic")?)?;
            let d = dict_mut(visited)?;
            if !d.contains_key(&topic) {
                d.insert(topic, clock::now_iso().into());
            }
        } else if is_str(&kind, "quiz") {
            let topic = item(body, "topic")?.clone();
            let score = py_int(item(body, "score")?)?;
            let total = py_int(item(body, "total")?)?;
            let pass_needed;
            {
                let quiz = item_mut(&mut p, "quiz")?;
                let q = setdefault(
                    quiz,
                    json_key(&topic)?,
                    dict([
                        ("best", Value::Int(0)),
                        ("total", Value::Int(total)),
                        ("attempts", Value::Int(0)),
                        ("passed", false.into()),
                    ]),
                )?;
                let attempts = add(item(q, "attempts")?, Num::I(1))?;
                set(q, "attempts", attempts)?;
                let best = item(q, "best")?.clone();
                let best = match num_cmp(Num::I(score), need_num(&best)?) {
                    Some(std::cmp::Ordering::Greater) => Value::Int(score),
                    _ => best,
                };
                set(q, "best", best)?;
                set(q, "total", Value::Int(total))?;
                set(q, "last", clock::now_iso().into())?;
                if let Some(Value::List(answers)) = get(body, "answers")? {
                    set(q, "answers", Value::List(answers.clone()))?;
                    set(q, "checked", true.into())?;
                }
                pass_needed = !truthy(item(q, "passed")?) && total != 0;
            }
            if pass_needed {
                let pass_mark = get_or(&self.config()?, "pass_mark", Value::Float(0.7))?;
                let mark = need_num(&pass_mark)?;
                let ratio = Num::F(score as f64 / total as f64);
                if matches!(
                    num_cmp(ratio, mark),
                    Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
                ) {
                    let q = item_mut(item_mut(&mut p, "quiz")?, &json_key(&topic)?)?;
                    set(q, "passed", true.into())?;
                    set(q, "passed_at", clock::now_iso().into())?;
                    let node = lookup(&nodes, &topic)?.ok_or_else(|| PyErr::Key(py_str(&topic)))?;
                    gained = need_num(&self.xp_for(item(node, "kind")?)?)?;
                }
            }
        } else if is_str(&kind, "card") {
            let card = py_str(item(body, "card")?);
            let today_days = clock::today_local();
            let today = clock::iso_date(today_days);
            let cards = item_mut(&mut p, "cards")?;
            let c = setdefault(
                cards,
                card,
                dict([
                    ("box", Value::Int(0)),
                    ("due", today.clone().into()),
                    ("first", today.clone().into()),
                ]),
            )?;
            let was_due = as_str(item(c, "due")?)? <= today.as_str();
            if truthy(&get_or(body, "correct", Value::Null)?) {
                let bumped = add(item(c, "box")?, Num::I(1))?;
                let six = Num::I(INTERVALS.len() as i128);
                let new_box = match num_cmp(six, need_num(&bumped)?) {
                    Some(std::cmp::Ordering::Less) => six.value(),
                    _ => bumped,
                };
                let idx = match &new_box {
                    Value::Int(n) => n - 1,
                    Value::Bool(b) => *b as i128 - 1,
                    _ => return crash("TypeError: list indices must be integers or slices"),
                };
                let idx = if idx < 0 {
                    idx + INTERVALS.len() as i128
                } else {
                    idx
                };
                if !(0..INTERVALS.len() as i128).contains(&idx) {
                    return crash("IndexError: list index out of range");
                }
                set(c, "box", new_box)?;
                let due = clock::iso_date(today_days + INTERVALS[idx as usize] as i64);
                set(c, "due", due.into())?;
                gained = Num::I(if was_due { 2 } else { 0 });
            } else {
                set(c, "box", Value::Int(0))?;
                set(c, "due", today.into())?;
            }
            let reviews = add(&get_or(c, "reviews", Value::Int(0))?, Num::I(1))?;
            set(c, "reviews", reviews)?;
        } else if is_str(&kind, "quiz_answers") {
            let topic = json_key(item(body, "topic")?)?;
            let answers = match get(body, "answers")? {
                Some(Value::List(a)) => Value::List(a.clone()),
                _ => Value::List(vec![]),
            };
            let quiz = item_mut(&mut p, "quiz")?;
            let q = setdefault(
                quiz,
                topic,
                dict([
                    ("best", Value::Int(0)),
                    ("total", Value::Int(0)),
                    ("attempts", Value::Int(0)),
                    ("passed", false.into()),
                ]),
            )?;
            set(q, "answers", answers)?;
            set(q, "checked", false.into())?;
            write_json(&self.sfile("progress.json"), &p)?;
            return Ok(p);
        } else if is_str(&kind, "review") {
            gained = Num::I(3 * py_int(item(body, "score")?)?.max(0));
        } else {
            return value_err("unknown progress kind");
        }
        let xp = add(item(&p, "xp")?, gained)?;
        set(&mut p, "xp", xp)?;
        let event = dict([
            ("at", clock::now_iso().into()),
            ("kind", kind.clone()),
            ("topic", get_or(body, "topic", Value::Null)?),
            ("card", get_or(body, "card", Value::Null)?),
            ("xp", gained.value()),
        ]);
        match item_mut(&mut p, "events")? {
            Value::List(events) => {
                events.push(event);
                if events.len() > 2000 {
                    let cut = events.len() - 2000;
                    events.drain(..cut);
                }
            }
            _ => return crash("AttributeError: events has no attribute 'append'"),
        }
        write_json(&self.sfile("progress.json"), &p)?;
        Ok(p)
    }

    pub fn handle_get(&self, target: &str) -> R<Resp> {
        let path = unquote(target.split('?').next().unwrap_or(""));
        let cur = self.curriculum()?;
        let ids = Self::ids(&cur)?;
        if path == "/" || path == "/index.html" {
            return Ok(Resp::html(self.render("tree", None)?));
        }
        if path == "/cards" || path == "/review" {
            return Ok(Resp::html(self.render(&path[1..], None)?));
        }
        if let Some(rest) = path.strip_prefix("/t/") {
            let t = rest.trim_matches('/');
            if contains(&ids, &Value::from(t))? {
                return Ok(Resp::html(self.render("topic", Some(t))?));
            }
        }
        if let Some(name) = path.strip_prefix("/assets/") {
            if let Some(bytes) = embedded(&format!("assets/{name}")) {
                return Ok(Resp::new(200, bytes.to_vec(), &asset_type(Path::new(name))));
            }
            return Ok(Resp::not_found());
        }
        if let Some(rest) = path.strip_prefix("/files/") {
            let target = realpath(&self.root.join(rest));
            if target.starts_with(&self.root)
                && target != self.root
                && target.is_file()
                && SERVABLE.contains(&suffix(&target).as_str())
            {
                let ctype = guess_type(&file_name(&target)).unwrap_or("application/octet-stream");
                return Ok(Resp::new(200, fs::read(&target)?, ctype));
            }
            return Ok(Resp::not_found());
        }
        if path == "/api/tts" {
            return self.tts(target);
        }
        if path == "/api/state" {
            let topic = parse_qs_first(query_of(target), "topic");
            let mut state = dict([
                ("notes", self.load_value()?),
                ("version", self.content_version()?.into()),
                ("listening", self.listening().into()),
            ]);
            if let Some(t) = topic {
                if contains(&ids, &Value::from(t.as_str()))? {
                    set(&mut state, "journal", self.journal_text(&t)?.into())?;
                }
            }
            return Ok(Resp::json(200, json::dumps(&state, true)));
        }
        Ok(Resp::not_found())
    }

    fn tts(&self, target: &str) -> R<Resp> {
        let q = query_of(target);
        let text = take_chars(strip(&parse_qs_first(q, "text").unwrap_or_default()), 2000);
        let slow = parse_qs_first(q, "slow").as_deref() == Some("1");
        let english = parse_qs_first(q, "lang").as_deref() == Some("en");
        let edge =
            paths::which("edge-tts").unwrap_or_else(|| paths::home().join(".local/bin/edge-tts"));
        let engine = if paths::access_x(&edge) {
            Some("edge")
        } else if paths::which("say").is_some() {
            Some("say")
        } else {
            None
        };
        let Some(engine) = engine.filter(|_| !text.is_empty()) else {
            return Ok(Resp::json(404, r#"{"error":"no tts"}"#));
        };
        let cache = self.sfile(".tts");
        mkdir(&cache)?;
        let suffix = if engine == "edge" { ".mp3" } else { ".wav" };
        let key = format!("{engine}:{}:{}:{text}", pybool(slow), pybool(english));
        let hex: String = Sha1::digest(key.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let target_file = cache.join(format!("{hex}{suffix}"));
        if !exists(&target_file) {
            let tmp = cache.join(format!("{hex}.tmp{suffix}"));
            let mut cmd = if engine == "edge" {
                let mut c = Command::new(&edge);
                c.args([
                    "--voice",
                    if english {
                        "en-US-AvaNeural"
                    } else {
                        "ja-JP-NanamiNeural"
                    },
                ]);
                c.arg(format!(
                    "--rate={}",
                    if slow {
                        "-35%"
                    } else if english {
                        "+0%"
                    } else {
                        "-5%"
                    }
                ));
                c.args(["--text", &text, "--write-media"]).arg(&tmp);
                c
            } else {
                let mut c = Command::new("say");
                c.args(["-v", if english { "Samantha" } else { "Kyoko" }]);
                if slow {
                    c.args(["-r", "110"]);
                }
                c.arg("--data-format=LEI16@22050")
                    .arg("-o")
                    .arg(&tmp)
                    .arg(&text);
                c
            };
            let (ok, stderr) = run_timeout(&mut cmd, 30)?;
            if !ok || !exists(&tmp) {
                let msg = String::from_utf8(stderr)
                    .or_else(|e| crash(format!("UnicodeDecodeError: {e}")))?;
                let body = dict([("error", take_chars(&msg, 200).into())]);
                return Ok(Resp::json(500, json::dumps(&body, true)));
            }
            fs::rename(&tmp, &target_file)?;
        }
        let ctype = if suffix == ".mp3" {
            "audio/mpeg"
        } else {
            "audio/wav"
        };
        Ok(Resp::new(200, fs::read(&target_file)?, ctype))
    }

    pub fn handle_post(&self, target: &str, raw: &[u8]) -> R<Resp> {
        let body = loads_body(if raw.is_empty() { b"{}" } else { raw })?;
        let path = target.split('?').next().unwrap_or("");
        match path {
            "/api/notes" => {
                let note = self.mutate(|notes| self.add_from_page(notes, &body))?;
                Ok(Resp::json(200, json::dumps(&note, true)))
            }
            "/api/wake" => Ok(Resp::json(200, json::dumps(&self.wake()?, true))),
            "/api/delete" => {
                self.mutate(|notes| {
                    let id = item(&body, "id")?.clone();
                    let mut keep = Vec::new();
                    for n in notes.drain(..) {
                        let same = py_eq(item(&n, "id")?, &id)
                            || py_eq(get(&n, "parent")?.unwrap_or(&Value::Null), &id);
                        if !same {
                            keep.push(n);
                        }
                    }
                    *notes = keep;
                    Ok(())
                })?;
                Ok(Resp::json(200, "{}"))
            }
            "/api/journal" => {
                let topic = item(&body, "topic")?.clone();
                let ids = Self::ids(&self.curriculum()?)?;
                if !contains(&ids, &topic)? {
                    return value_err("unknown topic");
                }
                let journal = self.sfile("journal");
                mkdir(&journal)?;
                let text = py_str(&get_or(&body, "text", "".into())?);
                write_text(&journal.join(format!("{}.md", py_str(&topic))), &text)?;
                Ok(Resp::json(200, "{}"))
            }
            "/api/progress" => Ok(Resp::json(
                200,
                json::dumps(&self.update_progress(&body)?, true),
            )),
            _ => Ok(Resp::not_found()),
        }
    }

    pub fn build(&self) -> R<()> {
        let mut problems = Vec::new();
        for node in Self::nodes(&self.curriculum()?)? {
            let nid = py_str(item(&node, "id")?);
            self.topic_fragment(&nid, true)?;
            let rel = |p: &Path| -> R<String> {
                match p.strip_prefix(&self.root) {
                    Ok(r) => Ok(r.display().to_string()),
                    Err(_) => crash(format!(
                        "ValueError: {} is not in the subpath of {}",
                        p.display(),
                        self.root.display()
                    )),
                }
            };
            for d in ["quizzes", "cards", "terms"] {
                let f = self.dir(d).join(format!("{nid}.json"));
                if exists(&f) {
                    match json::loads(&read_text_required(&f)?) {
                        Ok(_) => {}
                        Err(LoadError::Decode(e)) => problems.push(format!("{}: {e}", rel(&f)?)),
                        Err(e) => return crash(e.to_string()),
                    }
                }
            }
            for f in [
                self.dir("topics").join(format!("{nid}.html")),
                self.dir("quizzes").join(format!("{nid}.json")),
                self.dir("cards").join(format!("{nid}.json")),
            ] {
                if !exists(&f) {
                    problems.push(format!("missing {}", rel(&f)?));
                }
            }
        }
        {
            let _lock = self.locked()?;
            let notes = self.load()?;
            self.export_markdown(&notes)?;
        }
        println!("built version {}", self.content_version()?);
        for p in problems {
            println!("  {p}");
        }
        Ok(())
    }

    pub fn wait(&self, max_seconds: i128, settle: f64) -> R<()> {
        let deadline = clock::time() + max_seconds as f64;
        let pane = std::env::var("TMUX_PANE").unwrap_or_default();
        let tmux = std::env::var("TMUX").unwrap_or_default();
        if !pane.is_empty() && !tmux.is_empty() {
            let socket = tmux.split(',').next().unwrap_or("").to_string();
            let v = dict([("pane", pane.into()), ("socket", socket.into())]);
            write_text(&self.sfile(".wake-pane"), &json::dumps(&v, true))?;
        }
        let heartbeat = self.sfile(".watcher-heartbeat");
        while clock::time() < deadline {
            touch(&heartbeat)?;
            if !pending(&self.load()?)?.is_empty() {
                sleep(settle)?;
                touch(&heartbeat)?;
                let views = self.mutate(|notes| {
                    let found = pending(notes)?;
                    for &i in &found {
                        set(&mut notes[i], "status", "working".into())?;
                    }
                    let mut roots: Vec<(Value, Value)> = Vec::new();
                    for &i in &found {
                        let v = self.view(notes, i)?;
                        let key = item(&v, "reply_to")?.clone();
                        require_hashable(&key)?;
                        match roots.iter_mut().find(|(k, _)| py_eq(k, &key)) {
                            Some(slot) => slot.1 = v,
                            None => roots.push((key, v)),
                        }
                    }
                    Ok(roots.into_iter().map(|(_, v)| v).collect::<Vec<_>>())
                })?;
                println!("{}", json::dumps_indent(&Value::List(views), 2, false));
                return Ok(());
            }
            sleep(2.0)?;
        }
        println!("timed out with nothing pending");
        Ok(())
    }

    fn view(&self, notes: &[Value], i: usize) -> R<Value> {
        let n = &notes[i];
        let parent = get(n, "parent")?.cloned().unwrap_or(Value::Null);
        let target = if truthy(&parent) {
            parent
        } else {
            item(n, "id")?.clone()
        };
        let mut root = n;
        for r in notes {
            if py_eq(item(r, "id")?, &target) {
                root = r;
                break;
            }
        }
        let topic = topic_of(root)?;
        let context = get(root, "context")?.cloned().unwrap_or(Value::Null);
        let context = if truthy(&context) {
            context
        } else {
            get(root, "excerpt")?.cloned().unwrap_or(Value::Null)
        };
        let root_id = item(root, "id")?.clone();
        let mut thread = Vec::new();
        for mi in thread_of(notes, &root_id)? {
            let m = &notes[mi];
            thread.push(dict([
                ("id", item(m, "id")?.clone()),
                ("author", item(m, "author")?.clone()),
                ("text", item(m, "text")?.clone()),
            ]));
        }
        Ok(dict([
            ("reply_to", root_id.clone()),
            ("type", item(root, "type")?.clone()),
            ("topic", topic.clone()),
            (
                "file",
                display_path(&self.dir("topics").join(format!("{}.html", py_str(&topic)))).into(),
            ),
            (
                "journal",
                display_path(&self.sfile("journal").join(format!("{}.md", py_str(&topic)))).into(),
            ),
            (
                "section",
                get(root, "section")?.cloned().unwrap_or(Value::Null),
            ),
            ("block", item(root, "block")?.clone()),
            ("context", context),
            ("thread", Value::List(thread)),
        ]))
    }

    pub fn reply(&self, id: &str, text: &str) -> R<()> {
        let text = if text == "-" {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s)?;
            strip(&s).to_string()
        } else {
            text.to_string()
        };
        self.mutate(|notes| {
            let t = find(notes, &Value::from(id))?;
            let parent = get(&notes[t], "parent")?.cloned().unwrap_or(Value::Null);
            let key = if truthy(&parent) {
                parent
            } else {
                item(&notes[t], "id")?.clone()
            };
            let r = find(notes, &key)?;
            let root = notes[r].clone();
            let root_id = item(&root, "id")?.clone();
            notes.push(new_note(
                item(&root, "block")?.clone(),
                text,
                "claude",
                vec![
                    ("topic", topic_of(&root)?),
                    ("parent", root_id.clone()),
                    ("type", "reply".into()),
                    ("status", Value::Null),
                ],
            ));
            for i in thread_of(notes, &root_id)? {
                let m = &notes[i];
                let status = get(m, "status")?.cloned().unwrap_or(Value::Null);
                if is_str(item(m, "author")?, "you")
                    && (is_str(&status, "pending") || is_str(&status, "working"))
                {
                    set(&mut notes[i], "status", "answered".into())?;
                }
            }
            Ok(())
        })?;
        touch(&self.sfile(".watcher-heartbeat"))?;
        println!("replied");
        Ok(())
    }

    pub fn list(&self, open: bool) -> R<()> {
        let notes = self.load()?;
        for n in &notes {
            if truthy(get(n, "parent")?.unwrap_or(&Value::Null)) {
                continue;
            }
            let thread = thread_of(&notes, item(n, "id")?)?;
            let mut states: Vec<Value> = Vec::new();
            for &i in &thread {
                let s = get(&notes[i], "status")?.cloned().unwrap_or(Value::Null);
                require_hashable(&s)?;
                if !states.iter().any(|x| py_eq(x, &s)) {
                    states.push(s);
                }
            }
            if open
                && !states
                    .iter()
                    .any(|s| is_str(s, "pending") || is_str(s, "working"))
            {
                continue;
            }
            let mut names = Vec::new();
            for s in states.iter().filter(|s| truthy(s)) {
                names.push(as_str(s)?.to_string());
            }
            names.sort();
            let pad = |v: &Value| -> R<String> {
                match v {
                    Value::Str(s) => Ok(s.clone()),
                    Value::Int(_) | Value::Float(_) | Value::Bool(_) => Ok(py_str(v)),
                    other => crash(format!(
                        "TypeError: unsupported format string passed to {}.__format__",
                        type_name(other)
                    )),
                }
            };
            let section = get(n, "section")?.cloned().unwrap_or(Value::Null);
            let section = if truthy(&section) {
                take_chars(as_str(&section)?, 30)
            } else {
                String::new()
            };
            println!(
                "{}  {:<8} {:<30} {:<30}  {} msgs  {}",
                py_str(item(n, "id")?),
                pad(item(n, "type")?)?,
                take_chars(as_str(&topic_of(n)?)?, 30),
                section,
                thread.len(),
                names.join("/")
            );
            for &i in &thread {
                let m = &notes[i];
                println!(
                    "    {:>6}: {}",
                    pad(item(m, "author")?)?,
                    repr_str(&take_chars(as_str(item(m, "text")?)?, 100))
                );
            }
        }
        Ok(())
    }
}

fn sleep(secs: f64) -> R<()> {
    if secs.is_nan() || secs < 0.0 {
        return value_err("sleep length must be non-negative");
    }
    if !secs.is_finite() {
        return crash("OverflowError: timestamp too large to convert to C _PyTime_t");
    }
    std::thread::sleep(Duration::from_secs_f64(secs));
    Ok(())
}

fn thread_of(notes: &[Value], root_id: &Value) -> R<Vec<usize>> {
    let mut out = Vec::new();
    for (i, n) in notes.iter().enumerate() {
        if py_eq(item(n, "id")?, root_id)
            || py_eq(get(n, "parent")?.unwrap_or(&Value::Null), root_id)
        {
            out.push(i);
        }
    }
    Ok(out)
}

fn find(notes: &[Value], key: &Value) -> R<usize> {
    for (i, n) in notes.iter().enumerate() {
        let id = item(n, "id")?;
        if py_eq(id, key) {
            return Ok(i);
        }
        if as_str(id)?.starts_with(as_str(key)?) {
            return Ok(i);
        }
    }
    crash(format!("no note with id {}", py_str(key)))
}

fn new_note(block: Value, text: String, author: &str, extra: Vec<(&str, Value)>) -> Value {
    let mut d = Dict::new();
    d.insert("id".into(), new_id().into());
    d.insert("block".into(), block);
    d.insert("text".into(), text.into());
    d.insert("author".into(), author.into());
    d.insert("created".into(), clock::now_iso().into());
    for (k, v) in extra {
        d.insert(k.into(), v);
    }
    Value::Dict(d)
}

fn topic_of(note: &Value) -> R<Value> {
    let t = get(note, "topic")?.cloned().unwrap_or(Value::Null);
    if truthy(&t) {
        return Ok(t);
    }
    let block = as_str(item(note, "block")?)?;
    Ok(block.split('/').next().unwrap_or("").into())
}

fn pending(notes: &[Value]) -> R<Vec<usize>> {
    let mut out = Vec::new();
    for (i, n) in notes.iter().enumerate() {
        let author = get(n, "author")?.cloned().unwrap_or(Value::Null);
        let status = get(n, "status")?.cloned().unwrap_or(Value::Null);
        if is_str(&author, "you") && is_str(&status, "pending") {
            out.push(i);
        }
    }
    Ok(out)
}
