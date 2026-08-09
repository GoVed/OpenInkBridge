use crate::platform::{DisplayTransform, PenEvent, PenState};

#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::fs::{File, OpenOptions};
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::io::{self, Read};
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::path::Path;

/// Platform-independent representation of a decoded Linux evdev event.
///
/// This is deliberately not used as an ABI structure. Linux's `input_event`
/// timestamp fields follow the target's C ABI, so treating them as two `u64`s
/// corrupts records on 32-bit devices such as the reMarkable 1 and 2.
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
pub const BTN_TOOL_PEN: u16 = 0x140; // 320
pub const BTN_TOUCH: u16 = 0x14a; // 330
pub const BTN_TOOL_RUBBER: u16 = 0x14b; // 331 (Eraser)

/// A conservative default that bounds both latency and work performed by one
/// call to `receive_pen_events`.
pub const DEFAULT_MAX_EVENTS_PER_POLL: usize = 128;
pub const MAX_EVENTS_PER_POLL_LIMIT: usize = 4096;

const EVENT_FIELDS_SIZE: usize = std::mem::size_of::<u16>() * 2 + std::mem::size_of::<i32>();

/// Incrementally decodes native-endian Linux `input_event` records.
///
/// Reads from character devices are normally record-aligned, but callers must
/// not rely on that. Keeping incomplete bytes here means a split record is
/// completed on the next poll instead of being discarded.
#[derive(Debug)]
pub(crate) struct EvdevEventDecoder {
    record_size: usize,
    fields_offset: usize,
    timestamp_word_size: usize,
    pending: Vec<u8>,
}

impl EvdevEventDecoder {
    pub(crate) fn for_timestamp_word_size(timestamp_word_size: usize) -> Result<Self, String> {
        if !matches!(timestamp_word_size, 4 | 8) {
            return Err(format!(
                "unsupported evdev timestamp word size: {timestamp_word_size}"
            ));
        }

        let fields_offset = timestamp_word_size * 2;
        Ok(Self {
            record_size: fields_offset + EVENT_FIELDS_SIZE,
            fields_offset,
            timestamp_word_size,
            pending: Vec::new(),
        })
    }

    #[cfg(all(feature = "remarkable", target_os = "linux"))]
    fn native() -> io::Result<Self> {
        let record_size = std::mem::size_of::<libc::input_event>();
        let fields_offset = std::mem::offset_of!(libc::input_event, type_);
        let timestamp_bytes = fields_offset;

        if timestamp_bytes % 2 != 0 || fields_offset + EVENT_FIELDS_SIZE > record_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "unsupported libc::input_event layout: size={record_size}, fields_offset={fields_offset}"
                ),
            ));
        }

        let timestamp_word_size = timestamp_bytes / 2;
        let mut decoder = Self::for_timestamp_word_size(timestamp_word_size)
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidData, message))?;
        decoder.record_size = record_size;
        decoder.fields_offset = fields_offset;
        Ok(decoder)
    }

    pub(crate) fn record_size(&self) -> usize {
        self.record_size
    }

    #[allow(dead_code)]
    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn complete_event_count(&self) -> usize {
        self.pending.len() / self.record_size
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
    }

    pub(crate) fn drain_events(&mut self, limit: usize) -> Result<Vec<RawInputEvent>, String> {
        let event_count = self.complete_event_count().min(limit);
        let consumed_bytes = event_count * self.record_size;
        let mut events = Vec::with_capacity(event_count);

        for record in self.pending[..consumed_bytes].chunks_exact(self.record_size) {
            events.push(self.decode_record(record)?);
        }

        self.pending.drain(..consumed_bytes);
        Ok(events)
    }

    fn decode_record(&self, record: &[u8]) -> Result<RawInputEvent, String> {
        if record.len() != self.record_size {
            return Err(format!(
                "invalid evdev record length: expected {}, received {}",
                self.record_size,
                record.len()
            ));
        }

        let sec = decode_timestamp_word(&record[..self.timestamp_word_size])?;
        let usec =
            decode_timestamp_word(&record[self.timestamp_word_size..self.timestamp_word_size * 2])?;
        let fields = &record[self.fields_offset..self.fields_offset + EVENT_FIELDS_SIZE];

        Ok(RawInputEvent {
            sec,
            usec,
            type_: u16::from_ne_bytes([fields[0], fields[1]]),
            code: u16::from_ne_bytes([fields[2], fields[3]]),
            value: i32::from_ne_bytes([fields[4], fields[5], fields[6], fields[7]]),
        })
    }
}

fn decode_timestamp_word(bytes: &[u8]) -> Result<u64, String> {
    let value = match bytes.len() {
        4 => i32::from_ne_bytes(bytes.try_into().expect("length checked above")) as i64,
        8 => i64::from_ne_bytes(bytes.try_into().expect("length checked above")),
        size => return Err(format!("unsupported evdev timestamp word size: {size}")),
    };

    // Kernel event timestamps should be non-negative. Saturating malformed or
    // pre-epoch values avoids wrapping them into enormous `u64` timestamps.
    Ok(value.max(0) as u64)
}

#[cfg(all(feature = "remarkable", target_os = "linux"))]
pub(crate) struct NonBlockingEvdevReader {
    file: File,
    decoder: EvdevEventDecoder,
    max_events_per_poll: usize,
}

#[cfg(all(feature = "remarkable", target_os = "linux"))]
impl NonBlockingEvdevReader {
    const MAX_READ_CALLS_PER_POLL: usize = 4;
    const READ_BUFFER_SIZE: usize = 4096;

    pub(crate) fn open(path: &Path, max_events_per_poll: usize) -> io::Result<Self> {
        validate_event_limit(max_events_per_poll)
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;

        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open(path)?;

        Ok(Self {
            file,
            decoder: EvdevEventDecoder::native()?,
            max_events_per_poll,
        })
    }

    pub(crate) fn read_pending(&mut self, limit: usize) -> io::Result<Vec<RawInputEvent>> {
        let poll_limit = limit.min(self.max_events_per_poll);
        if poll_limit == 0 {
            return Ok(Vec::new());
        }
        let mut read_buffer = [0_u8; Self::READ_BUFFER_SIZE];

        for _ in 0..Self::MAX_READ_CALLS_PER_POLL {
            let complete = self.decoder.complete_event_count();
            if complete >= poll_limit {
                break;
            }

            let remaining_events = poll_limit - complete;
            let read_len = remaining_events
                .saturating_mul(self.decoder.record_size())
                .clamp(self.decoder.record_size(), read_buffer.len());

            match self.file.read(&mut read_buffer[..read_len]) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "evdev device reached EOF (it may have been disconnected)",
                    ));
                }
                Ok(count) => self.decoder.push_bytes(&read_buffer[..count]),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }

        self.decoder
            .drain_events(poll_limit)
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidData, message))
    }
}

pub(crate) fn validate_event_limit(limit: usize) -> Result<(), String> {
    if !(1..=MAX_EVENTS_PER_POLL_LIMIT).contains(&limit) {
        return Err(format!(
            "max_input_events_per_poll must be between 1 and {MAX_EVENTS_PER_POLL_LIMIT}, got {limit}"
        ));
    }
    Ok(())
}

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
                if event.code == BTN_TOUCH {
                    let new_down = event.value == 1;
                    if self.is_down != new_down {
                        self.is_down = new_down;
                        self.state_changed = true;
                    }
                } else if event.code == BTN_TOOL_PEN || event.code == BTN_TOOL_RUBBER {
                    let hovering = event.value == 1;
                    if self.is_hovering != hovering {
                        self.is_hovering = hovering;
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
                    let pressure =
                        DisplayTransform::normalize_pressure(self.raw_pressure, self.max_pressure);

                    let current_state = if self.is_down {
                        if self.last_emitted_state == Some(PenState::Down)
                            || self.last_emitted_state == Some(PenState::Move)
                        {
                            PenState::Move
                        } else {
                            PenState::Down
                        }
                    } else if self.last_emitted_state == Some(PenState::Down)
                        || self.last_emitted_state == Some(PenState::Move)
                    {
                        PenState::Up
                    } else if self.is_hovering {
                        PenState::Hover
                    } else {
                        return None;
                    };

                    self.last_emitted_state = Some(current_state);
                    self.last_emitted_x = x;
                    self.last_emitted_y = y;

                    let timestamp = event
                        .sec
                        .saturating_mul(1000)
                        .saturating_add(event.usec / 1000);

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
