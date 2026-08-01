pub mod backend;
pub mod display;
pub mod input;

#[cfg(test)]
pub mod tests;

pub use backend::{RemarkableBackend, RemarkableConfig};
pub use display::DisplayRenderer;
pub use input::InputParser;
