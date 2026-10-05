use crate::json::{float_repr, Dict, Value};
use std::cmp::Ordering;

#[derive(Debug)]
pub enum PyErr {
    Key(String),
    Value(String),
    Stop,
    Crash(String),
}

pub type R<T> = Result<T, PyErr>;

pub fn crash<T>(msg: impl Into<String>) -> R<T> {
    Err(PyErr::Crash(msg.into()))
}

pub fn value_err<T>(msg: impl Into<String>) -> R<T> {
    Err(PyErr::Value(msg.into()))
}

impl From<std::io::Error> for PyErr {
    fn from(e: std::io::Error) -> Self {
        PyErr::Crash(e.to_string())
    }
}

pub fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Int(_) | Value::Big(_) => "int",
        Value::Float(_) => "float",
        Value::Str(_) => "str",
        Value::List(_) => "list",
        Value::Dict(_) => "dict",
    }
}

pub fn item<'a>(v: &'a Value, key: &str) -> R<&'a Value> {
    match v {
        Value::Dict(d) => d.get(key).ok_or_else(|| PyErr::Key(key.to_string())),
        other => crash(format!(
            "TypeError: {} object is not subscriptable by str",
            type_name(other)
        )),
    }
}

pub fn get<'a>(v: &'a Value, key: &str) -> R<Option<&'a Value>> {
    match v {
        Value::Dict(d) => Ok(d.get(key)),
        other => crash(format!(
            "AttributeError: '{}' object has no attribute 'get'",
            type_name(other)
        )),
    }
}

pub fn get_or(v: &Value, key: &str, default: Value) -> R<Value> {
    Ok(get(v, key)?.cloned().unwrap_or(default))
}

pub fn dict_mut(v: &mut Value) -> R<&mut Dict> {
    match v {
        Value::Dict(d) => Ok(d),
        other => crash(format!(
            "TypeError: '{}' object does not support item assignment",
            type_name(other)
        )),
    }
}

pub fn item_mut<'a>(v: &'a mut Value, key: &str) -> R<&'a mut Value> {
    match v {
        Value::Dict(d) => d.get_mut(key).ok_or_else(|| PyErr::Key(key.to_string())),
        other => crash(format!(
            "TypeError: {} object is not subscriptable by str",
            type_name(other)
        )),
    }
}

pub fn set(v: &mut Value, key: &str, val: Value) -> R<()> {
    dict_mut(v)?.insert(key.to_string(), val);
    Ok(())
}

pub fn setdefault(v: &mut Value, key: String, default: Value) -> R<&mut Value> {
    Ok(dict_mut(v)?.entry(key).or_insert(default))
}

pub fn iter(v: &Value) -> R<Vec<Value>> {
    match v {
        Value::List(items) => Ok(items.clone()),
        Value::Dict(d) => Ok(d.keys().map(|k| Value::Str(k.clone())).collect()),
        Value::Str(s) => Ok(s.chars().map(|c| Value::Str(c.to_string())).collect()),
        other => crash(format!(
            "TypeError: '{}' object is not iterable",
            type_name(other)
        )),
    }
}

pub fn as_str(v: &Value) -> R<&str> {
    match v {
        Value::Str(s) => Ok(s),
        other => crash(format!("TypeError: expected str, got {}", type_name(other))),
    }
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Int(n) => *n != 0,
        Value::Big(_) => true,
        Value::Float(f) => *f != 0.0,
        Value::Str(s) => !s.is_empty(),
        Value::List(l) => !l.is_empty(),
        Value::Dict(d) => !d.is_empty(),
    }
}

pub fn hashable(v: &Value) -> bool {
    !matches!(v, Value::List(_) | Value::Dict(_))
}

pub fn require_hashable(v: &Value) -> R<()> {
    if hashable(v) {
        Ok(())
    } else {
        crash(format!("TypeError: unhashable type: '{}'", type_name(v)))
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Num {
    I(i128),
    F(f64),
}

impl Num {
    pub fn f(self) -> f64 {
        match self {
            Num::I(n) => n as f64,
            Num::F(f) => f,
        }
    }

    pub fn value(self) -> Value {
        match self {
            Num::I(n) => Value::Int(n),
            Num::F(f) => Value::Float(f),
        }
    }
}

pub fn num(v: &Value) -> Option<Num> {
    match v {
        Value::Bool(b) => Some(Num::I(*b as i128)),
        Value::Int(n) => Some(Num::I(*n)),
        Value::Float(f) => Some(Num::F(*f)),
        _ => None,
    }
}

pub fn need_num(v: &Value) -> R<Num> {
    num(v).map_or_else(
        || {
            crash(format!(
                "TypeError: unsupported operand type: '{}'",
                type_name(v)
            ))
        },
        Ok,
    )
}

pub fn add(a: &Value, b: Num) -> R<Value> {
    Ok(match (need_num(a)?, b) {
        (Num::I(x), Num::I(y)) => match x.checked_add(y) {
            Some(n) => Value::Int(n),
            None => return crash("OverflowError: integer too large"),
        },
        (x, y) => Value::Float(x.f() + y.f()),
    })
}

pub fn num_cmp(a: Num, b: Num) -> Option<Ordering> {
    match (a, b) {
        (Num::I(x), Num::I(y)) => Some(x.cmp(&y)),
        (Num::I(x), Num::F(y)) => int_float_cmp(x, y),
        (Num::F(x), Num::I(y)) => int_float_cmp(y, x).map(Ordering::reverse),
        (Num::F(x), Num::F(y)) => x.partial_cmp(&y),
    }
}

fn int_float_cmp(x: i128, y: f64) -> Option<Ordering> {
    if y.is_nan() {
        return None;
    }
    if y.is_infinite() {
        return Some(if y > 0.0 {
            Ordering::Less
        } else {
            Ordering::Greater
        });
    }
    let t = y.trunc();
    if t.abs() < 1.7e38 {
        let ti = t as i128;
        match x.cmp(&ti) {
            Ordering::Equal => (0.0).partial_cmp(&(y - t)),
            o => Some(o),
        }
    } else {
        (x as f64).partial_cmp(&y)
    }
}

pub fn py_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Str(x), Value::Str(y)) => x == y,
        (Value::Big(x), Value::Big(y)) => x == y,
        (Value::List(x), Value::List(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| py_eq(p, q))
        }
        (Value::Dict(x), Value::Dict(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| py_eq(v, w)))
        }
        _ => match (num(a), num(b)) {
            (Some(x), Some(y)) => num_cmp(x, y) == Some(Ordering::Equal),
            _ => false,
        },
    }
}

pub fn is_str(v: &Value, s: &str) -> bool {
    matches!(v, Value::Str(x) if x == s)
}

pub fn is_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

pub fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

pub fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn py_str(v: &Value) -> String {
    match v {
        Value::Str(s) => s.clone(),
        other => py_repr(other),
    }
}

pub fn py_repr(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Int(n) => n.to_string(),
        Value::Big(s) => s.clone(),
        Value::Float(f) => float_repr(*f),
        Value::Str(s) => repr_str(s),
        Value::List(items) => format!(
            "[{}]",
            items.iter().map(py_repr).collect::<Vec<_>>().join(", ")
        ),
        Value::Dict(d) => format!(
            "{{{}}}",
            d.iter()
                .map(|(k, v)| format!("{}: {}", repr_str(k), py_repr(v)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

pub fn json_key(v: &Value) -> R<String> {
    Ok(match v {
        Value::Str(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(true) => "true".into(),
        Value::Bool(false) => "false".into(),
        Value::Int(n) => n.to_string(),
        Value::Big(s) => s.clone(),
        Value::Float(f) => {
            if f.is_nan() {
                "NaN".into()
            } else if f.is_infinite() {
                if *f > 0.0 { "Infinity" } else { "-Infinity" }.into()
            } else {
                float_repr(*f)
            }
        }
        other => {
            return crash(format!(
                "TypeError: unhashable type: '{}'",
                type_name(other)
            ))
        }
    })
}

fn printable(c: char) -> bool {
    let u = c as u32;
    if u < 0x20 || u == 0x7f {
        return false;
    }
    if u < 0x7f {
        return true;
    }
    !matches!(u,
        0x80..=0xa0
        | 0xad
        | 0x600..=0x605
        | 0x61c
        | 0x6dd
        | 0x70f
        | 0x890..=0x891
        | 0x8e2
        | 0x1680
        | 0x180e
        | 0x2000..=0x200f
        | 0x2028..=0x202f
        | 0x205f..=0x2064
        | 0x2066..=0x206f
        | 0x3000
        | 0xd800..=0xf8ff
        | 0xfdd0..=0xfdef
        | 0xfeff
        | 0xfff9..=0xfffb
        | 0x110bd
        | 0x110cd
        | 0x13430..=0x1343f
        | 0x1bca0..=0x1bca3
        | 0x1d173..=0x1d17a
        | 0xe0001
        | 0xe0020..=0xe007f
        | 0xf0000..=0x10ffff
    ) && (u & 0xfffe) != 0xfffe
}

pub fn repr_str(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::new();
    out.push(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c if printable(c) => out.push(c),
            c if (c as u32) < 0x100 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c if (c as u32) < 0x10000 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push_str(&format!("\\U{:08x}", c as u32)),
        }
    }
    out.push(quote);
    out
}

pub fn int_from_str(s: &str) -> R<i128> {
    let fail = || {
        let r: String = repr_str(s).chars().take(200).collect();
        PyErr::Value(format!("invalid literal for int() with base 10: {r}"))
    };
    let t = strip(s);
    let (neg, digits) = match t.chars().next() {
        Some('-') => (true, &t[1..]),
        Some('+') => (false, &t[1..]),
        _ => (false, t),
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits.chars().all(|c| c.is_ascii_digit() || c == '_')
    {
        return Err(fail());
    }
    let clean: String = digits.chars().filter(|c| *c != '_').collect();
    let n: i128 = clean
        .parse()
        .map_err(|_| PyErr::Crash("integer too large".into()))?;
    Ok(if neg { -n } else { n })
}

pub fn py_int(v: &Value) -> R<i128> {
    match v {
        Value::Bool(b) => Ok(*b as i128),
        Value::Int(n) => Ok(*n),
        Value::Float(f) => {
            if f.is_nan() {
                value_err("cannot convert float NaN to integer")
            } else if f.is_infinite() {
                crash("OverflowError: cannot convert float infinity to integer")
            } else if f.abs() >= 1.7e38 {
                crash("integer too large")
            } else {
                Ok(f.trunc() as i128)
            }
        }
        Value::Str(s) => int_from_str(s),
        Value::Big(_) => crash("integer too large"),
        other => crash(format!(
            "TypeError: int() argument must be a string, a bytes-like object or a real number, not '{}'",
            type_name(other)
        )),
    }
}

pub fn html_escape(s: &str, quote: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if quote => out.push_str("&quot;"),
            '\'' if quote => out.push_str("&#x27;"),
            c => out.push(c),
        }
    }
    out
}

fn unquote_ascii(run: &str) -> String {
    let b = run.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && b[i + 1].is_ascii_hexdigit()
            && b[i + 2].is_ascii_hexdigit()
        {
            let hex = |c: u8| (c as char).to_digit(16).unwrap_or(0) as u8;
            out.push(hex(b[i + 1]) * 16 + hex(b[i + 2]));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn unquote(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let mut out = String::new();
    let mut run = String::new();
    let mut ascii = true;
    for c in s.chars() {
        if c.is_ascii() != ascii {
            if ascii {
                out.push_str(&unquote_ascii(&run));
            } else {
                out.push_str(&run);
            }
            run.clear();
            ascii = c.is_ascii();
        }
        run.push(c);
    }
    if ascii {
        out.push_str(&unquote_ascii(&run));
    } else {
        out.push_str(&run);
    }
    out
}

pub fn query_of(target: &str) -> &str {
    let t = target.trim_matches(|c: char| (c as u32) <= 0x20);
    let t = t.split_once('#').map_or(t, |(a, _)| a);
    t.split_once('?').map_or("", |(_, q)| q)
}

pub fn parse_qs_first(query: &str, name: &str) -> Option<String> {
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        if v.is_empty() {
            continue;
        }
        if unquote(&k.replace('+', " ")) == name {
            return Some(unquote(&v.replace('+', " ")));
        }
    }
    None
}

pub fn slug(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::new();
    let mut in_run = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('-');
            in_run = true;
        }
    }
    out
}
