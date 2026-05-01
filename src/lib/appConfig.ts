export type AppEnv = "local" | "dev" | "prod";

type ViteEnv = Partial<Record<"VITE_APP_ENV" | "VITE_API_BASE_URL", string>>;

export type AppConfig = {
  appEnv: AppEnv;
  apiBaseUrl: string;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export function normalizeAppEnv(value: string | undefined): AppEnv {
  if (value === "dev" || value === "prod") return value;
  return "local";
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function createAppConfig(env: ViteEnv): AppConfig {
  return {
    appEnv: normalizeAppEnv(env.VITE_APP_ENV),
    apiBaseUrl: normalizeApiBaseUrl(env.VITE_API_BASE_URL),
  };
}

const metaEnv = (import.meta as ImportMeta & {
  env?: ViteEnv;
}).env;

export const appConfig = createAppConfig(metaEnv ?? {});
