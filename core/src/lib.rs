pub mod diagnostics;
pub mod logging;
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

    // Invalid tolerances should never turn user input into unbounded recursion or
    // surprising data loss. A caller can correct the value and retry.
    if !epsilon.is_finite() || epsilon < 0.0 {
        return points.to_vec();
    }

    // Use an explicit work stack instead of recursive subdivision. Long stylus
    // strokes can contain tens of thousands of points and must not exhaust the
    // native or WebAssembly call stack.
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut ranges = vec![(0usize, points.len() - 1)];

    while let Some((start, end)) = ranges.pop() {
        if end <= start + 1 {
            continue;
        }

        let mut max_distance = 0.0;
        let mut furthest_index = None;
        for index in start + 1..end {
            let distance = perpendicular_distance(&points[index], &points[start], &points[end]);
            if distance > max_distance {
                max_distance = distance;
                furthest_index = Some(index);
            }
        }

        if max_distance > epsilon
            && let Some(index) = furthest_index
        {
            keep[index] = true;
            ranges.push((start, index));
            ranges.push((index, end));
        }
    }

    points
        .iter()
        .zip(keep)
        .filter_map(|(point, retained)| retained.then_some(*point))
        .collect()
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

/// Applies the canonical zero-phase smoothing pass to a stylus stroke.
pub fn smooth_stroke(points: &[Point]) -> Vec<Point> {
    if points.is_empty() {
        return Vec::new();
    }
    // Smooth points using zero-phase filter to prevent positional offset
    smooth_stroke_zero_phase(points)
}

#[cfg(test)]
mod stroke_processing_tests {
    use super::*;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Contract {
        schema_version: u32,
        algorithm: String,
        kernel: Vec<f32>,
        vectors: Vec<ContractVector>,
    }

    #[derive(serde::Deserialize)]
    struct ContractVector {
        name: String,
        input: Vec<Point>,
        expected: Vec<Point>,
    }

    fn point(x: f32, y: f32, pressure: f32, timestamp: u64) -> Point {
        Point {
            x,
            y,
            pressure,
            tilt: 0.0,
            timestamp,
        }
    }

    #[test]
    fn smoothing_uses_the_cross_platform_weighted_kernel() {
        let input = vec![
            point(0.0, 2.0, 0.0, 10),
            point(4.0, 6.0, 1.0, 20),
            point(12.0, 10.0, 0.0, 30),
        ];

        let output = smooth_stroke(&input);

        assert_eq!(output.len(), 3);
        assert_eq!(output[0].x, 0.0);
        assert_eq!(output[2].x, 12.0);
        assert_eq!(output[1].x, 5.0);
        assert_eq!(output[1].y, 6.0);
        assert_eq!(output[1].pressure, 0.5);
        assert_eq!(output[1].timestamp, 20);
    }

    #[test]
    fn smoothing_matches_the_versioned_cross_platform_contract() {
        let contract: Contract =
            serde_json::from_str(include_str!("../../contracts/stroke-processing-v1.json"))
                .expect("stroke processing contract must be valid JSON");

        assert_eq!(contract.schema_version, 1);
        assert_eq!(contract.algorithm, "zero-phase-weighted-average");
        assert_eq!(contract.kernel, vec![0.25, 0.5, 0.25]);

        for vector in contract.vectors {
            let actual = smooth_stroke(&vector.input);
            assert_eq!(actual.len(), vector.expected.len(), "{}", vector.name);
            for (actual_point, expected_point) in actual.iter().zip(&vector.expected) {
                assert!((actual_point.x - expected_point.x).abs() < f32::EPSILON);
                assert!((actual_point.y - expected_point.y).abs() < f32::EPSILON);
                assert!((actual_point.pressure - expected_point.pressure).abs() < f32::EPSILON);
                assert!((actual_point.tilt - expected_point.tilt).abs() < f32::EPSILON);
                assert_eq!(actual_point.timestamp, expected_point.timestamp);
            }
        }
    }

    #[test]
    fn simplification_retains_shape_and_endpoints() {
        let input = vec![
            point(0.0, 0.0, 0.5, 0),
            point(1.0, 0.01, 0.5, 1),
            point(2.0, 2.0, 0.5, 2),
            point(3.0, 2.01, 0.5, 3),
            point(4.0, 0.0, 0.5, 4),
        ];

        let output = simplify_stroke(&input, 0.1);

        assert_eq!(output.first().map(|p| p.x), Some(0.0));
        assert_eq!(output.last().map(|p| p.x), Some(4.0));
        assert!(output.iter().any(|p| p.x == 2.0 && p.y == 2.0));
        assert!(output.len() < input.len());
    }

    #[test]
    fn invalid_simplification_tolerance_preserves_input() {
        let input = vec![
            point(0.0, 0.0, 0.5, 0),
            point(1.0, 1.0, 0.5, 1),
            point(2.0, 0.0, 0.5, 2),
        ];

        let negative = simplify_stroke(&input, -1.0);
        let not_a_number = simplify_stroke(&input, f32::NAN);

        assert_eq!(negative.len(), input.len());
        assert_eq!(not_a_number.len(), input.len());
        for (actual, expected) in negative.iter().zip(&input) {
            assert_eq!(actual.x, expected.x);
            assert_eq!(actual.y, expected.y);
        }
    }

    #[test]
    fn very_long_stroke_simplifies_without_recursion() {
        let input: Vec<Point> = (0..100_000)
            .map(|index| point(index as f32, 0.0, 0.5, index))
            .collect();

        let output = simplify_stroke(&input, 0.01);

        assert_eq!(output.len(), 2);
    }
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

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn set_log_level_wasm(level_str: &str) {
    if let Ok(level) = level_str.parse::<logging::LogLevel>() {
        logging::set_log_level(level);
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn collect_diagnostics_wasm(backend: &str) -> String {
    let report = diagnostics::collect_diagnostics(
        backend.to_string(),
        vec!["WasmCanvas".to_string()],
        None,
        diagnostics::Capabilities::default(),
        "Fast".to_string(),
    );
    serde_json::to_string(&report).unwrap_or_default()
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn get_ring_buffer_logs_wasm() -> String {
    let logs = logging::get_ring_buffer_entries();
    serde_json::to_string(&logs).unwrap_or_default()
}

#[cfg(feature = "android")]
#[allow(non_snake_case)]
pub mod android {
    use super::models::Point;
    use super::smooth_stroke;
    use super::{diagnostics, logging};
    use jni::JNIEnv;
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use std::str::FromStr;

    #[unsafe(no_mangle)]
    pub extern "system" fn Java_org_openinkbridge_sdk_CoreBridge_smoothStroke(
        mut env: JNIEnv,
        _class: JClass,
        input: JString,
    ) -> jstring {
        let input_str: String = match env.get_string(&input) {
            Ok(s) => s.into(),
            Err(_) => {
                return env
                    .new_string("")
                    .map(|value| value.into_raw())
                    .unwrap_or(std::ptr::null_mut());
            }
        };
        let points: Vec<Point> = match serde_json::from_str(&input_str) {
            Ok(points) => points,
            Err(error) => {
                crate::openink_warn!(
                    logging::Subsystem::Synchronization,
                    "JNI",
                    "INVALID_STROKE_JSON",
                    "Rejected malformed stroke payload: {}",
                    error
                );
                Vec::new()
            }
        };
        let smoothed = smooth_stroke(&points);
        let output_str = serde_json::to_string(&smoothed).unwrap_or_default();
        env.new_string(output_str)
            .map(|value| value.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }

    #[unsafe(no_mangle)]
    pub extern "system" fn Java_org_openinkbridge_sdk_CoreBridge_setLogLevel(
        mut env: JNIEnv,
        _class: JClass,
        level_str: JString,
    ) {
        if let Ok(s) = env.get_string(&level_str) {
            let str_val: String = s.into();
            if let Ok(lvl) = logging::LogLevel::from_str(&str_val) {
                logging::set_log_level(lvl);
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "system" fn Java_org_openinkbridge_sdk_CoreBridge_getDiagnosticsJson(
        mut env: JNIEnv,
        _class: JClass,
        backend_name: JString,
    ) -> jstring {
        let backend: String = env
            .get_string(&backend_name)
            .map(|s| s.into())
            .unwrap_or_else(|_| "AndroidJNI".to_string());
        let report = diagnostics::collect_diagnostics(
            backend,
            vec![
                "OnyxBooxEpdAdapter".to_string(),
                "BigmeEpdAdapter".to_string(),
                "JetpackInkAdapter".to_string(),
                "FallbackCanvasAdapter".to_string(),
            ],
            None,
            diagnostics::Capabilities::default(),
            "SPEED".to_string(),
        );
        let json_str = serde_json::to_string(&report).unwrap_or_default();
        env.new_string(json_str)
            .map(|value| value.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }

    #[unsafe(no_mangle)]
    pub extern "system" fn Java_org_openinkbridge_sdk_CoreBridge_getRingBufferLogsJson(
        mut env: JNIEnv,
        _class: JClass,
    ) -> jstring {
        let logs = logging::get_ring_buffer_entries();
        let json_str = serde_json::to_string(&logs).unwrap_or_default();
        env.new_string(json_str)
            .map(|value| value.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }
}
