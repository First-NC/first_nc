import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_STORAGE_KEYS, migrateStorageNamespace, readStorageValue, STORAGE_KEYS } from "./storageKeys.ts";

function createStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}

test("readStorageValue falls back to legacy fnc namespace", () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.themeMode]: "navy",
  });

  assert.equal(readStorageValue(storage, "themeMode"), "navy");
});

test("migrateStorageNamespace copies legacy values into first_nc namespace", () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.themeMode]: "navy",
    [LEGACY_STORAGE_KEYS.lang]: "en-US",
  });

  migrateStorageNamespace(storage);

  assert.deepEqual(storage.snapshot(), {
    [LEGACY_STORAGE_KEYS.themeMode]: "navy",
    [LEGACY_STORAGE_KEYS.lang]: "en-US",
    [STORAGE_KEYS.themeMode]: "navy",
    [STORAGE_KEYS.lang]: "en-US",
  });
});

test("migrateStorageNamespace does not overwrite first_nc values", () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEYS.themeMode]: "navy",
    [STORAGE_KEYS.themeMode]: "light",
  });

  migrateStorageNamespace(storage);

  assert.equal(storage.getItem(STORAGE_KEYS.themeMode), "light");
});
