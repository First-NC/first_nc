import { spawn } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVersionFromPackageJson } from "./sync-version.mjs";

const BUILD_PLANS = {
  linux: {
    target: "x86_64-unknown-linux-gnu",
    bundles: "appimage,deb",
    hostPlatforms: ["linux"],
  },
  "linux:ci": {
    target: "x86_64-unknown-linux-gnu",
    bundles: "deb",
    hostPlatforms: ["linux"],
  },
  mac: {
    target: "aarch64-apple-darwin",
    bundles: "app,dmg",
    hostPlatforms: ["darwin"],
  },
  "mac:intel": {
    target: "x86_64-apple-darwin",
    bundles: "app,dmg",
    hostPlatforms: ["darwin"],
  },
  win: {
    target: "x86_64-pc-windows-msvc",
    bundles: "nsis,msi",
    hostPlatforms: ["win32"],
  },
};

export function resolveBuildPlan(name) {
  const plan = BUILD_PLANS[name];
  if (!plan) {
    throw new Error(
      `Unsupported package target "${name}". Supported targets: ${Object.keys(BUILD_PLANS).join(", ")}.`,
    );
  }

  return {
    target: plan.target,
    bundles: plan.bundles,
  };
}

function hasAppleSigningEnv(env) {
  return Boolean(env.APPLE_CERTIFICATE);
}

export function resolveExecutionPlan(name, env = process.env) {
  const plan = resolveBuildPlan(name);
  const isMacTarget = name === "mac" || name === "mac:intel";
  const useNativeMacBundler = isMacTarget && hasAppleSigningEnv(env);
  const createPlainDmg = isMacTarget && !useNativeMacBundler;
  return {
    ...plan,
    tauriBundles: createPlainDmg ? "app" : plan.bundles,
    createPlainDmg,
  };
}

function assertHostPlatform(name) {
  const supported = BUILD_PLANS[name].hostPlatforms;
  if (supported.includes(process.platform)) {
    return;
  }

  const labels = supported.map((platform) => {
    if (platform === "darwin") return "macOS";
    if (platform === "linux") return "Linux";
    if (platform === "win32") return "Windows";
    return platform;
  });

  throw new Error(
    `Package target "${name}" must be built on ${labels.join(" or ")}. Current host platform is ${process.platform}.`,
  );
}

export function buildEnvForPlatform(baseEnv, platform) {
  const env = { ...baseEnv };
  if (platform === "linux") {
    env.APPIMAGE_EXTRACT_AND_RUN = env.APPIMAGE_EXTRACT_AND_RUN || "1";
  }
  if (platform !== "win32" && env.HOME) {
    const cargoBin = path.join(env.HOME, ".cargo", "bin");
    try {
      accessSync(cargoBin, constants.X_OK);
      env.PATH = env.PATH ? `${cargoBin}:${env.PATH}` : cargoBin;
    } catch {
      // Ignore when Cargo is already on PATH or rustup is installed elsewhere.
    }
  }
  return env;
}

function buildEnv() {
  return buildEnvForPlatform(process.env, process.platform);
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command "${command}" terminated by signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command "${command}" exited with code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

function readTauriMetadata(repoRoot) {
  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  return {
    productName: tauriConfig.productName,
    version: tauriConfig.version,
  };
}

function archLabelForTarget(target) {
  if (target.startsWith("aarch64-")) return "aarch64";
  if (target.startsWith("x86_64-")) return "x64";
  return target.split("-")[0];
}

function bundleRoot(repoRoot, target) {
  return path.join(repoRoot, "src-tauri", "target", target, "release", "bundle");
}

function artifactRoot(repoRoot, target) {
  return path.join(repoRoot, "src-tauri", "target", target, "release", "artifacts");
}

function platformSlugForBuild(name) {
  if (name.startsWith("win")) return "windows";
  if (name.startsWith("mac")) return "macos";
  return "ubuntu";
}

function walkFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const results = [];
  for (const entry of readdirSync(rootDir)) {
    const fullPath = path.join(rootDir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }
    results.push(fullPath);
  }
  return results;
}

function findFirstFile(rootDir, matcher) {
  return walkFiles(rootDir).find((filePath) => matcher(path.basename(filePath)));
}

async function createTarGzArchive(repoRoot, sourcePath, outputPath) {
  rmSync(outputPath, { force: true });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  await runCommand(
    "tar",
    ["-czf", outputPath, "-C", path.dirname(sourcePath), path.basename(sourcePath)],
    { cwd: repoRoot, env: buildEnv() },
  );
}

async function createVersionedArtifacts(repoRoot, buildName, target) {
  const { productName, version } = readTauriMetadata(repoRoot);
  const platformSlug = platformSlugForBuild(buildName);
  const archSlug = archLabelForTarget(target);
  const artifactsDir = artifactRoot(repoRoot, target);
  const bundleDir = bundleRoot(repoRoot, target);
  const prefix = `first-nc-${version}-${platformSlug}-${archSlug}`;
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  if (platformSlug === "macos") {
    const dmgPath = findFirstFile(path.join(bundleDir, "dmg"), (name) => name.toLowerCase().endsWith(".dmg"));
    if (dmgPath) {
      cpSync(dmgPath, path.join(artifactsDir, `${prefix}-installer.dmg`));
    }
    const appPath = path.join(bundleDir, "macos", `${productName}.app`);
    if (existsSync(appPath)) {
      await createTarGzArchive(repoRoot, appPath, path.join(artifactsDir, `${prefix}-in-app-update.tar.gz`));
    }
    return;
  }

  if (platformSlug === "windows") {
    const nsisPath = findFirstFile(path.join(bundleDir, "nsis"), (name) => name.toLowerCase().endsWith(".exe"));
    if (nsisPath) {
      cpSync(nsisPath, path.join(artifactsDir, `${prefix}-installer.exe`));
    }
    const msiPath = findFirstFile(path.join(bundleDir, "msi"), (name) => name.toLowerCase().endsWith(".msi"));
    if (msiPath) {
      cpSync(msiPath, path.join(artifactsDir, `${prefix}-installer.msi`));
    }
    const appExePath = path.join(repoRoot, "src-tauri", "target", target, "release", "FirstNC.exe");
    if (existsSync(appExePath)) {
      await createTarGzArchive(repoRoot, appExePath, path.join(artifactsDir, `${prefix}-in-app-update.tar.gz`));
    }
    return;
  }

  const debPath = findFirstFile(path.join(bundleDir, "deb"), (name) => name.toLowerCase().endsWith(".deb"));
  if (debPath) {
    cpSync(debPath, path.join(artifactsDir, `${prefix}-installer.deb`));
  }
  const appImagePath = findFirstFile(path.join(bundleDir, "appimage"), (name) => name.toLowerCase().endsWith(".appimage"));
  if (appImagePath) {
    cpSync(appImagePath, path.join(artifactsDir, `${prefix}-installer.AppImage`));
  }
  const linuxBinaryPath = path.join(repoRoot, "src-tauri", "target", target, "release", "first-nc");
  if (existsSync(linuxBinaryPath)) {
    await createTarGzArchive(repoRoot, linuxBinaryPath, path.join(artifactsDir, `${prefix}-in-app-update.tar.gz`));
  }
}

async function reSignMacAppBundle(repoRoot, appBundlePath) {
  await runCommand(
    "codesign",
    ["--force", "--deep", "--sign", "-", appBundlePath],
    { cwd: repoRoot, env: buildEnv() },
  );
}

async function createPlainMacDmg(repoRoot, target) {
  const { productName, version } = readTauriMetadata(repoRoot);
  const appBundlePath = path.join(bundleRoot(repoRoot, target), "macos", `${productName}.app`);
  if (!existsSync(appBundlePath)) {
    throw new Error(`Expected app bundle at ${appBundlePath}, but it was not found.`);
  }

  await reSignMacAppBundle(repoRoot, appBundlePath);

  const dmgDir = path.join(bundleRoot(repoRoot, target), "dmg");
  mkdirSync(dmgDir, { recursive: true });

  const stagingDir = path.join(dmgDir, `.plain-dmg-${process.pid}`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  const stagedAppPath = path.join(stagingDir, `${productName}.app`);
  cpSync(appBundlePath, stagedAppPath, { recursive: true });
  symlinkSync("/Applications", path.join(stagingDir, "Applications"));

  const dmgPath = path.join(dmgDir, `${productName}_${version}_${archLabelForTarget(target)}.dmg`);
  rmSync(dmgPath, { force: true });

  return runCommand(
    "hdiutil",
    [
      "create",
      "-volname",
      productName,
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ],
    { cwd: repoRoot, env: buildEnv() },
  ).finally(() => {
    rmSync(stagingDir, { recursive: true, force: true });
  });
}

async function runBuild(name) {
  assertHostPlatform(name);
  const { target, tauriBundles, createPlainDmg } = resolveExecutionPlan(name, process.env);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  syncVersionFromPackageJson(repoRoot);
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");

  await runCommand(
    process.execPath,
    [tauriCli, "build", "--target", target, "--bundles", tauriBundles],
    {
      cwd: repoRoot,
      env: buildEnv(),
    },
  );

  if (createPlainDmg) {
    await createPlainMacDmg(repoRoot, target);
  }

  await createVersionedArtifacts(repoRoot, name, target);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const targetName = process.argv[2];
  if (!targetName) {
    console.error(`Usage: node ./scripts/package-platform.mjs <${Object.keys(BUILD_PLANS).join("|")}>`);
    process.exit(1);
  }

  try {
    await runBuild(targetName);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
