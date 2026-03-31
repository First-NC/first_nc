import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { applyThemePaletteToDom, getBootThemePalette, resolveBootTheme } from "./lib/themeBoot";

const storedThemeMode = (() => {
  try {
    return localStorage.getItem("fnc.themeMode");
  } catch {
    return null;
  }
})();

const resolvedBootTheme = resolveBootTheme(
  storedThemeMode === "dark" ? "navy" : storedThemeMode,
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
);
const bootPalette = getBootThemePalette(resolvedBootTheme);

applyThemePaletteToDom(document, resolvedBootTheme, bootPalette);

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const tauriTheme = resolvedBootTheme === "light" ? "light" : "dark";
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      const currentWindow = getCurrentWindow();
      return Promise.all([
        currentWindow.setBackgroundColor(bootPalette.background).catch(() => {}),
        currentWindow.setTheme(tauriTheme).catch(() => {}),
      ]);
    })
    .catch(() => {});
}

const hideBootSplash = () => {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.classList.add("boot-hide");
  window.setTimeout(() => splash.remove(), 220);
};

const notifyStartupPainted = () => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("notify_startup_painted"))
    .catch(() => {});
};

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find root element");
}

const root = createRoot(rootElement);
let startupSettled = false;

const releaseStartupOverlay = () => {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      notifyStartupPainted();
      hideBootSplash();
    });
  });
};

const renderStartupError = (error: unknown) => {
  startupSettled = true;
  console.error("Failed to bootstrap First NC Viewer", error);
  root.render(
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: bootPalette.background,
        color: bootPalette.text,
        padding: "24px",
        boxSizing: "border-box",
        fontFamily: "'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          borderRadius: "18px",
          padding: "28px 32px",
          background: bootPalette.panel,
          border: `1px solid ${bootPalette.border}`,
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.12)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>First NC Viewer</h1>
        <p style={{ margin: "14px 0 0", color: bootPalette.muted, lineHeight: 1.6 }}>
          Application bootstrap failed before the main UI became interactive.
        </p>
        <pre
          style={{
            margin: "18px 0 0",
            padding: "14px 16px",
            borderRadius: "12px",
            background: "rgba(15, 23, 42, 0.06)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "Consolas, Monaco, monospace",
            fontSize: "12px",
            lineHeight: 1.5,
          }}
        >
          {error instanceof Error ? `${error.name}: ${error.message}` : String(error)}
        </pre>
      </div>
    </div>,
  );
  releaseStartupOverlay();
};

const startupWatchdog = window.setTimeout(() => {
  if (startupSettled) return;
  renderStartupError(new Error("Startup timed out while loading the main interface."));
}, 8000);

void import("./App")
  .then(({ default: App }) => {
    if (startupSettled) return;
    startupSettled = true;
    window.clearTimeout(startupWatchdog);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    releaseStartupOverlay();
  })
  .catch((error) => {
    window.clearTimeout(startupWatchdog);
    renderStartupError(error);
  });
