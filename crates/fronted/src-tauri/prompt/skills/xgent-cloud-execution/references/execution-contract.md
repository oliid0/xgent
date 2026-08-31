# Cloud execution contract

Xgent creates or adopts the configured public `agent-temp` repository and owns only these paths:

```text
.xgent-cloud.json
.github/workflows/xgent-cloud-task.yml
scripts/xgent-cloud-entry.sh
scripts/xgent-cloud-entry.ps1
tasks/<task-id>/
├── manifest.json
├── run.sh or run.ps1
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

1. `start` returns the immutable task ID after committing and dispatching.
2. `status` or `wait` locates the workflow run by its task-specific run title.
3. A failed run remains immutable. Read `failure_log`, correct the inputs or script, and call `start` again.
4. A successful run produces an artifact named `xgent-<task-id>`.
5. `download_artifact` stores the artifact ZIP locally and returns its exact path.

Success means the workflow conclusion is `success` and the artifact ZIP has downloaded. A committed task, queued run, or locally generated script is not a completed result.
