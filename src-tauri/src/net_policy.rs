//! Which hosts this app is allowed to talk to.
//!
//! One rule, in one place, because two features now depend on it: the agent
//! panel's relay client, which has always refused anything that is not the
//! operator's own tailnet or loopback, and D22's webhook automation, which
//! POSTs a meeting export to a URL the operator typed. A webhook that accepted
//! a wider set of hosts than the relay would be a second, quieter egress policy
//! — and the looser of two policies is the one that decides what leaves the
//! machine. So there is only one.
//!
//! This module knows nothing about signing, pairing, meetings or settings. It
//! answers exactly one question about a host string, which is what makes it
//! testable without a socket and safe to share.

/// Whether `host` is on the operator's own private network.
///
/// Three families are private, and nothing else is:
///
/// * `localhost` and the loopback ranges — this machine talking to itself.
/// * `*.ts.net` — Tailscale's MagicDNS names.
/// * `100.64.0.0/10` and `fd7a:115c:a1e0::/48` — the CGNAT and IPv6 ranges
///   Tailscale allocates. A hostname that merely *resolves* into those ranges
///   is not accepted: this check runs on the string the operator gave us, so
///   that a later DNS answer cannot move the target after it was approved.
///
/// `None`, an empty host, and any public name are all refused. Brackets around
/// an IPv6 literal are stripped first, because a URL carries them and a bare
/// `Ipv6Addr` parse does not accept them.
pub fn is_private_relay_host(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    let host = host.trim_matches(|character| matches!(character, '[' | ']'));
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if host
        .get(host.len().saturating_sub(7)..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".ts.net"))
    {
        return true;
    }
    if let Ok(ipv4) = host.parse::<std::net::Ipv4Addr>() {
        let [first, second, _, _] = ipv4.octets();
        return first == 127 || (first == 100 && (64..=127).contains(&second));
    }
    if let Ok(ipv6) = host.parse::<std::net::Ipv6Addr>() {
        let segments = ipv6.segments();
        return ipv6.is_loopback()
            || (segments[0] == 0xfd7a && segments[1] == 0x115c && segments[2] == 0xa1e0);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::is_private_relay_host;

    #[test]
    fn loopback_and_tailnet_hosts_are_private() {
        assert!(is_private_relay_host(Some("localhost")));
        assert!(is_private_relay_host(Some("LocalHost")));
        assert!(is_private_relay_host(Some("127.0.0.1")));
        assert!(is_private_relay_host(Some("100.99.192.40")));
        assert!(is_private_relay_host(Some(
            "hermes-agent-01.taile1234.ts.net"
        )));
        assert!(is_private_relay_host(Some("[::1]")));
        assert!(is_private_relay_host(Some("fd7a:115c:a1e0::1")));
    }

    #[test]
    fn public_hosts_and_lookalikes_are_not() {
        assert!(!is_private_relay_host(None));
        assert!(!is_private_relay_host(Some("")));
        assert!(!is_private_relay_host(Some("example.com")));
        // Adjacent to the CGNAT block on both sides, and outside it.
        assert!(!is_private_relay_host(Some("100.63.0.1")));
        assert!(!is_private_relay_host(Some("100.128.0.1")));
        // The suffix has to be a label boundary, not a substring.
        assert!(!is_private_relay_host(Some("evil-ts.net")));
        assert!(!is_private_relay_host(Some("ts.net.example.com")));
        assert!(!is_private_relay_host(Some("2606:4700::1111")));
    }
}
