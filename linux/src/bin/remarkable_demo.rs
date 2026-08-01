use openinkbridge_core::models::Point;
use openinkbridge_core::platform::remarkable::RemarkableBackend;
use openinkbridge_core::platform::{DisplayTransform, EpdBackend, PenState, RefreshMode};
use openinkbridge_core::smooth_stroke;
use openinkbridge_linux::{backend_io_error, remarkable_config_from_env};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("==================================================");
    println!("         OpenInkBridge reMarkable Demo            ");
    println!("==================================================");
    println!("* Features: Low-latency pen drawing, pressure sensitivity,");
    println!("  stroke smoothing, eraser support, and partial E-Ink refresh.");

    let config = remarkable_config_from_env().map_err(backend_io_error)?;
    let mut backend =
        RemarkableBackend::with_config(config, DisplayTransform::remarkables_default());
    backend.initialize().map_err(backend_io_error)?;

    println!("-> Hardware initialization complete.");
    println!("-> Drawing active. Listening for stylus touch events...");

    let mut current_stroke: Vec<Point> = Vec::new();
    let mut stroke_count = 0;

    loop {
        let events = backend.try_receive_pen_events().map_err(backend_io_error)?;
        for event in events {
            let pt = Point {
                x: event.x,
                y: event.y,
                pressure: event.pressure,
                tilt: event.tilt_x.unwrap_or(0.0),
                timestamp: event.timestamp,
            };

            match event.state {
                PenState::Down => {
                    current_stroke.clear();
                    current_stroke.push(pt);
                    println!(
                        "[PEN DOWN] x: {:.1}, y: {:.1}, pressure: {:.2}",
                        event.x, event.y, event.pressure
                    );
                }
                PenState::Move => {
                    current_stroke.push(pt);
                    // Render latest segment with direct hardware E-Ink partial refresh
                    if current_stroke.len() >= 2 {
                        let segment = &current_stroke[current_stroke.len() - 2..];
                        backend
                            .render_strokes(segment, 0xFF000000, 4.0)
                            .map_err(backend_io_error)?;
                    }
                }
                PenState::Up => {
                    current_stroke.push(pt);
                    stroke_count += 1;

                    // Smooth and simplify stroke vector
                    let smoothed = smooth_stroke(&current_stroke);
                    println!(
                        "[PEN UP] Stroke #{} finished with {} points (smoothed: {} points)",
                        stroke_count,
                        current_stroke.len(),
                        smoothed.len()
                    );

                    let json = serde_json::to_string(&smoothed)?;
                    println!("STROKE_FINISHED: {}", json);

                    // Trigger partial refresh to solidify finished stroke
                    backend
                        .request_refresh(RefreshMode::Partial, None)
                        .map_err(backend_io_error)?;
                    current_stroke.clear();
                }
                PenState::Hover => {
                    // Hover event stream
                }
            }
        }

        // Sleep briefly to prevent high CPU usage when idle in polling loop
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}
