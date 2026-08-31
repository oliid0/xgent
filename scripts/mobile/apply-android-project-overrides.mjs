#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

function usage() {
  return "Usage: apply-android-project-overrides.mjs [src-tauri-directory]";
}

function requireDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function copyTree(sourceRoot, destinationRoot) {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = resolve(sourceRoot, entry.name);
    const destination = resolve(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destination, { recursive: true });
      copyTree(source, destination);
      continue;
    }
    if (!entry.isFile()) continue;
    mkdirSync(resolve(destination, ".."), { recursive: true });
    copyFileSync(source, destination);
    if (!readFileSync(source).equals(readFileSync(destination))) {
      throw new Error(`Android override verification failed: ${destination}`);
    }
  }
}

try {
  const tauriRoot = resolve(process.argv[2] || "src-tauri");
  const generatedMain = resolve(tauriRoot, "gen/android/app/src/main");
  const iconSource = resolve(tauriRoot, "icons/android");
  const overrideSource = resolve(tauriRoot, "android/app/src/main");

  requireDirectory(generatedMain, "Generated Android project");
  requireDirectory(iconSource, "Xgent Android icon resources");
  requireDirectory(overrideSource, "Xgent Android project overrides");

  copyTree(iconSource, resolve(generatedMain, "res"));
  copyTree(overrideSource, generatedMain);

  const manifestPath = resolve(generatedMain, "AndroidManifest.xml");
  const manifest = readFileSync(manifestPath, "utf8");
  const withRoundIcon = manifest.includes("android:roundIcon=")
    ? manifest
    : manifest.replace(
        'android:icon="@mipmap/ic_launcher"',
        'android:icon="@mipmap/ic_launcher"\n        android:roundIcon="@mipmap/ic_launcher_round"',
      );
  if (withRoundIcon === manifest && !manifest.includes("android:roundIcon=")) {
    throw new Error(`Could not configure the Android round icon in ${manifestPath}`);
  }
  writeFileSync(manifestPath, withRoundIcon);

  console.log(
    `Applied Xgent Android icons and WebView theme overrides to ${relative(process.cwd(), generatedMain) || generatedMain}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
