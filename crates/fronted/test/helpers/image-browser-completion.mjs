import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Wait for actual image decode/encoding completion, independent of virtual time. */
export async function imageBrowserCompletion(browser, fileURL, directory) {
  const profile = path.join(directory, "image-profile");
  const child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--no-sandbox", "--allow-file-access-from-files",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "", ended = false, launchError;
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
  const exited = new Promise(resolve => {
    child.once("exit", () => { ended = true; resolve(); });
    child.once("error", error => { launchError = error; ended = true; resolve(); });
  });
  let socket, rejectPending = () => {};
  try {
    const deadline = Date.now() + 30000;
    let port;
    while (Date.now() < deadline && !ended) {
      try {
        const active = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
        const candidate = Number(active.split("\n")[0]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) { port = candidate; break; }
      } catch (error) {
        // Windows can lock this file briefly while the owned browser writes its port.
        if (!["ENOENT", "EBUSY", "EACCES", "EPERM"].includes(error.code)) throw error;
      }
      await delay(25);
    }
    if (!port) throw launchError ?? new Error(`Image browser did not start: ${stderr}`);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,
      { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!targetResponse.ok) throw new Error(`Image browser target failed: ${targetResponse.status}`);
    const target = await targetResponse.json();
    const endpoint = new URL(target.webSocketDebuggerUrl);
    if (endpoint.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname) || Number(endpoint.port) !== port) {
      throw new Error("Image browser debugger escaped its owned loopback port");
    }
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Image browser connection timed out")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Image browser connection failed")); }, { once: true });
    });
    let sequence = 0;
    let navigated = false, loaded = false;
    const pending = new Map();
    rejectPending = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
    socket.addEventListener("close", () => rejectPending(new Error("Image browser debugger closed")));
    socket.addEventListener("error", () => rejectPending(new Error("Image browser debugger failed")));
    socket.addEventListener("message", event => {
      const response = JSON.parse(event.data);
      if (response.method === "Page.frameNavigated" && response.params.frame.url === fileURL) navigated = true;
      if (response.method === "Page.loadEventFired" && navigated) loaded = true;
      const item = pending.get(response.id);
      if (!item) return;
      pending.delete(response.id); clearTimeout(item.timer);
      if (response.error) item.reject(new Error(response.error.message)); else item.resolve(response.result);
    });
    const send = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Image browser ${method} timed out`)); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
    await send("Page.enable");
    const navigation = await send("Page.navigate", { url: fileURL });
    if (navigation.errorText) throw new Error(`Image fixture navigation failed: ${navigation.errorText}`);
    await send("Page.bringToFront");
    // Await this file's actual load event before creating a promise in its execution context.
    while (!loaded && Date.now() < deadline && !ended) await delay(20);
    if (!loaded) throw new Error(`Image browser did not load its fixture: ${stderr}`);
    const evaluated = await send("Runtime.evaluate", {
      expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 25000;
        const poll = () => {
          const value = document.getElementById("result")?.textContent;
          if (value) resolve(value);
          else if (Date.now() >= deadline) reject(new Error("Image fixture did not complete"));
          else setTimeout(poll, 20);
        };
        poll();
      })`,
      awaitPromise: true, returnByValue: true,
    });
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);
    if (typeof evaluated.result?.value !== "string") throw new Error("Image browser returned no completion result");
    const encoded = evaluated.result.value;
    await send("Browser.close", {}, 3000).catch(() => {});
    return encoded;
  } finally {
    rejectPending(new Error("Image browser fixture ended"));
    socket?.close();
    if (!ended) {
      // Browser.close is graceful. Give the owned process time to release its profile.
      const controller = new AbortController();
      try { await Promise.race([exited, delay(3000, null, { signal: controller.signal })]); }
      finally { controller.abort(); }
      if (!ended) child.kill();
    }
    await exited;
  }
}
