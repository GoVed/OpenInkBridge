use crate::models::Point;
use crate::platform::RefreshMode;
use std::path::{Path, PathBuf};

#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::fs::{File, OpenOptions};
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::io;
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::os::fd::{AsRawFd, RawFd};
#[cfg(all(feature = "remarkable", target_os = "linux"))]
use std::ptr::NonNull;

#[cfg(all(feature = "remarkable", target_os = "linux"))]
struct FramebufferMapping {
    file: File,
    pointer: Option<NonNull<u8>>,
    length: usize,
}

#[cfg(all(feature = "remarkable", target_os = "linux"))]
impl FramebufferMapping {
    fn open(path: &Path, length: usize) -> io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let address = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                file.as_raw_fd(),
                0,
            )
        };

        if address == libc::MAP_FAILED {
            return Err(io::Error::last_os_error());
        }

        let pointer = NonNull::new(address.cast::<u8>()).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "mmap returned a null framebuffer address",
            )
        })?;

        Ok(Self {
            file,
            pointer: Some(pointer),
            length,
        })
    }

    fn as_raw_fd(&self) -> RawFd {
        self.file.as_raw_fd()
    }

    fn copy_from_slice(&mut self, offset: usize, bytes: &[u8]) {
        let Some(pointer) = self.pointer else {
            return;
        };
        let Some(end) = offset.checked_add(bytes.len()) else {
            return;
        };
        if end > self.length {
            return;
        }

        unsafe {
            std::ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                pointer.as_ptr().add(offset),
                bytes.len(),
            );
        }
    }

    fn fill(&mut self, value: u8) {
        if let Some(pointer) = self.pointer {
            unsafe {
                std::ptr::write_bytes(pointer.as_ptr(), value, self.length);
            }
        }
    }

    fn unmap(&mut self) -> io::Result<()> {
        let Some(pointer) = self.pointer.take() else {
            return Ok(());
        };

        let result = unsafe { libc::munmap(pointer.as_ptr().cast(), self.length) };
        if result == 0 {
            Ok(())
        } else {
            self.pointer = Some(pointer);
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(all(feature = "remarkable", target_os = "linux"))]
impl Drop for FramebufferMapping {
    fn drop(&mut self) {
        let _ = self.unmap();
    }
}

pub struct DisplayRenderer {
    pub width: i32,
    pub height: i32,
    pub bytes_per_pixel: usize,
    buffer: Vec<u8>,
    framebuffer_path: PathBuf,
    require_framebuffer: bool,
    #[cfg(all(feature = "remarkable", target_os = "linux"))]
    framebuffer: Option<FramebufferMapping>,
    active_bounding_box: Option<(i32, i32, i32, i32)>,
    next_update_marker: u32,
}

impl DisplayRenderer {
    pub fn new(width: i32, height: i32) -> Self {
        Self::with_framebuffer_path(width, height, "/dev/fb0", false)
    }

    pub fn with_framebuffer_path(
        width: i32,
        height: i32,
        framebuffer_path: impl Into<PathBuf>,
        require_framebuffer: bool,
    ) -> Self {
        let bytes_per_pixel = 4; // 32-bit RGBA default
        let buffer_size = usize::try_from(width)
            .ok()
            .and_then(|width| {
                usize::try_from(height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .and_then(|pixels| pixels.checked_mul(bytes_per_pixel))
            .unwrap_or(0);
        Self {
            width,
            height,
            bytes_per_pixel,
            buffer: vec![255; buffer_size], // White canvas by default
            framebuffer_path: framebuffer_path.into(),
            require_framebuffer,
            #[cfg(all(feature = "remarkable", target_os = "linux"))]
            framebuffer: None,
            active_bounding_box: None,
            next_update_marker: 1,
        }
    }

    pub fn remarkables_default() -> Self {
        Self::new(1404, 1872)
    }

    /// Initialize the display renderer and attempt framebuffer memory mapping.
    pub fn initialize(&mut self) -> Result<(), String> {
        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            if self.framebuffer.is_some() {
                return Ok(());
            }

            match FramebufferMapping::open(&self.framebuffer_path, self.buffer.len()) {
                Ok(framebuffer) => {
                    self.framebuffer = Some(framebuffer);
                    Ok(())
                }
                Err(error) if self.require_framebuffer => Err(format!(
                    "failed to initialize framebuffer {}: {error}",
                    self.framebuffer_path.display()
                )),
                Err(_) => Ok(()),
            }
        }

        #[cfg(not(all(feature = "remarkable", target_os = "linux")))]
        {
            if self.require_framebuffer {
                return Err(
                    "hardware framebuffer support requires Linux and the `remarkable` feature"
                        .to_string(),
                );
            }
            Ok(())
        }
    }

    /// Release framebuffer memory mapping.
    pub fn shutdown(&mut self) -> Result<(), String> {
        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            if let Some(mut framebuffer) = self.framebuffer.take() {
                framebuffer.unmap().map_err(|error| {
                    format!(
                        "failed to unmap framebuffer {}: {error}",
                        self.framebuffer_path.display()
                    )
                })?;
            }
        }
        Ok(())
    }

    /// Set pixel color at (x, y) on both internal buffer and mapped framebuffer.
    pub fn draw_pixel(&mut self, x: i32, y: i32, color: u32) {
        if x < 0 || x >= self.width || y < 0 || y >= self.height {
            return;
        }

        let offset = ((y * self.width + x) as usize) * self.bytes_per_pixel;
        if offset + 3 < self.buffer.len() {
            let r = ((color >> 16) & 0xFF) as u8;
            let g = ((color >> 8) & 0xFF) as u8;
            let b = (color & 0xFF) as u8;
            let a = ((color >> 24) & 0xFF) as u8;

            self.buffer[offset] = r;
            self.buffer[offset + 1] = g;
            self.buffer[offset + 2] = b;
            self.buffer[offset + 3] = if a == 0 { 255 } else { a };

            #[cfg(all(feature = "remarkable", target_os = "linux"))]
            if let Some(framebuffer) = self.framebuffer.as_mut() {
                framebuffer.copy_from_slice(offset, &self.buffer[offset..offset + 4]);
            }

            self.update_bounding_box(x, y);
        }
    }

    /// Draw a line segment with variable width and color between two points.
    pub fn draw_line_segment(
        &mut self,
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        stroke_width: f32,
        color: u32,
    ) {
        let radius = (stroke_width / 2.0).round() as i32;
        if radius <= 1 {
            self.bresenham_line(x0, y0, x1, y1, color);
            return;
        }

        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;

        let mut x = x0;
        let mut y = y0;

        loop {
            self.draw_circle_filled(x, y, radius, color);
            if x == x1 && y == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                err += dx;
                y += sy;
            }
        }
    }

    fn draw_circle_filled(&mut self, cx: i32, cy: i32, radius: i32, color: u32) {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx * dx + dy * dy <= radius * radius {
                    self.draw_pixel(cx + dx, cy + dy, color);
                }
            }
        }
    }

    fn bresenham_line(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, color: u32) {
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;

        let mut x = x0;
        let mut y = y0;

        loop {
            self.draw_pixel(x, y, color);
            if x == x1 && y == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x += sx;
            }
            if e2 <= dx {
                err += dx;
                y += sy;
            }
        }
    }

    /// Render a batch of stroke points directly to the framebuffer with pressure scaling.
    pub fn render_stroke_points(&mut self, points: &[Point], color: u32, base_width: f32) {
        if points.len() < 2 {
            if let Some(p) = points.first() {
                let width = (base_width * p.pressure.max(0.2)).max(1.0);
                self.draw_circle_filled(p.x as i32, p.y as i32, (width / 2.0) as i32, color);
            }
            return;
        }

        for i in 0..points.len() - 1 {
            let p0 = &points[i];
            let p1 = &points[i + 1];
            let avg_pressure = (p0.pressure + p1.pressure) / 2.0;
            let stroke_width = (base_width * avg_pressure.max(0.15)).max(1.0);

            self.draw_line_segment(
                p0.x as i32,
                p0.y as i32,
                p1.x as i32,
                p1.y as i32,
                stroke_width,
                color,
            );
        }
    }

    /// Track affected screen region for partial E-Ink updates.
    fn update_bounding_box(&mut self, x: i32, y: i32) {
        match self.active_bounding_box {
            Some((min_x, min_y, max_x, max_y)) => {
                self.active_bounding_box =
                    Some((min_x.min(x), min_y.min(y), max_x.max(x), max_y.max(y)));
            }
            None => {
                self.active_bounding_box = Some((x, y, x, y));
            }
        }
    }

    /// Take and clear the current partial update bounding box.
    pub fn take_bounding_box(&mut self) -> Option<(i32, i32, i32, i32)> {
        self.active_bounding_box.take()
    }

    /// Trigger screen refresh via libremarkable or EPD controller interfaces.
    pub fn refresh_screen(
        &mut self,
        mode: RefreshMode,
        rect: Option<(i32, i32, i32, i32)>,
    ) -> Result<(), String> {
        let refresh_region = self.normalize_refresh_region(rect.or(self.active_bounding_box))?;

        if mode == RefreshMode::Clear {
            self.buffer.fill(255);
            #[cfg(all(feature = "remarkable", target_os = "linux"))]
            if let Some(framebuffer) = self.framebuffer.as_mut() {
                framebuffer.fill(0xFF);
            }
        }

        if let Err(error) = self.refresh_hardware(mode, refresh_region) {
            // Preserve dirty state so a later refresh can retry after a
            // transient ioctl failure.
            if mode == RefreshMode::Clear {
                self.active_bounding_box = Some((0, 0, self.width - 1, self.height - 1));
            }
            return Err(error);
        }

        if rect.is_none() || mode == RefreshMode::Clear {
            self.active_bounding_box = None;
        }
        Ok(())
    }

    fn normalize_refresh_region(
        &self,
        rect: Option<(i32, i32, i32, i32)>,
    ) -> Result<(i32, i32, i32, i32), String> {
        if self.width <= 0 || self.height <= 0 {
            return Err(format!(
                "invalid display dimensions: {}x{}",
                self.width, self.height
            ));
        }

        let Some((min_x, min_y, max_x, max_y)) = rect else {
            return Ok((0, 0, self.width - 1, self.height - 1));
        };

        if min_x > max_x || min_y > max_y {
            return Err(format!(
                "invalid refresh rectangle: ({min_x}, {min_y}, {max_x}, {max_y})"
            ));
        }
        if max_x < 0 || max_y < 0 || min_x >= self.width || min_y >= self.height {
            return Err(format!(
                "refresh rectangle is outside the display: ({min_x}, {min_y}, {max_x}, {max_y})"
            ));
        }

        let clipped = (
            min_x.clamp(0, self.width - 1),
            min_y.clamp(0, self.height - 1),
            max_x.clamp(0, self.width - 1),
            max_y.clamp(0, self.height - 1),
        );

        Ok(clipped)
    }

    #[cfg(all(feature = "remarkable", target_os = "linux"))]
    fn refresh_hardware(
        &mut self,
        mode: RefreshMode,
        (min_x, min_y, max_x, max_y): (i32, i32, i32, i32),
    ) -> Result<(), String> {
        use libremarkable::framebuffer::common::{
            MXCFB_SEND_UPDATE, display_temp, dither_mode, mxcfb_rect, update_mode, waveform_mode,
        };
        use libremarkable::framebuffer::mxcfb::mxcfb_update_data;

        let Some(framebuffer) = self.framebuffer.as_ref() else {
            if self.require_framebuffer {
                return Err(format!(
                    "framebuffer {} is not initialized",
                    self.framebuffer_path.display()
                ));
            }
            return Ok(());
        };

        let waveform = match mode {
            RefreshMode::Fast | RefreshMode::Partial => waveform_mode::WAVEFORM_MODE_DU,
            RefreshMode::Full | RefreshMode::Clear => waveform_mode::WAVEFORM_MODE_GC16,
        };
        let update_mode = match mode {
            RefreshMode::Fast | RefreshMode::Partial => update_mode::UPDATE_MODE_PARTIAL,
            RefreshMode::Full | RefreshMode::Clear => update_mode::UPDATE_MODE_FULL,
        };
        let marker = self.next_update_marker.max(1);
        self.next_update_marker = marker.wrapping_add(1).max(1);

        let update = mxcfb_update_data {
            update_region: mxcfb_rect {
                top: min_y as u32,
                left: min_x as u32,
                width: (max_x - min_x + 1) as u32,
                height: (max_y - min_y + 1) as u32,
            },
            waveform_mode: waveform as u32,
            update_mode: update_mode as u32,
            update_marker: marker,
            temp: display_temp::TEMP_USE_REMARKABLE_DRAW as i32,
            dither_mode: dither_mode::EPDC_FLAG_USE_DITHERING_PASSTHROUGH as i32,
            ..Default::default()
        };

        let result = unsafe {
            libc::ioctl(
                framebuffer.as_raw_fd(),
                MXCFB_SEND_UPDATE,
                &update as *const mxcfb_update_data,
            )
        };
        if result < 0 {
            return Err(format!(
                "framebuffer refresh ioctl failed for {}: {}",
                self.framebuffer_path.display(),
                io::Error::last_os_error()
            ));
        }

        Ok(())
    }

    #[cfg(not(all(feature = "remarkable", target_os = "linux")))]
    fn refresh_hardware(
        &mut self,
        _mode: RefreshMode,
        _rect: (i32, i32, i32, i32),
    ) -> Result<(), String> {
        if self.require_framebuffer {
            Err(
                "hardware framebuffer support requires Linux and the `remarkable` feature"
                    .to_string(),
            )
        } else {
            Ok(())
        }
    }

    /// Retrieve copy of the current pixel buffer.
    pub fn get_buffer(&self) -> &[u8] {
        &self.buffer
    }
}
