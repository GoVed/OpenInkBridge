pub mod remarkable;

use crate::models::Point;
use serde::{Deserialize, Serialize};

/// Pen state representing the current physical state of the stylus on the digitizer screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PenState {
    Down,
    Move,
    Up,
    Hover,
}

/// Generic, hardware-agnostic pen event emitted by E-Ink digitizer hardware backends.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PenEvent {
    pub x: f32,
    pub y: f32,
    pub pressure: f32,
    pub tilt_x: Option<f32>,
    pub tilt_y: Option<f32>,
    pub state: PenState,
    pub timestamp: u64,
}

/// Hardware-independent E-Ink refresh request modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefreshMode {
    /// Ultra low-latency direct update mode for live pen stroke previews.
    Fast,
    /// Targeted rectangular region update for committed stroke bounding boxes.
    Partial,
    /// Full screen flash refresh (GC16) to eliminate E-Ink ghosting.
    Full,
    /// Clear screen buffer and trigger full refresh.
    Clear,
}

/// Display transformation helper for converting raw digitizer coordinates to screen pixel coordinates.
#[derive(Debug, Clone, Copy)]
pub struct DisplayTransform {
    pub input_width: f32,
    pub input_height: f32,
    pub display_width: f32,
    pub display_height: f32,
    pub swap_xy: bool,
    pub invert_x: bool,
    pub invert_y: bool,
}

impl DisplayTransform {
    pub fn new(
        input_width: f32,
        input_height: f32,
        display_width: f32,
        display_height: f32,
        swap_xy: bool,
        invert_x: bool,
        invert_y: bool,
    ) -> Self {
        Self {
            input_width,
            input_height,
            display_width,
            display_height,
            swap_xy,
            invert_x,
            invert_y,
        }
    }

    /// Standard reMarkable 1 and 2 Wacom digitizer to E-Ink display coordinate transform.
    /// Wacom digitizer extent: 20967 x 15725. Display resolution: 1404 x 1872.
    pub fn remarkables_default() -> Self {
        Self {
            input_width: 15725.0,
            input_height: 20967.0,
            display_width: 1404.0,
            display_height: 1872.0,
            swap_xy: true,
            invert_x: false,
            invert_y: true,
        }
    }


    /// Maps raw input coordinates (sensor units) to display coordinates (pixel space).
    pub fn transform(&self, raw_x: f32, raw_y: f32) -> (f32, f32) {
        let (x, y) = if self.swap_xy {
            (raw_y, raw_x)
        } else {
            (raw_x, raw_y)
        };

        let norm_x = if self.input_height > 0.0 {
            (x / self.input_height).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let norm_y = if self.input_width > 0.0 {
            (y / self.input_width).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let final_x = if self.invert_x { 1.0 - norm_x } else { norm_x } * self.display_width;
        let final_y = if self.invert_y { 1.0 - norm_y } else { norm_y } * self.display_height;

        (final_x, final_y)
    }

    /// Normalizes raw pressure (typically 0..4095 on Wacom digitizers) into 0.0..1.0 range.
    pub fn normalize_pressure(raw_pressure: i32, max_pressure: f32) -> f32 {
        if max_pressure <= 0.0 {
            return 0.0;
        }
        (raw_pressure as f32 / max_pressure).clamp(0.0, 1.0)
    }
}

/// Unified Electrophoretic Display (EPD) Hardware Backend Trait.
/// Every platform adapter (reMarkable, Android Onyx Boox, Bigme, etc.) implements this interface.
pub trait EpdBackend {
    /// Initialize hardware resources (framebuffer memory mapping, evdev input handles, E-Ink controllers).
    fn initialize(&mut self) -> Result<(), String>;

    /// Release hardware resources cleanly upon application shutdown.
    fn shutdown(&mut self) -> Result<(), String>;

    /// Read pending hardware stylus input events and convert them into OpenInkBridge generic PenEvents.
    fn receive_pen_events(&mut self) -> Vec<PenEvent>;

    /// Render a batch of stroke points directly to the low-latency display layer.
    fn render_strokes(&mut self, points: &[Point], color: u32, width: f32) -> Result<(), String>;

    /// Trigger E-Ink screen refresh with specified refresh mode and optional bounding box region.
    fn request_refresh(&mut self, mode: RefreshMode, rect: Option<(i32, i32, i32, i32)>) -> Result<(), String>;
}
