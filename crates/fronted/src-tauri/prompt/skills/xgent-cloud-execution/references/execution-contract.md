# Cloud execution contract

Xgent creates or adopts the configured public `agent-temp` repository and owns only these paths:

```text
.xgent-cloud.json
.github/workflows/xgent-cloud-task.yml
scripts/xgent-cloud-entry.sh
scripts/xgent-cloud-entry.ps1
scripts/xgent-cloud-agent/{package.json,runner.mjs,tools.mjs}
tasks/<task-id>/
├── manifest.json
├── run.sh or run.ps1
├── agent.json (only autonomous agent tasks)
├── workspace/
└── output/
```

Each `start` call creates a new immutable `tasks/<task-id>` commit and dispatches the shared workflow. Never read from or modify another task directory.

## Runner contract

- `ubuntu-latest`: Bash entry script; use for Android, Linux, Python, Node.js, Go, documents, and most media tasks.
- `macos-latest`: Bash entry script; use for Apple-only toolchains, macOS, and iOS.
- `windows-latest`: PowerShell entry script; use only for Windows-specific tools and packaging.

The task script starts in `tasks/<task-id>/workspace`. Input files use paths relative to this directory. Write all deliverables to `../output`; Xgent uploads that directory even when the task fails.

The shared workflow has read-only repository permissions and a six-hour job timeout. The caller selects artifact retention from 1 to 90 days.

## Environment injection

The runner loads newline-delimited `NAME=value` entries from the repository Actions variable and secret both named `XGENT_CLOUD_ENV`. Public values load first and secret values override matching names. Empty lines and lines beginning with `#` are ignored.

Use these values only through environment variables. Do not echo secrets, serialize them into outputs, or pass them in command-line arguments that may appear in logs.

## Lifecycle

For `start`, choose exactly one of `script` or `agent`. Agent fields: `prompt`, `provider` (`openai` or `anthropic`), the installed cloud SDK's catalog `model`, optional `maxTurns` (1–128, default 16), `maxToolCalls` (1–256, default 64), `maxOutputTokens` (128–16384, default 4096 per request) and `timeoutSeconds` (30–3600, default 1800). Prompts/configuration and input files remain public. No credentials field is accepted.

The Actions runner is a general task environment: a script chooses its own commands and dependency setup. The application does not project its dependency graph into the task, require pnpm, or enforce a frozen install. The optional `agent` mode prepares Node 22 and installs its own compatible SDK dependencies with ordinary npm and lifecycle scripts disabled. It does not require exact dependency versions matching the submitting application. Configure `XGENT_AGENT_PROVIDER=<provider>` and `XGENT_AGENT_API_KEY=<key>` inside the repository secret `XGENT_CLOUD_ENV` for that mode. Local chat/provider credentials are never copied. Model/provider mismatches fail; unconfigured or unknown catalog models fail. Dependency or workflow setup failure can leave no execution receipt or artifact.

The model can read/list/write task files and execute bounded commands with the runner's OS permissions. Commands are not an OS sandbox; their child environment removes API/GitHub credentials, but this is not isolation against a deliberately hostile program inspecting the runner. File APIs reject traversal/symlinks/reserved receipt paths. Text/command output is capped at 256 KiB; commands at 120 seconds; model context at 512 KiB. The runner cannot directly perform sender-device connector operations; delegate those to original-device branches.

Agent tasks create actual files plus `output/.xgent-agent/checkpoint.json` and `result.json`. Receipts contain the transcript, observed state/reason, turn/tool counts, final response and actual deliverable paths/sizes/SHA-256. Timeout, cancellation, model errors, missing final response or exhausted limits fail the job and preserve partial outputs. A started marker blocks replay in the same workspace. Checkpoints are diagnostic artifacts, not automatic restart/recovery; a new runner does not possess the prior workspace. SDK-checkpoint continuation is not part of the runner contract. Limits are local to the child task and do not replace parent shared-budget/cancellation accounting. Download and inspect receipts and actual deliverables; model completion is not evidence that all user criteria have been satisfied.

1. `start` returns the immutable task ID after committing and dispatching.
2. `status` or `wait` locates the workflow run by its task-specific run title.
3. A failed run remains immutable. Read `failure_log`, correct the inputs or script, and call `start` again.
4. The workflow uploads existing output under `xgent-<task-id>`, including on failure. No output, expiry or upload failure can leave no downloadable artifact.
5. `download_artifact` stores the actual artifact ZIP locally and returns its exact path and observed run ID/conclusion. Success is required by default; `include_partial: true` permits recovery from other completed conclusions.
6. `extract_artifact` uses the same verified download, imports files into a fresh `cloud-results-*` directory and returns actual relative paths, sizes, SHA-256 hashes and native installation/workspace identity. It does not require mobile shell utilities. The ZIP remains available too.

The importer refuses encrypted entries, links, special files, traversal and non-portable/colliding entry paths. It bounds the archive to 256 entries, each expanded file to 64 MiB, all expanded contents to 256 MiB and its file manifest to 96 KiB. It validates/decompresses into a private new staging directory before publishing the whole import; it does not overwrite existing workspace files or execute archive contents. Import errors are reported, not converted into file links. These are import bounds; existing background inbox publication still requires the pinned workspace and its own smaller file/transfer limits.

Chat file cards use the recorded source device/workspace rather than the currently selected workspace. Agent receipt files remain available to tools but are omitted from deliverable cards. A successful import means bytes were imported, not that the run or user task succeeded. Failed-run ZIPs are labelled partial; inspect receipts and actual deliverables before checking completion criteria. A committed task, queued run, or locally generated script is not a completed result.
