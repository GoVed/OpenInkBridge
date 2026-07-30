use openinkbridge_core::models::Point;
use openinkbridge_core::platform::remarkable::RemarkableBackend;
use openinkbridge_core::platform::{EpdBackend, PenState, RefreshMode};
use openinkbridge_core::smooth_stroke;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("OpenInkBridge Linux Driver started (reMarkable Backend).");

    let mut backend = RemarkableBackend::remarkables_default();
    if let Err(err) = backend.initialize() {
        eprintln!("Warning initializing reMarkable backend: {}", err);
    }

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
