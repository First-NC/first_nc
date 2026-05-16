import { appConfig } from "./appConfig.ts";
import { STORAGE_KEYS } from "./storageKeys.ts";

export type UpdateVersionInfo = {
  id: number;
  version: string;
  os: string;
  package_kind: "installer" | "in_app_update";
  url: string;
  created_at: string;
  updated_at: string;
};

export type UpdateCheckResponse = {
  client_id: string;
  current_version: string;
  latest: UpdateVersionInfo | null;
  update_available: boolean;
  is_skipped: boolean;
  skipped_version: string | null;
  server_time: string;
};

type Envelope<T> = {
  data: T;
  message: string;
};

type CheckForUpdateOptions = {
  timeoutMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  apiBaseUrl?: string;
  clientId?: string;
  currentVersion?: string;
  os?: string;
  packageKind?: "installer" | "in_app_update";
};

export type CheckForUpdateResult = {
  clientId: string;
  currentVersion: string;
  os: string;
  response: UpdateCheckResponse;
};

const metaEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const DEFAULT_FALLBACK_VERSION = "0.0.0";

function normalizeApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildUpdateCheckUrl(apiBaseUrl: string): string {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/api/v1/update/check`;
}

function resolveUpdateStorage(
  storage: CheckForUpdateOptions["storage"],
): Pick<Storage, "getItem" | "setItem"> | null {
  if (storage !== undefined) {
    return storage;
  }
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function buildGeneratedClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `first-nc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractEnvelopeData<T>(
  response: Response,
  body: Envelope<T> | { detail?: string; message?: string } | null,
): T {
  if (!response.ok) {
    const message =
      (body && "message" in body && body.message) ||
      (body && "detail" in body && body.detail) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!body || !("data" in body)) {
    throw new Error("Malformed API response");
  }

  return body.data;
}

export function resolveUpdateOs(input?: string): "windows" | "macos" | "ubuntu" {
  const raw = (input ?? "").toLowerCase();
  if (raw.includes("win")) return "windows";
  if (raw.includes("mac") || raw.includes("darwin")) return "macos";
  return "ubuntu";
}

export function getOrCreateUpdateClientId(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
): string {
  const stored = storage?.getItem(STORAGE_KEYS.updateClientId);
  if (stored) return stored;

  const generated = buildGeneratedClientId();
  storage?.setItem(STORAGE_KEYS.updateClientId, generated);
  return generated;
}

export async function resolveCurrentAppVersion(): Promise<string> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      const version = await getVersion();
      if (version) return version;
    } catch {
    }
  }

  return metaEnv?.VITE_APP_VERSION ?? DEFAULT_FALLBACK_VERSION;
}

export function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "AbortError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => globalThis.clearTimeout(timer),
  };
}

async function requestUpdateCheck(
  payload: {
    client_id: string;
    current_version: string;
    os: string;
    package_kind: "installer" | "in_app_update";
  },
  options: {
    timeoutMs: number;
    apiBaseUrl: string;
  },
): Promise<UpdateCheckResponse> {
  const { signal, dispose } = withTimeoutSignal(options.timeoutMs);

  try {
    const response = await fetch(buildUpdateCheckUrl(options.apiBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });

    const body = (await response.json().catch(() => null)) as
      | Envelope<UpdateCheckResponse>
      | { detail?: string; message?: string }
      | null;
    return extractEnvelopeData(response, body);
  } finally {
    dispose();
  }
}

export async function checkForAppUpdate(options: CheckForUpdateOptions = {}): Promise<CheckForUpdateResult> {
  const storage = resolveUpdateStorage(options.storage);
  const clientId = options.clientId ?? getOrCreateUpdateClientId(storage);
  const currentVersion = options.currentVersion ?? await resolveCurrentAppVersion();
  const os = options.os ?? resolveUpdateOs(
    typeof navigator !== "undefined" ? `${navigator.userAgent} ${navigator.platform}` : "",
  );
  const response = await requestUpdateCheck(
    {
      client_id: clientId,
      current_version: currentVersion,
      os,
      package_kind: options.packageKind ?? "in_app_update",
    },
    {
      timeoutMs: options.timeoutMs ?? 30000,
      apiBaseUrl: options.apiBaseUrl ?? appConfig.apiBaseUrl,
    },
  );

  return {
    clientId,
    currentVersion,
    os,
    response,
  };
}
