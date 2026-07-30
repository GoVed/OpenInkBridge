use crate::models::Point;
use crate::platform::remarkable::backend::RemarkableBackend;
use crate::platform::remarkable::input::{
    InputParser, RawInputEvent, ABS_PRESSURE, ABS_X, ABS_Y, BTN_TOOL_PEN, EV_ABS, EV_KEY, EV_SYN,
};
use crate::platform::{DisplayTransform, EpdBackend, PenState, RefreshMode};
use crate::smooth_stroke;

#[test]
fn test_coordinate_conversion() {
    let transform = DisplayTransform::remarkables_default();

    // Test origin (0, 0) raw digitizer input
    let (x0, y0) = transform.transform(0.0, 0.0);
    assert!(x0 >= 0.0 && x0 <= 1404.0);
    assert!(y0 >= 0.0 && y0 <= 1872.0);

    // Test max extent digitizer input (20967, 15725)
    let (x_max, y_max) = transform.transform(15725.0, 20967.0);
    assert!((x_max - 1404.0).abs() < 1.0);
    assert!((y_max - 0.0).abs() < 1.0);
}

#[test]
fn test_pressure_mapping() {
    let raw_0 = 0;
    let raw_mid = 2047;
    let raw_max = 4095;

    assert_eq!(DisplayTransform::normalize_pressure(raw_0, 4095.0), 0.0);
    assert!((DisplayTransform::normalize_pressure(raw_mid, 4095.0) - 0.5).abs() < 0.01);
    assert_eq!(DisplayTransform::normalize_pressure(raw_max, 4095.0), 1.0);
}

#[test]
fn test_event_translation_and_state_machine() {
    let mut parser = InputParser::remarkables_default();

    let events = vec![
        // Pen Down event sequence
        RawInputEvent { sec: 1, usec: 0, type_: EV_KEY, code: BTN_TOOL_PEN, value: 1 },
        RawInputEvent { sec: 1, usec: 0, type_: EV_ABS, code: ABS_X, value: 5000 },
        RawInputEvent { sec: 1, usec: 0, type_: EV_ABS, code: ABS_Y, value: 10000 },
        RawInputEvent { sec: 1, usec: 0, type_: EV_ABS, code: ABS_PRESSURE, value: 2048 },
        RawInputEvent { sec: 1, usec: 0, type_: EV_SYN, code: 0, value: 0 },

        // Pen Move event sequence
        RawInputEvent { sec: 1, usec: 10, type_: EV_ABS, code: ABS_X, value: 5500 },
        RawInputEvent { sec: 1, usec: 10, type_: EV_ABS, code: ABS_Y, value: 10500 },
        RawInputEvent { sec: 1, usec: 10, type_: EV_ABS, code: ABS_PRESSURE, value: 3000 },
        RawInputEvent { sec: 1, usec: 10, type_: EV_SYN, code: 0, value: 0 },

        // Pen Up event sequence
        RawInputEvent { sec: 1, usec: 20, type_: EV_KEY, code: BTN_TOOL_PEN, value: 0 },
        RawInputEvent { sec: 1, usec: 20, type_: EV_SYN, code: 0, value: 0 },
    ];

    let parsed = parser.process_events(&events);
    assert_eq!(parsed.len(), 3);

    assert_eq!(parsed[0].state, PenState::Down);
    assert!((parsed[0].pressure - 0.5).abs() < 0.05);

    assert_eq!(parsed[1].state, PenState::Move);
    assert!(parsed[1].pressure > parsed[0].pressure);

    assert_eq!(parsed[2].state, PenState::Up);
}

#[test]
fn test_remarkable_backend_rendering_and_refresh() {
    let mut backend = RemarkableBackend::remarkables_default();
    assert!(backend.initialize().is_ok());

    let stroke_points = vec![
        Point { x: 100.0, y: 100.0, pressure: 0.5, tilt: 0.0, timestamp: 1000 },
        Point { x: 200.0, y: 200.0, pressure: 0.8, tilt: 0.0, timestamp: 1010 },
        Point { x: 300.0, y: 250.0, pressure: 0.4, tilt: 0.0, timestamp: 1020 },
    ];

    let smoothed = smooth_stroke(&stroke_points);
    assert_eq!(smoothed.len(), 3);

    assert!(backend.render_strokes(&smoothed, 0xFF000000, 4.0).is_ok());

    // Verify partial refresh and canvas clear requests
    assert!(backend.request_refresh(RefreshMode::Partial, Some((100, 100, 300, 250))).is_ok());
    assert!(backend.request_refresh(RefreshMode::Clear, None).is_ok());

    assert!(backend.shutdown().is_ok());
}
