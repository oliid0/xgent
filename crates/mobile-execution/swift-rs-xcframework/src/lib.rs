//! Compatibility adapter for Tauri's `swift-rs` dependency.
//!
//! `swift-rs-leap` preserves the upstream API and fixes SwiftPM destination
//! selection and framework discovery for iOS XCFramework dependencies. The
//! adapter deliberately contains no platform logic of its own so every
//! transitive `swift-rs` consumer in the workspace uses one implementation.

pub use swift_rs_xcframework_impl::*;
