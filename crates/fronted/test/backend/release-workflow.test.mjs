import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoRoot = path.resolve(frontendRoot, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/desktop-release.yml"),
  "utf8",
);

function jobSource(name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `missing ${name} job`);
  assert.notEqual(end, -1, `missing ${nextName} job after ${name}`);
  return workflow.slice(start, end);
}

test("manual release separates packaging, publishing, and signing", () => {
  assert.match(
    workflow,
    /publish:\s*\n\s+description: Publish the packages as a GitHub Release\s*\n\s+required: false\s*\n\s+type: boolean\s*\n\s+default: false/,
  );
  assert.match(
    workflow,
    /sign:\s*\n\s+description:.*requires release settings\)\s*\n\s+required: false\s*\n\s+type: boolean\s*\n\s+default: false/,
  );

  const metadata = jobSource("release-metadata", "release-preflight");
  assert.match(metadata, /publish_release: \$\{\{ steps\.mode\.outputs\.publish_release \}\}/);
  assert.match(metadata, /signed_release: \$\{\{ steps\.mode\.outputs\.signed_release \}\}/);
  assert.match(metadata, /PUBLISH_RELEASE: \$\{\{ github\.event_name == 'push' \|\| inputs\.publish \}\}/);
  assert.match(metadata, /SIGNED_RELEASE: \$\{\{ inputs\.sign \|\|/);

  const preflight = jobSource("release-preflight", "macos");
  assert.match(
    preflight,
    /SIGNED_RELEASE: \$\{\{ needs\.release-metadata\.outputs\.signed_release \}\}/,
  );
  assert.match(preflight, /if: env\.SIGNED_RELEASE != 'true'/);
  assert.match(preflight, /if: env\.SIGNED_RELEASE == 'true'/);

  for (const secret of [
    "APPLE_CERTIFICATE_P12_BASE64",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_TEAM_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_UPDATER_PUBLIC_KEY",
  ]) {
    assert.match(preflight, new RegExp(`\\b${secret}\\b`));
  }
  assert.match(workflow, /echo "APPLE_SIGNING_IDENTITY=\$signing_identity" >> "\$GITHUB_ENV"/);
  assert.doesNotMatch(workflow, /secrets\.APPLE_SIGNING_IDENTITY/);
  assert.match(preflight, /APPLE_ID: \$\{\{ vars\.APPLE_ID \}\}/);
  assert.match(preflight, /APPLE_TEAM_ID: \$\{\{ vars\.APPLE_TEAM_ID \}\}/);
  assert.match(
    preflight,
    /TAURI_UPDATER_PUBLIC_KEY: \$\{\{ vars\.TAURI_UPDATER_PUBLIC_KEY \}\}/,
  );
});

test("every platform has signed and package-only build paths", () => {
  const macos = jobSource("macos", "windows");
  const windows = jobSource("windows", "linux");
  const linux = jobSource("linux", "publish");

  for (const [platform, source] of [
    ["macOS", macos],
    ["Windows", windows],
    ["Linux", linux],
  ]) {
    assert.match(source, /release-preflight/, `${platform} must depend on preflight`);
    assert.match(source, /if: env\.SIGNED_RELEASE == 'true'/);
    assert.match(source, /if: env\.SIGNED_RELEASE != 'true'/);
  }

  assert.match(
    linux,
    /bash scripts\/release\/postprocess-linux-appimage\.sh/,
    "Linux post-processing must not depend on the checkout preserving executable bits",
  );
});

test("only the publish job receives repository write permission", () => {
  const beforePublish = workflow.slice(0, workflow.indexOf("  publish:\n"));
  const publish = workflow.slice(workflow.indexOf("  publish:\n"));

  assert.doesNotMatch(beforePublish, /contents: write/);
  assert.match(publish, /permissions:\s*\n\s+contents: write/);
  assert.match(
    publish,
    /if: \$\{\{ needs\.release-metadata\.outputs\.publish_release == 'true' \}\}/,
  );
  assert.match(publish, /create_args=\(--draft --target "\$RELEASE_SHA"/);
  assert.match(publish, /publish_args=\(--draft=false/);
  assert.match(publish, /-f target_commitish="\$RELEASE_SHA"/);
  assert.match(publish, /if \[ "\$SIGNED_RELEASE" = true \]; then/);
  assert.match(publish, /gh release delete-asset "\$RELEASE_TAG" latest\.json --yes/);
});
