import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUpdateDownloadLabel,
  deriveUpdateFileName,
  resolveUpdateStatusTone,
} from "./updatePresentation.ts";

test("deriveUpdateFileName keeps installer extension from url", () => {
  assert.equal(
    deriveUpdateFileName(
      "https://example.com/releases/FirstNC-0.2.0.msi?token=abc",
      "0.2.0",
      "windows",
      "installer",
    ),
    "FirstNC-0.2.0.msi",
  );
  assert.equal(
    deriveUpdateFileName("https://example.com/releases/FirstNC-0.2.0.dmg", "0.2.0", "macos", "installer"),
    "FirstNC-0.2.0.dmg",
  );
  assert.equal(
    deriveUpdateFileName(
      "https://example.com/releases/first-nc-0.2.0-macos-in-app-update.tar.gz",
      "0.2.0",
      "macos",
      "in_app_update",
    ),
    "first-nc-0.2.0-macos-in-app-update.tar.gz",
  );
});

test("deriveUpdateFileName falls back to platform installer extension", () => {
  assert.equal(
    deriveUpdateFileName("https://example.com/releases/latest", "0.2.0", "ubuntu", "installer"),
    "first-nc-0.2.0-ubuntu-installer.deb",
  );
  assert.equal(
    deriveUpdateFileName("https://example.com/releases/latest", "0.2.0", "windows", "in_app_update"),
    "first-nc-0.2.0-windows-in-app-update.tar.gz",
  );
});

test("buildUpdateDownloadLabel renders progress friendly copy", () => {
  assert.equal(buildUpdateDownloadLabel({ downloadedBytes: 512, totalBytes: null, percent: null }), "512 B");
  assert.equal(
    buildUpdateDownloadLabel({ downloadedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, percent: 25 }),
    "1.0 MB / 4.0 MB (25%)",
  );
});

test("resolveUpdateStatusTone maps phases to UI tone", () => {
  assert.equal(resolveUpdateStatusTone("idle"), "muted");
  assert.equal(resolveUpdateStatusTone("downloading"), "active");
  assert.equal(resolveUpdateStatusTone("ready"), "success");
  assert.equal(resolveUpdateStatusTone("failed"), "danger");
});
