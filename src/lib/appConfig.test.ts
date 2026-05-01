import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppConfig,
  normalizeAppEnv,
} from "./appConfig.ts";

test("normalizeAppEnv accepts local dev and prod only", () => {
  assert.equal(normalizeAppEnv("local"), "local");
  assert.equal(normalizeAppEnv("dev"), "dev");
  assert.equal(normalizeAppEnv("prod"), "prod");
  assert.equal(normalizeAppEnv("staging"), "local");
  assert.equal(normalizeAppEnv(undefined), "local");
});

test("createAppConfig reads backend api base url from vite env", () => {
  const config = createAppConfig({
    VITE_APP_ENV: "dev",
    VITE_API_BASE_URL: "https://dev-api.example.com/",
  });

  assert.equal(config.appEnv, "dev");
  assert.equal(config.apiBaseUrl, "https://dev-api.example.com");
});

test("createAppConfig falls back to local backend api address", () => {
  const config = createAppConfig({});

  assert.equal(config.appEnv, "local");
  assert.equal(config.apiBaseUrl, "http://127.0.0.1:8000");
});
