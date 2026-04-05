import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { migrateStorageNamespace, readStorageValue } from "./lib/storageKeys";
import { applyThemePaletteToDom, getBootThemePalette, resolveBootTheme } from "./lib/themeBoot";

type StartupErrorBoundaryProps = {
  children: ReactNode;
};

type StartupErrorBoundaryState = {
  error: unknown;
};

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

const storedThemeMode = (() => {
  try {
    migrateStorageNamespace(localStorage);
    return readStorageValue(localStorage, "themeMode");
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

const invokeStartupCommand = (command: string) => {
  if (typeof window === "undefined") return;
  const tauriWindow = window as TauriInternalsWindow;
  const invoke = tauriWindow.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return;
  void invoke(command).catch(() => {});
};

const notifyStartupPainted = () => {
  invokeStartupCommand("notify_startup_painted");
};

const notifyStartupReady = () => {
  invokeStartupCommand("notify_startup_ready");
};

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find root element");
}

const root = createRoot(rootElement);
let startupSettled = false;

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    notifyStartupReady();
  }, 0);
}

const releaseStartupOverlay = () => {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      notifyStartupPainted();
      hideBootSplash();
    });
  });
};

function renderErrorCard(error: unknown) {
  return (
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
        <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>First NC</h1>
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
    </div>
  );
}

class StartupErrorBoundary extends Component<StartupErrorBoundaryProps, StartupErrorBoundaryState> {
  state: StartupErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): StartupErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("Failed to render First NC", error);
  }

  render() {
    if (this.state.error) {
      return renderErrorCard(this.state.error);
    }
    return this.props.children;
  }
}

const renderStartupError = (error: unknown) => {
  startupSettled = true;
  console.error("Failed to bootstrap First NC", error);
  root.render(renderErrorCard(error));
  releaseStartupOverlay();
};

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (startupSettled) return;
    renderStartupError(event.error ?? new Error(event.message || "Unknown startup error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (startupSettled) return;
    renderStartupError(event.reason ?? new Error("Unhandled startup rejection"));
  });
}

const startupWatchdog = window.setTimeout(() => {
  if (startupSettled) return;
  renderStartupError(new Error("Startup timed out while loading the main interface."));
}, 8000);

try {
  if (!startupSettled) {
    startupSettled = true;
    window.clearTimeout(startupWatchdog);
    root.render(
      <StrictMode>
        <StartupErrorBoundary>
          <App />
        </StartupErrorBoundary>
      </StrictMode>,
    );
    releaseStartupOverlay();
  }
} catch (error) {
  window.clearTimeout(startupWatchdog);
  renderStartupError(error);
}
