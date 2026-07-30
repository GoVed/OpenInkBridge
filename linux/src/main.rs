use openinkbridge_core::diagnostics::{collect_diagnostics, dump_configuration, Capabilities};
use openinkbridge_core::logging::{set_log_level, LogLevel, Subsystem};
use openinkbridge_core::models::Point;
use openinkbridge_core::platform::remarkable::RemarkableBackend;
use openinkbridge_core::platform::{EpdBackend, PenState, RefreshMode};
use openinkbridge_core::{openink_info, openink_warn, smooth_stroke};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    set_log_level(LogLevel::Info);
    openink_info!(
        Subsystem::Linux,
        "LinuxDaemon",
        "STARTUP",
        "OpenInkBridge Linux Driver started (reMarkable Backend)"
    );

    let mut backend = RemarkableBackend::remarkables_default();
    let mut fallback_reason = None;
    if let Err(err) = backend.initialize() {
        openink_warn!(
            Subsystem::Backend,
            "REMARKABLE",
            "INIT_WARN",
            "Warning initializing reMarkable backend: {}",
            err
        );
        fallback_reason = Some(err.to_string());
    }

    let report = collect_diagnostics(
        "RemarkableBackend".to_string(),
        vec!["RemarkableBackend".to_string()],
        fallback_reason,
        Capabilities::default(),
        "Fast".to_string(),
    );
    println!("{}", dump_configuration(&report));

    let mut current_stroke: Vec<Point> = Vec::new();

    loop {
        let pen_events = backend.receive_pen_events();
        for event in pen_events {
            let point = Point {
                x: event.x,
                y: event.y,
                pressure: event.pressure,
                tilt: event.tilt_x.unwrap_or(0.0),
                timestamp: event.timestamp,
            };

            match event.state {
                PenState::Down => {
                    current_stroke.clear();
                    current_stroke.push(point);
                }
                PenState::Move => {
                    current_stroke.push(point);
                    if current_stroke.len() >= 2 {
                        let last_two = &current_stroke[current_stroke.len() - 2..];
                        let _ = backend.render_strokes(last_two, 0xFF000000, 4.0);
                    }
                }
                PenState::Up => {
                    current_stroke.push(point);
                    if !current_stroke.is_empty() {
                        let smoothed = smooth_stroke(&current_stroke);
                        let json = serde_json::to_string(&smoothed)?;
                        println!("STROKE_FINISHED: {}", json);
                        let _ = backend.request_refresh(RefreshMode::Partial, None);
                        current_stroke.clear();
                    }
                }
                PenState::Hover => {}
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

