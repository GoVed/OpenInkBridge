use crate::logging::{LogEntry, LogLevel, get_ring_buffer_entries};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub pressure: bool,
    pub tilt: bool,
    pub hover: bool,
    pub eraser: bool,
    pub refresh_modes: Vec<String>,
    pub hardware_acceleration: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            pressure: true,
            tilt: true,
            hover: true,
            eraser: true,
            refresh_modes: vec![
                "Fast".to_string(),
                "Partial".to_string(),
                "Full".to_string(),
                "Clear".to_string(),
            ],
            hardware_acceleration: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub version: String,
    pub platform: String,
    pub os: String,
    pub device_model: String,
    pub selected_backend: String,
    pub available_backends: Vec<String>,
    pub fallback_reason: Option<String>,
    pub capabilities: Capabilities,
    pub refresh_mode: String,
    pub build_configuration: String,
    pub feature_flags: Vec<String>,
    pub recent_logs: Vec<LogEntry>,
}

pub fn detect_platform() -> &'static str {
    if cfg!(target_arch = "wasm32") {
        "WASM / Web Browser"
    } else if cfg!(target_os = "android") {
        "Android"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unknown Platform"
    }
}

pub fn detect_feature_flags() -> Vec<String> {
    let mut flags = Vec::new();
    if cfg!(feature = "wasm") {
        flags.push("wasm".to_string());
    }
    if cfg!(feature = "android") {
        flags.push("android".to_string());
    }
    if cfg!(feature = "remarkable") {
        flags.push("remarkable".to_string());
    }
    flags
}

pub fn collect_diagnostics(
    selected_backend: String,
    available_backends: Vec<String>,
    fallback_reason: Option<String>,
    capabilities: Capabilities,
    refresh_mode: String,
) -> DiagnosticsReport {
    let build_config = if cfg!(debug_assertions) {
        "Debug"
    } else {
        "Release"
    };

    DiagnosticsReport {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: detect_platform().to_string(),
        os: std::env::consts::OS.to_string(),
        device_model: std::env::var("OPENINKBRIDGE_DEVICE")
            .unwrap_or_else(|_| "Generic Device".to_string()),
        selected_backend,
        available_backends,
        fallback_reason,
        capabilities,
        refresh_mode,
        build_configuration: build_config.to_string(),
        feature_flags: detect_feature_flags(),
        recent_logs: get_ring_buffer_entries(),
    }
}

pub fn dump_configuration(report: &DiagnosticsReport) -> String {
    let mut out = String::new();
    out.push_str("========== OpenInkBridge Diagnostics ==========\n");
    out.push_str(&format!("Version: {}\n", report.version));
    out.push_str(&format!("Platform: {}\n", report.platform));
    out.push_str(&format!("OS: {}\n", report.os));
    out.push_str(&format!("Device Model: {}\n", report.device_model));
    out.push_str(&format!("Selected Backend: {}\n", report.selected_backend));
    out.push_str(&format!(
        "Available Backends: {}\n",
        report.available_backends.join(", ")
    ));

    if let Some(ref reason) = report.fallback_reason {
        out.push_str(&format!("Fallback Reason: {}\n", reason));
    }

    out.push_str("Capabilities:\n");
    out.push_str(&format!(
        "  - Pressure: {}\n",
        if report.capabilities.pressure {
            "Supported"
        } else {
            "Unsupported"
        }
    ));
    out.push_str(&format!(
        "  - Tilt: {}\n",
        if report.capabilities.tilt {
            "Supported"
        } else {
            "Unsupported"
        }
    ));
    out.push_str(&format!(
        "  - Hover: {}\n",
        if report.capabilities.hover {
            "Supported"
        } else {
            "Unsupported"
        }
    ));
    out.push_str(&format!(
        "  - Eraser: {}\n",
        if report.capabilities.eraser {
            "Supported"
        } else {
            "Unsupported"
        }
    ));
    out.push_str(&format!(
        "  - Refresh Modes: [{}]\n",
        report.capabilities.refresh_modes.join(", ")
    ));
    out.push_str(&format!(
        "  - Hardware Acceleration: {}\n",
        if report.capabilities.hardware_acceleration {
            "Enabled"
        } else {
            "Disabled"
        }
    ));

    out.push_str(&format!("Refresh Mode: {}\n", report.refresh_mode));
    out.push_str(&format!(
        "Build Configuration: {}\n",
        report.build_configuration
    ));
    out.push_str(&format!(
        "Feature Flags: [{}]\n",
        report.feature_flags.join(", ")
    ));
    out.push_str("===============================================\n");
    out
}

pub fn create_bug_report(report: &DiagnosticsReport) -> String {
    let mut out = dump_configuration(report);
    out.push_str("\n========== Recent Warnings / Errors ==========\n");
    let filtered_logs: Vec<&LogEntry> = report
        .recent_logs
        .iter()
        .filter(|e| e.level == LogLevel::Warn || e.level == LogLevel::Error)
        .collect();

    if filtered_logs.is_empty() {
        out.push_str("No warnings or errors reported in recent log buffer.\n");
    } else {
        for log in filtered_logs {
            out.push_str(&format!("{}\n", log.format_line()));
        }
    }
    out.push_str("===============================================\n");
    out
}
