use crate::platform::{DisplayTransform, PenEvent, PenState};

/// Linux Kernel Input Event structure (evdev representation).
#[repr(C)]
#[derive(Debug, Copy, Clone, PartialEq, Eq, Default)]
pub struct RawInputEvent {
    pub sec: u64,
    pub usec: u64,
    pub type_: u16,
    pub code: u16,
    pub value: i32,
}

/// Evdev Event Types
pub const EV_SYN: u16 = 0x00;
pub const EV_KEY: u16 = 0x01;
pub const EV_ABS: u16 = 0x03;

/// Evdev Absolute Axis Codes
pub const ABS_X: u16 = 0x00;
pub const ABS_Y: u16 = 0x01;
pub const ABS_PRESSURE: u16 = 0x18;
pub const ABS_DISTANCE: u16 = 0x19;
pub const ABS_TILT_X: u16 = 0x1a;
pub const ABS_TILT_Y: u16 = 0x1b;

/// Evdev Button / Key Codes
pub const BTN_TOOL_PEN: u16 = 0x140;   // 320
pub const BTN_TOUCH: u16 = 0x14a;      // 330
pub const BTN_TOOL_RUBBER: u16 = 0x14b; // 331 (Eraser)

/// Parser for reMarkable evdev digitizer sensor event streams.
pub struct InputParser {
    pub transform: DisplayTransform,
    pub max_pressure: f32,
    raw_x: f32,
    raw_y: f32,
    raw_pressure: i32,
    raw_tilt_x: Option<f32>,
    raw_tilt_y: Option<f32>,
    is_down: bool,
    is_hovering: bool,
    state_changed: bool,
    last_emitted_state: Option<PenState>,
    last_emitted_x: f32,
    last_emitted_y: f32,
}

impl InputParser {
    pub fn new(transform: DisplayTransform, max_pressure: f32) -> Self {
        Self {
            transform,
            max_pressure,
            raw_x: 0.0,
            raw_y: 0.0,
            raw_pressure: 0,
            raw_tilt_x: None,
            raw_tilt_y: None,
            is_down: false,
            is_hovering: false,
            state_changed: false,
            last_emitted_state: None,
            last_emitted_x: -1.0,
            last_emitted_y: -1.0,
        }
    }

    pub fn remarkables_default() -> Self {
        Self::new(DisplayTransform::remarkables_default(), 4095.0)
    }

    /// Process a single raw evdev event and produce an optional generic PenEvent on SYN_REPORT.
    pub fn process_event(&mut self, event: &RawInputEvent) -> Option<PenEvent> {
        match event.type_ {
            EV_KEY => {
                if event.code == BTN_TOOL_PEN || event.code == BTN_TOUCH || event.code == BTN_TOOL_RUBBER {
                    let new_down = event.value == 1;
                    if self.is_down != new_down {
                        self.is_down = new_down;
                        self.state_changed = true;
                    }
                }
            }
            EV_ABS => match event.code {
                ABS_X => {
                    self.raw_x = event.value as f32;
                    self.state_changed = true;
                }
                ABS_Y => {
                    self.raw_y = event.value as f32;
                    self.state_changed = true;
                }
                ABS_PRESSURE => {
                    self.raw_pressure = event.value;
                    self.state_changed = true;
                }
                ABS_TILT_X => {
                    self.raw_tilt_x = Some(event.value as f32);
                    self.state_changed = true;
                }
                ABS_TILT_Y => {
                    self.raw_tilt_y = Some(event.value as f32);
                    self.state_changed = true;
                }
                ABS_DISTANCE => {
                    let hovering = event.value > 0;
                    if self.is_hovering != hovering {
                        self.is_hovering = hovering;
                        self.state_changed = true;
                    }
                }
                _ => {}
            },
            EV_SYN => {
                if event.code == 0 && self.state_changed {
                    self.state_changed = false;
                    let (x, y) = self.transform.transform(self.raw_x, self.raw_y);
                    let pressure = DisplayTransform::normalize_pressure(self.raw_pressure, self.max_pressure);

                    let current_state = if self.is_down {
                        if self.last_emitted_state == Some(PenState::Down) || self.last_emitted_state == Some(PenState::Move) {
                            PenState::Move
                        } else {
                            PenState::Down
                        }
                    } else if self.last_emitted_state == Some(PenState::Down) || self.last_emitted_state == Some(PenState::Move) {
                        PenState::Up
                    } else if self.is_hovering {
                        PenState::Hover
                    } else {
                        return None;
                    };

                    self.last_emitted_state = Some(current_state);
                    self.last_emitted_x = x;
                    self.last_emitted_y = y;

                    let timestamp = event.sec * 1000 + event.usec / 1000;

                    return Some(PenEvent {
                        x,
                        y,
                        pressure,
                        tilt_x: self.raw_tilt_x,
                        tilt_y: self.raw_tilt_y,
                        state: current_state,
                        timestamp,
                    });
                }
            }
            _ => {}
        }
        None
    }

    /// Process a batch of raw evdev input events and emit all parsed PenEvents.
    pub fn process_events(&mut self, events: &[RawInputEvent]) -> Vec<PenEvent> {
        let mut pen_events = Vec::with_capacity(events.len());
        for event in events {
            if let Some(pen_event) = self.process_event(event) {
                pen_events.push(pen_event);
            }
        }
        pen_events
    }
}
