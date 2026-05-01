import { STORAGE_KEYS } from "./storageKeys";

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
const DEFAULT_API_BASE_URL = metaEnv?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const DEFAULT_FALLBACK_VERSION = "0.0.0";

function normalizeApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveUpdateOs(input?: string): "windows" | "macos" | "ubuntu" {
  const raw = (input ?? "").toLowerCase();
  if (raw.includes("win")) return "windows";
  if (raw.includes("mac") || raw.includes("darwin")) return "macos";
  return "ubuntu";
}

/**
 * 读取或初始化「更新检查」用的稳定 client id。
 * - 若 storage 中已有值，直接复用。
 * - 否则生成新 id 并写入（若传入 null/undefined storage 则不持久化，仅本次返回值可用）。
 *
 * 生成策略：
 * 1. 优先 `crypto.randomUUID()`（运行时支持时），标准 UUID v4，碰撞概率可忽略。
 * 2. 否则使用时间戳 base36 + 随机段拼成前缀串，适配无 Web Crypto / 老旧环境；
 *    碰撞风险略高于 UUID，仍可接受客户端标识用途。
 */
export function getOrCreateUpdateClientId(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
): string {
  const stored = storage?.getItem(STORAGE_KEYS.updateClientId);
  if (stored) return stored;

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      // 降级：`Date.now()` 36 进制缩时序 + `Math.random` 截取，非密码学随机，够用即可。
      : `first-nc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
    const response = await fetch(`${normalizeApiBaseUrl(options.apiBaseUrl)}/api/v1/update/check`, {
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
  } finally {
    dispose();
  }
}

export async function checkForAppUpdate(options: CheckForUpdateOptions = {}): Promise<CheckForUpdateResult> {
  const storage = options.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
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
      apiBaseUrl: options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    },
  );

  return {
    clientId,
    currentVersion,
    os,
    response,
  };
}
