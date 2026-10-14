import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";

const LIMIT = 256 * 1024;
export function commandEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => /^(PATH|HOME|USERPROFILE|SystemRoot|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|JAVA_HOME|ANDROID_HOME|ANDROID_SDK_ROOT|DEVELOPER_DIR)$/i.test(key)));
}

function inside(root, file) { const relative = path.relative(root, file); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
async function target(root, relative, writing = false) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\0")) throw new Error("A relative task path is required");
  const file = path.resolve(root, relative);
  if (!inside(root, file) || path.relative(root, file).split(path.sep).includes(".xgent-agent")) throw new Error("Path is outside task storage or reserved for execution receipts");
  // Reject existing symlink parents, including dangling links, before mkdir/write.
  let current = root;
  for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Task file tools do not follow symlinks"); }
    catch (error) { if (error.code !== "ENOENT") throw error; if (!writing) throw error; }
  }
  return file;
}

export async function runCommand(command, { cwd, signal, env, timeoutMs = 120000 }) {
  if (signal?.aborted) throw new Error("Cancelled");
  if (typeof command !== "string" || !command.trim() || command.length > 32768) throw new Error("A bounded command is required");
  const windows = process.platform === "win32";
  return new Promise((resolve, reject) => {
    const child = spawn(windows ? "pwsh" : "bash", windows ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command], {
      cwd, env: commandEnvironment(env), detached: !windows, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", total = 0, failure;
    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      if (windows) {
        if (child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => stop("Command timed out; inspect partial artifacts before retrying"), timeoutMs);
    const abort = () => stop("Cancelled; command effects may already have occurred");
    signal?.addEventListener("abort", abort, { once: true });
    const append = chunk => { total += chunk.length; if (total <= LIMIT) output += chunk.toString("utf8"); else stop("Command output limit exceeded; effects may already have occurred"); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.on("error", error => { cleanup(); reject(error); });
    child.on("close", (code, killedBy) => { cleanup(); if (failure) reject(new Error(failure)); else if (code !== 0) reject(new Error(`Command exited ${code ?? killedBy}: ${output}`)); else resolve(output); });
  });
}

export async function cloudTools(workspace, output, env, scrub) {
  await mkdir(workspace, { recursive: true }); await mkdir(output, { recursive: true });
  const roots = { workspace: await realpath(workspace), output: await realpath(output) };
  const location = Type.Union([Type.Literal("workspace"), Type.Literal("output")]);
  const reply = (text, details = {}) => ({ content: [{ type: "text", text: scrub(text) }], details });
  return [
    { name: "ReadTaskFile", label: "Read task file", description: "Read a UTF-8 text file, at most 256 KiB. Use commands for binary document extraction.",
      parameters: Type.Object({ storage: location, path: Type.String() }),
      async execute(_id, args, signal) { signal?.throwIfAborted(); const file = await target(roots[args.storage], args.path); const stat = await lstat(file);
        if (!stat.isFile() || stat.size > LIMIT) throw new Error("Read requires a regular file no larger than 256 KiB");
        return reply(await readFile(file, "utf8"), { path: args.path, bytes: stat.size }); },
    },
    { name: "WriteTaskFile", label: "Write task file", description: "Write UTF-8 source or deliverable. Use output storage for final documents/websites; commands can generate binary files.",
      parameters: Type.Object({ storage: location, path: Type.String(), content: Type.String() }),
      async execute(_id, args, signal) { signal?.throwIfAborted(); if (Buffer.byteLength(args.content) > LIMIT) throw new Error("Write exceeds 256 KiB");
        const file = await target(roots[args.storage], args.path, true); await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, args.content, { flag: "w" }); return reply("File written", { path: args.path, bytes: Buffer.byteLength(args.content) }); },
    },
    { name: "ListTaskFiles", label: "List task files", description: "List up to 200 immediate entries; omitted entries are marked as truncated.",
      parameters: Type.Object({ storage: location, path: Type.Optional(Type.String()) }),
      async execute(_id, args, signal) { signal?.throwIfAborted(); const dir = args.path ? await target(roots[args.storage], args.path) : roots[args.storage];
        const entries = await readdir(dir, { withFileTypes: true }); const visible = entries.filter(e => e.name !== ".xgent-agent");
        return reply(JSON.stringify({ entries: visible.slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() })), truncated: visible.length > 200 })); },
    },
    { name: "RunTaskCommand", label: "Run task command", description: "Run Bash (Linux/macOS) or PowerShell (Windows) in the task workspace. Has runner OS permissions, not an OS sandbox. Credentials are removed from the child environment. Commands have a 120-second timeout and 256-KiB output cap; write deliverables to ../output.",
      parameters: Type.Object({ command: Type.String() }),
      async execute(_id, args, signal) { return reply(await runCommand(args.command, { cwd: roots.workspace, signal, env })); },
    },
  ];
}
