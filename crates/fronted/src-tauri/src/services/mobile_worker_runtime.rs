//! A single mobile app process shares its actual protected vault/peer registry.
//! Separate snapshots in a foreground startup and OS callback could overwrite
//! each other's paired sessions, revocations or immutable request bindings.
use std::collections::BTreeMap;
use std::path::{Path,PathBuf};
use std::sync::{Arc,Mutex,OnceLock,Weak};
use super::{cloud_secret_vault::CloudSecretVault,worker_peers::WorkerPeerRegistry};

static VAULTS:OnceLock<Mutex<BTreeMap<PathBuf,Weak<CloudSecretVault>>>>=OnceLock::new();
static PEERS:OnceLock<Mutex<BTreeMap<usize,Weak<WorkerPeerRegistry>>>>=OnceLock::new();

pub(crate) fn vault(root:&Path,create:bool)->Result<Arc<CloudSecretVault>,String>{
    let root=std::fs::canonicalize(root).map_err(|_|"Original mobile credential directory unavailable".to_string())?;
    let mut slots=VAULTS.get_or_init(||Mutex::new(BTreeMap::new())).lock().map_err(|_|"Mobile credential owner lock unavailable".to_string())?;
    if let Some(vault)=slots.get(&root).and_then(Weak::upgrade){return Ok(vault);}
    slots.retain(|_,weak|weak.strong_count()>0);
    let opened=if create {CloudSecretVault::new(root.clone())?} else {CloudSecretVault::open_existing(&root)?};
    let vault=Arc::new(opened);slots.insert(root,Arc::downgrade(&vault));Ok(vault)
}

pub(crate) fn peers(vault:&Arc<CloudSecretVault>)->Result<Arc<WorkerPeerRegistry>,String>{
    let owner=Arc::as_ptr(vault) as usize;
    let mut slots=PEERS.get_or_init(||Mutex::new(BTreeMap::new())).lock().map_err(|_|"Mobile peer owner lock unavailable".to_string())?;
    if let Some(peers)=slots.get(&owner).and_then(Weak::upgrade){return Ok(peers);}
    slots.retain(|_,weak|weak.strong_count()>0);
    let peers=Arc::new(WorkerPeerRegistry::new(Arc::clone(vault))?);slots.insert(owner,Arc::downgrade(&peers));Ok(peers)
}
