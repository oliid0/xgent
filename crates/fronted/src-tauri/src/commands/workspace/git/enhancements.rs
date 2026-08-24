use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::{
    ensure_ready_state, git_status_sync, git_success, validate_branch_name,
    validate_git_config_value, validate_git_remote_url, validate_start_point, GitOperationResponse,
    GitRepositoryState,
};
use crate::commands::system::validate_project_folder_name;
use crate::runtime::process::{configure_child_process_group, terminate_process_tree_by_pid};

const CLONE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    pub path: String,
    pub branch: String,
    pub main_worktree_path: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteBranchesResponse {
    pub default_branch: String,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeResponse {
    pub ok: bool,
    pub state: GitRepositoryState,
    pub worktree_path: String,
    pub branch: String,
    pub directory_name: String,
    pub main_worktree_path: String,
    pub stdout: String,
    pub stderr: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoveWorktreeResponse {
    pub ok: bool,
    pub state: GitRepositoryState,
    pub worktree_path: String,
    pub main_worktree_path: String,
    pub branch: String,
    pub worktree_removed: bool,
    pub branch_delete_requested: bool,
    pub branch_deleted: bool,
    pub stdout: String,
    pub stderr: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneTask {
    pub id: String,
    pub repository_name: String,
    pub target_path: String,
    pub branch: String,
    pub status: String,
    pub phase: String,
    pub progress: Option<u8>,
    pub detail: String,
    pub error: String,
    pub started_at: u64,
}

struct GitCloneTaskEntry {
    task: GitCloneTask,
    pid: u32,
}

#[derive(Default)]
pub struct GitCloneTaskRegistry {
    tasks: Mutex<HashMap<String, GitCloneTaskEntry>>,
}

impl GitCloneTaskRegistry {
    pub fn start(
        self: &Arc<Self>,
        parent: String,
        name: String,
        remote_url: String,
        branch: Option<String>,
    ) -> Result<GitCloneTask, String> {
        let parent = validate_clone_parent(&parent)?;
        let name = validate_project_folder_name(&name)?.to_string();
        let remote_url = validate_git_remote_url(&remote_url)?;
        let branch = validate_git_config_value("分支名", branch)?.unwrap_or_default();
        let target = parent.join(&name);

        match fs::create_dir(&target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(format!("克隆目标已存在：{}", target.display()));
            }
            Err(error) => return Err(format!("创建克隆目标失败：{error}")),
        }

        let mut command = Command::new("git");
        configure_child_process_group(&mut command);
        command
            .arg("clone")
            .arg("--progress")
            .current_dir(&target)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if !branch.is_empty() {
            command.args(["--branch", branch.as_str()]);
        }
        command.args(["--", remote_url.as_str(), "."]);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let _ = fs::remove_dir_all(&target);
                return Err(format!("无法启动 git clone：{error}"));
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                terminate_process_tree_by_pid(child.id(), Duration::from_millis(500));
                let _ = fs::remove_dir_all(&target);
                return Err("无法读取 git clone 进度输出。".to_string());
            }
        };
        let id = uuid::Uuid::new_v4().to_string();
        let task = GitCloneTask {
            id: id.clone(),
            repository_name: name,
            target_path: target.to_string_lossy().into_owned(),
            branch,
            status: "running".to_string(),
            phase: "preparing".to_string(),
            progress: None,
            detail: "正在准备克隆…".to_string(),
            error: String::new(),
            started_at: now_ms(),
        };
        self.tasks
            .lock()
            .map_err(|_| "克隆任务注册表不可用。".to_string())?
            .insert(
                id.clone(),
                GitCloneTaskEntry {
                    task: task.clone(),
                    pid: child.id(),
                },
            );

        let registry = Arc::clone(self);
        thread::spawn(move || registry.run(id, target, child, stderr));
        Ok(task)
    }

    pub fn snapshot(&self) -> Result<Vec<GitCloneTask>, String> {
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| "克隆任务注册表不可用。".to_string())?
            .values()
            .map(|entry| entry.task.clone())
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.started_at));
        Ok(tasks)
    }

    pub fn task(&self, id: &str) -> Result<GitCloneTask, String> {
        self.tasks
            .lock()
            .map_err(|_| "克隆任务注册表不可用。".to_string())?
            .get(id.trim())
            .map(|entry| entry.task.clone())
            .ok_or_else(|| "找不到克隆任务。".to_string())
    }

    pub fn cancel(&self, id: String) -> Result<GitCloneTask, String> {
        let pid = {
            let mut tasks = self
                .tasks
                .lock()
                .map_err(|_| "克隆任务注册表不可用。".to_string())?;
            let entry = tasks
                .get_mut(id.trim())
                .ok_or_else(|| "找不到克隆任务。".to_string())?;
            if entry.task.status != "running" {
                return Ok(entry.task.clone());
            }
            entry.task.status = "cancelling".to_string();
            entry.task.detail = "正在取消克隆…".to_string();
            entry.pid
        };
        terminate_process_tree_by_pid(pid, Duration::from_millis(500));
        self.task(id.trim())
    }

    pub fn dismiss(&self, id: String) -> Result<(), String> {
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| "克隆任务注册表不可用。".to_string())?;
        let id = id.trim();
        let Some(entry) = tasks.get(id) else {
            return Ok(());
        };
        if matches!(entry.task.status.as_str(), "running" | "cancelling") {
            return Err("克隆任务仍在运行，无法移除。".to_string());
        }
        tasks.remove(id);
        Ok(())
    }

    pub fn shutdown_cleanup(&self) {
        let tasks = match self.tasks.lock() {
            Ok(tasks) => tasks
                .values()
                .filter(|entry| matches!(entry.task.status.as_str(), "running" | "cancelling"))
                .map(|entry| (entry.pid, PathBuf::from(&entry.task.target_path)))
                .collect::<Vec<_>>(),
            Err(_) => return,
        };
        for (pid, target) in tasks {
            terminate_process_tree_by_pid(pid, Duration::from_millis(500));
            let _ = fs::remove_dir_all(target);
        }
    }

    fn run(
        self: Arc<Self>,
        id: String,
        target: PathBuf,
        mut child: Child,
        stderr: std::process::ChildStderr,
    ) {
        let (output_tx, output_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            loop {
                let mut bytes = Vec::new();
                match reader.read_until(b'\r', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let _ = output_tx.send(String::from_utf8_lossy(&bytes).into_owned());
                    }
                }
            }
        });
        let started = Instant::now();
        let status = loop {
            while let Ok(chunk) = output_rx.try_recv() {
                self.apply_output(&id, &chunk);
            }
            if started.elapsed() >= CLONE_TIMEOUT {
                terminate_process_tree_by_pid(child.id(), Duration::from_millis(500));
                self.fail(&id, "git clone 超时。".to_string(), &target);
                break None;
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    self.fail(&id, format!("等待 git clone 失败：{error}"), &target);
                    break None;
                }
            }
        };
        let _ = reader.join();
        while let Ok(chunk) = output_rx.try_recv() {
            self.apply_output(&id, &chunk);
        }

        let Ok(task) = self.task(&id) else {
            return;
        };
        if task.status == "cancelling" {
            let _ = fs::remove_dir_all(&target);
            self.update(&id, |task| {
                task.status = "cancelled".to_string();
                task.phase = "cancelled".to_string();
                task.progress = None;
                task.detail = "克隆已取消。".to_string();
            });
            return;
        }
        match status {
            Some(status) if status.success() => {
                match git_status_sync(target.to_string_lossy().into_owned()) {
                    Ok(_) => self.update(&id, |task| {
                        task.status = "completed".to_string();
                        task.phase = "completed".to_string();
                        task.progress = Some(100);
                        task.detail = "克隆完成。".to_string();
                    }),
                    Err(error) => self.fail(&id, error, &target),
                }
            }
            Some(status) => {
                let detail = task.detail.trim();
                let error = if detail.is_empty() {
                    format!("git clone 退出，状态码：{}", status.code().unwrap_or(-1))
                } else {
                    detail.to_string()
                };
                self.fail(&id, error, &target);
            }
            None => {}
        }
    }

    fn apply_output(&self, id: &str, chunk: &str) {
        for line in chunk.split(['\r', '\n']) {
            let detail = line.trim();
            if detail.is_empty() {
                continue;
            }
            self.update(id, |task| {
                if task.status != "running" {
                    return;
                }
                task.detail = detail.to_string();
                if let Some((phase, progress)) = parse_clone_progress(detail) {
                    task.phase = phase.to_string();
                    task.progress = Some(progress);
                }
            });
        }
    }

    fn fail(&self, id: &str, error: String, target: &Path) {
        let _ = fs::remove_dir_all(target);
        self.update(id, |task| {
            task.status = "failed".to_string();
            task.phase = "failed".to_string();
            task.progress = None;
            task.error = error;
            task.detail = "克隆失败。".to_string();
        });
    }

    fn update(&self, id: &str, update: impl FnOnce(&mut GitCloneTask)) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(entry) = tasks.get_mut(id) {
                update(&mut entry.task);
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn parse_clone_progress(line: &str) -> Option<(&'static str, u8)> {
    let parse_percent = |prefix: &str| {
        line.strip_prefix(prefix)?
            .trim_start()
            .split('%')
            .next()?
            .trim()
            .parse::<u8>()
            .ok()
            .map(|value| value.min(100) as u16)
    };
    if let Some(percent) = parse_percent("Receiving objects:") {
        return Some(("receiving", (5 + percent * 80 / 100) as u8));
    }
    if let Some(percent) = parse_percent("Resolving deltas:") {
        return Some(("resolving", (85 + percent * 15 / 100) as u8));
    }
    if let Some(percent) = parse_percent("Checking out files:") {
        return Some(("finalizing", (95 + percent * 5 / 100) as u8));
    }
    if line.starts_with("remote:") || line.starts_with("Cloning into") {
        return Some(("preparing", 5));
    }
    None
}

fn validate_clone_parent(parent: &str) -> Result<PathBuf, String> {
    let parent = parent.trim();
    if parent.is_empty() {
        return Err("克隆目标的父目录不能为空。".to_string());
    }
    let path = PathBuf::from(parent);
    if !path.is_absolute() {
        return Err("克隆目标的父目录必须是绝对路径。".to_string());
    }
    if !fs::metadata(&path).map(|meta| meta.is_dir()).unwrap_or(false) {
        return Err("克隆目标的父目录不存在或不可访问。".to_string());
    }
    fs::canonicalize(path).map_err(|error| format!("无法解析克隆目标的父目录：{error}"))
}

#[derive(Debug, Clone, Default)]
struct WorktreeRecord {
    path: String,
    branch: String,
    is_main: bool,
    is_current: bool,
    locked: bool,
}

fn normalized_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = normalized_path(left).to_string_lossy().replace('\\', "/");
    let right = normalized_path(right).to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

fn worktree_records(repo_root: &str) -> Result<Vec<WorktreeRecord>, String> {
    let output = git_success(repo_root, &["worktree", "list", "--porcelain"])?;
    let current = normalized_path(Path::new(repo_root));
    let mut records = Vec::new();
    let mut record = WorktreeRecord::default();
    for line in output.stdout.lines().chain(std::iter::once("")) {
        if line.trim().is_empty() {
            if !record.path.is_empty() {
                record.is_main = records.is_empty();
                record.is_current = paths_match(Path::new(&record.path), &current);
                records.push(record);
                record = WorktreeRecord::default();
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            record.path = path.trim().to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            record.branch = branch.trim().to_string();
        } else if line == "locked" || line.starts_with("locked ") {
            record.locked = true;
        }
    }
    if records.is_empty() {
        return Err("Git 未返回任何 Worktree。".to_string());
    }
    Ok(records)
}

pub(crate) fn git_worktrees_sync(repo_root: &str) -> Result<Vec<GitWorktreeInfo>, String> {
    let records = worktree_records(repo_root)?;
    let main = records[0].path.clone();
    Ok(records
        .into_iter()
        .filter(|record| !record.is_main)
        .map(|record| GitWorktreeInfo {
            path: record.path,
            branch: record.branch,
            main_worktree_path: main.clone(),
            is_current: record.is_current,
        })
        .collect())
}

fn worktree_storage_base() -> Result<PathBuf, String> {
    let dir = crate::services::app_paths::app_storage_dir()?.join("worktrees");
    fs::create_dir_all(&dir).map_err(|error| format!("创建 Worktree 目录失败：{error}"))?;
    Ok(dir)
}

fn repo_storage_id(repo_root: &str) -> String {
    let name = Path::new(repo_root)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repo".to_string());
    let safe = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in repo_root.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!(
        "{}-{hash:016x}",
        safe.trim_matches(|ch| ch == '-' || ch == '.')
    )
}

fn validate_existing_directory(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(format!("{label}必须是绝对路径。"));
    }
    if !fs::metadata(&path).map(|meta| meta.is_dir()).unwrap_or(false) {
        return Err(format!("{label}不存在或不可访问。"));
    }
    fs::canonicalize(path).map_err(|error| format!("无法解析{label}：{error}"))
}

fn create_worktree_sync(
    workdir: String,
    branch: String,
    directory_name: String,
    parent_directory: Option<String>,
    start_point: Option<String>,
) -> Result<GitWorktreeResponse, String> {
    let state = ensure_ready_state(&workdir)?;
    let records = worktree_records(&state.repo_root)?;
    let main = normalized_path(Path::new(&records[0].path));
    let main_string = main.to_string_lossy().into_owned();
    let branch = validate_branch_name(&state.repo_root, &branch)?;
    let directory_name = validate_project_folder_name(&directory_name)?.to_string();
    let parent = match parent_directory {
        Some(parent) if !parent.trim().is_empty() => {
            validate_existing_directory(&parent, "Worktree 父目录")?
        }
        _ => {
            let parent = worktree_storage_base()?.join(repo_storage_id(&main_string));
            fs::create_dir_all(&parent)
                .map_err(|error| format!("创建 Worktree 目录失败：{error}"))?;
            fs::canonicalize(parent).map_err(|error| format!("解析 Worktree 目录失败：{error}"))?
        }
    };
    let target = parent.join(&directory_name);
    if target.exists() {
        return Err(format!("Worktree 目标已存在：{}", target.display()));
    }
    if records
        .iter()
        .any(|record| target.starts_with(normalized_path(Path::new(&record.path))))
    {
        return Err("Worktree 目标不能位于现有 Worktree 目录内。".to_string());
    }
    let start_point = start_point
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| validate_start_point(&state.repo_root, value))
        .transpose()?
        .unwrap_or_else(|| "HEAD".to_string());
    let target_string = target.to_string_lossy().into_owned();
    let result = git_success(
        &main_string,
        &[
            "worktree",
            "add",
            "-b",
            branch.as_str(),
            target_string.as_str(),
            start_point.as_str(),
        ],
    );
    let response_state = git_status_sync(workdir)?;
    match result {
        Ok(output) => Ok(GitWorktreeResponse {
            ok: true,
            state: response_state,
            worktree_path: normalized_path(&target).to_string_lossy().into_owned(),
            branch,
            directory_name,
            main_worktree_path: main_string,
            stdout: output.stdout,
            stderr: output.stderr,
            message: "Worktree 已创建。".to_string(),
        }),
        Err(error) => Ok(GitWorktreeResponse {
            ok: false,
            state: response_state,
            worktree_path: target_string,
            branch,
            directory_name,
            main_worktree_path: main_string,
            stdout: String::new(),
            stderr: error.clone(),
            message: error,
        }),
    }
}

fn remove_worktree_sync(
    workdir: String,
    worktree_path: String,
    force: Option<bool>,
    delete_branch: Option<bool>,
) -> Result<GitRemoveWorktreeResponse, String> {
    let state = ensure_ready_state(&workdir)?;
    let requested = PathBuf::from(worktree_path.trim());
    if !requested.is_absolute() {
        return Err("Worktree 路径必须是绝对路径。".to_string());
    }
    let records = worktree_records(&state.repo_root)?;
    let target = records
        .iter()
        .find(|record| paths_match(Path::new(&record.path), &requested))
        .cloned()
        .ok_or_else(|| "目标路径不是当前仓库已登记的 Worktree。".to_string())?;
    if target.is_main {
        return Err("不能删除主 Worktree。".to_string());
    }
    let control = records
        .iter()
        .find(|record| !paths_match(Path::new(&record.path), Path::new(&target.path)) && Path::new(&record.path).is_dir())
        .map(|record| record.path.clone())
        .ok_or_else(|| "找不到可用于移除 Worktree 的存活工作树。".to_string())?;
    let main = records[0].path.clone();
    let delete_requested = delete_branch == Some(true);
    let mut args = vec!["worktree", "remove"];
    if force == Some(true) {
        args.push("--force");
        if target.locked {
            args.push("--force");
        }
    }
    args.extend(["--", target.path.as_str()]);
    let remove = git_success(&control, &args);
    let response = |ok, removed, deleted, stdout: String, stderr: String, message: String|
     -> Result<GitRemoveWorktreeResponse, String> {
        Ok(GitRemoveWorktreeResponse {
            ok,
            state: git_status_sync(control.clone())?,
            worktree_path: target.path.clone(),
            main_worktree_path: main.clone(),
            branch: target.branch.clone(),
            worktree_removed: removed,
            branch_delete_requested: delete_requested,
            branch_deleted: deleted,
            stdout,
            stderr,
            message,
        })
    };
    match remove {
        Err(error) => response(
            false,
            false,
            false,
            String::new(),
            error.clone(),
            error,
        ),
        Ok(output) if delete_requested && !target.branch.is_empty() => {
            match git_success(&control, &["branch", "-d", "--", target.branch.as_str()]) {
                Ok(branch_output) => response(
                    true,
                    true,
                    true,
                    [output.stdout, branch_output.stdout]
                        .into_iter()
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    branch_output.stderr,
                    "Worktree 与分支已删除。".to_string(),
                ),
                Err(error) => response(
                    false,
                    true,
                    false,
                    output.stdout,
                    error.clone(),
                    format!("Worktree 已移除，但分支删除失败：{error}"),
                ),
            }
        }
        Ok(output) => response(
            true,
            true,
            false,
            output.stdout,
            output.stderr,
            "Worktree 已移除。".to_string(),
        ),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn git_clone_repository(
    parent: String,
    name: String,
    remote_url: String,
    branch: Option<String>,
) -> Result<GitOperationResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = Arc::new(GitCloneTaskRegistry::default());
        let task = registry.start(parent, name, remote_url, branch)?;
        loop {
            let current = registry.task(&task.id)?;
            match current.status.as_str() {
                "completed" => {
                    return Ok(GitOperationResponse {
                        ok: true,
                        state: git_status_sync(current.target_path)?,
                        stdout: String::new(),
                        stderr: String::new(),
                        message: "仓库已克隆。".to_string(),
                    });
                }
                "failed" | "cancelled" => return Err(current.error),
                _ => thread::sleep(Duration::from_millis(100)),
            }
        }
    })
    .await
    .map_err(|error| format!("git_clone_repository join 失败：{error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub fn git_clone_repository_start(
    registry: tauri::State<'_, Arc<GitCloneTaskRegistry>>,
    parent: String,
    name: String,
    remote_url: String,
    branch: Option<String>,
) -> Result<GitCloneTask, String> {
    registry.start(parent, name, remote_url, branch)
}

#[tauri::command]
pub fn git_clone_repository_tasks(
    registry: tauri::State<'_, Arc<GitCloneTaskRegistry>>,
) -> Result<Vec<GitCloneTask>, String> {
    registry.snapshot()
}

#[tauri::command(rename_all = "snake_case")]
pub fn git_clone_repository_cancel(
    registry: tauri::State<'_, Arc<GitCloneTaskRegistry>>,
    task_id: String,
) -> Result<GitCloneTask, String> {
    registry.cancel(task_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn git_clone_repository_dismiss(
    registry: tauri::State<'_, Arc<GitCloneTaskRegistry>>,
    task_id: String,
) -> Result<Vec<GitCloneTask>, String> {
    registry.dismiss(task_id)?;
    registry.snapshot()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn git_list_remote_branches(
    remote_url: String,
) -> Result<GitRemoteBranchesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let remote_url = validate_git_remote_url(&remote_url)?;
        let scratch = tempfile::tempdir().map_err(|error| format!("创建临时目录失败：{error}"))?;
        let cwd = scratch.path().to_string_lossy().into_owned();
        let heads = git_success(&cwd, &["ls-remote", "--heads", "--", remote_url.as_str()])?;
        let mut branches = heads
            .stdout
            .lines()
            .filter_map(|line| line.split_once("refs/heads/").map(|(_, branch)| branch.trim()))
            .filter(|branch| !branch.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        branches.sort();
        branches.dedup();
        let default_branch = git_success(
            &cwd,
            &["ls-remote", "--symref", "--", remote_url.as_str(), "HEAD"],
        )
        .ok()
        .and_then(|output| {
            output.stdout.lines().find_map(|line| {
                line.strip_prefix("ref: refs/heads/")
                    .and_then(|line| line.split_once('\t').map(|(branch, _)| branch.trim().to_string()))
            })
        })
        .filter(|branch| branches.contains(branch))
        .unwrap_or_else(|| branches.first().cloned().unwrap_or_default());
        Ok(GitRemoteBranchesResponse {
            default_branch,
            branches,
        })
    })
    .await
    .map_err(|error| format!("git_list_remote_branches join 失败：{error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn git_create_worktree(
    workdir: String,
    branch: Option<String>,
    directory_name: Option<String>,
    parent_directory: Option<String>,
    start_point: Option<String>,
    name: Option<String>,
) -> Result<GitWorktreeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let legacy_name = name.unwrap_or_default();
        create_worktree_sync(
            workdir,
            branch.unwrap_or_else(|| legacy_name.clone()),
            directory_name.unwrap_or(legacy_name),
            parent_directory,
            start_point,
        )
    })
    .await
    .map_err(|error| format!("git_create_worktree join 失败：{error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn git_remove_worktree(
    workdir: String,
    worktree_path: String,
    force: Option<bool>,
    delete_branch: Option<bool>,
) -> Result<GitRemoveWorktreeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_worktree_sync(workdir, worktree_path, force, delete_branch)
    })
    .await
    .map_err(|error| format!("git_remove_worktree join 失败：{error}"))?
}
