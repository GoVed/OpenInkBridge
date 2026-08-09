use crate::models::Point;
use crate::platform::remarkable::backend::{RemarkableBackend, RemarkableConfig};
use crate::platform::remarkable::input::{
    ABS_PRESSURE, ABS_X, ABS_Y, BTN_TOOL_PEN, BTN_TOUCH, EV_ABS, EV_KEY, EV_SYN, EvdevEventDecoder,
    InputParser, RawInputEvent, validate_event_limit,
};
use crate::platform::{DisplayTransform, EpdBackend, PenState, RefreshMode};
use crate::smooth_stroke;

fn encode_evdev_record(timestamp_word_size: usize, event: RawInputEvent) -> Vec<u8> {
    let mut record = Vec::new();
    match timestamp_word_size {
        4 => {
            record.extend_from_slice(&(event.sec as i32).to_ne_bytes());
            record.extend_from_slice(&(event.usec as i32).to_ne_bytes());
        }
        8 => {
            record.extend_from_slice(&(event.sec as i64).to_ne_bytes());
            record.extend_from_slice(&(event.usec as i64).to_ne_bytes());
        }
        _ => panic!("unsupported test timestamp size"),
    }
    record.extend_from_slice(&event.type_.to_ne_bytes());
    record.extend_from_slice(&event.code.to_ne_bytes());
    record.extend_from_slice(&event.value.to_ne_bytes());
    record
}

#[test]
fn test_coordinate_conversion() {
    let transform = DisplayTransform::remarkables_default();

    // Test origin (0, 0) raw digitizer input
    let (x0, y0) = transform.transform(0.0, 0.0);
    assert!((0.0..=1404.0).contains(&x0));
    assert!((0.0..=1872.0).contains(&y0));

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
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_KEY,
            code: BTN_TOUCH,
            value: 1,
        },
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_ABS,
            code: ABS_X,
            value: 5000,
        },
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_ABS,
            code: ABS_Y,
            value: 10000,
        },
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_ABS,
            code: ABS_PRESSURE,
            value: 2048,
        },
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_SYN,
            code: 0,
            value: 0,
        },
        // Pen Move event sequence
        RawInputEvent {
            sec: 1,
            usec: 10,
            type_: EV_ABS,
            code: ABS_X,
            value: 5500,
        },
        RawInputEvent {
            sec: 1,
            usec: 10,
            type_: EV_ABS,
            code: ABS_Y,
            value: 10500,
        },
        RawInputEvent {
            sec: 1,
            usec: 10,
            type_: EV_ABS,
            code: ABS_PRESSURE,
            value: 3000,
        },
        RawInputEvent {
            sec: 1,
            usec: 10,
            type_: EV_SYN,
            code: 0,
            value: 0,
        },
        // Pen Up event sequence
        RawInputEvent {
            sec: 1,
            usec: 20,
            type_: EV_KEY,
            code: BTN_TOUCH,
            value: 0,
        },
        RawInputEvent {
            sec: 1,
            usec: 20,
            type_: EV_SYN,
            code: 0,
            value: 0,
        },
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
    let config = RemarkableConfig::default()
        .with_input_device_path("__openinkbridge_missing_input__")
        .with_framebuffer_device_path("__openinkbridge_missing_framebuffer__")
        .allow_virtual_fallback();
    let mut backend =
        RemarkableBackend::with_config(config, DisplayTransform::remarkables_default());

    assert!(
        backend
            .render_strokes(&[], 0xFF000000, 4.0)
            .unwrap_err()
            .contains("not initialized")
    );
    assert!(backend.initialize().is_ok());
    assert!(backend.is_initialized());

    let stroke_points = vec![
        Point {
            x: 100.0,
            y: 100.0,
            pressure: 0.5,
            tilt: 0.0,
            timestamp: 1000,
        },
        Point {
            x: 200.0,
            y: 200.0,
            pressure: 0.8,
            tilt: 0.0,
            timestamp: 1010,
        },
        Point {
            x: 300.0,
            y: 250.0,
            pressure: 0.4,
            tilt: 0.0,
            timestamp: 1020,
        },
    ];

    let smoothed = smooth_stroke(&stroke_points);
    assert_eq!(smoothed.len(), 3);

    assert!(backend.render_strokes(&smoothed, 0xFF000000, 4.0).is_ok());

    // Verify partial refresh and canvas clear requests
    assert!(
        backend
            .request_refresh(RefreshMode::Partial, Some((100, 100, 300, 250)))
            .is_ok()
    );
    assert!(backend.request_refresh(RefreshMode::Clear, None).is_ok());
    assert!(
        backend
            .request_refresh(RefreshMode::Partial, Some((-10, -10, -1, -1)))
            .is_err()
    );

    assert!(backend.shutdown().is_ok());
    assert!(!backend.is_initialized());
}

#[test]
fn evdev_decoder_handles_32_and_64_bit_kernel_layouts() {
    let expected = RawInputEvent {
        sec: 42,
        usec: 123_456,
        type_: EV_ABS,
        code: ABS_PRESSURE,
        value: -17,
    };

    for timestamp_word_size in [4, 8] {
        let mut decoder = EvdevEventDecoder::for_timestamp_word_size(timestamp_word_size).unwrap();
        let record = encode_evdev_record(timestamp_word_size, expected);
        assert_eq!(record.len(), decoder.record_size());
        decoder.push_bytes(&record);
        assert_eq!(decoder.drain_events(1).unwrap(), vec![expected]);
        assert_eq!(decoder.pending_len(), 0);
    }
}

#[test]
fn evdev_decoder_preserves_partial_records_and_bounds_batches() {
    let first = RawInputEvent {
        sec: 1,
        usec: 2,
        type_: EV_ABS,
        code: ABS_X,
        value: 100,
    };
    let second = RawInputEvent {
        sec: 3,
        usec: 4,
        type_: EV_ABS,
        code: ABS_Y,
        value: 200,
    };
    let mut decoder = EvdevEventDecoder::for_timestamp_word_size(4).unwrap();
    let first_record = encode_evdev_record(4, first);
    let second_record = encode_evdev_record(4, second);

    decoder.push_bytes(&first_record[..7]);
    assert!(decoder.drain_events(8).unwrap().is_empty());
    assert_eq!(decoder.pending_len(), 7);

    decoder.push_bytes(&first_record[7..]);
    decoder.push_bytes(&second_record);
    assert_eq!(decoder.drain_events(1).unwrap(), vec![first]);
    assert_eq!(decoder.pending_len(), second_record.len());
    assert_eq!(decoder.drain_events(1).unwrap(), vec![second]);
    assert_eq!(decoder.pending_len(), 0);
}

#[test]
fn event_poll_limit_is_validated() {
    assert!(validate_event_limit(1).is_ok());
    assert!(validate_event_limit(4096).is_ok());
    assert!(validate_event_limit(0).is_err());
    assert!(validate_event_limit(4097).is_err());
}

#[test]
fn tool_proximity_is_hover_not_pen_down() {
    let mut parser = InputParser::remarkables_default();
    let events = [
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_KEY,
            code: BTN_TOOL_PEN,
            value: 1,
        },
        RawInputEvent {
            sec: 1,
            usec: 0,
            type_: EV_SYN,
            code: 0,
            value: 0,
        },
    ];

    let parsed = parser.process_events(&events);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].state, PenState::Hover);
}

#[test]
fn required_hardware_failure_is_reported_during_initialization() {
    let config = RemarkableConfig::default()
        .with_input_device_path("__openinkbridge_missing_input__")
        .with_framebuffer_device_path("__openinkbridge_missing_framebuffer__");
    let mut backend =
        RemarkableBackend::with_config(config, DisplayTransform::remarkables_default());

    let error = backend.initialize().unwrap_err();
    assert!(error.contains("framebuffer") || error.contains("hardware framebuffer support"));
    assert!(!backend.is_initialized());
}
