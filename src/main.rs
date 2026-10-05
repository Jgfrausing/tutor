mod clock;
mod http;
mod json;
mod paths;
mod py;
mod tutor;

use clap::{Parser, Subcommand};
use py::PyErr;
use std::process::ExitCode;
use std::sync::Arc;
use tutor::App;

const DEFAULT_PORT: i64 = 8765;

fn parse_int(s: &str) -> Result<i128, String> {
    py::int_from_str(s).map_err(|_| format!("invalid int value: '{s}'"))
}

fn parse_float(s: &str) -> Result<f64, String> {
    let t = py::strip(s);
    let clean: String = t.chars().filter(|c| *c != '_').collect();
    let lower = clean.to_ascii_lowercase();
    let unsigned = lower.trim_start_matches(['+', '-']);
    let special = matches!(unsigned, "inf" | "infinity" | "nan");
    if !special
        && !clean
            .chars()
            .all(|c| c.is_ascii_digit() || "+-.eE".contains(c))
    {
        return Err(format!("invalid float value: '{s}'"));
    }
    clean
        .parse::<f64>()
        .map_err(|_| format!("invalid float value: '{s}'"))
}

#[derive(Parser)]
#[command(name = "tutor", infer_long_args = true)]
struct Cli {
    #[arg(
        long,
        help = "curriculum directory (default: $STUDY_ROOT or the current directory)"
    )]
    root: Option<String>,
    #[arg(
        long,
        help = "directory for your notes, journal and progress (default: $STUDY_STATE or ~/.tutor/<curriculum>)"
    )]
    state: Option<String>,
    #[arg(long, value_parser = parse_int, allow_hyphen_values = true)]
    port: Option<i128>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Serve,
    Build,
    #[command(infer_long_args = true)]
    Wait {
        #[arg(long = "max-seconds", value_parser = parse_int, default_value = "6900", allow_hyphen_values = true)]
        max_seconds: i128,
        #[arg(long, value_parser = parse_float, default_value = "4", allow_hyphen_values = true)]
        settle: f64,
    },
    Reply {
        id: String,
        text: String,
    },
    #[command(infer_long_args = true)]
    List {
        #[arg(long)]
        open: bool,
    },
}

fn fail(msg: impl std::fmt::Display) -> ExitCode {
    eprintln!("{msg}");
    ExitCode::from(1)
}

fn describe(e: PyErr) -> String {
    match e {
        PyErr::Key(k) => format!("KeyError: {k}"),
        PyErr::Value(v) => format!("ValueError: {v}"),
        PyErr::Stop => "StopIteration".into(),
        PyErr::Crash(c) => c,
    }
}

fn main() -> ExitCode {
    let env_port = match std::env::var("STUDY_PORT") {
        Ok(v) => match py::int_from_str(&v) {
            Ok(n) => n,
            Err(e) => return fail(describe(e)),
        },
        Err(_) => DEFAULT_PORT as i128,
    };
    let cli = Cli::parse();
    let root = cli
        .root
        .unwrap_or_else(|| std::env::var("STUDY_ROOT").unwrap_or_else(|_| ".".into()));
    let state = cli.state.or_else(|| std::env::var("STUDY_STATE").ok());
    let port = cli.port.unwrap_or(env_port);
    let port = match i64::try_from(port) {
        Ok(p) => p,
        Err(_) => return fail("OverflowError: port out of range"),
    };
    let app = match App::configure(&root, port, state.as_deref()) {
        Ok(a) => a,
        Err(e) => return fail(e),
    };
    let result = match cli.cmd {
        Cmd::Serve => return serve(app),
        Cmd::Build => app.build(),
        Cmd::Wait {
            max_seconds,
            settle,
        } => app.wait(max_seconds, settle),
        Cmd::Reply { id, text } => app.reply(&id, &text),
        Cmd::List { open } => app.list(open),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => fail(describe(e)),
    }
}

fn serve(app: App) -> ExitCode {
    let port = app.port.load(std::sync::atomic::Ordering::SeqCst);
    let Ok(port16) = u16::try_from(port) else {
        return fail("OverflowError: bind(): port must be 0-65535.");
    };
    let listener = match std::net::TcpListener::bind(("127.0.0.1", port16)) {
        Ok(l) => l,
        Err(e) => return fail(format!("OSError: {e}")),
    };
    let real = listener.local_addr().map(|a| a.port()).unwrap_or(port16);
    app.port
        .store(real as i64, std::sync::atomic::Ordering::SeqCst);
    println!(
        "serving {} with state in {} on http://127.0.0.1:{real}/",
        app.root.display(),
        app.state.display()
    );
    http::serve(Arc::new(app), listener);
    ExitCode::SUCCESS
}
