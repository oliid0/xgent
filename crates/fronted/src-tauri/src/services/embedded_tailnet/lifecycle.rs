//! Registration outcomes from the pinned engine's device_state/control_runner.
//! NetworkUnreachable and Timeout require a fresh runtime: that actor stopped.
//! Auth rejection, expiry and interactive login require explicit user action.
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Exit { Retry, UserAction }

pub(super) fn exit(state: &tailscale::DeviceState) -> Option<Exit> {
    use tailscale::{DeviceState, RegistrationError};
    match state {
        DeviceState::Failed(RegistrationError::NetworkUnreachable | RegistrationError::Timeout) => Some(Exit::Retry),
        DeviceState::Failed(_) | DeviceState::Expired | DeviceState::NeedsLogin(_) => Some(Exit::UserAction),
        _ => None,
    }
}

#[derive(Default)]
pub(super) struct Backoff { attempt: u32 }

impl Backoff {
    pub(super) fn next(&mut self) -> Duration {
        let seconds = (2u64 << self.attempt.min(5)).min(60);
        self.attempt = self.attempt.saturating_add(1);
        Duration::from_secs(seconds)
    }

    pub(super) fn reset(&mut self) { self.attempt = 0; }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tailscale::{DeviceState, RegistrationError};

    #[test]
    fn only_network_registration_failures_restart_the_original_node() {
        assert!(exit(&DeviceState::Failed(RegistrationError::NetworkUnreachable)) == Some(Exit::Retry));
        assert!(exit(&DeviceState::Failed(RegistrationError::Timeout)) == Some(Exit::Retry));
        for state in [DeviceState::Expired, DeviceState::Failed(RegistrationError::KeyExpired),
            DeviceState::Failed(RegistrationError::AuthRejected("rejected".into()))] {
            assert!(exit(&state) == Some(Exit::UserAction));
        }
        for state in [DeviceState::Connecting, DeviceState::Running, DeviceState::Reauthenticating, DeviceState::NeedsMachineAuth] {
            assert!(exit(&state).is_none());
        }
    }

    #[test]
    fn failed_start_backoff_is_bounded_and_success_resets_it() {
        let mut backoff = Backoff::default();
        let delays: Vec<_> = (0..10).map(|_| backoff.next().as_secs()).collect();
        assert_eq!(delays, [2, 4, 8, 16, 32, 60, 60, 60, 60, 60]);
        backoff.reset();
        assert_eq!(backoff.next(), Duration::from_secs(2));
    }
}
