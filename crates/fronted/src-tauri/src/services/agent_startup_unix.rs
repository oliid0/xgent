//! User login supervisors. Graphical-session lifecycle is deliberate: no root daemon or linger.
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use sha2::{Digest, Sha256};
use tauri::Manager;
use wait_timeout::ChildExt;
use super::agent_startup_supervisor::Registration;

struct Descriptor { path: PathBuf, label: String, marker: String, text: String }

fn descriptor(app: &tauri::AppHandle) -> Result<Descriptor, String> {
    let data = app.path().app_data_dir().map_err(|e|e.to_string())?;
    let identity = format!("{}\0{}",app.config().identifier,data.display());
    let hash = format!("{:x}",Sha256::digest(identity.as_bytes()));
    let executable = std::env::current_exe().map_err(|e|e.to_string())?;
    #[cfg(target_os="linux")]
    let executable = app.env().appimage.unwrap_or(executable);
    #[cfg(target_os="macos")]
    let executable = executable.canonicalize().map_err(|e|e.to_string())?;
    let executable = executable.to_str().ok_or("Agent executable path is not Unicode")?;
    if !Path::new(executable).is_absolute() || executable.chars().any(char::is_control) {
        return Err("Agent registration requires an absolute executable path without control characters".into());
    }
    #[cfg(target_os="macos")]
    {
        let label=format!("com.xgent.agent.{}",&hash[..32]);
        let marker=format!("<!-- XgentAgent/v1/{label} -->");
        let program=quick_xml::escape::escape(executable);
        let text=format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{marker}\n<plist version=\"1.0\"><dict><key>Label</key><string>{label}</string><key>ProgramArguments</key><array><string>{program}</string><string>--xgent-agent</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string></dict></plist>\n");
        let path=dirs::home_dir().ok_or("User home unavailable")?.join("Library/LaunchAgents").join(format!("{label}.plist"));
        Ok(Descriptor {path,label,marker,text})
    }
    #[cfg(target_os="linux")]
    {
        if executable.contains('$') {return Err("User service executable paths containing dollar characters are not supported; no login registration was changed".into());}
        let label=format!("app-xgent-agent-{}.service",&hash[..32]);
        let marker=format!("# XgentAgent/v1/{label}");
        let program=executable.replace('\\',"\\\\").replace('"',"\\\"").replace('%',"%%");
        let text=format!("{marker}\n[Unit]\nDescription=Xgent background agent\nAfter=graphical-session.target\nPartOf=graphical-session.target\nStartLimitIntervalSec=60\nStartLimitBurst=6\n\n[Service]\nType=simple\nExecStart=\"{program}\" --xgent-agent\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=30\nUMask=0077\nSlice=background.slice\n\n[Install]\nWantedBy=graphical-session.target\n");
        let path=dirs::config_dir().ok_or("User configuration directory unavailable")?.join("systemd/user").join(&label);
        Ok(Descriptor {path,label,marker,text})
    }
}

fn read_owned(descriptor: &Descriptor) -> Result<Option<String>, String> {
    let metadata=match std::fs::symlink_metadata(&descriptor.path) {
        Ok(metadata)=>metadata,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(error)=>return Err(error.to_string()),
    };
    if !metadata.file_type().is_file() || metadata.len()>65536 { return Err("Agent registration is not an owned bounded file".into()); }
    let text=std::fs::read_to_string(&descriptor.path).map_err(|e|e.to_string())?;
    if !text.lines().take(2).any(|line|line==descriptor.marker) { return Err("Another owner controls this login registration; no file was changed".into()); }
    Ok(Some(text))
}

fn run(program: &str, args: &[&str]) -> Result<(bool,String),String> {
    let mut stdout=tempfile::tempfile().map_err(|e|e.to_string())?;
    let mut stderr=tempfile::tempfile().map_err(|e|e.to_string())?;
    let mut command=Command::new(program);
    crate::runtime::process::configure_child_process_group(&mut command);
    let mut child=command.args(args).stdin(Stdio::null()).stdout(stdout.try_clone().map_err(|e|e.to_string())?)
        .stderr(stderr.try_clone().map_err(|e|e.to_string())?).spawn().map_err(|e|e.to_string())?;
    let status=match child.wait_timeout(Duration::from_secs(10)).map_err(|e|e.to_string())? {
        Some(status)=>status,None=>{let _=child.kill();let _=child.wait();return Err("OS registration response timed out; observe actual state before retrying".into());},
    };
    stdout.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;stderr.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
    let mut out=String::new();stdout.take(65537).read_to_string(&mut out).map_err(|e|e.to_string())?;
    if out.len()>65536 {return Err("OS registration observation exceeds its bound".into());}
    if !status.success() && out.trim().is_empty() {
        let mut error=String::new();stderr.take(4096).read_to_string(&mut error).map_err(|e|e.to_string())?;
        return Err(format!("OS registration utility failed: {}",error.trim()));
    }
    Ok((status.success(),out))
}

#[cfg(target_os="macos")]
fn domain() -> Result<String,String> {
    let (success,uid)=run("/usr/bin/id",&["-u"])?;
    if !success || uid.trim().is_empty() || !uid.trim().bytes().all(|value|value.is_ascii_digit()) {return Err("Original graphical user identity unavailable".into());}
    Ok(format!("gui/{}",uid.trim()))
}

pub fn observe(app: &tauri::AppHandle) -> Result<Option<Registration>,String> {
    let descriptor=descriptor(app)?;
    let Some(text)=read_owned(&descriptor)? else {return Ok(None);};
    let mut registered=text==descriptor.text;
    #[cfg(target_os="macos")]
    {
        let domain=domain()?;
        let (success,disabled)=run("/bin/launchctl",&["print-disabled",&domain])?;
        if !success {return Err("User launchd registration state unavailable".into());}
        let pattern=format!("(?m)^\\s*\"{}\"\\s*=>\\s*(true|false|enabled|disabled)\\s*[,;]?\\s*$",regex::escape(&descriptor.label));
        if let Some(value)=regex::Regex::new(&pattern).map_err(|e|e.to_string())?.captures(&disabled) {
            registered &= !matches!(&value[1],"true"|"disabled");
        } else if disabled.contains(&format!("\"{}\"",descriptor.label)) {
            return Err("User launchd disabled state is unrecognized".into());
        }
    }
    #[cfg(target_os="linux")]
    {
        let (success,state)=run("/usr/bin/systemctl",&["--user","is-enabled",&descriptor.label])?;
        match state.trim() {"enabled"=>registered &=success,"disabled"|"masked"|"static"|"indirect"|"not-found"=>registered=false,_=>return Err("User systemd registration state is unrecognized".into())}
        if registered {
            let (success,overrides)=run("/usr/bin/systemctl",&["--user","show",&descriptor.label,"--property=DropInPaths","--value"])?;
            if !success || !overrides.trim().is_empty() {return Err("Managed user service has external overrides; its restart policy cannot be confirmed".into());}
        }
    }
    Ok(Some(Registration {registered,restart_on_failure:registered}))
}

pub fn set(app: &tauri::AppHandle, enabled: bool) -> Result<(),String> {
    let descriptor=descriptor(app)?;
    let previous=read_owned(&descriptor)?;
    #[cfg(target_os="linux")]
    if enabled {
        if !run("/usr/bin/systemctl",&["--user","is-active","graphical-session.target"])?.0 {
            return Err("This desktop session does not expose an active systemd graphical-session.target; existing login registration was left unchanged".into());
        }
    }
    if enabled {
        let parent=descriptor.path.parent().ok_or("Invalid agent registration path")?;
        std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;
        let mut file=tempfile::NamedTempFile::new_in(parent).map_err(|e|e.to_string())?;
        file.write_all(descriptor.text.as_bytes()).map_err(|e|e.to_string())?;file.as_file().sync_all().map_err(|e|e.to_string())?;
        if read_owned(&descriptor)?!=previous {return Err("Agent registration changed while saving; no replacement was applied".into());}
        if previous.is_none() {file.persist_noclobber(&descriptor.path).map_err(|e|e.to_string())?;}
        else {file.persist(&descriptor.path).map_err(|e|e.to_string())?;}
    }
    #[cfg(target_os="macos")]
    {
        let service=format!("{}/{}",domain()?,descriptor.label);
        if !run("/bin/launchctl",&[if enabled {"enable"}else{"disable"},&service])?.0 {return Err("User launchd registration was not confirmed".into());}
    }
    #[cfg(target_os="linux")]
    if enabled || previous.is_some() {
        if !run("/usr/bin/systemctl",&["--user","daemon-reload"])?.0 {return Err("User service reload was not confirmed".into());}
        if !run("/usr/bin/systemctl",&["--user",if enabled {"enable"}else{"disable"},&descriptor.label])?.0 {return Err("User service registration was not confirmed".into());}
    }
    if !enabled && previous.is_some() {
        if read_owned(&descriptor)?!=previous {return Err("Agent registration changed during removal; no file was removed".into());}
        std::fs::remove_file(&descriptor.path).map_err(|e|e.to_string())?;
    }
    let observed=observe(app)?;
    if observed.as_ref().is_some_and(|value|value.registered)!=enabled {return Err("OS login registration did not match requested state; observe before retrying".into());}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(path: PathBuf) -> Descriptor {
        Descriptor {path,label:"own-agent".into(),marker:"# OwnAgent".into(),text:"# OwnAgent\nOriginal descriptor".into()}
    }
    #[test]
    fn managed_login_files_reject_foreign_oversized_and_symlinked_resources() {
        let root=tempfile::tempdir().unwrap();let path=root.path().join("agent.service");let descriptor=fixture(path.clone());
        assert!(read_owned(&descriptor).unwrap().is_none());
        std::fs::write(&path,"Foreign user registration").unwrap();assert!(read_owned(&descriptor).is_err());
        std::fs::write(&path,&descriptor.text).unwrap();assert_eq!(read_owned(&descriptor).unwrap().as_deref(),Some(descriptor.text.as_str()));
        std::fs::write(&path,format!("# OwnAgent\n{}","x".repeat(65536))).unwrap();assert!(read_owned(&descriptor).is_err());
        let link=root.path().join("redirected.service");std::os::unix::fs::symlink(&path,&link).unwrap();assert!(read_owned(&fixture(link)).is_err());
    }
    #[test]
    fn launchd_owner_comment_can_follow_the_xml_declaration_without_claiming_foreign_plists() {
        let root=tempfile::tempdir().unwrap();let mut descriptor=fixture(root.path().join("agent.plist"));descriptor.marker="<!-- OwnAgent -->".into();
        std::fs::write(&descriptor.path,"<?xml version=\"1.0\"?>\n<!-- OwnAgent -->\n<plist version=\"1.0\"><dict/></plist>").unwrap();assert!(read_owned(&descriptor).unwrap().is_some());
        std::fs::write(&descriptor.path,"<?xml version=\"1.0\"?>\n<!-- Foreign marker -->\n<!-- OwnAgent -->").unwrap();assert!(read_owned(&descriptor).is_err());
    }
}
