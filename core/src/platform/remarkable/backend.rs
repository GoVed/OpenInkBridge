use crate::models::Point;
use crate::platform::remarkable::display::DisplayRenderer;
use crate::platform::remarkable::input::{InputParser, RawInputEvent};
use crate::platform::{DisplayTransform, EpdBackend, PenEvent, RefreshMode};
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

pub struct RemarkableBackend {
    pub parser: InputParser,
    pub renderer: DisplayRenderer,
    input_device_path: PathBuf,
    input_file: Option<File>,
    event_buffer: Vec<RawInputEvent>,
    is_initialized: bool,
}

impl RemarkableBackend {
    pub fn new(input_device_path: impl Into<PathBuf>, transform: DisplayTransform) -> Self {
        let display_width = transform.display_width as i32;
        let display_height = transform.display_height as i32;
        Self {
            parser: InputParser::new(transform, 4095.0),
            renderer: DisplayRenderer::new(display_width, display_height),
            input_device_path: input_device_path.into(),
            input_file: None,
            event_buffer: Vec::with_capacity(64),
            is_initialized: false,
        }
    }

    pub fn remarkables_default() -> Self {
        Self::new(
            "/dev/input/event0",
            DisplayTransform::remarkables_default(),
        )
    }

    /// Feed raw evdev events directly into the backend (used in polling or unit testing).
    pub fn push_raw_event(&mut self, event: RawInputEvent) {
        self.event_buffer.push(event);
    }
}

impl EpdBackend for RemarkableBackend {
    fn initialize(&mut self) -> Result<(), String> {
        if self.is_initialized {
            return Ok(());
        }

        // Initialize display renderer
        self.renderer.initialize()?;

        // Open input device file if available
        if self.input_device_path.exists() {
            match File::open(&self.input_device_path) {
                Ok(file) => {
                    self.input_file = Some(file);
                }
                Err(err) => {
                    // Log warning but proceed with memory buffer capability
                    eprintln!(
                        "RemarkableBackend: Could not open evdev device {:?}: {}",
                        self.input_device_path, err
                    );
                }
            }
        }

        self.is_initialized = true;
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), String> {
        self.renderer.shutdown()?;
        self.input_file = None;
        self.is_initialized = false;
        Ok(())
    }

    fn receive_pen_events(&mut self) -> Vec<PenEvent> {
        let mut raw_events = std::mem::take(&mut self.event_buffer);

        // Read pending raw events from input device file if available
        if let Some(ref mut file) = self.input_file {
            let mut event_bytes = [0u8; std::mem::size_of::<RawInputEvent>()];
            while let Ok(count) = file.read(&mut event_bytes) {
                if count == event_bytes.len() {
                    let event: RawInputEvent = unsafe { std::mem::transmute(event_bytes) };
                    raw_events.push(event);
                } else {
                    break;
                }
            }
        }

        self.parser.process_events(&raw_events)
    }

    fn render_strokes(&mut self, points: &[Point], color: u32, width: f32) -> Result<(), String> {
        self.renderer.render_stroke_points(points, color, width);
        // Automatically request partial refresh for rendered stroke bounds
        self.request_refresh(RefreshMode::Fast, None)
    }

    fn request_refresh(&mut self, mode: RefreshMode, rect: Option<(i32, i32, i32, i32)>) -> Result<(), String> {
        self.renderer.refresh_screen(mode, rect)
    }
}
