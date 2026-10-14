import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read = path => readFileSync(new URL(`../../src-tauri/src/${path}`, import.meta.url), "utf8");
const background = read("services/automation/store/background.rs");
const query = [...background.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(m => m[1].startsWith("SELECT json_extract(b.input_json, '$.providerId')"))?.[1];

test("actual native queue SQL isolates provider/model identities, terminal tasks and parked work", () => {
  assert.ok(query);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE automation_background_tasks(execution_id TEXT, input_json TEXT); CREATE TABLE automation_cron_runs(execution_id TEXT, state TEXT);");
    const add = (execution, provider, model, state, background = true) => {
      if (background) db.prepare("INSERT INTO automation_background_tasks VALUES (?,?)").run(execution, JSON.stringify({ providerId: provider, model }));
      db.prepare("INSERT INTO automation_cron_runs VALUES (?,?)").run(execution, state);
    };
    add("a", "p1", "same", "pending"); add("b", "p1", "same", "leased"); add("c", "p1", "same", "waiting");
    add("d", "p2", "same", "pending"); add("e", "p1", "other", "leased");
    for (const state of ["completed", "failed", "cancelled", "expired"]) add(state, "p1", "same", state);
    add("cron", "p1", "same", "leased", false);
    db.exec("PRAGMA reverse_unordered_selects=ON");
    const rows = db.prepare(query).all().map(row => Object.values(row)).sort((a,b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
    assert.deepEqual(rows, [["p1", "other", 0, 1, 0], ["p1", "same", 1, 1, 1], ["p2", "same", 1, 0, 0]]);
    db.prepare("UPDATE automation_cron_runs SET state='completed' WHERE execution_id='b'").run();
    const updated = db.prepare(query).all().map(row => Object.values(row)).find(row => row[0] === "p1" && row[1] === "same");
    assert.deepEqual(updated, ["p1", "same", 1, 0, 1]);
  } finally { db.close(); }
});

test("native specialization acceptance uses the exact host-owned model and frozen settings transaction", () => {
  const settings = read("commands/config/settings/background_execution.rs");
  assert.match(settings, /model\.get\("id"\).*Some\(input\.model\.as_str\(\)\)/s);
  assert.match(settings, /selected\.map\(crate::services::worker_inventory::configured_model_skills\)/);
  assert.match(settings, /requirements\.model_skills\.iter\(\)\.any\(\|required\| !skills\.contains\(required\)\)/);
  assert.ok(settings.indexOf("requirements.model_skills") < settings.indexOf("let mut snapshot"));
  assert.match(background, /capture\(&tx, &input\)/);
  const peer = read("services/worker_peers.rs");
  assert.match(peer, /modelSkills[\s\S]*host\.model_routing_version != 1[\s\S]*no task was sent/);
  assert.match(read("commands/automation/cron.rs"), /config\.map\(crate::services::worker_inventory::configured_model_skills\)/);
});
