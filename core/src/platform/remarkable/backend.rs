use crate::logging::Subsystem;
use crate::models::Point;
use crate::platform::remarkable::display::DisplayRenderer;
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use crate::platform::remarkable::input::NonBlockingEvdevReader;
use crate::platform::remarkable::input::{
    DEFAULT_MAX_EVENTS_PER_POLL, InputParser, RawInputEvent, validate_event_limit,
};
use crate::platform::{DisplayTransform, EpdBackend, PenEvent, RefreshMode};
use crate::{openink_debug, openink_info, openink_trace, openink_warn};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RemarkableConfig {
    pub input_device_path: PathBuf,
    pub framebuffer_device_path: PathBuf,
    pub max_input_events_per_poll: usize,
    pub require_hardware: bool,
}

impl Default for RemarkableConfig {
    fn default() -> Self {
        Self {
            input_device_path: PathBuf::from("/dev/input/event0"),
            framebuffer_device_path: PathBuf::from("/dev/fb0"),
            max_input_events_per_poll: DEFAULT_MAX_EVENTS_PER_POLL,
            require_hardware: true,
        }
    }
}

impl RemarkableConfig {
    pub fn with_input_device_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.input_device_path = path.into();
        self
    }

    pub fn with_framebuffer_device_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.framebuffer_device_path = path.into();
        self
    }

    pub fn with_max_input_events_per_poll(mut self, limit: usize) -> Self {
        self.max_input_events_per_poll = limit;
        self
    }

    /// Permit the in-memory renderer and injected events when hardware is not
    /// available. Production on-device applications should keep the default
    /// strict behavior so missing permissions or device paths fail at startup.
    pub fn allow_virtual_fallback(mut self) -> Self {
        self.require_hardware = false;
        self
    }
}

pub struct RemarkableBackend {
    pub parser: InputParser,
    pub renderer: DisplayRenderer,
    config: RemarkableConfig,
    #[cfg(all(feature = "remarkable", target_os = "linux"))]
    input_reader: Option<NonBlockingEvdevReader>,
    event_buffer: Vec<RawInputEvent>,
    is_initialized: bool,
}

impl RemarkableBackend {
    pub fn new(input_device_path: impl Into<PathBuf>, transform: DisplayTransform) -> Self {
        let config = RemarkableConfig::default().with_input_device_path(input_device_path);
        Self::with_config(config, transform)
    }

    pub fn with_config(config: RemarkableConfig, transform: DisplayTransform) -> Self {
        let display_width = transform.display_width as i32;
        let display_height = transform.display_height as i32;
        let renderer = DisplayRenderer::with_framebuffer_path(
            display_width,
            display_height,
            config.framebuffer_device_path.clone(),
            config.require_hardware,
        );
        Self {
            parser: InputParser::new(transform, 4095.0),
            renderer,
            config,
            #[cfg(all(feature = "remarkable", target_os = "linux"))]
            input_reader: None,
            event_buffer: Vec::with_capacity(DEFAULT_MAX_EVENTS_PER_POLL),
            is_initialized: false,
        }
    }

    pub fn remarkables_default() -> Self {
        Self::with_config(
            RemarkableConfig::default(),
            DisplayTransform::remarkables_default(),
        )
    }

    /// Feed raw evdev events directly into the backend (used in polling or unit testing).
    pub fn push_raw_event(&mut self, event: RawInputEvent) {
        self.event_buffer.push(event);
    }

    pub fn is_initialized(&self) -> bool {
        self.is_initialized
    }

    /// Poll input while preserving I/O failures for callers that can handle
    /// them. `EpdBackend::receive_pen_events` remains a compatibility wrapper.
    pub fn try_receive_pen_events(&mut self) -> Result<Vec<PenEvent>, String> {
        self.ensure_initialized()?;

        let limit = self.config.max_input_events_per_poll;
        let buffered_count = self.event_buffer.len().min(limit);
        let mut raw_events: Vec<_> = self.event_buffer.drain(..buffered_count).collect();

        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        if let Some(reader) = self.input_reader.as_mut() {
            let remaining = limit - raw_events.len();
            if remaining > 0 {
                let device_events = reader.read_pending(remaining).map_err(|error| {
                    format!(
                        "failed to read evdev device {}: {error}",
                        self.config.input_device_path.display()
                    )
                })?;
                raw_events.extend(device_events);
            }
        }

        let parsed = self.parser.process_events(&raw_events);
        if !parsed.is_empty() {
            openink_trace!(
                Subsystem::PenInput,
                "REMARKABLE",
                "EVENTS_RECEIVED",
                "Parsed {} pen events from {} raw evdev events",
                parsed.len(),
                raw_events.len()
            );
        }
        Ok(parsed)
    }

    fn ensure_initialized(&self) -> Result<(), String> {
        if self.is_initialized {
            Ok(())
        } else {
            Err("RemarkableBackend is not initialized".to_string())
        }
    }
}

impl EpdBackend for RemarkableBackend {
    fn initialize(&mut self) -> Result<(), String> {
        if self.is_initialized {
            return Ok(());
        }

        openink_info!(
            Subsystem::Backend,
            "REMARKABLE",
            "INITIALIZATION",
            "Initializing RemarkableBackend with evdev path: {:?}",
            self.config.input_device_path
        );

        validate_event_limit(self.config.max_input_events_per_poll)?;
        self.renderer.initialize()?;

        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            match NonBlockingEvdevReader::open(
                &self.config.input_device_path,
                self.config.max_input_events_per_poll,
            ) {
                Ok(reader) => {
                    self.input_reader = Some(reader);
                    openink_info!(
                        Subsystem::PenInput,
                        "REMARKABLE",
                        "EVDEV_BOUND",
                        "Opened evdev device in nonblocking mode at {:?}",
                        self.config.input_device_path
                    );
                }
                Err(error) if self.config.require_hardware => {
                    let cleanup_error = self.renderer.shutdown().err();
                    return Err(match cleanup_error {
                        Some(cleanup_error) => format!(
                            "failed to open required evdev device {}: {error}; framebuffer cleanup also failed: {cleanup_error}",
                            self.config.input_device_path.display()
                        ),
                        None => format!(
                            "failed to open required evdev device {}: {error}",
                            self.config.input_device_path.display()
                        ),
                    });
                }
                Err(error) => {
                    openink_warn!(
                        Subsystem::PenInput,
                        "REMARKABLE",
                        "EVDEV_OPEN_FAILED",
                        "Could not open evdev device {:?}: {}; operating in synthetic buffer mode",
                        self.config.input_device_path,
                        error
                    );
                }
            }
        }

        #[cfg(not(all(feature = "remarkable", target_os = "linux")))]
        if !self.config.require_hardware {
            openink_warn!(
                Subsystem::PenInput,
                "REMARKABLE",
                "EVDEV_UNAVAILABLE",
                "Linux evdev support is unavailable; operating in synthetic buffer mode"
            );
        }

        self.is_initialized = true;
        openink_info!(
            Subsystem::Backend,
            "REMARKABLE",
            "INIT_COMPLETE",
            "RemarkableBackend hardware initialization complete"
        );
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), String> {
        openink_info!(
            Subsystem::Backend,
            "REMARKABLE",
            "SHUTDOWN",
            "Shutting down RemarkableBackend"
        );
        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            self.input_reader = None;
        }
        self.is_initialized = false;
        self.renderer.shutdown()
    }

    fn receive_pen_events(&mut self) -> Vec<PenEvent> {
        match self.try_receive_pen_events() {
            Ok(events) => events,
            Err(error) => {
                openink_warn!(
                    Subsystem::PenInput,
                    "REMARKABLE",
                    "EVENT_READ_FAILED",
                    "{}",
                    error
                );
                Vec::new()
            }
        }
    }

    fn render_strokes(&mut self, points: &[Point], color: u32, width: f32) -> Result<(), String> {
        self.ensure_initialized()?;
        openink_debug!(
            Subsystem::Renderer,
            "REMARKABLE",
            "RENDER_STROKE",
            "Rendering stroke with {} points, color 0x{:08X}, width {}",
            points.len(),
            color,
            width
        );
        self.renderer.render_stroke_points(points, color, width);
        // Automatically request partial refresh for rendered stroke bounds
        self.request_refresh(RefreshMode::Fast, None)
    }

    fn request_refresh(
        &mut self,
        mode: RefreshMode,
        rect: Option<(i32, i32, i32, i32)>,
    ) -> Result<(), String> {
        self.ensure_initialized()?;
        openink_debug!(
            Subsystem::Refresh,
            "REMARKABLE",
            "REFRESH_REQUESTED",
            "Refresh requested mode: {:?}, rect: {:?}",
            mode,
            rect
        );
        self.renderer.refresh_screen(mode, rect)
    }
}
