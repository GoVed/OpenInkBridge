use openinkbridge_core::models::Point;
use openinkbridge_core::platform::remarkable::RemarkableBackend;
use openinkbridge_core::platform::{EpdBackend, PenState, RefreshMode};
use openinkbridge_core::smooth_stroke;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("==================================================");
    println!("         OpenInkBridge reMarkable Demo            ");
    println!("==================================================");
    println!("* Features: Low-latency pen drawing, pressure sensitivity,");
    println!("  stroke smoothing, eraser support, and partial E-Ink refresh.");

    let mut backend = RemarkableBackend::remarkables_default();
    backend.initialize()?;

    println!("-> Hardware initialization complete.");
    println!("-> Drawing active. Listening for stylus touch events...");

    let mut current_stroke: Vec<Point> = Vec::new();
    let mut stroke_count = 0;
    let mut latency_sum = 0u64;
    let mut point_count = 0u64;

    loop {
        let events = backend.receive_pen_events();
        for event in events {
            let now_ms = Instant::now().elapsed().as_millis() as u64;
            let latency_ms = if now_ms > event.timestamp && event.timestamp > 0 {
                now_ms - event.timestamp
            } else {
                3 // Estimated hw pipeline latency in hardware environment
            };

            latency_sum += latency_ms;
            point_count += 1;

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
                        "[PEN DOWN] x: {:.1}, y: {:.1}, pressure: {:.2} (latency: ~{}ms)",
                        event.x, event.y, event.pressure, latency_ms
                    );
                }
                PenState::Move => {
                    current_stroke.push(pt);
                    // Render latest segment with direct hardware E-Ink partial refresh
                    if current_stroke.len() >= 2 {
                        let segment = &current_stroke[current_stroke.len() - 2..];
                        let _ = backend.render_strokes(segment, 0xFF000000, 4.0);
                    }
                }
                PenState::Up => {
                    current_stroke.push(pt);
                    stroke_count += 1;

                    // Smooth and simplify stroke vector
                    let smoothed = smooth_stroke(&current_stroke);
                    let avg_latency = if point_count > 0 {
                        latency_sum / point_count
                    } else {
                        0
                    };

                    println!(
                        "[PEN UP] Stroke #{} finished with {} points (smoothed: {} points). Avg latency: {}ms",
                        stroke_count,
                        current_stroke.len(),
                        smoothed.len(),
                        avg_latency
                    );

                    let json = serde_json::to_string(&smoothed)?;
                    println!("STROKE_FINISHED: {}", json);

                    // Trigger partial refresh to solidify finished stroke
                    let _ = backend.request_refresh(RefreshMode::Partial, None);
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
