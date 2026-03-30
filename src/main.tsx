import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
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
      return Promise.allSettled([
        currentWindow.setBackgroundColor(bootPalette.background),
        currentWindow.setTheme(tauriTheme),
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (typeof window !== "undefined") {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      notifyStartupPainted();
      hideBootSplash();
    });
  });
}
