import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForAppUpdate,
  getOrCreateUpdateClientId,
  resolveUpdateOs,
} from "./updateClient.ts";

test("resolveUpdateOs maps desktop platforms to backend enum", () => {
  assert.equal(resolveUpdateOs("Windows NT 10.0 Win64"), "windows");
  assert.equal(resolveUpdateOs("Macintosh; Intel Mac OS X"), "macos");
  assert.equal(resolveUpdateOs("Linux x86_64"), "ubuntu");
});

test("getOrCreateUpdateClientId persists generated client id", () => {
  const storage = {
    value: null as string | null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
    },
  };

  const first = getOrCreateUpdateClientId(storage);
  const second = getOrCreateUpdateClientId(storage);

  assert.equal(first, second);
  assert.ok(first.length > 8);
});

test("checkForAppUpdate posts payload and unwraps envelope", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string | null }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : null,
    });

    return new Response(JSON.stringify({
      data: {
        client_id: "client-1",
        current_version: "0.1.0",
        latest: {
          id: 1,
          version: "0.2.0",
          os: "windows",
          url: "https://example.com/download",
          created_at: "2026-04-09T00:00:00Z",
          updated_at: "2026-04-09T00:00:00Z",
        },
        update_available: true,
        is_skipped: false,
        skipped_version: null,
        server_time: "2026-04-09T00:00:00Z",
      },
      message: "ok",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await checkForAppUpdate({
      apiBaseUrl: "http://127.0.0.1:8000/",
      clientId: "client-1",
      currentVersion: "0.1.0",
      os: "windows",
      timeoutMs: 30000,
      storage: null,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://127.0.0.1:8000/api/v1/update/check");
    assert.match(calls[0]?.body ?? "", /"current_version":"0\.1\.0"/);
    assert.equal(result.response.latest?.version, "0.2.0");
    assert.equal(result.response.update_available, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
