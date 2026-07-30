pub mod models;
pub mod platform;

use models::Point;

fn perpendicular_distance(p: &Point, a: &Point, b: &Point) -> f32 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let line_len_sq = dx * dx + dy * dy;
    if line_len_sq == 0.0 {
        let p_dx = p.x - a.x;
        let p_dy = p.y - a.y;
        return (p_dx * p_dx + p_dy * p_dy).sqrt();
    }
    let area = (dy * p.x - dx * p.y + b.x * a.y - b.y * a.x).abs();
    area / line_len_sq.sqrt()
}

/// Simplifies a path of points using the Ramer-Douglas-Peucker algorithm.
/// Reduces point count for efficient networking, storage, and rendering.
pub fn simplify_stroke(points: &[Point], epsilon: f32) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }

    let mut max_dist = 0.0;
    let mut index = 0;
    let end = points.len() - 1;

    for i in 1..end {
        let dist = perpendicular_distance(&points[i], &points[0], &points[end]);
        if dist > max_dist {
            max_dist = dist;
            index = i;
        }
    }

    if max_dist > epsilon {
        let mut results1 = simplify_stroke(&points[0..=index], epsilon);
        let results2 = simplify_stroke(&points[index..=end], epsilon);
        results1.pop();
        results1.extend(results2);
        results1
    } else {
        vec![points[0], points[end]]
    }
}

/// Smooths a list of points using a zero-phase symmetric weighted filter (0.25, 0.50, 0.25).
/// This removes digitizer sensor jitter without causing positional shift or curve drift.
pub fn smooth_stroke_zero_phase(points: &[Point]) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }

    let mut smoothed = Vec::with_capacity(points.len());
    smoothed.push(points[0]);

    for i in 1..points.len() - 1 {
        let p_prev = &points[i - 1];
        let p_curr = &points[i];
        let p_next = &points[i + 1];

        smoothed.push(Point {
            x: 0.25 * p_prev.x + 0.50 * p_curr.x + 0.25 * p_next.x,
            y: 0.25 * p_prev.y + 0.50 * p_curr.y + 0.25 * p_next.y,
            pressure: 0.25 * p_prev.pressure + 0.50 * p_curr.pressure + 0.25 * p_next.pressure,
            tilt: 0.25 * p_prev.tilt + 0.50 * p_curr.tilt + 0.25 * p_next.tilt,
            timestamp: p_curr.timestamp,
        });
    }

    smoothed.push(points[points.len() - 1]);
    smoothed
}

/// Unified processing function: smooths and simplifies a stylus stroke.
pub fn smooth_stroke(points: &[Point]) -> Vec<Point> {
    if points.is_empty() {
        return Vec::new();
    }
    // Smooth points using zero-phase filter to prevent positional offset
    smooth_stroke_zero_phase(points)
}

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn smooth_stroke_wasm(points_json: &str) -> String {
    let points: Vec<Point> = serde_json::from_str(points_json).unwrap_or_default();
    let smoothed = smooth_stroke(&points);
    serde_json::to_string(&smoothed).unwrap_or_default()
}

#[cfg(feature = "android")]
#[allow(non_snake_case)]
pub mod android {
    use jni::JNIEnv;
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use super::smooth_stroke;
    use super::models::Point;

    #[unsafe(no_mangle)]
    pub extern "system" fn Java_org_openinkbridge_sdk_CoreBridge_smoothStroke(
        mut env: JNIEnv,
        _class: JClass,
        input: JString,
    ) -> jstring {
        let input_str: String = match env.get_string(&input) {
            Ok(s) => s.into(),
            Err(_) => return env.new_string("").unwrap().into_raw(),
        };
        let points: Vec<Point> = serde_json::from_str(&input_str).unwrap_or_default();
        let smoothed = smooth_stroke(&points);
        let output_str = serde_json::to_string(&smoothed).unwrap_or_default();
        env.new_string(output_str).unwrap().into_raw()
    }
}
