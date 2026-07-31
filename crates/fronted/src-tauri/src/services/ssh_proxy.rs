#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshProxyKind {
    Socks5,
    Http,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SshProxyEndpoint {
    pub kind: SshProxyKind,
    pub host: String,
    pub port: u16,
}

/// Resolves the shared SSH proxy address syntax used by desktop sessions and
/// native mobile one-shot SSH commands. The URL may include a scheme and port;
/// an explicit port field takes precedence.
pub(crate) fn resolve_ssh_proxy_endpoint(
    raw_url: &str,
    configured_type: &str,
    configured_port: i64,
) -> Result<SshProxyEndpoint, String> {
    let raw_url = raw_url.trim();
    if raw_url.is_empty() {
        return Err("SSH proxy host is required".to_string());
    }
    let (scheme, authority) = split_proxy_scheme(raw_url);
    let kind = resolve_proxy_kind(configured_type, scheme)?;
    let authority = authority
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(authority)
        .trim();
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let (host, url_port) = split_host_port(authority);
    if host.trim().is_empty() {
        return Err("SSH proxy host is required".to_string());
    }
    let explicit_port = u16::try_from(configured_port).ok().filter(|port| *port >= 1);
    let default_port = match kind {
        SshProxyKind::Socks5 => 1080,
        SshProxyKind::Http => 8080,
    };
    Ok(SshProxyEndpoint {
        kind,
        host,
        port: explicit_port.or(url_port).unwrap_or(default_port),
    })
}

fn split_proxy_scheme(input: &str) -> (Option<&str>, &str) {
    if let Some(index) = input.find("://") {
        let (scheme, rest) = input.split_at(index);
        return (Some(scheme), &rest[3..]);
    }
    (None, input)
}

fn resolve_proxy_kind(raw_type: &str, scheme: Option<&str>) -> Result<SshProxyKind, String> {
    let source = scheme.unwrap_or(raw_type).trim().to_ascii_lowercase();
    match source.as_str() {
        "http" => Ok(SshProxyKind::Http),
        "" | "socks5" | "socks" => Ok(SshProxyKind::Socks5),
        other => Err(format!("SSH proxy type is not supported: {other}")),
    }
}

fn split_host_port(authority: &str) -> (String, Option<u16>) {
    let authority = authority.trim();
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host = rest[..end].to_string();
            let port = rest[end + 1..].strip_prefix(':').and_then(parse_u16_port);
            return (host, port);
        }
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            return (host.to_string(), parse_u16_port(port));
        }
    }
    (authority.to_string(), None)
}

fn parse_u16_port(value: &str) -> Option<u16> {
    value.trim().parse::<u16>().ok().filter(|port| *port >= 1)
}
