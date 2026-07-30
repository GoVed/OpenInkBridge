use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Debug => "DEBUG",
            LogLevel::Trace => "TRACE",
        }
    }
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for LogLevel {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "ERROR" => Ok(LogLevel::Error),
            "WARN" | "WARNING" => Ok(LogLevel::Warn),
            "INFO" => Ok(LogLevel::Info),
            "DEBUG" => Ok(LogLevel::Debug),
            "TRACE" => Ok(LogLevel::Trace),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Subsystem {
    Core,
    Backend,
    Renderer,
    PenInput,
    Refresh,
    Synchronization,
    JsBridge,
    Android,
    Linux,
    Performance,
    Configuration,
    Networking,
}

impl Subsystem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Subsystem::Core => "Core",
            Subsystem::Backend => "Backend",
            Subsystem::Renderer => "Renderer",
            Subsystem::PenInput => "PenInput",
            Subsystem::Refresh => "Refresh",
            Subsystem::Synchronization => "Synchronization",
            Subsystem::JsBridge => "JsBridge",
            Subsystem::Android => "Android",
            Subsystem::Linux => "Linux",
            Subsystem::Performance => "Performance",
            Subsystem::Configuration => "Configuration",
            Subsystem::Networking => "Networking",
        }
    }
}

impl fmt::Display for Subsystem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: LogLevel,
    pub subsystem: Subsystem,
    pub backend: String,
    pub event: String,
    pub message: String,
}

impl LogEntry {
    pub fn format_line(&self) -> String {
        format!(
            "[{level}][{subsystem}][{backend}] {event}: {message}",
            level = self.level.as_str(),
            subsystem = self.subsystem.as_str(),
            backend = if self.backend.is_empty() { "System" } else { &self.backend },
            event = self.event,
            message = self.message
        )
    }
}

/// Thread-safe in-memory circular log buffer.
pub struct RingBuffer {
    capacity: usize,
    buffer: Vec<LogEntry>,
    head: usize,
    full: bool,
}

impl RingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            buffer: Vec::with_capacity(capacity),
            head: 0,
            full: false,
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.capacity == 0 {
            return;
        }
        if self.buffer.len() < self.capacity {
            self.buffer.push(entry);
        } else {
            self.buffer[self.head] = entry;
            self.head = (self.head + 1) % self.capacity;
            self.full = true;
        }
    }

    pub fn get_entries(&self) -> Vec<LogEntry> {
        if !self.full {
            self.buffer.clone()
        } else {
            let mut entries = Vec::with_capacity(self.capacity);
            entries.extend_from_slice(&self.buffer[self.head..]);
            entries.extend_from_slice(&self.buffer[..self.head]);
            entries
        }
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
        self.head = 0;
        self.full = false;
    }
}

static GLOBAL_LOG_LEVEL: AtomicU8 = AtomicU8::new(LogLevel::Info as u8);
static LAST_TRACE_TIMESTAMP: AtomicU64 = AtomicU64::new(0);

lazy_static_ring_buffer!();

macro_rules! lazy_static_ring_buffer {
    () => {
        static RING_BUFFER: std::sync::OnceLock<Mutex<RingBuffer>> = std::sync::OnceLock::new();

        fn get_ring_buffer() -> &'static Mutex<RingBuffer> {
            RING_BUFFER.get_or_init(|| Mutex::new(RingBuffer::new(500)))
        }
    };
}

use lazy_static_ring_buffer;

pub fn set_log_level(level: LogLevel) {
    GLOBAL_LOG_LEVEL.store(level as u8, Ordering::SeqCst);
}

pub fn get_log_level() -> LogLevel {
    match GLOBAL_LOG_LEVEL.load(Ordering::SeqCst) {
        0 => LogLevel::Error,
        1 => LogLevel::Warn,
        2 => LogLevel::Info,
        3 => LogLevel::Debug,
        4 => LogLevel::Trace,
        _ => LogLevel::Info,
    }
}

fn current_timestamp_ms() -> u64 {
    #[cfg(feature = "wasm")]
    {
        // On WASM, attempt SystemTime or fallback safely
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
    #[cfg(not(feature = "wasm"))]
    {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

/// Rate limits high-frequency TRACE events to avoid log flooding.
/// Returns true if the event should be logged.
pub fn should_log_trace(min_interval_ms: u64) -> bool {
    let now = current_timestamp_ms();
    let last = LAST_TRACE_TIMESTAMP.load(Ordering::Relaxed);
    if now >= last + min_interval_ms {
        LAST_TRACE_TIMESTAMP.store(now, Ordering::Relaxed);
        true
    } else {
        false
    }
}

pub fn log(level: LogLevel, subsystem: Subsystem, backend: &str, event: &str, message: &str) {
    let entry = LogEntry {
        timestamp: current_timestamp_ms(),
        level,
        subsystem,
        backend: backend.to_string(),
        event: event.to_string(),
        message: message.to_string(),
    };

    // Always push to in-memory RingBuffer for diagnostic collection
    if let Ok(mut rb) = get_ring_buffer().lock() {
        rb.push(entry.clone());
    }

    // Console output if level meets active threshold
    let active_level = get_log_level();
    if level <= active_level {
        let formatted = entry.format_line();
        if level == LogLevel::Error || level == LogLevel::Warn {
            eprintln!("{}", formatted);
        } else {
            println!("{}", formatted);
        }
    }
}

pub fn get_ring_buffer_entries() -> Vec<LogEntry> {
    if let Ok(rb) = get_ring_buffer().lock() {
        rb.get_entries()
    } else {
        Vec::new()
    }
}

pub fn clear_ring_buffer() {
    if let Ok(mut rb) = get_ring_buffer().lock() {
        rb.clear();
    }
}

#[macro_export]
macro_rules! openink_log {
    ($level:expr, $subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($level, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! openink_error {
    ($subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::LogLevel::Error, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! openink_warn {
    ($subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::LogLevel::Warn, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! openink_info {
    ($subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::LogLevel::Info, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! openink_debug {
    ($subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::LogLevel::Debug, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! openink_trace {
    ($subsystem:expr, $backend:expr, $event:expr, $($arg:tt)*) => {
        $crate::logging::log($crate::logging::LogLevel::Trace, $subsystem, $backend, $event, &format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_parsing_and_ordering() {
        assert_eq!("ERROR".parse::<LogLevel>(), Ok(LogLevel::Error));
        assert_eq!("WARN".parse::<LogLevel>(), Ok(LogLevel::Warn));
        assert_eq!("INFO".parse::<LogLevel>(), Ok(LogLevel::Info));
        assert_eq!("DEBUG".parse::<LogLevel>(), Ok(LogLevel::Debug));
        assert_eq!("TRACE".parse::<LogLevel>(), Ok(LogLevel::Trace));
        assert!(LogLevel::Error < LogLevel::Warn);
        assert!(LogLevel::Warn < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Debug);
        assert!(LogLevel::Debug < LogLevel::Trace);
    }

    #[test]
    fn test_ring_buffer_capacity_and_rotation() {
        let mut rb = RingBuffer::new(3);
        rb.push(LogEntry {
            timestamp: 100,
            level: LogLevel::Info,
            subsystem: Subsystem::Core,
            backend: "BOOX".to_string(),
            event: "E1".to_string(),
            message: "M1".to_string(),
        });
        rb.push(LogEntry {
            timestamp: 101,
            level: LogLevel::Warn,
            subsystem: Subsystem::Backend,
            backend: "BOOX".to_string(),
            event: "E2".to_string(),
            message: "M2".to_string(),
        });
        rb.push(LogEntry {
            timestamp: 102,
            level: LogLevel::Error,
            subsystem: Subsystem::Renderer,
            backend: "BOOX".to_string(),
            event: "E3".to_string(),
            message: "M3".to_string(),
        });

        assert_eq!(rb.get_entries().len(), 3);

        // Push 4th entry, rotating out first
        rb.push(LogEntry {
            timestamp: 103,
            level: LogLevel::Debug,
            subsystem: Subsystem::PenInput,
            backend: "BOOX".to_string(),
            event: "E4".to_string(),
            message: "M4".to_string(),
        });

        let entries = rb.get_entries();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].event, "E2");
        assert_eq!(entries[1].event, "E3");
        assert_eq!(entries[2].event, "E4");
    }

    #[test]
    fn test_global_logging_macro_and_ring_buffer() {
        clear_ring_buffer();
        set_log_level(LogLevel::Debug);

        openink_info!(Subsystem::Core, "TEST", "INIT", "Core test starting");
        openink_warn!(Subsystem::Backend, "TEST", "FALLBACK", "Testing fallback");

        let entries = get_ring_buffer_entries();
        assert!(entries.len() >= 2);
        let has_init = entries.iter().any(|e| e.event == "INIT");
        let has_fallback = entries.iter().any(|e| e.event == "FALLBACK");
        assert!(has_init);
        assert!(has_fallback);
    }
}

