use openinkbridge_core::platform::remarkable::RemarkableConfig;

pub const INPUT_DEVICE_ENV: &str = "OPENINKBRIDGE_INPUT_DEVICE";
pub const FRAMEBUFFER_DEVICE_ENV: &str = "OPENINKBRIDGE_FRAMEBUFFER_DEVICE";
pub const MAX_EVENTS_PER_POLL_ENV: &str = "OPENINKBRIDGE_MAX_EVENTS_PER_POLL";
pub const REQUIRE_HARDWARE_ENV: &str = "OPENINKBRIDGE_REQUIRE_HARDWARE";

/// Build the on-device configuration from optional environment overrides.
/// Defaults remain strict so permission and device-path failures stop startup.
pub fn remarkable_config_from_env() -> Result<RemarkableConfig, String> {
    let mut config = RemarkableConfig::default();

    if let Some(path) = std::env::var_os(INPUT_DEVICE_ENV) {
        config = config.with_input_device_path(path);
    }
    if let Some(path) = std::env::var_os(FRAMEBUFFER_DEVICE_ENV) {
        config = config.with_framebuffer_device_path(path);
    }
    if let Ok(raw_limit) = std::env::var(MAX_EVENTS_PER_POLL_ENV) {
        let limit = raw_limit.parse::<usize>().map_err(|error| {
            format!("invalid {MAX_EVENTS_PER_POLL_ENV} value {raw_limit:?}: {error}")
        })?;
        config = config.with_max_input_events_per_poll(limit);
    }
    if let Ok(raw_required) = std::env::var(REQUIRE_HARDWARE_ENV) {
        match raw_required.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" => {}
            "0" | "false" | "no" => config = config.allow_virtual_fallback(),
            _ => {
                return Err(format!(
                    "invalid {REQUIRE_HARDWARE_ENV} value {raw_required:?}; expected true or false"
                ));
            }
        }
    }

    Ok(config)
}

pub fn backend_io_error(message: String) -> std::io::Error {
    std::io::Error::other(message)
}
