use super::CuaResponse;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::ffi::{c_char, c_void, CStr, CString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

const ABI: u32=1;
const MAX_BYTES:u64=64*1024*1024;
static INSTALL:OnceLock<Mutex<()>>=OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
struct Manifest { abi:u32, target:String, filename:String, sha256:String, bytes:u64, version:String }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status { installed:bool, target:String, version:Option<String>, bytes:u64, permissions_required:bool, restart_required:bool, host_pid:u32 }

fn target()->String { format!("{}-{}",std::env::consts::OS,std::env::consts::ARCH) }
fn extension()->&'static str { if cfg!(windows) { "dll" } else if cfg!(target_os="macos") { "dylib" } else { "so" } }
fn filename()->String { format!("Xgent-CUA-abi{ABI}-{}.{}",target(),extension()) }
fn root(app:&tauri::AppHandle)->Result<PathBuf,String> {
    app.path().app_data_dir().map(|path|path.join("computer-use").join(format!("abi{ABI}")).join(target())).map_err(|e|e.to_string())
}
fn validate_manifest(manifest:&Manifest)->Result<(),String> {
    if manifest.abi!=ABI || manifest.target!=target() || manifest.filename!=filename() {
        return Err("This CUA component is incompatible with this Xgent installation".into());
    }
    if manifest.sha256.len()!=64 || !manifest.sha256.bytes().all(|byte|byte.is_ascii_hexdigit()) || manifest.bytes==0 || manifest.bytes>MAX_BYTES {
        return Err("CUA component manifest is invalid".into());
    }
    Ok(())
}
fn installed(app:&tauri::AppHandle)->Result<Option<(Manifest,PathBuf)>,String> {
    let root=root(app)?;
    let path=root.join("current.json");
    if !path.is_file() { return Ok(None); }
    let manifest:Manifest=serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|format!("CUA installation metadata is invalid: {e}"))?;
    validate_manifest(&manifest)?;
    let binary=root.join(&manifest.sha256).join(&manifest.filename);
    if !binary.is_file() { return Ok(None); }
    Ok(Some((manifest,binary)))
}

#[tauri::command]
pub fn cua_status(app:tauri::AppHandle)->Result<Status,String> {
    let installed=installed(&app)?;
    let path=installed.as_ref().map(|(_,path)|path);
    let restart_required=LOADED.get().and_then(|module|module.lock().ok())
        .and_then(|module|module.as_ref().map(|module|Some(&module.path)!=path)).unwrap_or(false);
    Ok(Status { installed:installed.is_some(), target:target(),version:installed.as_ref().map(|(manifest,_)|manifest.version.clone()),
        bytes:installed.as_ref().map(|(manifest,_)|manifest.bytes).unwrap_or(0),permissions_required:cfg!(target_os="macos"),restart_required,host_pid:std::process::id() })
}

fn progress(app:&tauri::AppHandle,phase:&str,bytes:u64,total:u64) {
    let _=app.emit("cua-install-progress",serde_json::json!({"phase":phase,"bytes":bytes,"total":total}));
}

fn install(app:&tauri::AppHandle)->Result<PathBuf,String> {
    let _guard=INSTALL.get_or_init(Mutex::default).lock().map_err(|_|"CUA installation lock poisoned")?;
    if let Some((manifest,path))=installed(app)? {
        let bytes=std::fs::read(&path).map_err(|e|e.to_string())?;
        if bytes.len() as u64==manifest.bytes && Sha256::digest(&bytes).iter().map(|byte|format!("{byte:02x}")).collect::<String>().eq_ignore_ascii_case(&manifest.sha256) { return Ok(path); }
        return Err("Installed CUA component failed integrity verification. Remove it through component settings and reinstall.".into());
    }
    progress(app,"checking",0,0);
    let client=reqwest::blocking::Client::builder().user_agent("Xgent-CUA/1")
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(180)).build().map_err(|e|e.to_string())?;
    // Download only assets published by this repository. No installation script
    // is fetched or executed. ABI, target, byte count and SHA-256 are checked.
    let release:Value=client.get("https://api.github.com/repos/oliid0/xgent/releases/latest").send().and_then(|response|response.error_for_status())
        .map_err(|e|format!("Cannot find Xgent's CUA release: {e}"))?.json().map_err(|e|e.to_string())?;
    let tag=release["tag_name"].as_str().ok_or("CUA release has no version")?;
    if tag.is_empty() || !tag.bytes().all(|byte|byte.is_ascii_alphanumeric() || b".-_".contains(&byte)) { return Err("Invalid CUA release version".into()); }
    let base=format!("https://github.com/oliid0/xgent/releases/download/{tag}");
    let manifest_name=format!("Xgent-CUA-abi{ABI}-{}.json",target());
    let manifest:Manifest=client.get(format!("{base}/{manifest_name}")).send().and_then(|response|response.error_for_status())
        .map_err(|e|format!("This release does not provide a CUA component for {}: {e}",target()))?.json().map_err(|e|e.to_string())?;
    validate_manifest(&manifest)?;
    let mut response=client.get(format!("{base}/{}",manifest.filename)).send().and_then(|response|response.error_for_status()).map_err(|e|e.to_string())?;
    if response.content_length().is_some_and(|size|size>MAX_BYTES) { return Err("CUA download exceeds the component size limit".into()); }
    let root=root(app)?;
    std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let staging=tempfile::Builder::new().prefix("install-").tempdir_in(&root).map_err(|e|e.to_string())?;
    let binary=staging.path().join(&manifest.filename);
    let mut file=std::fs::File::create(&binary).map_err(|e|e.to_string())?;
    let mut digest=Sha256::new();
    let mut total=0u64;
    let mut buffer=[0u8;64*1024];
    loop {
        let read=response.read(&mut buffer).map_err(|e|e.to_string())?;
        if read==0 { break; }
        total+=read as u64;
        if total>manifest.bytes || total>MAX_BYTES { return Err("CUA download size does not match its manifest".into()); }
        digest.update(&buffer[..read]); file.write_all(&buffer[..read]).map_err(|e|e.to_string())?;
        progress(app,"downloading",total,manifest.bytes);
    }
    if total!=manifest.bytes || !digest.finalize().iter().map(|byte|format!("{byte:02x}")).collect::<String>().eq_ignore_ascii_case(&manifest.sha256) { return Err("CUA download failed SHA-256 verification".into()); }
    file.sync_all().map_err(|e|e.to_string())?; drop(file);
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary,std::fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
    }
    let destination=root.join(&manifest.sha256);
    if !destination.exists() { std::fs::rename(staging.path(),&destination).map_err(|e|e.to_string())?; }
    let mut pointer=tempfile::NamedTempFile::new_in(&root).map_err(|e|e.to_string())?;
    pointer.write_all(&serde_json::to_vec(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    pointer.as_file().sync_all().map_err(|e|e.to_string())?;
    pointer.persist(root.join("current.json")).map_err(|e|e.to_string())?;
    progress(app,"ready",total,total);
    Ok(destination.join(manifest.filename))
}

pub fn ensure_installed(app:&tauri::AppHandle)->Result<PathBuf,String> {
    // A loaded module is immutable for this process. Avoid reading and hashing
    // the entire library on every input; verify again only at the next load.
    if let Some(path)=LOADED.get().and_then(|loaded|loaded.lock().ok())
        .and_then(|loaded|loaded.as_ref().map(|module|module.path.clone())) { return Ok(path); }
    install(app)
}

#[tauri::command]
pub async fn cua_install(app:tauri::AppHandle)->Result<Status,String> {
    let handle=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||install(&handle)).await.map_err(|e|e.to_string())?;
    if let Err(error)=result { progress(&app,"failed",0,0); return Err(error); }
    cua_status(app)
}

struct NativeModule { path:PathBuf, call:unsafe extern "C" fn(*const c_char)->*mut c_char, release:unsafe extern "C" fn(*mut c_char) }
static LOADED:OnceLock<Mutex<Option<NativeModule>>>=OnceLock::new();

#[cfg(unix)]
unsafe fn symbols(path:&Path)->Result<(*mut c_void,*mut c_void),String> {
    #[cfg_attr(target_os="linux",link(name="dl"))]
    extern "C" { fn dlopen(path:*const c_char,mode:i32)->*mut c_void; fn dlsym(handle:*mut c_void,name:*const c_char)->*mut c_void; fn dlerror()->*const c_char; }
    let path=CString::new(path.to_string_lossy().as_bytes()).map_err(|e|e.to_string())?;
    let handle=dlopen(path.as_ptr(),2);
    if handle.is_null() { let error=dlerror(); return Err(if error.is_null(){"Cannot load CUA component".into()}else{CStr::from_ptr(error).to_string_lossy().into_owned()}); }
    Ok((dlsym(handle,c"xgent_cua_call".as_ptr()),dlsym(handle,c"xgent_cua_free".as_ptr())))
}

#[cfg(windows)]
unsafe fn symbols(path:&Path)->Result<(*mut c_void,*mut c_void),String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress,LoadLibraryW};
    let path:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle=LoadLibraryW(path.as_ptr());
    if handle.is_null() { return Err(format!("Cannot load CUA component: {}",std::io::Error::last_os_error())); }
    Ok((GetProcAddress(handle,c"xgent_cua_call".as_ptr().cast()).map(|f|f as *mut c_void).unwrap_or(std::ptr::null_mut()),
        GetProcAddress(handle,c"xgent_cua_free".as_ptr().cast()).map(|f|f as *mut c_void).unwrap_or(std::ptr::null_mut())))
}

pub fn call(path:&Path,operation:&str,arguments:&Value)->Result<CuaResponse,String> {
    let mut loaded=LOADED.get_or_init(Mutex::default).lock().map_err(|_|"CUA native module lock poisoned")?;
    if loaded.is_none() {
        let (call,release)=unsafe{symbols(path)}?;
        if call.is_null()||release.is_null(){return Err("CUA component has an incompatible ABI".into());}
        *loaded=Some(NativeModule{path:path.into(),call:unsafe{std::mem::transmute(call)},release:unsafe{std::mem::transmute(release)}});
    }
    let module=loaded.as_ref().ok_or("CUA component unavailable")?;
    let request=CString::new(serde_json::json!({"operation":operation,"arguments":arguments}).to_string()).map_err(|e|e.to_string())?;
    unsafe {
        let result=(module.call)(request.as_ptr());
        if result.is_null(){return Err("CUA returned no state".into());}
        let response=serde_json::from_slice(CStr::from_ptr(result).to_bytes()).map_err(|e|format!("Invalid CUA result: {e}"));
        (module.release)(result);
        response
    }
}
