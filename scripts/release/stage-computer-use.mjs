import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The filename/manifest contract is consumed by cua_component.rs.
const [source, target, version, destination = "dist"] = process.argv.slice(2);
const extension = {
  "windows-x86_64": "dll",
  "linux-x86_64": "so",
  "macos-aarch64": "dylib",
  "macos-x86_64": "dylib",
}[target];
if (!source || !extension || !/^v[\w.-]+$/.test(version ?? "")) {
  throw new Error("Expected native library, supported OS-architecture, and release tag");
}
const binary = readFileSync(source);
if (!binary.length || binary.length > 64 * 1024 * 1024) {
  throw new Error("CUA component exceeds the installer's size bounds");
}
const stem = `Xgent-CUA-abi1-${target}`;
const filename = `${stem}.${extension}`;
mkdirSync(destination, { recursive: true });
copyFileSync(source, path.join(destination, filename));
writeFileSync(path.join(destination, `${stem}.json`), `${JSON.stringify({
  revision: 2, abi: 1, target, filename, version, bytes: binary.length,
  sha256: createHash("sha256").update(binary).digest("hex"),
}, null, 2)}\n`);
copyFileSync("crates/fronted/src-tauri/native/computer-use/LICENSE", path.join(destination, "Xgent-CUA-LICENSE.txt"));
