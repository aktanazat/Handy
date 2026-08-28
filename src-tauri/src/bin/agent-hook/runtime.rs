//! Hook-local clock plus the shared runtime contract.
//!
//! The standalone consumer owns time and admission. The wire module owns the
//! durable file format, path derivation, and atomic persistence primitives.

use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) use super::wire::{HookRequest as Request, RuntimePaths, SessionPaths};

/// The current protocol version also selects the opaque session-path generation.
pub(crate) fn protocol_session_generation() -> u64 {
    u64::from(super::wire::PROTOCOL_GENERATION)
}

/// Wall clock used for expiry decisions. Tests pin it to a fixed instant.
pub(crate) struct Clock(Box<dyn Fn() -> u64 + Send + Sync>);

impl Clock {
    pub(crate) fn system() -> Self {
        Self(Box::new(system_now_ms))
    }

    #[cfg(test)]
    pub(crate) fn fixed(now_ms: u64) -> Self {
        Self(Box::new(move || now_ms))
    }

    pub(crate) fn now_ms(&self) -> u64 {
        (self.0)()
    }
}

/// An unreadable system clock expires everything rather than accepting a stale
/// response whose freshness cannot be established.
fn system_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}
