#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const removedBrand = ["live", "agent"].join("");
const removedSpacedBrand = ["live", "agent"].join(" ");
const removedBrandPattern = new RegExp(`${removedBrand}|${removedSpacedBrand}`, "i");

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
requirePath("crates/gateway/go.mod", "Go gateway module");

forbidPath("crates/agent-gui", "legacy frontend directory must stay removed");
forbidPath("crates/agent-gateway", "legacy gateway directory must stay removed");
forbidPath("crates/gateway/web", "the Go gateway must not contain a frontend");
forbidPath("crates/gateway/test/webui", "frontend tests belong to the unified frontend");
forbidPath("crates/gateway/test/helpers", "frontend test loaders belong to the unified frontend");
forbidPath("crates/fronted/src/platforms", "platform adapters must not duplicate React pages");
forbidPath("crates/gateway/embed.go", "the Go gateway is API-only and must not embed frontend assets");
forbidPath("crates/gateway/embed_test.go", "embedded frontend assets are no longer part of gateway tests");
forbidPath("scripts/check-mirror.mjs", "there is no second frontend tree to mirror");
forbidPath("scripts/mirror-manifest.json", "there is no second frontend tree to mirror");

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
  if (
    source.includes("@tauri-apps/") &&
    filePath !== "crates/fronted/src/runtime/tauri.ts" &&
    filePath !== "crates/fronted/src/components/WindowsTitleBar.tsx"
  ) {
    errors.push(`${filePath}: imports Tauri outside the runtime boundary`);
  }
}

const gatewayServerPath = path.join(repoRoot, "crates/gateway/internal/server/http.go");
if (existsSync(gatewayServerPath)) {
  const source = readFileSync(gatewayServerPath, "utf8");
  if (/WebUIAssets|web\/dist|http\.FileServer/.test(source)) {
    errors.push("crates/gateway/internal/server/http.go: gateway still serves frontend assets");
  }
}

if (errors.length > 0) {
  console.error("architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("architecture check passed: one frontend, one API-only Go gateway");
