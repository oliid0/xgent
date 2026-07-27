#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const removedBrand = ["live", "agent"].join("");
const removedSpacedBrand = ["live", "agent"].join(" ");
const removedBrandPattern = new RegExp(`${removedBrand}|${removedSpacedBrand}`, "i");
const removedFrontendLayoutPattern =
  /agent-gui|agent-gateway\/web|crates\/gateway\/web|scripts\/(?:check-mirror|mirror-manifest)/i;

function relative(absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");
}

function requirePath(relativePath, kind) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) errors.push(`missing ${kind}: ${relativePath}`);
}

function forbidPath(relativePath, reason) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (existsSync(absolutePath)) errors.push(`${relativePath}: ${reason}`);
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

requirePath("crates/fronted/package.json", "unified frontend package");
requirePath("crates/fronted/src/main.tsx", "unified React entry");
requirePath("crates/fronted/src/runtime/index.ts", "runtime boundary");
requirePath("crates/fronted/src-tauri/tauri.conf.json", "Tauri application");
forbidPath("crates/agent-gui", "legacy frontend directory must stay removed");
forbidPath("crates/agent-gateway", "legacy gateway directory must stay removed");
forbidPath("crates/gateway", "the standalone gateway has been removed; local access belongs to Tauri");
forbidPath("crates/fronted/src/platforms", "platform adapters must not duplicate React pages");
forbidPath("crates/fronted/src/lib/runtimeEnv.ts", "runtime detection belongs to the shared runtime boundary");
forbidPath("scripts/check-mirror.mjs", "there is no second frontend tree to mirror");
forbidPath("scripts/mirror-manifest.json", "there is no second frontend tree to mirror");
forbidPath("scripts/consolidate-frontend.mjs", "the frontend has already been consolidated");
forbidPath("Dockerfile", "container packaging is outside the current project architecture");
forbidPath("railway.json", "the removed Docker deployment must not be restored indirectly");

const frontendPackagePath = path.join(repoRoot, "crates/fronted/package.json");
if (existsSync(frontendPackagePath)) {
  const frontendPackage = JSON.parse(readFileSync(frontendPackagePath, "utf8"));
  if (typeof frontendPackage.scripts?.["build:web"] !== "string") {
    errors.push("crates/fronted/package.json: missing build:web script");
  }
}

const sourceRoot = path.join(repoRoot, "crates/fronted/src");
for (const file of walkFiles(sourceRoot)) {
  if (!/\.(?:css|html|js|jsx|json|mjs|ts|tsx)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const filePath = relative(file);
  if (removedBrandPattern.test(source)) {
    errors.push(`${filePath}: contains a removed legacy brand reference`);
  }
  if (removedFrontendLayoutPattern.test(source)) {
    errors.push(`${filePath}: refers to the removed duplicate frontend layout`);
  }
  if (
    source.includes("@tauri-apps/") &&
    filePath !== "crates/fronted/src/runtime/tauri.ts" &&
    filePath !== "crates/fronted/src/components/WindowsTitleBar.tsx"
  ) {
    errors.push(`${filePath}: imports Tauri outside the runtime boundary`);
  }
}

if (errors.length > 0) {
  console.error("architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("architecture check passed: one React/Tauri frontend with local access owned by Tauri");
