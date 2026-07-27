export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeReleaseTag(input) {
  const rawTag = String(input ?? "").trim();
  if (!rawTag) {
    throw new Error("Release tag is required. Example: v0.1.3");
  }

  const releaseTag = rawTag.replace(/^refs\/tags\//, "");
  if (!releaseTag.startsWith("v")) {
    throw new Error(`Release tag must start with "v". Received: ${rawTag}`);
  }

  const appVersion = releaseTag.slice(1);
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(`Release tag must be a semver tag like v0.1.3. Received: ${rawTag}`);
  }

  return releaseTag;
}

export function parseReleaseVersion(input) {
  const releaseTag = normalizeReleaseTag(input);
  const appVersion = releaseTag.slice(1);

  return {
    appVersion,
    isPrerelease: appVersion.split("+", 1)[0].includes("-"),
    releaseTag,
  };
}

export function windowsInstallerVersion(appVersion) {
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(`App version must be a valid semver string. Received: ${appVersion}`);
  }

  const versionWithoutBuildMetadata = appVersion.split("+", 1)[0];
  const prereleaseSeparator = versionWithoutBuildMetadata.indexOf("-");
  if (prereleaseSeparator === -1) {
    return versionWithoutBuildMetadata;
  }

  const baseVersion = versionWithoutBuildMetadata.slice(0, prereleaseSeparator);
  const prerelease = versionWithoutBuildMetadata.slice(prereleaseSeparator + 1);
  const identifiers = prerelease.split(".");
  const numericIdentifier = [...identifiers]
    .reverse()
    .find((identifier) => /^\d+$/.test(identifier));

  if (numericIdentifier === undefined) {
    throw new Error(
      `Windows prerelease tags must contain a numeric identifier, for example ${baseVersion}-beta.1. Received: ${appVersion}`,
    );
  }

  const numericValue = Number.parseInt(numericIdentifier, 10);
  if (numericValue > 65_535) {
    throw new Error(
      `Windows prerelease identifier cannot be greater than 65535. Received: ${numericIdentifier}`,
    );
  }

  // MSI accepts an optional prerelease component only when it is numeric.
  // Keep the complete semver in the release tag/artifact name while giving
  // Tauri's Windows bundlers the representable installer version.
  return `${baseVersion}-${numericValue}`;
}

export function tauriVersionConfig(appVersion, platform = "default") {
  if (!SEMVER_PATTERN.test(appVersion)) {
    throw new Error(`App version must be a valid semver string. Received: ${appVersion}`);
  }

  if (!["default", "windows"].includes(platform)) {
    throw new Error(`Unsupported Tauri version platform: ${platform}`);
  }

  return {
    version: platform === "windows" ? windowsInstallerVersion(appVersion) : appVersion,
  };
}
