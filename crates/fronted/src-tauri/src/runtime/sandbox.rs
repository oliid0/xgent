



//!




//!









use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// `current_exe __sandbox_exec --write-root <root> --net on|off [--isolated] -- <program> <args...>`;
pub(crate) const SANDBOX_EXEC_SUBCOMMAND: &str = "__sandbox_exec";

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LauncherInvocation {
    pub write_root: PathBuf,
        pub allow_network: bool,
            pub isolated: bool,
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn build_launcher_args(
    write_root: &Path,
    allow_network: bool,
    isolated: bool,
    program: &Path,
    args: &[String],
) -> Vec<String> {
    let mut out = vec![
        SANDBOX_EXEC_SUBCOMMAND.to_string(),
        "--write-root".to_string(),
        write_root.to_string_lossy().into_owned(),
        "--net".to_string(),
        if allow_network { "on" } else { "off" }.to_string(),
    ];
    if isolated {
        out.push("--isolated".to_string());
    }
    out.push("--".to_string());
    out.push(program.to_string_lossy().into_owned());
    out.extend(args.iter().cloned());
    out
}

/// `--write-root <root> --net on|off [--isolated] -- <program> [args...]`。
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_launcher_args(payload: &[String]) -> Result<LauncherInvocation, String> {
    let mut it = payload.iter();
    let mut write_root: Option<PathBuf> = None;
    let mut allow_network: Option<bool> = None;
    let mut isolated = false;
    let mut program: Option<PathBuf> = None;
    let mut rest: Vec<String> = Vec::new();
    while let Some(tok) = it.next() {
        match tok.as_str() {
            "--write-root" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--write-root requires a value".to_string())?;
                write_root = Some(PathBuf::from(value));
            }
            "--net" => {
                let value = it
                    .next()
                    .ok_or_else(|| "--net requires a value".to_string())?;
                allow_network = Some(match value.as_str() {
                    "on" => true,
                    "off" => false,
                    other => return Err(format!("--net expects on|off, got: {other}")),
                });
            }
            "--isolated" => isolated = true,
            "--" => {
                program = it.next().map(PathBuf::from);
                rest = it.cloned().collect();
                break;
            }
            other => return Err(format!("unexpected launcher argument: {other}")),
        }
    }
    let write_root = write_root.ok_or_else(|| "missing --write-root".to_string())?;
    let allow_network = allow_network.ok_or_else(|| "missing --net on|off".to_string())?;
    let program = program.ok_or_else(|| "missing program after `--`".to_string())?;
    Ok(LauncherInvocation {
        write_root,
        allow_network,
        isolated,
        program,
        args: rest,
    })
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn synthetic_workspace_sid(write_root: &Path) -> String {
    fn fnv1a64(bytes: &[u8]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for &b in bytes {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }
    let canonical = write_root.to_string_lossy().to_lowercase();
    let h1 = fnv1a64(canonical.as_bytes());
    
    let mut salted = canonical.into_bytes();
    salted.push(0);
    salted.extend_from_slice(b"xgent-sandbox");
    let h2 = fnv1a64(&salted);
    let a = (h1 >> 32) as u32;
    let b = h1 as u32;
    let c = (h2 >> 32) as u32;
    let d = h2 as u32;
    format!("S-1-5-21-{a}-{b}-{c}-{d}")
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn build_command_line(program: &str, args: &[String]) -> Vec<u16> {
    fn append_arg(cmd: &mut Vec<u16>, arg: &str) {
        let arg: Vec<u16> = arg.encode_utf16().collect();
        let space = u16::from(b' ');
        let tab = u16::from(b'\t');
        let quote = u16::from(b'"');
        let backslash = u16::from(b'\\');
        let needs_quote = arg.is_empty() || arg.iter().any(|&c| c == space || c == tab);
        if needs_quote {
            cmd.push(quote);
        }
        let mut backslashes: usize = 0;
        for &w in &arg {
            if w == backslash {
                backslashes += 1;
            } else {
                if w == quote {
                    
                    for _ in 0..=backslashes {
                        cmd.push(backslash);
                    }
                }
                backslashes = 0;
            }
            cmd.push(w);
        }
        if needs_quote {
            for _ in 0..backslashes {
                cmd.push(backslash);
            }
            cmd.push(quote);
        }
    }

    let mut cmd: Vec<u16> = Vec::new();
    append_arg(&mut cmd, program);
    for a in args {
        cmd.push(u16::from(b' '));
        append_arg(&mut cmd, a);
    }
    cmd.push(0);
    cmd
}



#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn resolve_program_in_path(
    program: &Path,
    path_env: &str,
    pathext: &str,
    is_file: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if program.is_absolute() {
        return Some(program.to_path_buf());
    }
    let name = program.as_os_str();
    
    let mut exts: Vec<String> = vec![String::new()];
    exts.extend(
        pathext
            .split(';')
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(str::to_string),
    );
    for dir in path_env.split(';').map(str::trim) {
        let dir_path = Path::new(dir);
        
        if !dir_path.is_absolute() {
            continue;
        }
        for ext in &exts {
            let mut file = name.to_os_string();
            file.push(ext);
            let candidate = dir_path.join(&file);
            if is_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn is_msix_windowsapps_path(path: &Path) -> bool {
    path.to_string_lossy()
        .split(['\\', '/'])
        .any(|seg| seg.eq_ignore_ascii_case("WindowsApps"))
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const CNG_USER_REGISTRY_SUBKEYS: &[&str] = &[
    r"Software\Microsoft\SystemCertificates",
    r"Software\Microsoft\SystemCertificates\CA",
    r"Software\Microsoft\SystemCertificates\Root",
    r"Software\Microsoft\SystemCertificates\My",
    r"Software\Policies\Microsoft\SystemCertificates",
    r"Software\Policies\Microsoft\SystemCertificates\CA",
    r"Software\Microsoft\Cryptography",
];

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn cng_named_registry_object(subkey: &str) -> String {
    format!("CURRENT_USER\\{subkey}")
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn cng_user_file_dirs(appdata: &Path, localappdata: &Path) -> Vec<PathBuf> {
    vec![
        appdata.join("Microsoft").join("Crypto"),
        appdata.join("Microsoft").join("Protect"),
        localappdata.join("Microsoft").join("CryptnetUrlCache"),
    ]
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const CLR_USER_REGISTRY_SUBKEYS: &[&str] = &[
    r"Software\Microsoft\PowerShell",
    r"Software\Microsoft\PowerShell\1",
    r"Software\Microsoft\Windows\PowerShell",
    r"Software\Microsoft\.NETFramework",
];


#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn clr_user_file_dirs(appdata: &Path, localappdata: &Path) -> Vec<PathBuf> {
    vec![
        localappdata.join("Microsoft").join("CLR_v4.0"),
        localappdata.join("Microsoft").join("CLR_v4.0_32"),
        localappdata.join("assembly"),
        localappdata
            .join("Microsoft")
            .join("Windows")
            .join("PowerShell"),
        localappdata.join("Microsoft").join("PowerShell"),
        appdata.join("Microsoft").join("Windows").join("PowerShell"),
        appdata.join("Microsoft").join("CLR Security Config"),
        localappdata.join("IsolatedStorage"),
    ]
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SandboxOptions {
    pub allow_network: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct SandboxSpec {
    pub write_root: PathBuf,
    pub allow_network: bool,
                    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub isolated: bool,
}

impl SandboxSpec {
    pub(crate) fn from_options(write_root: PathBuf, options: SandboxOptions) -> Self {
        Self {
            write_root,
            allow_network: options.allow_network,
            
            
            isolated: false,
        }
    }
}

pub(crate) fn options_from_mode(mode: &str) -> Option<SandboxOptions> {
    match mode.trim() {
        "sandbox" => Some(SandboxOptions {
            allow_network: true,
        }),
        "sandboxOffline" => Some(SandboxOptions {
            allow_network: false,
        }),
        _ => None,
    }
}

pub(crate) fn strictest(
    a: Option<SandboxOptions>,
    b: Option<SandboxOptions>,
) -> Option<SandboxOptions> {
    match (a, b) {
        (Some(x), Some(y)) => Some(SandboxOptions {
            allow_network: x.allow_network && y.allow_network,
        }),
        (Some(only), None) | (None, Some(only)) => Some(only),
        (None, None) => None,
    }
}


pub(crate) fn resolve_effective_options(
    requested: Option<SandboxOptions>,
) -> Result<Option<SandboxOptions>, String> {
    let mode = crate::commands::settings::load_runtime_command_safety_mode().map_err(|err| {
        format!(
            "Cannot verify the persisted sandbox floor (settings.system.commandSafetyMode): {err}. \
Refusing to run the command unsandboxed."
        )
    })?;
    Ok(strictest(requested, options_from_mode(&mode)))
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxCapability {
    pub supported: bool,
    pub mechanism: &'static str,
    pub platform: &'static str,
                pub network_control: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn sensitive_home_subdirs() -> [&'static str; 4] {
    [".ssh", ".aws", ".gnupg", ".config/gh"]
}

fn app_config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(format!(".{}", env!("CARGO_PKG_NAME"))))
}

fn sensitive_dirs() -> Vec<PathBuf> {
    let mut dirs_out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for sub in sensitive_home_subdirs() {
            dirs_out.push(home.join(sub));
        }
    }
    if let Some(config) = app_config_dir() {
        dirs_out.push(config);
    }
    dirs_out
}

fn canonical_or_self(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}


fn normalize_for_compare(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped: String = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.to_string()
    };
    if cfg!(windows) {
        PathBuf::from(stripped.to_lowercase())
    } else {
        PathBuf::from(stripped)
    }
}

fn path_encloses(ancestor: &Path, descendant: &Path) -> bool {
    normalize_for_compare(descendant).starts_with(normalize_for_compare(ancestor))
}



pub(crate) fn validate_workspace(write_root: &Path) -> Result<(), String> {
    let root = canonical_or_self(write_root);
    let app_config = app_config_dir().map(|p| canonical_or_self(&p));

    for dir in sensitive_dirs() {
        let dir = canonical_or_self(&dir);
        if path_encloses(&root, &dir) {
            return Err(format!(
                "Sandbox refuses workspace \"{}\": it encloses or equals the sensitive directory \
\"{}\", which the workspace write fence would re-expose. Choose a workspace that does not \
contain credential or app-config directories.",
                root.display(),
                dir.display()
            ));
        }
        if path_encloses(&dir, &root) {
            
            let dir_key = normalize_for_compare(&dir);
            if app_config
                .as_deref()
                .is_some_and(|config| normalize_for_compare(config) == dir_key)
            {
                continue;
            }
            return Err(format!(
                "Sandbox refuses workspace \"{}\": it lives inside the sensitive directory \"{}\". \
Choose a workspace outside credential directories.",
                root.display(),
                dir.display()
            ));
        }
    }
    Ok(())
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn darwin_user_temp_parent(tmpdir: &Path) -> Option<PathBuf> {
    let mut names: Vec<&str> = Vec::new();
    for component in tmpdir.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => names.push(name.to_str()?),
            _ => return None,
        }
    }
    let n = names.len();
    if n < 4 || names[n - 1] != "T" || names[n - 4] != "folders" {
        return None;
    }
    let prefix = &names[..n - 4];
    if prefix != ["var"] && prefix != ["private", "var"] {
        return None;
    }
    tmpdir.parent().map(Path::to_path_buf)
}

#[cfg(any(not(windows), test))]
pub(crate) fn temp_write_root_is_safe(path: &Path) -> bool {
    let root = canonical_or_self(path);
    let cmp = normalize_for_compare(&root);
    if cmp == Path::new("/") || cmp.as_os_str().is_empty() {
        return false;
    }
    #[cfg(windows)]
    {
        if cmp.components().count() <= 1 {
            return false;
        }
    }
    if let Some(home) = dirs::home_dir() {
        if path_encloses(&root, &canonical_or_self(&home)) {
            return false;
        }
    }
    for dir in sensitive_dirs() {
        if path_encloses(&root, &canonical_or_self(&dir)) {
            return false;
        }
    }
    true
}


#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
pub(crate) fn resolve_bwrap_executable(
    path_env: &str,
    is_file: &dyn Fn(&Path) -> bool,
    skip_under: Option<&Path>,
) -> Option<PathBuf> {
    const PINNED: &[&str] = &["/usr/bin/bwrap", "/usr/local/bin/bwrap"];
    let skipped = |candidate: &Path| skip_under.is_some_and(|root| path_encloses(root, candidate));
    for candidate in PINNED {
        let path = Path::new(candidate);
        if is_file(path) && !skipped(path) {
            return Some(path.to_path_buf());
        }
    }
    for dir in path_env.split(':').map(str::trim) {
        let dir_path = Path::new(dir);
        if !dir_path.is_absolute() || skipped(dir_path) {
            continue;
        }
        let candidate = dir_path.join("bwrap");
        if is_file(&candidate) && !skipped(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(not(windows))]
fn writable_temp_dirs() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push_canonical = |path: PathBuf| {
        if !temp_write_root_is_safe(&path) {
            return;
        }
        let canonical = std::fs::canonicalize(&path).unwrap_or(path);
        if !temp_write_root_is_safe(&canonical) {
            return;
        }
        if !out.contains(&canonical) {
            out.push(canonical);
        }
    };

    if let Ok(tmpdir) = std::env::var("TMPDIR") {
        let tmpdir = PathBuf::from(tmpdir.trim_end_matches('/'));
        if tmpdir.is_absolute() && tmpdir.is_dir() {
            
            
            #[cfg(target_os = "macos")]
            if let Some(parent) = darwin_user_temp_parent(&tmpdir) {
                push_canonical(parent);
            }
            push_canonical(tmpdir);
        }
    }
    push_canonical(std::env::temp_dir());
    for path in ["/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"] {
        let path = Path::new(path);
        if path.is_dir() {
            push_canonical(path.to_path_buf());
        }
    }
    out
}

pub fn capability() -> SandboxCapability {
    platform::capability()
}

pub(crate) fn wrap_command(
    spec: &SandboxSpec,
    program: &Path,
    args: &[String],
) -> Result<(PathBuf, Vec<String>, &'static str), String> {
    let capability = capability();
    if !capability.supported {
        return Err(format!(
            "Sandbox mode is enabled but unavailable on this platform: {}. \
Disable sandbox mode in Settings → System, or resolve the issue and retry.",
            capability
                .reason
                .as_deref()
                .unwrap_or("unsupported platform")
        ));
    }
    validate_workspace(&spec.write_root)?;
    platform::wrap_command(spec, program, args)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

    pub(super) fn capability() -> SandboxCapability {
        if Path::new(SANDBOX_EXEC).exists() {
            SandboxCapability {
                supported: true,
                mechanism: "seatbelt",
                platform: "macos",
                network_control: true,
                reason: None,
            }
        } else {
            SandboxCapability {
                supported: false,
                mechanism: "seatbelt",
                platform: "macos",
                network_control: false,
                reason: Some(format!("{SANDBOX_EXEC} not found")),
            }
        }
    }

        fn escape(path: &Path) -> String {
        path.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    }

    fn subpath_filters(paths: &[PathBuf]) -> String {
        paths
            .iter()
            .map(|p| format!("(subpath \"{}\")", escape(p)))
            .collect::<Vec<_>>()
            .join(" ")
    }

                    pub(super) fn seatbelt_profile(spec: &SandboxSpec) -> String {
        let mut writable = vec![spec.write_root.clone()];
        writable.extend(writable_temp_dirs());

        let mut profile = String::from("(version 1)\n(allow default)\n(deny file-write*)\n");
        profile.push_str(&format!(
            "(allow file-write* {})\n",
            subpath_filters(&writable)
        ));
        profile.push_str(
            "(allow file-write-data file-ioctl (literal \"/dev/null\") (literal \"/dev/zero\") \
(literal \"/dev/tty\") (literal \"/dev/stdout\") (literal \"/dev/stderr\") \
(literal \"/dev/dtracehelper\"))\n(allow file-write* (subpath \"/dev/fd\"))\n",
        );
        let sensitive = sensitive_dirs();
        if !sensitive.is_empty() {
            profile.push_str(&format!(
                "(deny file-read* {})\n",
                subpath_filters(&sensitive)
            ));
        }
        profile.push_str(&format!(
            "(allow file-read* file-write* (subpath \"{}\"))\n",
            escape(&spec.write_root)
        ));
        if !spec.allow_network {
            profile.push_str("(deny network*)\n");
        }
        profile
    }

    pub(super) fn wrap_command(
        spec: &SandboxSpec,
        program: &Path,
        args: &[String],
    ) -> Result<(PathBuf, Vec<String>, &'static str), String> {
        let mut out = vec!["-p".to_string(), seatbelt_profile(spec)];
        out.push(program.to_string_lossy().into_owned());
        out.extend(args.iter().cloned());
        Ok((PathBuf::from(SANDBOX_EXEC), out, "seatbelt"))
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
mod platform {
    use super::*;
    use std::process::Command;
    use std::sync::OnceLock;

    static CAPABILITY: OnceLock<SandboxCapability> = OnceLock::new();

    fn resolve_installed_bwrap() -> Option<PathBuf> {
        resolve_bwrap_executable(
            &std::env::var("PATH").unwrap_or_default(),
            &|path| path.is_file(),
            None,
        )
    }

    fn probe() -> SandboxCapability {
        let unsupported = |reason: String| SandboxCapability {
            supported: false,
            mechanism: "bubblewrap",
            platform: "linux",
            network_control: false,
            reason: Some(reason),
        };
        let Some(bwrap) = resolve_installed_bwrap() else {
            return unsupported(
                "bubblewrap (bwrap) is not available. Install it, e.g. `apt install bubblewrap`."
                    .to_string(),
            );
        };
        
        
        match Command::new(&bwrap)
            .args([
                "--die-with-parent",
                "--unshare-pid",
                "--ro-bind",
                "/",
                "/",
                "--proc",
                "/proc",
                "--dev",
                "/dev",
                "--",
                "/bin/true",
            ])
            .output()
        {
            Ok(output) if output.status.success() => SandboxCapability {
                supported: true,
                mechanism: "bubblewrap",
                platform: "linux",
                network_control: true,
                reason: None,
            },
            Ok(output) => unsupported(format!(
                "bubblewrap probe failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )),
            Err(err) => unsupported(format!("bubblewrap (bwrap) is not available: {err}.")),
        }
    }

    pub(super) fn capability() -> SandboxCapability {
        CAPABILITY.get_or_init(probe).clone()
    }

    pub(super) fn bwrap_args(spec: &SandboxSpec) -> Vec<String> {
        
        
        let mut args: Vec<String> = Vec::new();
        if !spec.isolated {
            args.push("--die-with-parent".to_string());
        }
        args.extend(
            [
                "--unshare-pid",
                "--ro-bind",
                "/",
                "/",
                "--proc",
                "/proc",
                "--dev",
                "/dev",
            ]
            .into_iter()
            .map(String::from),
        );

        for tmp in writable_temp_dirs() {
            let tmp = tmp.to_string_lossy().into_owned();
            args.extend(["--bind".to_string(), tmp.clone(), tmp]);
        }
        
        
        for dir in sensitive_dirs() {
            if dir.is_dir() {
                args.extend(["--tmpfs".to_string(), dir.to_string_lossy().into_owned()]);
            }
        }
        let root = spec.write_root.to_string_lossy().into_owned();
        args.extend(["--bind".to_string(), root.clone(), root]);
        if !spec.allow_network {
            args.push("--unshare-net".to_string());
        }
        args.push("--".to_string());
        args
    }

    pub(super) fn wrap_command(
        spec: &SandboxSpec,
        program: &Path,
        args: &[String],
    ) -> Result<(PathBuf, Vec<String>, &'static str), String> {
        let bwrap = resolve_bwrap_executable(
            &std::env::var("PATH").unwrap_or_default(),
            &|path| path.is_file(),
            Some(&spec.write_root),
        )
        .ok_or_else(|| {
            "Sandbox mode is enabled but bwrap was not found outside the workspace. \
Install bubblewrap to a system path such as /usr/bin/bwrap (a binary inside the \
project folder is never used)."
                .to_string()
        })?;
        let mut out = bwrap_args(spec);
        out.push(program.to_string_lossy().into_owned());
        out.extend(args.iter().cloned());
        Ok((bwrap, out, "bubblewrap"))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::OnceLock;

    static CAPABILITY: OnceLock<SandboxCapability> = OnceLock::new();

                        fn probe() -> SandboxCapability {
        let unsupported = |reason: String| SandboxCapability {
            supported: false,
            mechanism: "low-integrity-token",
            platform: "windows",
            network_control: false,
            reason: Some(reason),
        };
        
        if let Err(err) = std::env::current_exe() {
            return unsupported(format!("cannot resolve current executable: {err}"));
        }
        let (networked_token, appcontainer) = crate::runtime::windows_sandbox::probe_backends();
        if let Err(err) = networked_token {
            return unsupported(format!("low-integrity token backend unavailable: {err}"));
        }
        SandboxCapability {
            supported: true,
            mechanism: "low-integrity-token",
            platform: "windows",
            
            
            network_control: appcontainer.is_ok(),
            reason: appcontainer
                .err()
                .map(|err| format!("offline (AppContainer) backend unavailable: {err}")),
        }
    }

    pub(super) fn capability() -> SandboxCapability {
        CAPABILITY.get_or_init(probe).clone()
    }

    pub(super) fn wrap_command(
        spec: &SandboxSpec,
        program: &Path,
        args: &[String],
    ) -> Result<(PathBuf, Vec<String>, &'static str), String> {
        
        
        
        if !spec.allow_network && !capability().network_control {
            return Err(format!(
                "Offline sandbox is enabled but the AppContainer backend is unavailable on this \
machine: {}. Switch to the networked sandbox mode or resolve the issue and retry.",
                capability()
                    .reason
                    .as_deref()
                    .unwrap_or("AppContainer SID could not be derived")
            ));
        }
        let current_exe = std::env::current_exe()
            .map_err(|err| format!("failed to resolve current executable for sandbox: {err}"))?;
        let launcher_args = build_launcher_args(
            &spec.write_root,
            spec.allow_network,
            spec.isolated,
            program,
            args,
        );
        let mechanism = if spec.allow_network {
            "low-integrity-token"
        } else {
            "appcontainer"
        };
        Ok((current_exe, launcher_args, mechanism))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_profile_contains_write_root_and_ordering() {
        let spec = SandboxSpec {
            write_root: PathBuf::from("/tmp/xgent \"quoted\" ws"),
            allow_network: false,
            isolated: false,
        };
        let profile = platform::seatbelt_profile(&spec);
        assert!(profile.starts_with("(version 1)\n(allow default)\n(deny file-write*)\n"));
        assert!(profile.contains("xgent \\\"quoted\\\" ws"));
        assert!(profile.ends_with("(deny network*)\n"));
        
        let deny_read = profile
            .find("(deny file-read*")
            .expect("deny file-read rule");
        let reallow = profile
            .find("(allow file-read* file-write*")
            .expect("workspace re-allow rule");
        assert!(reallow > deny_read);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_network_allowed_omits_network_rule() {
        let spec = SandboxSpec {
            write_root: PathBuf::from("/tmp/ws"),
            allow_network: true,
            isolated: false,
        };
        assert!(!platform::seatbelt_profile(&spec).contains("network"));
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    #[test]
    fn bwrap_args_order_masks_before_write_root_bind() {
        let spec = SandboxSpec {
            write_root: PathBuf::from("/home/user/project"),
            allow_network: false,
            isolated: false,
        };
        let args = platform::bwrap_args(&spec);
        assert_eq!(args.first().map(String::as_str), Some("--die-with-parent"));
        assert!(args.contains(&"--unshare-net".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("--"));
        let root_bind = args
            .iter()
            .position(|a| a == "/home/user/project")
            .expect("write root bind");
        if let Some(mask) = args.iter().position(|a| a == "--tmpfs") {
            assert!(mask < root_bind);
        }
    }

    
    #[cfg(all(not(windows), not(target_os = "macos")))]
    #[test]
    fn bwrap_args_isolated_omits_die_with_parent() {
        let base = PathBuf::from("/home/user/project");
        let attached = platform::bwrap_args(&SandboxSpec {
            write_root: base.clone(),
            allow_network: false,
            isolated: false,
        });
        assert!(attached.contains(&"--die-with-parent".to_string()));

        let isolated = platform::bwrap_args(&SandboxSpec {
            write_root: base,
            allow_network: false,
            isolated: true,
        });
        assert!(!isolated.contains(&"--die-with-parent".to_string()));
        
        assert_eq!(isolated.first().map(String::as_str), Some("--unshare-pid"));
        assert_eq!(isolated.last().map(String::as_str), Some("--"));
    }

    
    #[test]
    fn validate_workspace_rejects_ancestor_of_sensitive_dir() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        
        assert!(validate_workspace(&home).is_err());
    }

    
    #[test]
    fn validate_workspace_rejects_inside_credential_dir() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let inside_ssh = home.join(".ssh").join("ws");
        assert!(validate_workspace(&inside_ssh).is_err());
    }

    
    #[test]
    fn validate_workspace_allows_default_project_under_app_config() {
        let Some(config) = app_config_dir() else {
            return;
        };
        let default_project = config.join("default-project");
        assert!(validate_workspace(&default_project).is_ok());
    }

    
    #[test]
    fn validate_workspace_allows_ordinary_workspace() {
        assert!(validate_workspace(Path::new("/tmp/xgent-ordinary-ws")).is_ok());
    }

    

    
    
    #[test]
    fn normalize_for_compare_strips_verbatim_prefixes() {
        assert_eq!(
            normalize_for_compare(Path::new(r"\\?\C:\ws\proj")).to_string_lossy(),
            if cfg!(windows) {
                r"c:\ws\proj".to_string()
            } else {
                r"C:\ws\proj".to_string()
            }
        );
        assert_eq!(
            normalize_for_compare(Path::new(r"\\?\UNC\server\share\ws")).to_string_lossy(),
            r"\\server\share\ws"
        );
    }

    #[test]
    fn path_encloses_matches_ancestor_and_self() {
        assert!(path_encloses(
            Path::new("/home/user"),
            Path::new("/home/user/.ssh")
        ));
        assert!(path_encloses(
            Path::new("/home/user"),
            Path::new("/home/user")
        ));
        assert!(!path_encloses(
            Path::new("/home/user/.ssh"),
            Path::new("/home/user")
        ));
        
        #[cfg(windows)]
        {
            assert!(path_encloses(
                Path::new(r"C:\Users\Me"),
                Path::new(r"\\?\C:\Users\Me\.ssh")
            ));
            assert!(path_encloses(
                Path::new(r"\\?\C:\Users\Me"),
                Path::new(r"c:\users\me\.aws")
            ));
        }
    }

    
    #[test]
    fn strictest_takes_the_tighter_side() {
        let online = Some(SandboxOptions {
            allow_network: true,
        });
        let offline = Some(SandboxOptions {
            allow_network: false,
        });
        assert!(strictest(None, None).is_none());
        assert_eq!(strictest(None, online).map(|o| o.allow_network), Some(true));
        assert_eq!(strictest(online, None).map(|o| o.allow_network), Some(true));
        
        assert_eq!(
            strictest(online, offline).map(|o| o.allow_network),
            Some(false)
        );
        assert_eq!(
            strictest(offline, online).map(|o| o.allow_network),
            Some(false)
        );
    }

    #[test]
    fn options_from_mode_only_sandbox_modes_fence() {
        assert!(options_from_mode("auto").is_none());
        assert!(options_from_mode("ask").is_none());
        assert!(options_from_mode("nonsense").is_none());
        assert_eq!(
            options_from_mode("sandbox").map(|o| o.allow_network),
            Some(true)
        );
        assert_eq!(
            options_from_mode("sandboxOffline").map(|o| o.allow_network),
            Some(false)
        );
    }

    #[test]
    fn launcher_args_roundtrip() {
        let program = PathBuf::from(r"C:\Program Files\Git\bin\bash.exe");
        let args = vec!["-lc".to_string(), "echo \"hi there\" && ls".to_string()];
        for (allow_network, isolated) in
            [(true, false), (false, false), (true, true), (false, true)]
        {
            let built = build_launcher_args(
                Path::new(r"C:\ws\proj"),
                allow_network,
                isolated,
                &program,
                &args,
            );
            assert_eq!(built[0], SANDBOX_EXEC_SUBCOMMAND);
            
            let parsed = parse_launcher_args(&built[1..]).expect("parse");
            assert_eq!(parsed.write_root, PathBuf::from(r"C:\ws\proj"));
            assert_eq!(parsed.allow_network, allow_network);
            assert_eq!(parsed.isolated, isolated);
            assert_eq!(parsed.program, program);
            assert_eq!(parsed.args, args);
        }
    }

    #[test]
    fn parse_launcher_args_rejects_incomplete() {
        assert!(parse_launcher_args(&["--write-root".to_string()]).is_err());
        assert!(parse_launcher_args(&["--".to_string()]).is_err());
        assert!(parse_launcher_args(&[]).is_err());
        
        assert!(parse_launcher_args(&[
            "--net".to_string(),
            "on".to_string(),
            "--".to_string(),
            "cmd.exe".to_string(),
        ])
        .is_err());
        
        assert!(parse_launcher_args(&[
            "--write-root".to_string(),
            r"C:\ws".to_string(),
            "--".to_string(),
            "cmd.exe".to_string(),
        ])
        .is_err());
        
        assert!(parse_launcher_args(&[
            "--write-root".to_string(),
            r"C:\ws".to_string(),
            "--net".to_string(),
            "maybe".to_string(),
            "--".to_string(),
            "cmd.exe".to_string(),
        ])
        .is_err());
    }

    #[test]
    fn parse_launcher_args_program_without_extra_args() {
        let parsed = parse_launcher_args(&[
            "--write-root".to_string(),
            r"C:\ws".to_string(),
            "--net".to_string(),
            "off".to_string(),
            "--".to_string(),
            "cmd.exe".to_string(),
        ])
        .expect("parse");
        assert_eq!(parsed.program, PathBuf::from("cmd.exe"));
        assert!(!parsed.allow_network);
        assert!(!parsed.isolated);
        assert!(parsed.args.is_empty());
    }

    #[test]
    fn synthetic_sid_is_deterministic_and_case_insensitive() {
        let a = synthetic_workspace_sid(Path::new(r"C:\Users\Me\Project"));
        let b = synthetic_workspace_sid(Path::new(r"c:\users\me\project"));
        assert_eq!(a, b, "Windows 路径大小写不敏感,应得同一 SID");
        assert!(a.starts_with("S-1-5-21-"));
        
        assert_eq!(a.split('-').count(), 8);
        let other = synthetic_workspace_sid(Path::new(r"C:\Users\Me\Other"));
        assert_ne!(a, other, "不同路径应得不同 SID");
    }

    #[test]
    fn command_line_quotes_spaces_and_escapes_quotes() {
        let line = build_command_line(
            r"C:\Program Files\App\app.exe",
            &[
                "--flag".to_string(),
                "a b".to_string(),
                r#"say "hi""#.to_string(),
            ],
        );
        assert_eq!(line.last(), Some(&0u16), "须以 NUL 结尾");
        let decoded = String::from_utf16(&line[..line.len() - 1]).unwrap();
        
        assert!(decoded.starts_with(r#""C:\Program Files\App\app.exe""#));
        
        assert!(decoded.contains(" --flag "));
        
        assert!(decoded.contains(r#" "a b" "#));
        
        assert!(decoded.ends_with(r#""say \"hi\"""#));
    }

    #[test]
    fn command_line_doubles_trailing_backslashes_before_closing_quote() {
        
        
        let line = build_command_line("prog", &[r"a\b c\".to_string()]);
        let decoded = String::from_utf16(&line[..line.len() - 1]).unwrap();
        assert!(decoded.ends_with(r#""a\b c\\""#));
    }

    
    
    #[test]
    fn resolve_program_searches_absolute_dirs_first_match_wins() {
        let present: std::collections::HashSet<PathBuf> =
            [PathBuf::from("/usr/bin/sh")].into_iter().collect();
        let is_file = |p: &Path| present.contains(p);
        let got =
            resolve_program_in_path(Path::new("sh"), "/nonexist;/usr/bin;/bin", ".EXE", &is_file);
        assert_eq!(got, Some(PathBuf::from("/usr/bin/sh")));
    }

    #[test]
    fn resolve_program_applies_pathext_to_bare_name() {
        let present: std::collections::HashSet<PathBuf> =
            [PathBuf::from("/tools/pwsh.EXE")].into_iter().collect();
        let is_file = |p: &Path| present.contains(p);
        let got = resolve_program_in_path(Path::new("pwsh"), "/tools", ".COM;.EXE", &is_file);
        assert_eq!(got, Some(PathBuf::from("/tools/pwsh.EXE")));
    }

    #[test]
    fn resolve_program_never_probes_relative_or_dot_dirs() {
        
        let is_file = |p: &Path| {
            assert!(
                p.is_absolute(),
                "resolver probed a non-absolute path: {p:?}"
            );
            false
        };
        let got = resolve_program_in_path(Path::new("cmd.exe"), ".;rel/dir;/abs", ".EXE", &is_file);
        assert_eq!(got, None);
    }

    #[test]
    fn resolve_program_passes_absolute_input_through_without_probing() {
        let is_file = |_: &Path| panic!("absolute input must not be probed");
        let got = resolve_program_in_path(Path::new("/bin/sh"), "/other", ".EXE", &is_file);
        assert_eq!(got, Some(PathBuf::from("/bin/sh")));
    }

    #[test]
    fn msix_windowsapps_path_is_detected_case_insensitively() {
        assert!(is_msix_windowsapps_path(Path::new(
            r"C:\Users\Me\AppData\Local\Microsoft\WindowsApps\pwsh.exe"
        )));
        assert!(is_msix_windowsapps_path(Path::new(
            r"C:\Program Files\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe"
        )));
        assert!(!is_msix_windowsapps_path(Path::new(
            r"C:\Program Files\PowerShell\7\pwsh.exe"
        )));
        assert!(!is_msix_windowsapps_path(Path::new(
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        )));
    }

    #[test]
    fn cng_user_write_surface_is_narrow_user_store_not_home() {
        assert!(CNG_USER_REGISTRY_SUBKEYS
            .iter()
            .all(|key| key.starts_with(r"Software\")));
        assert!(CNG_USER_REGISTRY_SUBKEYS
            .iter()
            .all(|key| { key.contains("SystemCertificates") || key.contains("Cryptography") }));
        assert_eq!(
            cng_named_registry_object(r"Software\Microsoft\SystemCertificates"),
            r"CURRENT_USER\Software\Microsoft\SystemCertificates"
        );
        let dirs = cng_user_file_dirs(Path::new("/roaming"), Path::new("/local"));
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/roaming/Microsoft/Crypto"),
                PathBuf::from("/roaming/Microsoft/Protect"),
                PathBuf::from("/local/Microsoft/CryptnetUrlCache"),
            ]
        );
        assert!(!dirs
            .iter()
            .any(|path| path == Path::new("/roaming") || path == Path::new("/local")));
    }

    #[test]
    fn clr_user_write_surface_is_narrow_runtime_cache_not_home() {
        assert!(CLR_USER_REGISTRY_SUBKEYS
            .iter()
            .all(|key| key.starts_with(r"Software\Microsoft\")));
        assert!(CLR_USER_REGISTRY_SUBKEYS
            .iter()
            .all(|key| { key.contains("PowerShell") || key.contains(".NETFramework") }));
        let dirs = clr_user_file_dirs(Path::new("/roaming"), Path::new("/local"));
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/local/Microsoft/CLR_v4.0"),
                PathBuf::from("/local/Microsoft/CLR_v4.0_32"),
                PathBuf::from("/local/assembly"),
                PathBuf::from("/local/Microsoft/Windows/PowerShell"),
                PathBuf::from("/local/Microsoft/PowerShell"),
                PathBuf::from("/roaming/Microsoft/Windows/PowerShell"),
                PathBuf::from("/roaming/Microsoft/CLR Security Config"),
                PathBuf::from("/local/IsolatedStorage"),
            ]
        );
        assert!(!dirs.iter().any(|path| {
            path == Path::new("/roaming")
                || path == Path::new("/local")
                || path == Path::new("/local/Temp")
                || path == Path::new("/local/Microsoft")
        }));
    }

    #[test]
    fn darwin_user_temp_parent_only_matches_var_folders_layout() {
        assert_eq!(
            darwin_user_temp_parent(Path::new("/var/folders/zz/abc123/T")),
            Some(PathBuf::from("/var/folders/zz/abc123"))
        );
        assert_eq!(
            darwin_user_temp_parent(Path::new("/private/var/folders/zz/abc123/T")),
            Some(PathBuf::from("/private/var/folders/zz/abc123"))
        );
        
        assert_eq!(darwin_user_temp_parent(Path::new("/tmp")), None);
        assert_eq!(darwin_user_temp_parent(Path::new("/private/tmp")), None);
        assert_eq!(darwin_user_temp_parent(Path::new("/var/tmp")), None);
        assert_eq!(darwin_user_temp_parent(Path::new("/tmp/T")), None);
        assert_eq!(
            darwin_user_temp_parent(Path::new("/var/folders/zz/abc123")),
            None
        );
    }

    #[test]
    fn temp_write_root_rejects_filesystem_root_and_home() {
        assert!(!temp_write_root_is_safe(Path::new("/")));
        if let Some(home) = dirs::home_dir() {
            assert!(!temp_write_root_is_safe(&home));
        }
        assert!(temp_write_root_is_safe(Path::new("/tmp")));
        assert!(temp_write_root_is_safe(Path::new("/var/folders/zz/abc123")));
    }

    #[test]
    fn resolve_bwrap_prefers_system_path_over_workspace_path_prefix() {
        let present: std::collections::HashSet<PathBuf> = [
            PathBuf::from("/workspace/node_modules/.bin/bwrap"),
            PathBuf::from("/usr/bin/bwrap"),
        ]
        .into_iter()
        .collect();
        let is_file = |p: &Path| present.contains(p);
        let got = resolve_bwrap_executable("/workspace/node_modules/.bin:/usr/bin", &is_file, None);
        assert_eq!(got, Some(PathBuf::from("/usr/bin/bwrap")));
    }

    #[test]
    fn resolve_bwrap_skips_workspace_and_relative_path_entries() {
        let present: std::collections::HashSet<PathBuf> = [
            PathBuf::from("/workspace/node_modules/.bin/bwrap"),
            PathBuf::from("/opt/nix/bin/bwrap"),
        ]
        .into_iter()
        .collect();
        let is_file = |p: &Path| present.contains(p);
        let got = resolve_bwrap_executable(
            ".:/workspace/node_modules/.bin:/opt/nix/bin",
            &is_file,
            Some(Path::new("/workspace")),
        );
        assert_eq!(got, Some(PathBuf::from("/opt/nix/bin/bwrap")));
    }

    #[test]
    fn resolve_bwrap_refuses_when_only_workspace_copy_exists() {
        let is_file = |p: &Path| p == Path::new("/workspace/.venv/bin/bwrap");
        let got = resolve_bwrap_executable(
            "/workspace/.venv/bin",
            &is_file,
            Some(Path::new("/workspace")),
        );
        assert_eq!(got, None);
    }
}
