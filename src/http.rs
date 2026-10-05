use crate::clock;
use crate::py::{html_escape, int_from_str, is_space, repr_str, PyErr};
use crate::tutor::{App, Resp};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::Arc;

const MAX_LINE: usize = 65536;
const SERVER: &str = "tutor";

fn reason(code: u16) -> (&'static str, &'static str) {
    match code {
        200 => ("OK", "Request fulfilled, document follows"),
        400 => ("Bad Request", "Bad request syntax or unsupported method"),
        404 => ("Not Found", "Nothing matches the given URI"),
        414 => ("Request-URI Too Long", "URI is too long"),
        431 => (
            "Request Header Fields Too Large",
            "The server refused this request because the request header fields are too large",
        ),
        500 => ("Internal Server Error", "Server got itself in trouble"),
        501 => ("Not Implemented", "Server does not support this operation"),
        505 => ("HTTP Version Not Supported", "Cannot fulfill request"),
        _ => ("???", "???"),
    }
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn latin1_bytes(s: &str) -> Vec<u8> {
    s.chars().map(|c| c as u32 as u8).collect()
}

fn read_line(r: &mut impl BufRead, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    r.take(limit as u64).read_until(b'\n', &mut out)?;
    Ok(out)
}

struct Conn {
    out: TcpStream,
    version: String,
    command: String,
}

impl Conn {
    fn head(&self, code: u16, message: &str, extra: &[(&str, String)]) -> Vec<u8> {
        if self.version == "HTTP/0.9" {
            return Vec::new();
        }
        let mut h = latin1_bytes(&format!("HTTP/1.0 {code} {message}\r\n"));
        h.extend(format!("Server: {SERVER}\r\nDate: {}\r\n", clock::http_date()).bytes());
        for (k, v) in extra {
            h.extend(latin1_bytes(&format!("{k}: {v}\r\n")));
        }
        h.extend(b"\r\n");
        h
    }

    fn send(&mut self, resp: Resp) {
        let mut data = self.head(
            resp.code,
            reason(resp.code).0,
            &[
                ("Content-Type", resp.ctype.clone()),
                ("Content-Length", resp.body.len().to_string()),
                ("Cache-Control", "no-store".into()),
            ],
        );
        data.extend(resp.body);
        let _ = self.out.write_all(&data);
    }

    fn send_error(&mut self, code: u16, message: Option<&str>, explain: Option<&str>) {
        let (short, long) = reason(code);
        let message = message.unwrap_or(short);
        let explain = explain.unwrap_or(long);
        let body = format!(
            "<!DOCTYPE HTML>\n<html lang=\"en\">\n    <head>\n        <meta charset=\"utf-8\">\n        <title>Error response</title>\n    </head>\n    <body>\n        <h1>Error response</h1>\n        <p>Error code: {code}</p>\n        <p>Message: {}.</p>\n        <p>Error code explanation: {code} - {}.</p>\n    </body>\n</html>\n",
            html_escape(message, false),
            html_escape(explain, false)
        );
        let mut data = self.head(
            code,
            message,
            &[
                ("Connection", "close".into()),
                ("Content-Type", "text/html;charset=utf-8".into()),
                ("Content-Length", body.len().to_string()),
            ],
        );
        if self.command != "HEAD" {
            data.extend(body.bytes());
        }
        let _ = self.out.write_all(&data);
    }
}

fn header_value(lines: &[String], name: &str) -> Option<String> {
    let mut parsed: Vec<(String, String)> = Vec::new();
    for line in lines {
        let bare = line.trim_end_matches(['\r', '\n']);
        if bare.is_empty() {
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = parsed.last_mut() {
                last.1.push_str(line);
            }
            continue;
        }
        if line.starts_with("From ") {
            continue;
        }
        let Some(colon) = line.find(':') else { break };
        let key = &line[..colon];
        if !key
            .chars()
            .all(|c| ('\x21'..='\x7e').contains(&c) && c != ':')
        {
            break;
        }
        parsed.push((
            key.to_string(),
            line[colon + 1..]
                .trim_start_matches([' ', '\t'])
                .to_string(),
        ));
    }
    parsed
        .into_iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.trim_end_matches(['\r', '\n']).to_string())
}

fn http_version_ok(version: &str) -> Result<(u64, u64), ()> {
    let base = version.strip_prefix("HTTP/").ok_or(())?;
    let parts: Vec<&str> = base.split('.').collect();
    if parts.len() != 2 {
        return Err(());
    }
    let mut nums = [0u64; 2];
    for (i, p) in parts.iter().enumerate() {
        if p.is_empty() || p.len() > 10 || !p.chars().all(|c| c.is_ascii_digit()) {
            return Err(());
        }
        nums[i] = p.parse().map_err(|_| ())?;
    }
    Ok((nums[0], nums[1]))
}

fn report(err: PyErr) {
    let msg = match err {
        PyErr::Key(k) => format!("KeyError: {k}"),
        PyErr::Value(v) => format!("ValueError: {v}"),
        PyErr::Stop => "StopIteration".into(),
        PyErr::Crash(c) => c,
    };
    eprintln!("error while handling a request: {msg}");
}

fn handle(app: &App, stream: TcpStream) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut conn = Conn {
        out: stream,
        version: "HTTP/0.9".into(),
        command: String::new(),
    };
    serve_one(app, &mut reader, &mut conn);
    let _ = conn.out.flush();
    let _ = conn.out.shutdown(Shutdown::Write);
}

fn serve_one(app: &App, reader: &mut BufReader<TcpStream>, conn: &mut Conn) {
    let Ok(raw) = read_line(reader, MAX_LINE + 1) else {
        return;
    };
    if raw.is_empty() {
        return;
    }
    if raw.len() > MAX_LINE {
        conn.version = String::new();
        conn.send_error(414, None, None);
        return;
    }
    let requestline = latin1(&raw).trim_end_matches(['\r', '\n']).to_string();
    let words: Vec<&str> = requestline
        .split(is_space)
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        return;
    }
    if words.len() >= 3 {
        let version = words[words.len() - 1];
        match http_version_ok(version) {
            Err(()) => {
                conn.send_error(
                    400,
                    Some(&format!("Bad request version ({})", repr_str(version))),
                    None,
                );
                return;
            }
            Ok(v) if v >= (2, 0) => {
                conn.send_error(
                    505,
                    Some(&format!("Invalid HTTP version ({})", &version[5..])),
                    None,
                );
                return;
            }
            Ok(_) => conn.version = version.to_string(),
        }
    }
    if !(2..=3).contains(&words.len()) {
        conn.send_error(
            400,
            Some(&format!("Bad request syntax ({})", repr_str(&requestline))),
            None,
        );
        return;
    }
    let command = words[0].to_string();
    let mut path = words[1].to_string();
    if words.len() == 2 && command != "GET" {
        conn.send_error(
            400,
            Some(&format!(
                "Bad HTTP/0.9 request type ({})",
                repr_str(&command)
            )),
            None,
        );
        return;
    }
    conn.command = command.clone();
    if path.starts_with("//") {
        path = format!("/{}", path.trim_start_matches('/'));
    }
    let mut lines = Vec::new();
    loop {
        let Ok(line) = read_line(reader, MAX_LINE + 1) else {
            return;
        };
        if line.len() > MAX_LINE {
            conn.send_error(
                431,
                Some("Line too long"),
                Some("got more than 65536 bytes when reading header line"),
            );
            return;
        }
        let end = line.is_empty() || line == b"\r\n" || line == b"\n";
        lines.push(latin1(&line));
        if lines.len() > 100 {
            conn.send_error(
                431,
                Some("Too many headers"),
                Some("got more than 100 headers"),
            );
            return;
        }
        if end {
            break;
        }
    }
    let result = match command.as_str() {
        "GET" => app.handle_get(&path),
        "POST" => post(app, reader, &path, &lines),
        _ => {
            conn.send_error(
                501,
                Some(&format!("Unsupported method ({})", repr_str(&command))),
                None,
            );
            return;
        }
    };
    match result {
        Ok(resp) => conn.send(resp),
        Err(PyErr::Key(k)) if command == "POST" => {
            conn.send(error_json(&format!("missing or unknown value: {k}")))
        }
        Err(PyErr::Value(v)) if command == "POST" => conn.send(error_json(&v)),
        Err(PyErr::Stop) if command == "POST" => conn.send(error_json("")),
        Err(e) => report(e),
    }
}

fn error_json(msg: &str) -> Resp {
    let mut body = String::from("{\"error\": ");
    crate::json::encode_str(&mut body, msg, true);
    body.push('}');
    Resp {
        code: 400,
        body: body.into_bytes(),
        ctype: "application/json".into(),
    }
}

fn post(
    app: &App,
    reader: &mut BufReader<TcpStream>,
    path: &str,
    lines: &[String],
) -> Result<Resp, PyErr> {
    let length = match header_value(lines, "Content-Length") {
        Some(v) => int_from_str(&v)?,
        None => 0,
    };
    let mut body = Vec::new();
    if length < 0 {
        reader.read_to_end(&mut body)?;
    } else {
        reader.take(length as u64).read_to_end(&mut body)?;
    }
    app.handle_post(path, &body)
}

pub fn serve(app: Arc<App>, listener: TcpListener) {
    for conn in listener.incoming() {
        let Ok(stream) = conn else { continue };
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .stack_size(64 * 1024 * 1024)
            .spawn(move || handle(&app, stream));
    }
}
