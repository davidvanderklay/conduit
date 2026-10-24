//! Desktop torrent helper. The Electron shell writes one `StartRequest` JSON
//! line to stdin and reads `Status` JSON lines from stdout. Closing stdin stops
//! the session and removes its private cache before the process exits.
use conduit_p2p::{Engine, Phase, StartRequest, Status};
use std::io::{BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

fn main() {
    let mut line = String::new();
    if std::io::stdin().lock().read_line(&mut line).is_err() {
        return;
    }
    // Engine errors can contain hashes, trackers, and paths. Report stable codes only.
    let request = match serde_json::from_str::<StartRequest>(&line) {
        Ok(request) if request.source.magnet_url().is_ok() => request,
        _ => return report_failure("invalid_p2p_source"),
    };
    let mut engine = match Engine::start(request) {
        Ok(engine) => engine,
        Err(_) => return report_failure("p2p_start_failed"),
    };
    let (closed, stdin_closed) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        let _ = std::io::stdin().lock().read_line(&mut String::new());
        let _ = closed.send(());
    });
    let mut stdout = std::io::stdout().lock();
    loop {
        let status = engine.status();
        let finished = matches!(status.phase, Phase::Failed | Phase::Closed);
        if write_status(&mut stdout, &status).is_err() || finished {
            break;
        }
        match stdin_closed.recv_timeout(Duration::from_millis(500)) {
            Err(RecvTimeoutError::Timeout) => {}
            _ => break,
        }
    }
    engine.close();
}

fn report_failure(error: &'static str) {
    let status = Status {
        phase: Phase::Failed,
        error: Some(error),
        ..Default::default()
    };
    let _ = write_status(&mut std::io::stdout().lock(), &status);
}

fn write_status(output: &mut impl Write, status: &Status) -> std::io::Result<()> {
    serde_json::to_writer(&mut *output, status)?;
    output.write_all(b"\n")?;
    output.flush()
}
