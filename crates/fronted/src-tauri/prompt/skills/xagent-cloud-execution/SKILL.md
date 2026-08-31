---
name: xgent-cloud-execution
description: Run build, packaging, document, media, and other artifact-producing tasks in the user's public GitHub agent-temp repository with GitHub Actions. Use when the current device lacks the required toolchain, the requested target platform differs from the current platform, a mobile shell cannot complete the work, or the user explicitly asks to execute a task in the cloud and return its artifact.
---

# Xgent Cloud Execution

Choose the execution environment in this order:

1. Use the current device when its local runtime can complete the task.
2. Use a paired LAN desktop when it is available and has the required tools.
3. Use GitHub Actions when cloud execution is enabled and local or LAN execution is unavailable, unsuitable, or would require a large toolchain.

Use cloud execution for cross-platform builds such as creating an IPA from Windows, for large temporary toolchains, and for artifact-producing work such as APK/EXE packaging, PDF generation, presentation generation, and media processing.

Read [references/execution-contract.md](references/execution-contract.md) before starting a cloud task. It defines the generated repository layout, runner contract, environment injection, output rules, and retry semantics implemented by Xgent.

## Security and repository visibility

Treat every task script and input file as public because `agent-temp` is a public repository. Tell the user before uploading private source code, credentials, personal data, or proprietary assets.

Never request, print, place in task files, or pass through a workflow the GitHub personal access token. Xgent reads the token only from its encrypted local vault.

Configure runtime credentials and environment values in the `agent-temp` repository under **Settings → Secrets and variables → Actions**:

- Create a variable named `XGENT_CLOUD_ENV` for non-sensitive values.
- Create a secret named `XGENT_CLOUD_ENV` for sensitive values.
- Store one `NAME=value` entry per line.
- When the same name exists in both, the secret value takes precedence.

Do not embed secrets in generated files, command arguments, logs, artifact names, or assistant responses.

## Preparing a task

Select the smallest runner that supports the task:

- `ubuntu-latest` for Linux, Android, Node.js, Python, Go, documents, and most media work.
- `windows-latest` for Windows-only packaging or tooling.
- `macos-latest` for macOS and iOS builds.

Write a self-contained Bash script for Linux/macOS or PowerShell script for Windows. The script starts in the isolated `workspace` directory; read inputs relative to that directory and write every returned file to `../output`.

Keep a task within these upload limits:

- At most 100 input files.
- At most 2 MiB per file.
- At most 20 MiB total.
- At most 256 KiB for the entry script.

Do not depend on files from another task directory. Each retry is a new immutable task.

## Running and returning the result

1. Call the cloud task `start` action with a descriptive task name, runner, entry script, and all required input files.
2. Preserve the returned task ID.
3. Call `wait` repeatedly until the task reaches a completed state.
4. If the run fails, call `failure_log`, fix the task definition, and start a new task. Never mutate or rerun the failed task directory.
5. When the run succeeds, call `download_artifact`.
6. Return the downloaded local artifact path and a short description of its contents to the user.

Do not claim success until the workflow completed successfully and the artifact was downloaded.
