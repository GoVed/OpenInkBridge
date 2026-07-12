pub mod models;

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

/// Smooths a list of points using Double Exponential Smoothing.
/// This balances jitter reduction without introducing drawing lag.
pub fn smooth_stroke_des(points: &[Point], alpha: f32, beta: f32) -> Vec<Point> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let mut smoothed = Vec::with_capacity(points.len());

    let mut s_x = points[0].x;
    let mut b_x = points[1].x - points[0].x;

    let mut s_y = points[0].y;
    let mut b_y = points[1].y - points[0].y;

    let mut s_p = points[0].pressure;
    let mut b_p = points[1].pressure - points[0].pressure;

    let mut s_t = points[0].tilt;
    let mut b_t = points[1].tilt - points[0].tilt;

    smoothed.push(points[0]);

    for i in 1..points.len() {
        let p = &points[i];

        let s_x_new = alpha * p.x + (1.0 - alpha) * (s_x + b_x);
        let s_y_new = alpha * p.y + (1.0 - alpha) * (s_y + b_y);
        let s_p_new = alpha * p.pressure + (1.0 - alpha) * (s_p + b_p);
        let s_t_new = alpha * p.tilt + (1.0 - alpha) * (s_t + b_t);

        b_x = beta * (s_x_new - s_x) + (1.0 - beta) * b_x;
        b_y = beta * (s_y_new - s_y) + (1.0 - beta) * b_y;
        b_p = beta * (s_p_new - s_p) + (1.0 - beta) * b_p;
        b_t = beta * (s_t_new - s_t) + (1.0 - beta) * b_t;

        s_x = s_x_new;
        s_y = s_y_new;
        s_p = s_p_new;
        s_t = s_t_new;

        smoothed.push(Point {
            x: s_x,
            y: s_y,
            pressure: s_p,
            tilt: s_t,
            timestamp: p.timestamp,
        });
    }

    smoothed
}

/// Unified processing function: smooths and simplifies a stylus stroke.
pub fn smooth_stroke(points: &[Point]) -> Vec<Point> {
    if points.is_empty() {
        return Vec::new();
    }
    // 1. Smooth the points to remove hand jitter and sensor noise
    smooth_stroke_des(points, 0.65, 0.25)
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
