import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(`../../src-tauri/src/${file}`, import.meta.url), "utf8");

test("native source contract: agent input validates before network effects and enters the original managed public workflow", () => {
  const source = read("services/cloud_execution.rs"), launch = read("services/automation/store/cloud_launch.rs");
  const start = source.slice(source.indexOf("async fn start_task_with_id("), source.indexOf("async fn task_status("));
  assert.ok(start.indexOf("input.validate_execution()?") < start.indexOf("self.current_user(token)"));
  assert.match(start, /task_root\}\/agent\.json/); assert.match(start, /CLOUD_AGENT_PS1/); assert.match(start, /CLOUD_AGENT_SH/);
  assert.match(source, /hashFiles\(format\('tasks\/\{0\}\/agent\.json'/);
  assert.match(source, /uses: actions\/setup-node@v6/);
  for (const file of ["package.json", "runner.mjs", "tools.mjs"]) assert.ok(source.includes(`include_str!("cloud_agent/${file}")`));
  assert.match(launch, /input\.validate_execution\(\)\?/);
  assert.match(launch, /Sha256::digest\(raw\.as_bytes\(\)\)/, "original agent arguments remain part of the immutable journal authority");
  const runtime = JSON.parse(read("services/cloud_agent/package.json"));
  assert.equal(runtime.dependencies["@earendil-works/pi-agent-core"], "^0.85.1");
  assert.equal(runtime.dependencies["@earendil-works/pi-ai"], "^0.85.1");
  assert.equal(runtime.packageManager, undefined);
  assert.equal(runtime.engines, undefined);
});

test("native runner workflow keeps arbitrary scripts independent from optional agent dependency installation", () => {
  const source = read("services/cloud_execution.rs");
  assert.doesNotMatch(source, /pnpm\/action-setup|pnpm --version|--frozen-lockfile|cloud_agent\/(?:lockfile\.mjs|pnpm-lock\.yaml)/);
  assert.match(source, /if: hashFiles\(format\('tasks\/\{0\}\/agent\.json', inputs\.task_id\)\) != ''/);
  for (const constant of ["CLOUD_AGENT_SH", "CLOUD_AGENT_PS1"]) {
    const script = source.split(`const ${constant}: &str = r#"`)[1].split('"#;')[0];
    assert.match(script, /npm --prefix/); assert.match(script, /--ignore-scripts/);
    assert.ok(script.indexOf("npm --prefix") < script.indexOf("runner.mjs"));
    assert.doesNotMatch(script, /pnpm|lockfile|packageManager|\bbuild\b/);
  }
});
