import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Source admission/wiring contracts only. These do not execute Rust or GitHub.
const source = fs.readFileSync(new URL("../../src-tauri/src/services/cloud_execution.rs", import.meta.url), "utf8");
function method(name, next) {
  const start = source.indexOf(`fn ${name}(`);
  const end = next ? source.indexOf(`fn ${next}(`, start + 1) : source.length;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function before(text, first, second) {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert.ok(a >= 0 && b > a, `${first} must precede ${second}`);
}

test("native source contract: validates payload before remote creation, creates only public repositories", () => {
  const start = method("start_task", "task_status");
  before(start, "validate_task_path(&file.path)?", ".current_user(token)");
  before(start, "total_bytes > MAX_TASK_TOTAL_BYTES", ".ensure_repository(");
  assert.match(start, /"repositoryVisibility": "public"/);
  assert.match(start, /repository_visibility: "public"/);
  const create = method("ensure_repository", "resolve_managed_repository");
  assert.match(create, /"private": false/);
  assert.doesNotMatch(create, /"private": true/);
  before(create, "require_public_repository(&repository)?", "return Ok((repository, false))");
  before(create, 'decode_json(response, "create GitHub cloud repository")', "Ok((repository, true))");
});

test("native source contract: existing repositories require marker; old public task reads do not require public visibility", () => {
  const ensure = method("ensure_managed_repository", "dispatch_workflow");
  assert.match(ensure, /if !created\s*\{\s*self\.verify_managed_repository/);
  before(ensure, "verify_managed_repository", "commit_files_if_changed");
  const read = method("resolve_managed_repository", "get_repository");
  assert.match(read, /verify_managed_repository/);
  assert.doesNotMatch(read, /require_public_repository|verify_public_repository/);
  const marker = method("verify_managed_repository", "ensure_managed_repository");
  assert.match(marker, /Some\("xgent-cloud"\)/);
  assert.doesNotMatch(marker, /repository\.private|require_public_repository/);
});

test("native source contract: live public admission before upload, reference publication and dispatch; replacement fails closed", () => {
  const write = method("commit_files", "default_repository");
  before(write, "verify_public_repository(token, repository).await?", '"{API_ROOT}/repos/{}/{}/git/blobs"');
  before(write.slice(write.indexOf("let commit: GitMutationResult")), "verify_public_repository(token, repository).await?", "Method::PATCH");
  before(method("dispatch_workflow", "get_content"), "verify_public_repository(token, repository).await?", "Method::POST");
  const verify = method("verify_public_repository", "verify_managed_repository");
  before(verify, "get_repository", "require_public_repository(&current)");
  assert.match(verify, /current\.id != repository\.id/);
  assert.match(verify, /no longer exists/);
});
