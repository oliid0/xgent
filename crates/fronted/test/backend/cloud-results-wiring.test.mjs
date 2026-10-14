import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(`../../src-tauri/src/${path}`, import.meta.url), "utf8");
test("native import contracts use verified job artifacts, explicit partial opt-in, bounded ZIP validation and unpublished staging", () => {
  const service = read("services/cloud_execution.rs"), importer = read("services/cloud_artifacts.rs"), command = read("commands/integration/cloud.rs"), policy = read("services/local_access.rs");
  assert.match(service, /!include_partial && status\.conclusion\.as_deref\(\) != Some\("success"\)/);
  assert.match(command, /include_partial\.unwrap_or\(false\)/); assert.match(command, /vault\.worker_host_identity\(\)/);
  assert.match(service, /self\.download_artifact\(token, locator, destination_dir, include_partial\)/);
  for (const contract of ["entry.encrypted()", "entry.is_symlink()", "entry.enclosed_name()", "paths.insert(name.to_lowercase())", "MAX_ENTRIES", "MAX_TOTAL_BYTES", "create_new(true)", "Sha256::digest", "96 * 1024", "fs::rename(&staging, &published)"]) assert.ok(importer.includes(contract), contract);
  assert.ok(importer.indexOf("entry.enclosed_name()") < importer.indexOf("fs::create_dir(&staging)"));
  assert.match(policy, /"cloud_task_download_artifact" \| "cloud_task_extract_artifact"/);
  assert.equal(read("lib.rs").match(/commands::cloud::cloud_task_extract_artifact,/g).length, 2, "desktop and mobile register actual command");
});
