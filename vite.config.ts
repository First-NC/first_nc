import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
