import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const cargoToml = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");

test("package.json does not pin platform-specific Tauri CLI packages directly", () => {
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const optionalDeps = Object.keys(pkg.optionalDependencies ?? {});
  const platformSpecific = [...devDeps, ...optionalDeps].filter(
    (name) => name.startsWith("@tauri-apps/cli-") && name !== "@tauri-apps/cli",
  );

  assert.deepEqual(platformSpecific, []);
});

test("platform-specific Tauri CLI entries remain optional in package-lock", () => {
  const entry = lock.packages["node_modules/@tauri-apps/cli-win32-x64-msvc"];
  assert.equal(entry.optional, true);
});

test("npm and Rust dialog plugin versions stay exactly aligned", () => {
  const npmVersion = pkg.dependencies?.["@tauri-apps/plugin-dialog"];
  const cargoVersionMatch = cargoToml.match(/tauri-plugin-dialog\s*=\s*"([^"]+)"/);

  assert.ok(cargoVersionMatch, "src-tauri/Cargo.toml should declare tauri-plugin-dialog");
  assert.equal(
    cargoVersionMatch[1],
    `=${npmVersion.replace(/^\^/, "")}`,
    "Rust tauri-plugin-dialog must be pinned to the exact npm plugin-dialog version",
  );
});
