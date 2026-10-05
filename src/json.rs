use indexmap::IndexMap;
use std::fmt;

pub type Dict = IndexMap<String, Value>;

#[derive(Clone, Debug, Default)]
pub enum Value {
    #[default]
    Null,
    Bool(bool),
    Int(i128),
    Big(String),
    Float(f64),
    Str(String),
    List(Vec<Value>),
    Dict(Dict),
}

impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::Str(s.to_string())
    }
}

impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::Str(s)
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}

impl From<i128> for Value {
    fn from(n: i128) -> Self {
        Value::Int(n)
    }
}

pub fn dict<const N: usize>(items: [(&str, Value); N]) -> Value {
    Value::Dict(items.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

#[derive(Debug, Clone)]
pub struct DecodeError {
    pub msg: String,
    pub pos: usize,
    pub line: usize,
    pub col: usize,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: line {} column {} (char {})",
            self.msg, self.line, self.col, self.pos
        )
    }
}

#[derive(Debug, Clone)]
pub enum LoadError {
    Decode(DecodeError),
    Depth(&'static str),
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Decode(e) => e.fmt(f),
            LoadError::Depth(what) => write!(
                f,
                "maximum recursion depth exceeded while decoding a JSON {what} from a unicode string"
            ),
        }
    }
}

const MAX_DEPTH: usize = 9997;

enum E {
    Stop(usize),
    Msg(&'static str, usize),
    Depth(&'static str),
}

struct Parser {
    c: Vec<char>,
    depth: usize,
}

fn decode_error(c: &[char], msg: &str, pos: usize) -> DecodeError {
    let before = &c[..pos.min(c.len())];
    let line = before.iter().filter(|&&ch| ch == '\n').count() + 1;
    let col = match before.iter().rposition(|&ch| ch == '\n') {
        Some(i) => pos - i,
        None => pos + 1,
    };
    DecodeError {
        msg: msg.to_string(),
        pos,
        line,
        col,
    }
}

pub fn loads(s: &str) -> Result<Value, LoadError> {
    parse(s, true)
}

pub fn loads_decoded(s: &str) -> Result<Value, LoadError> {
    parse(s, false)
}

fn parse(s: &str, check_bom: bool) -> Result<Value, LoadError> {
    let c: Vec<char> = s.chars().collect();
    if check_bom && c.first() == Some(&'\u{feff}') {
        return Err(LoadError::Decode(decode_error(
            &c,
            "Unexpected UTF-8 BOM (decode using utf-8-sig)",
            0,
        )));
    }
    let mut p = Parser { c, depth: 0 };
    let start = p.ws(0);
    let result = match p.scan(start) {
        Ok((v, end)) => {
            let end = p.ws(end);
            if end != p.c.len() {
                Err(E::Msg("Extra data", end))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e),
    };
    result.map_err(|e| match e {
        E::Stop(i) => LoadError::Decode(decode_error(&p.c, "Expecting value", i)),
        E::Msg(m, i) => LoadError::Decode(decode_error(&p.c, m, i)),
        E::Depth(what) => LoadError::Depth(what),
    })
}

fn is_ws(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

impl Parser {
    fn ws(&self, mut i: usize) -> usize {
        while i < self.c.len() && is_ws(self.c[i]) {
            i += 1;
        }
        i
    }

    fn at(&self, i: usize, word: &str) -> bool {
        let w: Vec<char> = word.chars().collect();
        i + w.len() <= self.c.len() && self.c[i..i + w.len()] == w[..]
    }

    fn scan(&mut self, idx: usize) -> Result<(Value, usize), E> {
        if idx >= self.c.len() {
            return Err(E::Stop(idx));
        }
        match self.c[idx] {
            '"' => {
                let (s, end) = self.string(idx + 1)?;
                Ok((Value::Str(s), end))
            }
            '{' => {
                self.enter("object")?;
                let r = self.object(idx + 1);
                self.depth -= 1;
                r
            }
            '[' => {
                self.enter("array")?;
                let r = self.array(idx + 1);
                self.depth -= 1;
                r
            }
            'n' if self.at(idx, "null") => Ok((Value::Null, idx + 4)),
            't' if self.at(idx, "true") => Ok((Value::Bool(true), idx + 4)),
            'f' if self.at(idx, "false") => Ok((Value::Bool(false), idx + 5)),
            'N' if self.at(idx, "NaN") => Ok((Value::Float(f64::NAN), idx + 3)),
            'I' if self.at(idx, "Infinity") => Ok((Value::Float(f64::INFINITY), idx + 8)),
            '-' if self.at(idx, "-Infinity") => Ok((Value::Float(f64::NEG_INFINITY), idx + 9)),
            _ => self.number(idx),
        }
    }

    fn enter(&mut self, what: &'static str) -> Result<(), E> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            self.depth -= 1;
            return Err(E::Depth(what));
        }
        Ok(())
    }

    fn digit(&self, i: usize) -> bool {
        i < self.c.len() && self.c[i].is_ascii_digit()
    }

    fn number(&self, start: usize) -> Result<(Value, usize), E> {
        let c = &self.c;
        let end_idx = c.len() as isize - 1;
        let mut idx = start;
        if c[idx] == '-' {
            idx += 1;
            if idx as isize > end_idx {
                return Err(E::Stop(start));
            }
        }
        if ('1'..='9').contains(&c[idx]) {
            idx += 1;
            while self.digit(idx) {
                idx += 1;
            }
        } else if c[idx] == '0' {
            idx += 1;
        } else {
            return Err(E::Stop(start));
        }
        let mut is_float = false;
        if (idx as isize) < end_idx && c[idx] == '.' && c[idx + 1].is_ascii_digit() {
            is_float = true;
            idx += 2;
            while self.digit(idx) {
                idx += 1;
            }
        }
        if (idx as isize) < end_idx && (c[idx] == 'e' || c[idx] == 'E') {
            let e_start = idx;
            idx += 1;
            if (idx as isize) < end_idx && (c[idx] == '-' || c[idx] == '+') {
                idx += 1;
            }
            while self.digit(idx) {
                idx += 1;
            }
            if c[idx - 1].is_ascii_digit() {
                is_float = true;
            } else {
                idx = e_start;
            }
        }
        let text: String = c[start..idx].iter().collect();
        if is_float {
            Ok((Value::Float(text.parse::<f64>().unwrap_or(f64::NAN)), idx))
        } else {
            match text.parse::<i128>() {
                Ok(n) => Ok((Value::Int(n), idx)),
                Err(_) => Ok((Value::Big(text), idx)),
            }
        }
    }

    fn hex4(&self, from: usize) -> Option<u32> {
        let mut v = 0u32;
        for i in from..from + 4 {
            v = (v << 4) | self.c.get(i)?.to_digit(16)?;
        }
        Some(v)
    }

    fn string(&self, mut end: usize) -> Result<(String, usize), E> {
        let c = &self.c;
        let len = c.len();
        let begin = end - 1;
        let mut out = String::new();
        loop {
            let mut next = end;
            let mut d = '\0';
            while next < len {
                d = c[next];
                if d == '"' || d == '\\' {
                    break;
                }
                if (d as u32) <= 0x1f {
                    return Err(E::Msg("Invalid control character at", next));
                }
                next += 1;
            }
            if next >= len || (d != '"' && d != '\\') {
                return Err(E::Msg("Unterminated string starting at", begin));
            }
            out.extend(&c[end..next]);
            next += 1;
            if d == '"' {
                return Ok((out, next));
            }
            if next == len {
                return Err(E::Msg("Unterminated string starting at", begin));
            }
            let esc = c[next];
            if esc != 'u' {
                end = next + 1;
                let ch = match esc {
                    '"' => '"',
                    '\\' => '\\',
                    '/' => '/',
                    'b' => '\u{8}',
                    'f' => '\u{c}',
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    _ => return Err(E::Msg("Invalid \\escape", end - 2)),
                };
                out.push(ch);
            } else {
                next += 1;
                end = next + 4;
                if end >= len {
                    return Err(E::Msg("Invalid \\uXXXX escape", next - 1));
                }
                let Some(mut u) = self.hex4(next) else {
                    return Err(E::Msg("Invalid \\uXXXX escape", end - 5));
                };
                if (0xd800..0xdc00).contains(&u)
                    && end + 6 < len
                    && c[end] == '\\'
                    && c[end + 1] == 'u'
                {
                    let Some(u2) = self.hex4(end + 2) else {
                        return Err(E::Msg("Invalid \\uXXXX escape", end + 1));
                    };
                    if (0xdc00..0xe000).contains(&u2) {
                        u = 0x10000 + ((u - 0xd800) << 10) + (u2 - 0xdc00);
                        end += 6;
                    }
                }
                out.push(char::from_u32(u).unwrap_or('\u{fffd}'));
            }
        }
    }

    fn object(&mut self, start: usize) -> Result<(Value, usize), E> {
        let mut map = Dict::new();
        let len = self.c.len();
        let mut idx = self.ws(start);
        if idx >= len || self.c[idx] != '}' {
            loop {
                if idx >= len || self.c[idx] != '"' {
                    return Err(E::Msg(
                        "Expecting property name enclosed in double quotes",
                        idx,
                    ));
                }
                let (key, next) = self.string(idx + 1)?;
                idx = self.ws(next);
                if idx >= len || self.c[idx] != ':' {
                    return Err(E::Msg("Expecting ':' delimiter", idx));
                }
                idx = self.ws(idx + 1);
                let (val, next) = self.scan(idx)?;
                map.insert(key, val);
                idx = self.ws(next);
                if idx < len && self.c[idx] == '}' {
                    break;
                }
                if idx >= len || self.c[idx] != ',' {
                    return Err(E::Msg("Expecting ',' delimiter", idx));
                }
                idx = self.ws(idx + 1);
            }
        }
        Ok((Value::Dict(map), idx + 1))
    }

    fn array(&mut self, start: usize) -> Result<(Value, usize), E> {
        let mut items = Vec::new();
        let len = self.c.len();
        let mut idx = self.ws(start);
        if idx >= len || self.c[idx] != ']' {
            loop {
                let (val, next) = self.scan(idx)?;
                items.push(val);
                idx = self.ws(next);
                if idx < len && self.c[idx] == ']' {
                    break;
                }
                if idx >= len || self.c[idx] != ',' {
                    return Err(E::Msg("Expecting ',' delimiter", idx));
                }
                idx = self.ws(idx + 1);
            }
        }
        Ok((Value::List(items), idx + 1))
    }
}

pub fn float_repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf".into() } else { "-inf".into() };
    }
    if x == 0.0 {
        return if x.is_sign_negative() {
            "-0.0".into()
        } else {
            "0.0".into()
        };
    }
    let sci = format!("{:e}", x.abs());
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let decpt = exp + 1;
    let sign = if x < 0.0 { "-" } else { "" };
    let n = digits.len() as i32;
    if -4 < decpt && decpt <= 16 {
        if decpt <= 0 {
            format!("{sign}0.{}{digits}", "0".repeat((-decpt) as usize))
        } else if decpt >= n {
            format!("{sign}{digits}{}.0", "0".repeat((decpt - n) as usize))
        } else {
            let (a, b) = digits.split_at(decpt as usize);
            format!("{sign}{a}.{b}")
        }
    } else {
        let e = decpt - 1;
        let (first, rest) = digits.split_at(1);
        let frac = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        let esign = if e < 0 { '-' } else { '+' };
        format!("{sign}{first}{frac}e{esign}{:02}", e.abs())
    }
}

pub fn encode_str(out: &mut String, s: &str, ascii: bool) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c if ascii && (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", unit));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write(out: &mut String, v: &Value, indent: Option<usize>, level: usize, ascii: bool) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Int(n) => out.push_str(&n.to_string()),
        Value::Big(s) => out.push_str(s),
        Value::Float(f) => {
            if f.is_nan() {
                out.push_str("NaN")
            } else if f.is_infinite() {
                out.push_str(if *f > 0.0 { "Infinity" } else { "-Infinity" })
            } else {
                out.push_str(&float_repr(*f))
            }
        }
        Value::Str(s) => encode_str(out, s, ascii),
        Value::List(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                separator(out, i, indent, level + 1);
                write(out, item, indent, level + 1, ascii);
            }
            close(out, indent, level);
            out.push(']');
        }
        Value::Dict(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (k, item)) in map.iter().enumerate() {
                separator(out, i, indent, level + 1);
                encode_str(out, k, ascii);
                out.push_str(": ");
                write(out, item, indent, level + 1, ascii);
            }
            close(out, indent, level);
            out.push('}');
        }
    }
}

fn separator(out: &mut String, i: usize, indent: Option<usize>, level: usize) {
    match indent {
        None => {
            if i > 0 {
                out.push_str(", ");
            }
        }
        Some(n) => {
            if i > 0 {
                out.push(',');
            }
            out.push('\n');
            out.push_str(&" ".repeat(n * level));
        }
    }
}

fn close(out: &mut String, indent: Option<usize>, level: usize) {
    if let Some(n) = indent {
        out.push('\n');
        out.push_str(&" ".repeat(n * level));
    }
}

pub fn dumps(v: &Value, ascii: bool) -> String {
    let mut out = String::new();
    write(&mut out, v, None, 0, ascii);
    out
}

pub fn dumps_indent(v: &Value, indent: usize, ascii: bool) -> String {
    let mut out = String::new();
    write(&mut out, v, Some(indent), 0, ascii);
    out
}
