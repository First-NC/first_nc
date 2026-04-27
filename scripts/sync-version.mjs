import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readRootPackageVersion(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!packageJson.version || typeof packageJson.version !== "string") {
    throw new Error(`Missing string version in ${packageJsonPath}.`);
  }
  return packageJson.version;
}

export function syncTauriConfigVersion(content, version) {
  const parsed = JSON.parse(content);
  parsed.version = version;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function syncCargoTomlVersion(content, version) {
  if (!/^version\s*=\s*".*"$/m.test(content)) {
    throw new Error('Could not locate [package] version in Cargo.toml.');
  }
  return content.replace(/^version\s*=\s*".*"$/m, `version = "${version}"`);
}

export function syncVersionFromPackageJson(repoRoot) {
  const version = readRootPackageVersion(repoRoot);

  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  writeFileSync(
    tauriConfigPath,
    syncTauriConfigVersion(readFileSync(tauriConfigPath, "utf8"), version),
  );

  const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
  writeFileSync(
    cargoTomlPath,
    syncCargoTomlVersion(readFileSync(cargoTomlPath, "utf8"), version),
  );

  return version;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const version = syncVersionFromPackageJson(repoRoot);
  console.log(`Synced desktop version metadata to ${version}`);
}
