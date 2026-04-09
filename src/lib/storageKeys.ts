export const STORAGE_KEYS = {
  themeMode: "first_nc.themeMode",
  lang: "first_nc.lang",
  showFiles: "first_nc.showFiles",
  showEditor: "first_nc.showEditor",
  showViewer: "first_nc.showViewer",
  filesWidth: "first_nc.filesWidth",
  editorWidth: "first_nc.editorWidth",
  showGrid: "first_nc.showGrid",
  showGizmo: "first_nc.showGizmo",
  recentFiles: "first_nc.recentFiles",
  shortcuts: "first_nc.shortcuts",
  immersiveViewer: "first_nc.immersiveViewer",
  windowState: "first_nc.windowState",
  workspaceSession: "first_nc.workspaceSession",
  toolbarPrefs: "first_nc.toolbarPrefs",
  updateClientId: "first_nc.updateClientId",
} as const;

export const LEGACY_STORAGE_KEYS: Record<keyof typeof STORAGE_KEYS, string> = {
  themeMode: "fnc.themeMode",
  lang: "fnc.lang",
  showFiles: "fnc.showFiles",
  showEditor: "fnc.showEditor",
  showViewer: "fnc.showViewer",
  filesWidth: "fnc.filesWidth",
  editorWidth: "fnc.editorWidth",
  showGrid: "fnc.showGrid",
  showGizmo: "fnc.showGizmo",
  recentFiles: "fnc.recentFiles",
  shortcuts: "fnc.shortcuts",
  immersiveViewer: "fnc.immersiveViewer",
  windowState: "fnc.windowState",
  workspaceSession: "fnc.workspaceSession",
  toolbarPrefs: "fnc.toolbarPrefs",
  updateClientId: "fnc.updateClientId",
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStorageValue(
  storage: StorageLike | null | undefined,
  key: keyof typeof STORAGE_KEYS,
): string | null {
  if (!storage) return null;
  const nextValue = storage.getItem(STORAGE_KEYS[key]);
  if (nextValue !== null) return nextValue;
  return storage.getItem(LEGACY_STORAGE_KEYS[key]);
}

export function migrateStorageNamespace(storage: StorageLike | null | undefined) {
  if (!storage) return;
  for (const key of Object.keys(STORAGE_KEYS) as Array<keyof typeof STORAGE_KEYS>) {
    const nextKey = STORAGE_KEYS[key];
    if (storage.getItem(nextKey) !== null) continue;
    const legacyValue = storage.getItem(LEGACY_STORAGE_KEYS[key]);
    if (legacyValue !== null) {
      storage.setItem(nextKey, legacyValue);
    }
  }
}
