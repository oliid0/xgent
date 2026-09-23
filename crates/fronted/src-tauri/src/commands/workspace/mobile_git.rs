use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use chrono::{TimeZone, Utc};
use git2::{build::CheckoutBuilder, Cred, CredentialType, Diff, DiffFormat, DiffOptions, FetchOptions, PushOptions, RemoteCallbacks, Repository, Sort, Status, StatusOptions};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::services::cloud_secret_vault::CloudSecretVault;

const MAX_DIFF_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileGitChange {
    path: String,
    old_path: Option<String>,
    index_status: String,
    worktree_status: String,
    staged: bool,
    working: bool,
    untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileGitSnapshot {
    branch: String,
    upstream: String,
    ahead: usize,
    behind: usize,
    changes: Vec<MobileGitChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileGitHistoryEntry {
    sha: String,
    short_sha: String,
    author: String,
    date: String,
    subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileGitIdentity {
    name: String,
    email: String,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Git worker failed: {error}"))?
}

fn open_repo(workdir: &str) -> Result<Repository, String> {
    let repo = Repository::discover(workdir)
        .map_err(|error| format!("not a git repository: {error}"))?;
    if repo.is_bare() || repo.workdir().is_none() {
        return Err("Git review requires a working tree".to_string());
    }
    Ok(repo)
}

fn safe_relative_path(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty()
        || !path.components().all(|component| matches!(component, Component::Normal(_)))
        || path.components().next().is_some_and(|component| component.as_os_str() == ".git")
    {
        return Err("Invalid repository-relative path".to_string());
    }
    Ok(path)
}

fn worktree_file(repo: &Repository, path: &Path) -> Result<PathBuf, String> {
    let root = repo
        .workdir()
        .ok_or("Git working tree missing")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let candidate = root.join(path);
    let parent = candidate
        .parent()
        .ok_or("Invalid repository-relative path")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !parent.starts_with(&root) {
        return Err("Git path escapes the working tree".to_string());
    }
    Ok(candidate)
}

fn status_code(status: Status, index: bool) -> &'static str {
    if status.contains(Status::CONFLICTED) {
        "U"
    } else if index && status.contains(Status::INDEX_NEW) {
        "A"
    } else if index && status.contains(Status::INDEX_DELETED)
        || !index && status.contains(Status::WT_DELETED)
    {
        "D"
    } else if index && status.contains(Status::INDEX_RENAMED)
        || !index && status.contains(Status::WT_RENAMED)
    {
        "R"
    } else if index && status.contains(Status::INDEX_TYPECHANGE)
        || !index && status.contains(Status::WT_TYPECHANGE)
    {
        "T"
    } else if index && status.contains(Status::INDEX_MODIFIED)
        || !index && status.contains(Status::WT_MODIFIED)
    {
        "M"
    } else if !index && status.contains(Status::WT_NEW) {
        "?"
    } else {
        " "
    }
}

fn snapshot(workdir: &str) -> Result<MobileGitSnapshot, String> {
    let repo = open_repo(workdir)?;
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut options)).map_err(|error| error.to_string())?;
    let changes = statuses
        .iter()
        .filter_map(|entry| {
            let path = entry.path()?.to_string();
            let status = entry.status();
            let index_status = status_code(status, true).to_string();
            let worktree_status = status_code(status, false).to_string();
            let old_path = entry
                .head_to_index()
                .and_then(|delta| delta.old_file().path().map(|path| path.to_string_lossy().into_owned()))
                .filter(|old| old != &path);
            Some(MobileGitChange {
                path,
                old_path,
                staged: index_status != " ",
                working: worktree_status != " ",
                untracked: status.contains(Status::WT_NEW),
                index_status,
                worktree_status,
            })
        })
        .collect();
    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_default();
    let mut upstream = String::new();
    let (mut ahead, mut behind) = (0, 0);
    if let Ok(local) = repo.find_branch(&branch, git2::BranchType::Local) {
        if let Ok(remote) = local.upstream() {
            upstream = remote.name().ok().flatten().unwrap_or_default().to_string();
            if let (Some(local_oid), Some(remote_oid)) = (local.get().target(), remote.get().target()) {
                if let Ok(counts) = repo.graph_ahead_behind(local_oid, remote_oid) {
                    (ahead, behind) = counts;
                }
            }
        }
    }
    Ok(MobileGitSnapshot { branch, upstream, ahead, behind, changes })
}

fn append_diff(output: &mut Vec<u8>, diff: &Diff<'_>) -> Result<(), String> {
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        if output.len() >= MAX_DIFF_BYTES { return true; }
        if matches!(line.origin(), '+' | '-' | ' ') {
            output.push(line.origin() as u8);
        }
        let remaining = MAX_DIFF_BYTES.saturating_sub(output.len());
        output.extend_from_slice(&line.content()[..line.content().len().min(remaining)]);
        true
    })
    .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_status(workdir: String) -> Result<MobileGitSnapshot, String> {
    blocking(move || snapshot(&workdir)).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_identity(workdir: String) -> Result<MobileGitIdentity, String> {
    blocking(move || {
        let repo = open_repo(&workdir)?;
        let config = repo.config().map_err(|error| error.to_string())?;
        Ok(MobileGitIdentity {
            name: config.get_string("user.name").unwrap_or_default(),
            email: config.get_string("user.email").unwrap_or_default(),
        })
    }).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_history(workdir: String) -> Result<Vec<MobileGitHistoryEntry>, String> {
    blocking(move || {
        let repo = open_repo(&workdir)?;
        let mut walk = repo.revwalk().map_err(|error| error.to_string())?;
        if walk.push_head().is_err() {
            return Ok(Vec::new());
        }
        walk.set_sorting(Sort::TIME).map_err(|error| error.to_string())?;
        walk.take(60)
            .map(|id| {
                let commit = repo.find_commit(id.map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
                let sha = commit.id().to_string();
                let date = Utc.timestamp_opt(commit.time().seconds(), 0)
                    .single()
                    .map(|date| date.to_rfc3339())
                    .unwrap_or_default();
                Ok(MobileGitHistoryEntry {
                    short_sha: sha.chars().take(7).collect(),
                    sha,
                    author: commit.author().name().unwrap_or_default().to_string(),
                    date,
                    subject: commit.summary().unwrap_or_default().to_string(),
                })
            })
            .collect()
    }).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_diff(workdir: String, path: String) -> Result<String, String> {
    blocking(move || {
        let path = safe_relative_path(&path)?;
        let repo = open_repo(&workdir)?;
        let mut options = DiffOptions::new();
        options.pathspec(path.to_string_lossy().as_ref()).disable_pathspec_match(true)
            .show_untracked_content(true).recurse_untracked_dirs(true);
        let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
        let staged = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut options))
            .map_err(|error| error.to_string())?;
        let working = repo.diff_index_to_workdir(None, Some(&mut options))
            .map_err(|error| error.to_string())?;
        let mut output = Vec::new();
        append_diff(&mut output, &staged)?;
        append_diff(&mut output, &working)?;
        Ok(String::from_utf8_lossy(&output).into_owned())
    }).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_commit_detail(workdir: String, sha: String) -> Result<String, String> {
    blocking(move || {
        let repo = open_repo(&workdir)?;
        let oid = git2::Oid::from_str(&sha).map_err(|error| error.to_string())?;
        let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
        let previous = if commit.parent_count() > 0 {
            Some(commit.parent(0).map_err(|error| error.to_string())?
                .tree().map_err(|error| error.to_string())?)
        } else {
            None
        };
        let current = commit.tree().map_err(|error| error.to_string())?;
        let diff = repo.diff_tree_to_tree(previous.as_ref(), Some(&current), None)
            .map_err(|error| error.to_string())?;
        let mut output = format!("commit {oid}\nAuthor: {}\n\n    {}\n\n",
            commit.author().name().unwrap_or_default(),
            commit.message().unwrap_or_default().trim()).into_bytes();
        append_diff(&mut output, &diff)?;
        Ok(String::from_utf8_lossy(&output).into_owned())
    }).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_mutate(
    workdir: String,
    operation: String,
    path: Option<String>,
    message: Option<String>,
    author_name: Option<String>,
    author_email: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        if operation == "init" {
            Repository::init(&workdir).map_err(|error| error.to_string())?;
            return Ok(String::new());
        }
        let repo = open_repo(&workdir)?;
        match operation.as_str() {
            "stage" | "unstage" | "discard" => {
                let path = safe_relative_path(path.as_deref().unwrap_or_default())?;
                match operation.as_str() {
                    "stage" => {
                        let mut index = repo.index().map_err(|error| error.to_string())?;
                        let absolute = repo.workdir().ok_or("Git working tree missing")?.join(path);
                        if absolute.exists() {
                            worktree_file(&repo, path)?;
                            index.add_path(path).map_err(|error| error.to_string())?;
                        } else {
                            index.remove_path(path).map_err(|error| error.to_string())?;
                        }
                        index.write().map_err(|error| error.to_string())?;
                    }
                    "unstage" => {
                        if let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) {
                            repo.reset_default(Some(head.as_object()), [path])
                                .map_err(|error| error.to_string())?;
                        } else {
                            let mut index = repo.index().map_err(|error| error.to_string())?;
                            index.remove_path(path).map_err(|error| error.to_string())?;
                            index.write().map_err(|error| error.to_string())?;
                        }
                    }
                    "discard" => {
                        let status = repo.status_file(path).map_err(|error| error.to_string())?;
                        if status.contains(Status::WT_NEW) {
                            let absolute = worktree_file(&repo, path)?;
                            fs::remove_file(&absolute).map_err(|error| error.to_string())?;
                        } else {
                            let mut checkout = CheckoutBuilder::new();
                            checkout.force().path(path);
                            repo.checkout_index(None, Some(&mut checkout))
                                .map_err(|error| error.to_string())?;
                        }
                    }
                    _ => unreachable!(),
                }
                Ok(String::new())
            }
            "commit" => {
                let message = message.as_deref().unwrap_or_default().trim();
                if message.is_empty() { return Err("Commit message is required".to_string()); }
                let author_name = author_name.as_deref().unwrap_or_default().trim();
                let author_email = author_email.as_deref().unwrap_or_default().trim();
                if !author_name.is_empty() || !author_email.is_empty() {
                    if author_name.is_empty() || author_email.is_empty() {
                        return Err("Both Git author name and email are required".to_string());
                    }
                    let mut config = repo.config().map_err(|error| error.to_string())?;
                    config.set_str("user.name", author_name).map_err(|error| error.to_string())?;
                    config.set_str("user.email", author_email).map_err(|error| error.to_string())?;
                }
                let signature = repo.signature().map_err(|_| "Configure user.name and user.email for this repository before committing".to_string())?;
                let mut index = repo.index().map_err(|error| error.to_string())?;
                let tree_id = index.write_tree().map_err(|error| error.to_string())?;
                let tree = repo.find_tree(tree_id).map_err(|error| error.to_string())?;
                let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
                if parent.as_ref().is_some_and(|parent| parent.tree_id() == tree_id) {
                    return Err("There are no staged changes to commit".to_string());
                }
                let parents: Vec<_> = parent.iter().collect();
                let id = repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parents)
                    .map_err(|error| error.to_string())?;
                Ok(id.to_string())
            }
            _ => Err("Unsupported Git operation".to_string()),
        }
    }).await
}

fn remote_callbacks(token: Option<String>) -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, _username, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT)
            && reqwest::Url::parse(url)
                .ok()
                .is_some_and(|parsed| parsed.scheme() == "https" && parsed.host_str() == Some("github.com"))
        {
            if let Some(token) = token.as_ref() {
                return Cred::userpass_plaintext("x-access-token", token);
            }
        }
        Err(git2::Error::from_str("Configure a GitHub token for authenticated HTTPS Git remotes"))
    });
    callbacks
}

fn fetch_origin(repo: &Repository, token: Option<String>) -> Result<(), String> {
    let mut remote = repo.find_remote("origin").map_err(|error| error.to_string())?;
    let mut options = FetchOptions::new();
    options.remote_callbacks(remote_callbacks(token));
    remote.fetch(&[] as &[&str], Some(&mut options), None)
        .map_err(|error| format!("Git fetch failed: {error}"))
}

fn pull_fast_forward(repo: &Repository) -> Result<(), String> {
    let head = repo.head().map_err(|error| error.to_string())?;
    let branch_name = head.shorthand().ok_or("Pull requires a local branch")?.to_string();
    let local_oid = head.target().ok_or("Pull requires a local commit")?;
    let local_branch = repo.find_branch(&branch_name, git2::BranchType::Local)
        .map_err(|error| error.to_string())?;
    let upstream = local_branch.upstream()
        .map_err(|_| "Set an upstream branch before pulling".to_string())?;
    let remote_oid = upstream.get().target().ok_or("The upstream has no commit")?;
    if remote_oid == local_oid { return Ok(()); }
    let (ahead, _behind) = repo.graph_ahead_behind(local_oid, remote_oid)
        .map_err(|error| error.to_string())?;
    if ahead > 0 || repo.statuses(None).map_err(|error| error.to_string())?.len() > 0 {
        return Err("Pull needs a clean worktree and a fast-forward; resolve local commits or changes first".to_string());
    }
    let remote_commit = repo.find_commit(remote_oid).map_err(|error| error.to_string())?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(remote_commit.as_object(), Some(&mut checkout))
        .map_err(|error| format!("Git pull checkout failed: {error}"))?;
    let mut head_ref = repo.find_reference(&format!("refs/heads/{branch_name}"))
        .map_err(|error| error.to_string())?;
    head_ref.set_target(remote_oid, "Xgent mobile fast-forward pull")
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn mobile_git_remote(
    app: AppHandle,
    workdir: String,
    operation: String,
) -> Result<(), String> {
    let token = app.try_state::<Arc<CloudSecretVault>>()
        .and_then(|vault| vault.github_token().ok());
    blocking(move || {
        let repo = open_repo(&workdir)?;
        match operation.as_str() {
            "fetch" => fetch_origin(&repo, token),
            "pull" => {
                fetch_origin(&repo, token)?;
                pull_fast_forward(&repo)
            }
            "push" => {
                let head = repo.head().map_err(|error| error.to_string())?;
                let refname = head.name().ok_or("Push requires a local branch")?;
                if !refname.starts_with("refs/heads/") {
                    return Err("Push requires a local branch".to_string());
                }
                let mut remote = repo.find_remote("origin").map_err(|error| error.to_string())?;
                let mut options = PushOptions::new();
                let mut callbacks = remote_callbacks(token);
                callbacks.push_update_reference(|_, status| {
                    status.map_or(Ok(()), |error| Err(git2::Error::from_str(error)))
                });
                options.remote_callbacks(callbacks);
                remote.push(&[format!("{refname}:{refname}")], Some(&mut options))
                    .map_err(|error| format!("Git push failed: {error}"))
            }
            _ => Err("Unsupported Git remote operation".to_string()),
        }
    }).await
}
