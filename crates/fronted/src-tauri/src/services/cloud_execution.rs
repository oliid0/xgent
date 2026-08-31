use std::collections::BTreeSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use futures_util::StreamExt;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const API_ROOT: &str = "https://api.github.com";
const REPOSITORY_MARKER_PATH: &str = ".xgent-cloud.json";
const WORKFLOW_FILE_NAME: &str = "xgent-cloud-task.yml";
const WORKFLOW_PATH: &str = ".github/workflows/xgent-cloud-task.yml";
const MAX_TASK_FILES: usize = 100;
const MAX_TASK_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TASK_TOTAL_BYTES: usize = 20 * 1024 * 1024;
const MAX_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_FAILURE_LOG_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;
const MAX_FAILURE_LOG_TAIL_BYTES: usize = 96 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 1024 * 1024 * 1024;

const REPOSITORY_MARKER: &str = r#"{
  "product": "xgent-cloud",
  "schemaVersion": 2,
  "managedPaths": [".github/workflows/xgent-cloud-task.yml", "scripts/xgent-cloud-entry.sh", "scripts/xgent-cloud-entry.ps1", "tasks/"]
}
"#;

const CLOUD_WORKFLOW: &str = r#"name: Xgent Cloud Task
run-name: Xgent cloud task ${{ inputs.task_id }}

on:
  workflow_dispatch:
    inputs:
      task_id:
        description: Validated Xgent task identifier
        required: true
        type: string
      runner:
        description: GitHub-hosted runner
        required: true
        type: choice
        options:
          - ubuntu-latest
          - windows-latest
          - macos-latest
      retention_days:
        description: Artifact retention in days
        required: true
        default: "7"
        type: string

permissions:
  contents: read

jobs:
  execute:
    runs-on: ${{ inputs.runner }}
    timeout-minutes: 360
    env:
      XGENT_CLOUD_PUBLIC_ENV: ${{ vars.XGENT_CLOUD_ENV }}
      XGENT_CLOUD_SECRET_ENV: ${{ secrets.XGENT_CLOUD_ENV }}
    steps:
      - uses: actions/checkout@v6
      - name: Execute task on Linux or macOS
        if: runner.os != 'Windows'
        shell: bash
        run: bash scripts/xgent-cloud-entry.sh "${{ inputs.task_id }}"
      - name: Execute task on Windows
        if: runner.os == 'Windows'
        shell: pwsh
        run: ./scripts/xgent-cloud-entry.ps1 -TaskId "${{ inputs.task_id }}"
      - name: Upload task outputs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: xgent-${{ inputs.task_id }}
          path: tasks/${{ inputs.task_id }}/output
          if-no-files-found: warn
          include-hidden-files: true
          retention-days: ${{ inputs.retention_days }}
"#;

const CLOUD_ENTRY_SH: &str = r#"#!/usr/bin/env bash
set -euo pipefail
task_id="${1:-}"
if [[ ! "$task_id" =~ ^[a-z0-9][a-z0-9-]{7,63}$ ]]; then
  echo "Invalid task id" >&2
  exit 64
fi
task_root="tasks/$task_id"
test -f "$task_root/run.sh"
mkdir -p "$task_root/workspace" "$task_root/output"
load_env_block() {
  local block="${1:-}" line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$line" != *=* || ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid Xgent cloud environment entry" >&2
      exit 65
    fi
    export "$key=$value"
  done <<< "$block"
}
load_env_block "${XGENT_CLOUD_PUBLIC_ENV:-}"
load_env_block "${XGENT_CLOUD_SECRET_ENV:-}"
unset XGENT_CLOUD_PUBLIC_ENV XGENT_CLOUD_SECRET_ENV
cd "$task_root/workspace"
bash ../run.sh
"#;

const CLOUD_ENTRY_PS1: &str = r##"param([Parameter(Mandatory=$true)][string]$TaskId)
$ErrorActionPreference = "Stop"
if ($TaskId -notmatch '^[a-z0-9][a-z0-9-]{7,63}$') { throw "Invalid task id" }
$TaskRoot = Join-Path "tasks" $TaskId
$RunScript = Join-Path $TaskRoot "run.ps1"
if (-not (Test-Path -LiteralPath $RunScript)) { throw "Task script is missing" }
New-Item -ItemType Directory -Force -Path (Join-Path $TaskRoot "workspace") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TaskRoot "output") | Out-Null
function Import-XgentEnvBlock([string]$Block) {
    if ([string]::IsNullOrEmpty($Block)) { return }
    foreach ($Line in ($Block -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($Line) -or $Line.TrimStart().StartsWith("#")) { continue }
        $Parts = $Line.Split('=', 2)
        if ($Parts.Count -ne 2 -or $Parts[0] -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "Invalid Xgent cloud environment entry"
        }
        [Environment]::SetEnvironmentVariable($Parts[0], $Parts[1], "Process")
    }
}
Import-XgentEnvBlock $env:XGENT_CLOUD_PUBLIC_ENV
Import-XgentEnvBlock $env:XGENT_CLOUD_SECRET_ENV
Remove-Item Env:XGENT_CLOUD_PUBLIC_ENV -ErrorAction SilentlyContinue
Remove-Item Env:XGENT_CLOUD_SECRET_ENV -ErrorAction SilentlyContinue
Push-Location (Join-Path $TaskRoot "workspace")
try { & (Join-Path ".." "run.ps1") } finally { Pop-Location }
"##;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskFileInput {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub encoding: CloudTaskFileEncoding,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudTaskFileEncoding {
    #[default]
    Utf8,
    Base64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskStartInput {
    #[serde(default)]
    pub owner: String,
    #[serde(default = "default_repository")]
    pub repository: String,
    pub runner: String,
    #[serde(default)]
    pub label: String,
    pub script: String,
    #[serde(default)]
    pub files: Vec<CloudTaskFileInput>,
    #[serde(default = "default_retention_days")]
    pub retention_days: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskStartResult {
    pub task_id: String,
    pub owner: String,
    pub repository: String,
    pub runner: String,
    pub repository_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskLocator {
    #[serde(default)]
    pub owner: String,
    #[serde(default = "default_repository")]
    pub repository: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskStatus {
    pub task_id: String,
    pub state: String,
    pub conclusion: Option<String>,
    pub run_id: Option<u64>,
    pub run_url: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskArtifactResult {
    pub task_id: String,
    pub artifact_id: u64,
    pub artifact_name: String,
    pub local_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTaskFailureReport {
    pub task_id: String,
    pub run_id: u64,
    pub run_url: String,
    pub conclusion: Option<String>,
    pub log_tail: String,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRepository {
    name: String,
    owner: GitHubRepositoryOwner,
    default_branch: String,
    html_url: String,
    private: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubRepositoryOwner {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubContent {
    sha: String,
    content: Option<String>,
    encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitReference {
    object: GitObject,
}

#[derive(Debug, Deserialize)]
struct GitObject {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GitCommit {
    tree: GitObject,
}

#[derive(Debug, Deserialize)]
struct GitMutationResult {
    sha: String,
}

struct CloudRepositoryFile {
    path: String,
    content: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct WorkflowRuns {
    workflow_runs: Vec<WorkflowRun>,
}

#[derive(Debug, Deserialize)]
struct WorkflowRun {
    id: u64,
    status: String,
    conclusion: Option<String>,
    html_url: String,
    display_title: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct WorkflowArtifacts {
    artifacts: Vec<WorkflowArtifact>,
}

#[derive(Debug, Deserialize)]
struct WorkflowArtifact {
    id: u64,
    name: String,
    expired: bool,
}

pub struct CloudExecutionService {
    client: Client,
    artifact_root: PathBuf,
    repository_write_guard: tokio::sync::Mutex<()>,
}

impl CloudExecutionService {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        let artifact_root = app_data_dir.join("cloud-artifacts");
        fs::create_dir_all(&artifact_root)
            .map_err(|error| format!("create cloud artifact directory failed: {error}"))?;
        let client = Client::builder()
            .user_agent("Xgent-Cloud-Execution/2")
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| format!("create GitHub client failed: {error}"))?;
        Ok(Self {
            client,
            artifact_root,
            repository_write_guard: tokio::sync::Mutex::new(()),
        })
    }

    pub async fn start_task(
        &self,
        token: &str,
        input: CloudTaskStartInput,
    ) -> Result<CloudTaskStartResult, String> {
        validate_runner(&input.runner)?;
        if input.script.len() > MAX_SCRIPT_BYTES {
            return Err("cloud task script is too large".to_string());
        }
        if input.files.len() > MAX_TASK_FILES {
            return Err(format!("cloud task supports at most {MAX_TASK_FILES} files"));
        }

        let _write_guard = self.repository_write_guard.lock().await;
        let retention_days = input.retention_days.clamp(1, 90);
        let repository_name = normalize_repository_name(&input.repository)?;
        let user = self.current_user(token).await?;
        let owner = if input.owner.trim().is_empty() {
            user.login.clone()
        } else {
            normalize_owner(&input.owner)?
        };
        let (repository, created) = self
            .ensure_repository(token, &user.login, &owner, &repository_name)
            .await?;
        self.ensure_managed_repository(token, &repository, created)
            .await?;

        let task_id = format!("task-{}", Uuid::new_v4().simple());
        let task_root = format!("tasks/{task_id}");
        let mut total_bytes = input.script.len();
        let mut seen_paths = BTreeSet::new();
        let mut task_files = Vec::with_capacity(input.files.len() + 2);

        for file in &input.files {
            let relative_path = validate_task_path(&file.path)?;
            if !seen_paths.insert(relative_path.clone()) {
                return Err(format!("duplicate cloud task file: {relative_path}"));
            }
            let bytes = match file.encoding {
                CloudTaskFileEncoding::Utf8 => file.content.as_bytes().to_vec(),
                CloudTaskFileEncoding::Base64 => BASE64
                    .decode(file.content.trim())
                    .map_err(|error| format!("decode {relative_path} as base64 failed: {error}"))?,
            };
            if bytes.len() > MAX_TASK_FILE_BYTES {
                return Err(format!("cloud task file exceeds 2 MiB: {relative_path}"));
            }
            total_bytes = total_bytes.saturating_add(bytes.len());
            if total_bytes > MAX_TASK_TOTAL_BYTES {
                return Err("cloud task input exceeds 20 MiB".to_string());
            }
            task_files.push(CloudRepositoryFile {
                path: format!("{task_root}/workspace/{relative_path}"),
                content: bytes,
            });
        }

        let script_path = if input.runner == "windows-latest" {
            format!("{task_root}/run.ps1")
        } else {
            format!("{task_root}/run.sh")
        };
        task_files.push(CloudRepositoryFile {
            path: script_path,
            content: input.script.into_bytes(),
        });
        let manifest = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 2,
            "taskId": &task_id,
            "label": input.label.trim(),
            "runner": &input.runner,
            "createdAt": Utc::now().to_rfc3339(),
            "inputFileCount": input.files.len(),
            "outputDirectory": "output",
            "repositoryVisibility": "public"
        }))
        .map_err(|error| format!("serialize cloud task manifest failed: {error}"))?;
        task_files.push(CloudRepositoryFile {
            path: format!("{task_root}/manifest.json"),
            content: manifest,
        });

        self.commit_files(
            token,
            &repository,
            task_files,
            &format!("cloud({task_id}): create isolated task"),
        )
        .await?;
        self.dispatch_workflow(
            token,
            &repository,
            &task_id,
            &input.runner,
            retention_days,
        )
        .await?;

        Ok(CloudTaskStartResult {
            task_id,
            owner: repository.owner.login.clone(),
            repository: repository.name.clone(),
            runner: input.runner,
            repository_url: repository.html_url.clone(),
        })
    }

    pub async fn task_status(
        &self,
        token: &str,
        locator: &CloudTaskLocator,
    ) -> Result<CloudTaskStatus, String> {
        let task_id = validate_task_id(&locator.task_id)?;
        let repository = self.resolve_managed_repository(token, locator).await?;
        let expected_title = format!("Xgent cloud task {task_id}");
        let mut run = None;
        for page in 1..=10 {
            let endpoint = format!(
                "{API_ROOT}/repos/{}/{}/actions/workflows/{}/runs?event=workflow_dispatch&branch={}&per_page=100&page={page}",
                repository.owner.login,
                repository.name,
                encode_segment(WORKFLOW_FILE_NAME),
                encode_segment(&repository.default_branch)
            );
            let response = self
                .request(Method::GET, endpoint, token)
                .send()
                .await
                .map_err(|error| format!("list cloud task runs failed: {error}"))?;
            let runs: WorkflowRuns = decode_json(response, "list cloud task runs").await?;
            let page_len = runs.workflow_runs.len();
            run = runs
                .workflow_runs
                .into_iter()
                .find(|candidate| candidate.display_title == expected_title);
            if run.is_some() || page_len < 100 {
                break;
            }
        }

        Ok(match run {
            Some(run) => CloudTaskStatus {
                task_id,
                state: run.status,
                conclusion: run.conclusion,
                run_id: Some(run.id),
                run_url: Some(run.html_url),
                updated_at: Some(run.updated_at),
            },
            None => CloudTaskStatus {
                task_id,
                state: "queued".to_string(),
                conclusion: None,
                run_id: None,
                run_url: None,
                updated_at: None,
            },
        })
    }

    pub async fn wait_for_task(
        &self,
        token: &str,
        locator: &CloudTaskLocator,
        max_wait_seconds: u64,
    ) -> Result<CloudTaskStatus, String> {
        let deadline =
            tokio::time::Instant::now() + Duration::from_secs(max_wait_seconds.clamp(1, 55));
        loop {
            let status = self.task_status(token, locator).await?;
            if status.state == "completed" || tokio::time::Instant::now() >= deadline {
                return Ok(status);
            }
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    }

    pub async fn failure_log(
        &self,
        token: &str,
        locator: &CloudTaskLocator,
    ) -> Result<CloudTaskFailureReport, String> {
        let status = self.task_status(token, locator).await?;
        if status.state != "completed" {
            return Err(format!("cloud task is not complete (state={})", status.state));
        }
        let run_id = status
            .run_id
            .ok_or_else(|| "cloud task run id is unavailable".to_string())?;
        let repository = self.resolve_managed_repository(token, locator).await?;
        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}/actions/runs/{run_id}/logs",
            repository.owner.login, repository.name
        );
        let response = self
            .request(Method::GET, endpoint, token)
            .send()
            .await
            .map_err(|error| format!("download cloud task logs failed: {error}"))?;
        let response = ensure_success(response, "download cloud task logs").await?;
        if response.content_length().unwrap_or(0) > MAX_FAILURE_LOG_ARCHIVE_BYTES as u64 {
            return Err("cloud task log archive exceeds 32 MiB".to_string());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("read cloud task logs failed: {error}"))?;
        if bytes.len() > MAX_FAILURE_LOG_ARCHIVE_BYTES {
            return Err("cloud task log archive exceeds 32 MiB".to_string());
        }
        let log_tail = tauri::async_runtime::spawn_blocking(move || extract_log_tail(&bytes))
            .await
            .map_err(|error| format!("read cloud task log archive join failed: {error}"))??;
        Ok(CloudTaskFailureReport {
            task_id: status.task_id,
            run_id,
            run_url: status.run_url.unwrap_or_default(),
            conclusion: status.conclusion,
            log_tail,
        })
    }

    pub async fn download_artifact(
        &self,
        token: &str,
        locator: &CloudTaskLocator,
        destination_dir: Option<&str>,
    ) -> Result<CloudTaskArtifactResult, String> {
        let status = self.task_status(token, locator).await?;
        if status.state != "completed" || status.conclusion.as_deref() != Some("success") {
            return Err(format!(
                "cloud task did not complete successfully (state={}, conclusion={})",
                status.state,
                status.conclusion.as_deref().unwrap_or("none")
            ));
        }
        let run_id = status
            .run_id
            .ok_or_else(|| "cloud task run id is unavailable".to_string())?;
        let repository = self.resolve_managed_repository(token, locator).await?;
        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}/actions/runs/{run_id}/artifacts?per_page=100",
            repository.owner.login, repository.name
        );
        let response = self
            .request(Method::GET, endpoint, token)
            .send()
            .await
            .map_err(|error| format!("list cloud task artifacts failed: {error}"))?;
        let artifacts: WorkflowArtifacts =
            decode_json(response, "list cloud task artifacts").await?;
        let expected_name = format!("xgent-{}", status.task_id);
        let artifact = artifacts
            .artifacts
            .into_iter()
            .find(|artifact| artifact.name == expected_name && !artifact.expired)
            .ok_or_else(|| "cloud task completed without a downloadable artifact".to_string())?;

        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}/actions/artifacts/{}/zip",
            repository.owner.login, repository.name, artifact.id
        );
        let response = self
            .request(Method::GET, endpoint, token)
            .send()
            .await
            .map_err(|error| format!("download cloud task artifact failed: {error}"))?;
        let response = ensure_success(response, "download cloud task artifact").await?;
        if response.content_length().unwrap_or(0) > MAX_ARTIFACT_BYTES {
            return Err("cloud task artifact exceeds 1 GiB".to_string());
        }

        let target_dir = destination_dir
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.artifact_root.join(&status.task_id));
        tokio::fs::create_dir_all(&target_dir)
            .await
            .map_err(|error| format!("create task artifact directory failed: {error}"))?;
        let target = target_dir.join(format!("{}-{}.zip", artifact.name, artifact.id));
        let partial = target_dir.join(format!(".{}.part-{}", artifact.name, Uuid::new_v4()));
        let mut file = tokio::fs::File::create(&partial)
            .await
            .map_err(|error| format!("create cloud task artifact file failed: {error}"))?;
        let mut stream = response.bytes_stream();
        let mut size_bytes = 0_u64;
        let download_result = async {
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|error| format!("read cloud task artifact failed: {error}"))?;
                size_bytes = size_bytes.saturating_add(chunk.len() as u64);
                if size_bytes > MAX_ARTIFACT_BYTES {
                    return Err("cloud task artifact exceeds 1 GiB".to_string());
                }
                file.write_all(&chunk)
                    .await
                    .map_err(|error| format!("save cloud task artifact failed: {error}"))?;
            }
            file.flush()
                .await
                .map_err(|error| format!("flush cloud task artifact failed: {error}"))?;
            drop(file);
            tokio::fs::rename(&partial, &target)
                .await
                .map_err(|error| format!("publish cloud task artifact failed: {error}"))
        }
        .await;
        if let Err(error) = download_result {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(error);
        }

        Ok(CloudTaskArtifactResult {
            task_id: status.task_id,
            artifact_id: artifact.id,
            artifact_name: artifact.name,
            local_path: target.to_string_lossy().into_owned(),
            size_bytes,
        })
    }

    async fn current_user(&self, token: &str) -> Result<GitHubUser, String> {
        let response = self
            .request(Method::GET, format!("{API_ROOT}/user"), token)
            .send()
            .await
            .map_err(|error| format!("read GitHub user failed: {error}"))?;
        decode_json(response, "read GitHub user").await
    }

    async fn ensure_repository(
        &self,
        token: &str,
        authenticated_login: &str,
        owner: &str,
        repository: &str,
    ) -> Result<(GitHubRepository, bool), String> {
        if let Some(repository) = self.get_repository(token, owner, repository).await? {
            return Ok((repository, false));
        }
        let endpoint = if owner.eq_ignore_ascii_case(authenticated_login) {
            format!("{API_ROOT}/user/repos")
        } else {
            format!("{API_ROOT}/orgs/{}/repos", encode_segment(owner))
        };
        let response = self
            .request(Method::POST, endpoint, token)
            .json(&json!({
                "name": repository,
                "description": "Public Xgent cloud execution workspace with Actions environment injection",
                "private": false,
                "auto_init": true
            }))
            .send()
            .await
            .map_err(|error| format!("create GitHub cloud repository failed: {error}"))?;
        let repository = decode_json(response, "create GitHub cloud repository").await?;
        Ok((repository, true))
    }

    async fn resolve_managed_repository(
        &self,
        token: &str,
        locator: &CloudTaskLocator,
    ) -> Result<GitHubRepository, String> {
        let repository_name = normalize_repository_name(&locator.repository)?;
        let owner = if locator.owner.trim().is_empty() {
            self.current_user(token).await?.login
        } else {
            normalize_owner(&locator.owner)?
        };
        let repository = self
            .get_repository(token, &owner, &repository_name)
            .await?
            .ok_or_else(|| format!("GitHub repository {owner}/{repository_name} does not exist"))?;
        self.verify_managed_repository(token, &repository).await?;
        Ok(repository)
    }

    async fn get_repository(
        &self,
        token: &str,
        owner: &str,
        repository: &str,
    ) -> Result<Option<GitHubRepository>, String> {
        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}",
            encode_segment(owner),
            encode_segment(repository)
        );
        let response = self
            .request(Method::GET, endpoint, token)
            .send()
            .await
            .map_err(|error| format!("read GitHub cloud repository failed: {error}"))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        decode_json(response, "read GitHub cloud repository")
            .await
            .map(Some)
    }

    async fn verify_managed_repository(
        &self,
        token: &str,
        repository: &GitHubRepository,
    ) -> Result<(), String> {
        if repository.private {
            return Err(format!(
                "GitHub repository {}/{} is private; make the Xgent cloud task repository public before using hosted Actions",
                repository.owner.login, repository.name
            ));
        }
        let marker = self
            .get_content(token, repository, REPOSITORY_MARKER_PATH)
            .await?
            .and_then(|(_, content)| content)
            .ok_or_else(|| {
                format!(
                    "refusing to use {}/{} because it is not an Xgent-managed repository",
                    repository.owner.login, repository.name
                )
            })?;
        let value: Value = serde_json::from_slice(&marker)
            .map_err(|_| "Xgent cloud repository marker is invalid".to_string())?;
        if value.get("product").and_then(Value::as_str) != Some("xgent-cloud") {
            return Err("Xgent cloud repository marker has an unexpected product".to_string());
        }
        Ok(())
    }

    async fn ensure_managed_repository(
        &self,
        token: &str,
        repository: &GitHubRepository,
        created: bool,
    ) -> Result<(), String> {
        if repository.private {
            return Err(format!(
                "GitHub repository {}/{} is private; make the Xgent cloud task repository public before using hosted Actions",
                repository.owner.login, repository.name
            ));
        }
        if !created
            && self
                .get_content(token, repository, REPOSITORY_MARKER_PATH)
                .await?
                .is_some()
        {
            self.verify_managed_repository(token, repository).await?;
        }
        self.commit_files_if_changed(
            token,
            repository,
            vec![
                CloudRepositoryFile {
                    path: REPOSITORY_MARKER_PATH.to_string(),
                    content: REPOSITORY_MARKER.as_bytes().to_vec(),
                },
                CloudRepositoryFile {
                    path: WORKFLOW_PATH.to_string(),
                    content: CLOUD_WORKFLOW.as_bytes().to_vec(),
                },
                CloudRepositoryFile {
                    path: "scripts/xgent-cloud-entry.sh".to_string(),
                    content: CLOUD_ENTRY_SH.as_bytes().to_vec(),
                },
                CloudRepositoryFile {
                    path: "scripts/xgent-cloud-entry.ps1".to_string(),
                    content: CLOUD_ENTRY_PS1.as_bytes().to_vec(),
                },
            ],
            "cloud: update managed execution infrastructure",
        )
        .await
    }

    async fn dispatch_workflow(
        &self,
        token: &str,
        repository: &GitHubRepository,
        task_id: &str,
        runner: &str,
        retention_days: u8,
    ) -> Result<(), String> {
        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}/actions/workflows/{}/dispatches",
            repository.owner.login,
            repository.name,
            encode_segment(WORKFLOW_FILE_NAME)
        );
        let response = self
            .request(Method::POST, endpoint, token)
            .json(&json!({
                "ref": repository.default_branch,
                "inputs": {
                    "task_id": task_id,
                    "runner": runner,
                    "retention_days": retention_days.to_string()
                }
            }))
            .send()
            .await
            .map_err(|error| format!("dispatch cloud task workflow failed: {error}"))?;
        ensure_success(response, "dispatch cloud task workflow")
            .await
            .map(|_| ())
    }

    async fn get_content(
        &self,
        token: &str,
        repository: &GitHubRepository,
        path: &str,
    ) -> Result<Option<(String, Option<Vec<u8>>)>, String> {
        let endpoint = format!(
            "{API_ROOT}/repos/{}/{}/contents/{}?ref={}",
            repository.owner.login,
            repository.name,
            encode_path(path),
            encode_segment(&repository.default_branch)
        );
        let response = self
            .request(Method::GET, endpoint, token)
            .send()
            .await
            .map_err(|error| format!("read GitHub content {path} failed: {error}"))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let content: GitHubContent =
            decode_json(response, &format!("read GitHub content {path}")).await?;
        let decoded = match (content.encoding.as_deref(), content.content) {
            (Some("base64"), Some(value)) => Some(
                BASE64
                    .decode(value.replace('\r', "").replace('\n', ""))
                    .map_err(|error| format!("decode GitHub content {path} failed: {error}"))?,
            ),
            _ => None,
        };
        Ok(Some((content.sha, decoded)))
    }

    async fn commit_files_if_changed(
        &self,
        token: &str,
        repository: &GitHubRepository,
        files: Vec<CloudRepositoryFile>,
        message: &str,
    ) -> Result<(), String> {
        let mut changed = Vec::new();
        for file in files {
            let existing = self
                .get_content(token, repository, &file.path)
                .await?
                .and_then(|(_, content)| content);
            if existing.as_deref() != Some(file.content.as_slice()) {
                changed.push(file);
            }
        }
        if changed.is_empty() {
            return Ok(());
        }
        self.commit_files(token, repository, changed, message).await
    }

    async fn commit_files(
        &self,
        token: &str,
        repository: &GitHubRepository,
        files: Vec<CloudRepositoryFile>,
        message: &str,
    ) -> Result<(), String> {
        if files.is_empty() {
            return Err("cloud task commit contains no files".to_string());
        }

        let mut blobs = Vec::with_capacity(files.len());
        for file in files {
            let endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/blobs",
                repository.owner.login, repository.name
            );
            let response = self
                .request(Method::POST, endpoint, token)
                .json(&json!({
                    "content": BASE64.encode(&file.content),
                    "encoding": "base64"
                }))
                .send()
                .await
                .map_err(|error| format!("create GitHub blob {} failed: {error}", file.path))?;
            let blob: GitMutationResult =
                decode_json(response, &format!("create GitHub blob {}", file.path)).await?;
            blobs.push((file.path, blob.sha));
        }

        for attempt in 1..=3 {
            let branch = encode_segment(&repository.default_branch);
            let reference_endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/ref/heads/{branch}",
                repository.owner.login, repository.name
            );
            let reference: GitReference = decode_json(
                self.request(Method::GET, reference_endpoint, token)
                    .send()
                    .await
                    .map_err(|error| format!("read GitHub branch head failed: {error}"))?,
                "read GitHub branch head",
            )
            .await?;
            let parent_sha = reference.object.sha;

            let commit_endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/commits/{}",
                repository.owner.login,
                repository.name,
                encode_segment(&parent_sha)
            );
            let parent: GitCommit = decode_json(
                self.request(Method::GET, commit_endpoint, token)
                    .send()
                    .await
                    .map_err(|error| format!("read GitHub parent commit failed: {error}"))?,
                "read GitHub parent commit",
            )
            .await?;

            let tree_entries = blobs
                .iter()
                .map(|(path, sha)| {
                    json!({
                        "path": path,
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha
                    })
                })
                .collect::<Vec<_>>();
            let tree_endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/trees",
                repository.owner.login, repository.name
            );
            let tree: GitMutationResult = decode_json(
                self.request(Method::POST, tree_endpoint, token)
                    .json(&json!({
                        "base_tree": parent.tree.sha,
                        "tree": tree_entries
                    }))
                    .send()
                    .await
                    .map_err(|error| format!("create GitHub task tree failed: {error}"))?,
                "create GitHub task tree",
            )
            .await?;

            let create_commit_endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/commits",
                repository.owner.login, repository.name
            );
            let commit: GitMutationResult = decode_json(
                self.request(Method::POST, create_commit_endpoint, token)
                    .json(&json!({
                        "message": message,
                        "tree": tree.sha,
                        "parents": [parent_sha]
                    }))
                    .send()
                    .await
                    .map_err(|error| format!("create GitHub task commit failed: {error}"))?,
                "create GitHub task commit",
            )
            .await?;

            let update_reference_endpoint = format!(
                "{API_ROOT}/repos/{}/{}/git/refs/heads/{branch}",
                repository.owner.login, repository.name
            );
            let response = self
                .request(Method::PATCH, update_reference_endpoint, token)
                .json(&json!({ "sha": commit.sha, "force": false }))
                .send()
                .await
                .map_err(|error| format!("publish GitHub task commit failed: {error}"))?;
            if response.status().is_success() {
                return Ok(());
            }
            if attempt == 3
                || !matches!(
                    response.status(),
                    StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
                )
            {
                return ensure_success(response, "publish GitHub task commit")
                    .await
                    .map(|_| ());
            }
        }

        Err("publish GitHub task commit exhausted retries".to_string())
    }

    fn request(&self, method: Method, endpoint: String, token: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, endpoint)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }
}

fn default_repository() -> String {
    "agent-temp".to_string()
}

fn default_retention_days() -> u8 {
    7
}

fn normalize_owner(value: &str) -> Result<String, String> {
    validate_repo_component(value, "GitHub owner")
}

fn normalize_repository_name(value: &str) -> Result<String, String> {
    let value = if value.trim().is_empty() {
        "agent-temp"
    } else {
        value.trim()
    };
    validate_repo_component(value, "GitHub repository")
}

fn validate_repo_component(value: &str, label: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized.len() > 100
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(normalized.to_string())
}

fn validate_runner(value: &str) -> Result<(), String> {
    if matches!(
        value,
        "ubuntu-latest" | "windows-latest" | "macos-latest"
    ) {
        Ok(())
    } else {
        Err("cloud task runner must be ubuntu-latest, windows-latest, or macos-latest".to_string())
    }
}

fn validate_task_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() < 8
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || !value.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err("cloud task id is invalid".to_string());
    }
    Ok(value.to_string())
}

fn validate_task_path(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.len() > 512 || normalized.starts_with('/') {
        return Err("cloud task file path is invalid".to_string());
    }
    let components: Vec<&str> = normalized.split('/').collect();
    if components.iter().any(|part| {
        part.is_empty()
            || *part == "."
            || *part == ".."
            || part
                .chars()
                .any(|character| character == '\0' || character.is_control())
    }) {
        return Err(format!("cloud task file path is unsafe: {normalized}"));
    }
    Ok(components.join("/"))
}

fn extract_log_tail(bytes: &[u8]) -> Result<String, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("open cloud task log archive failed: {error}"))?;
    let mut combined = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("read cloud task log entry failed: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let safe_name = entry
            .name()
            .chars()
            .filter(|character| !character.is_control())
            .take(160)
            .collect::<String>();
        combined.extend_from_slice(format!("\n===== {safe_name} =====\n").as_bytes());
        let mut entry_tail = Vec::new();
        entry
            .by_ref()
            .take((MAX_FAILURE_LOG_TAIL_BYTES * 2) as u64)
            .read_to_end(&mut entry_tail)
            .map_err(|error| format!("read cloud task log text failed: {error}"))?;
        if entry_tail.len() > MAX_FAILURE_LOG_TAIL_BYTES {
            entry_tail.drain(..entry_tail.len() - MAX_FAILURE_LOG_TAIL_BYTES);
        }
        combined.extend_from_slice(&entry_tail);
        if combined.len() > MAX_FAILURE_LOG_TAIL_BYTES * 2 {
            combined.drain(..combined.len() - MAX_FAILURE_LOG_TAIL_BYTES * 2);
        }
    }
    if combined.len() > MAX_FAILURE_LOG_TAIL_BYTES {
        combined.drain(..combined.len() - MAX_FAILURE_LOG_TAIL_BYTES);
    }
    Ok(String::from_utf8_lossy(&combined).into_owned())
}

fn encode_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn encode_path(value: &str) -> String {
    value
        .split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

async fn ensure_success(
    response: reqwest::Response,
    action: &str,
) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(500).collect());
    Err(format!(
        "{action} failed with GitHub HTTP {status}: {message}"
    ))
}

async fn decode_json<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    action: &str,
) -> Result<T, String> {
    ensure_success(response, action)
        .await?
        .json::<T>()
        .await
        .map_err(|error| format!("decode {action} response failed: {error}"))
}
