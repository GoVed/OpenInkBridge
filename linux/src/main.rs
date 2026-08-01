use openinkbridge_core::diagnostics::{Capabilities, collect_diagnostics, dump_configuration};
use openinkbridge_core::logging::{LogLevel, Subsystem, set_log_level};
use openinkbridge_core::models::Point;
use openinkbridge_core::platform::remarkable::RemarkableBackend;
use openinkbridge_core::platform::{DisplayTransform, EpdBackend, PenState, RefreshMode};
use openinkbridge_core::{openink_info, smooth_stroke};
use openinkbridge_linux::{backend_io_error, remarkable_config_from_env};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    set_log_level(LogLevel::Info);
    openink_info!(
        Subsystem::Linux,
        "LinuxDaemon",
        "STARTUP",
        "OpenInkBridge Linux Driver started (reMarkable Backend)"
    );

    let config = remarkable_config_from_env().map_err(backend_io_error)?;
    let mut backend =
        RemarkableBackend::with_config(config, DisplayTransform::remarkables_default());
    backend.initialize().map_err(backend_io_error)?;

    let report = collect_diagnostics(
        "RemarkableBackend".to_string(),
        vec!["RemarkableBackend".to_string()],
        None,
        Capabilities::default(),
        "Fast".to_string(),
    );
    println!("{}", dump_configuration(&report));

    let mut current_stroke: Vec<Point> = Vec::new();

    loop {
        let pen_events = backend.try_receive_pen_events().map_err(backend_io_error)?;
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
                        backend
                            .render_strokes(last_two, 0xFF000000, 4.0)
                            .map_err(backend_io_error)?;
                    }
                }
                PenState::Up => {
                    current_stroke.push(point);
                    if !current_stroke.is_empty() {
                        let smoothed = smooth_stroke(&current_stroke);
                        let json = serde_json::to_string(&smoothed)?;
                        println!("STROKE_FINISHED: {}", json);
                        backend
                            .request_refresh(RefreshMode::Partial, None)
                            .map_err(backend_io_error)?;
                        current_stroke.clear();
                    }
                }
                PenState::Hover => {}
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}
