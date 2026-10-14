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

Choose either a self-contained `script` or an autonomous `agent` configuration, never both. Use `agent` when the runner must continue planning, invoking tools and verifying generated files after the sender goes offline; read its exact fields, credentials and budgets in the execution contract. Actions must already have matching `XGENT_AGENT_PROVIDER` and `XGENT_AGENT_API_KEY` in secret environment; never upload local chat credentials. Mobile calendar/reminder/health/home operations stay on original-device branches.

Scripts use Bash for Linux/macOS or PowerShell for Windows. Execution starts in the isolated `workspace` directory; read inputs relative to that directory and write every returned file to `../output`.

Keep a task within these upload limits:

- At most 100 input files.
- At most 2 MiB per file.
- At most 20 MiB total.
- At most 256 KiB for the entry script.

Do not depend on files from another task directory. Each retry is a new immutable task.

## Running and returning the result

1. Call the cloud task `start` action with a descriptive task name, runner, exactly one script or agent, and all required input files.
2. Preserve the returned task ID.
3. Call `wait` repeatedly until the task reaches a completed state.
4. If the run fails, call `failure_log`. When useful, recover existing partial outputs with `extract_artifact` and `include_partial: true`; this does not change the failed job's conclusion. Correct the task definition within the original authority and budgets before starting a new task. Never mutate or rerun the failed task directory.
5. Call `extract_artifact` to download and import actual files into a new local directory without a shell. The tool uses its captured workspace as the destination, or the native artifact cache if none is configured. Background inbox publication requires files in the task's pinned workspace. Use `download_artifact` when only the ZIP is needed. Both actions require a completed run and an actual unexpired artifact; partial recovery requires explicit opt-in.
6. Inspect the returned files using their recorded workspace and paths; for agent tasks also read `.xgent-agent/result.json` and its final/partial state. Return actual file links and an accurate description of inspected contents to the user. File source identity is recorded by the native importer, not supplied by the model.

Do not claim task success from download/import alone. Check the workflow conclusion, receipts, actual contents and all requested criteria. Label recovered outputs from a failed run as partial.
