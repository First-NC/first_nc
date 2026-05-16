import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type * as Monaco from "monaco-editor";
import { useTranslation } from "react-i18next";
import {
  FileUp,
  Save,
  SaveAll,
  Download,
  Languages,
  Moon,
  Sun,
  Play,
  Pause,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Compass,
  Drill,
  Expand,
  ZoomIn,
  ZoomOut,
  Hand,
  Rotate3d,
  Grid3X3,
  Eye,
  EyeOff,
  BadgeInfo,
  Keyboard,
  X,
  FolderOpen,
  Code2,
  Box,
  LocateFixed,
  Shrink,
} from "lucide-react";
import "./App.css";
import { splitCodeLines, toLoadedProgramState } from "./lib/loadedProgram";
import { enterImmersivePanes, exitImmersivePanes, toggleImmersiveDrawer } from "./lib/immersiveViewer";
import { resolveImmersiveSidebarLeft } from "./lib/immersiveSidebar";
import { clampPaneWidth } from "./lib/paneWidths";
import { getViewerSourceSignature, shouldClearTransientViewerState } from "./lib/viewerPlaybackState";
import { applyThemePaletteToDom, getBootThemePalette, resolveBootTheme } from "./lib/themeBoot";
import { getStartupMaskConfig } from "./lib/startupMask";
import { migrateStorageNamespace, STORAGE_KEYS } from "./lib/storageKeys";
import { basename, cameraForView, dirname, formatFileSize, formatFileTime } from "./lib/appViewUtils";
import {
  buildShortcutGroups,
  buildShortcutItemMap,
  buildShortcutItems,
  buildVisibleFiles,
  buildVisibleRecentFiles,
  type FileSortField,
  type SortOrder,
} from "./lib/appShellData";
import { resolveRestoredFrameIndex, sanitizeStoredWorkspaceSession, type StoredWorkspaceSession } from "./lib/workspaceSession";
import { clampWorkspaceWindowState, sanitizeStoredWorkspaceWindowState } from "./lib/workspaceState";
import { sanitizeToolbarPrefs } from "./lib/toolbarPrefs";
import {
  findShortcutConflicts,
  formatShortcutForDisplay,
  getDefaultShortcuts,
  isApplePlatform,
  isModifierOnlyShortcut,
  keyboardEventToShortcut,
  migrateLegacyShortcutMap,
  type ShortcutId,
  type ShortcutMap,
} from "./lib/shortcuts";
import type { CameraState, FrameState, LoadedProgramState, NcFileItem, NcMode, ParseResult, Vec3 } from "./types";
import { parseNcToFrames } from "./lib/ncPath";
import { checkForAppUpdate, resolveCurrentAppVersion, type UpdateVersionInfo } from "./lib/updateClient";
import {
  buildUpdateDownloadLabel,
  deriveUpdateFileName,
  resolveUpdateStatusTone,
  type UpdateOverlayPhase,
} from "./lib/updatePresentation";
import { HELP_MENU_ACTION_ORDER, UTILITY_MENU_CONTROL_ORDER } from "./lib/topMenu";

type ThemeMode = "system" | "light" | "navy" | "xdark";
type SpeedMode = "Low" | "Standard" | "High";
type InteractionMode = "pan" | "rotate";
type RecentFileItem = { path: string; fileName: string; lastOpenedAtMs: number };
type TooltipMode = "below-center" | "below-right" | "side-right";
type ActiveTooltip = {
  text: string;
  rect: DOMRect;
  mode: TooltipMode;
};
type UpdatePromptState = {
  source: "startup" | "manual";
  currentVersion: string;
  latest: UpdateVersionInfo;
};

type PreparedUpdatePackage = {
  path: string;
  fileName: string;
  version: string;
  os: string;
  packageKind?: "installer" | "in_app_update";
};

type UpdateDownloadEventPayload = {
  status: "started" | "progress" | "finished" | "failed";
  version: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  path?: string | null;
  error?: string | null;
};

type NcEditorProps = {
  path: string;
  theme: string;
  value: string;
  onBeforeMount?: (monaco: typeof Monaco) => void;
  onMount: (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => void;
  onUnmount?: () => void;
  onChange: (value: string | undefined) => void;
};

const speedPointsPerSecond: Record<SpeedMode, number> = {
  Low: 60,
  Standard: 160,
  High: 360,
};
const STORAGE_THEME_KEY = STORAGE_KEYS.themeMode;
const STORAGE_LANG_KEY = STORAGE_KEYS.lang;
const STORAGE_SHOW_FILES_KEY = STORAGE_KEYS.showFiles;
const STORAGE_SHOW_EDITOR_KEY = STORAGE_KEYS.showEditor;
const STORAGE_SHOW_VIEWER_KEY = STORAGE_KEYS.showViewer;
const STORAGE_FILES_WIDTH_KEY = STORAGE_KEYS.filesWidth;
const STORAGE_EDITOR_WIDTH_KEY = STORAGE_KEYS.editorWidth;
const STORAGE_SHOW_GRID_KEY = STORAGE_KEYS.showGrid;
const STORAGE_SHOW_GIZMO_KEY = STORAGE_KEYS.showGizmo;
const STORAGE_RECENT_FILES_KEY = STORAGE_KEYS.recentFiles;
const STORAGE_SHORTCUTS_KEY = STORAGE_KEYS.shortcuts;
const STORAGE_IMMERSIVE_VIEWER_KEY = STORAGE_KEYS.immersiveViewer;
const STORAGE_WINDOW_STATE_KEY = STORAGE_KEYS.windowState;
const STORAGE_WORKSPACE_SESSION_KEY = STORAGE_KEYS.workspaceSession;
const STORAGE_TOOLBAR_PREFS_KEY = STORAGE_KEYS.toolbarPrefs;

try {
  migrateStorageNamespace(localStorage);
} catch {
  // 本地命名空间迁移失败时保持旧数据不动，避免阻塞应用启动。
}

function frameForLine(frames: FrameState[], lineNumber: number): FrameState | null {
  if (!frames.length) return null;
  let exact: FrameState | null = null;
  for (const frame of frames) {
    if (frame.lineNumber === lineNumber) {
      exact = frame;
      break;
    }
  }
  if (exact) return exact;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].lineNumber <= lineNumber) return frames[i];
  }
  return frames[0];
}

function inTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function getSystemDarkPreference(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type TauriWindowModule = typeof import("@tauri-apps/api/window");
type TauriCoreModule = typeof import("@tauri-apps/api/core");
type TauriEventModule = typeof import("@tauri-apps/api/event");
type TauriDialogModule = typeof import("@tauri-apps/plugin-dialog");

let tauriWindowModulePromise: Promise<TauriWindowModule> | null = null;
let tauriCoreModulePromise: Promise<TauriCoreModule> | null = null;
let tauriEventModulePromise: Promise<TauriEventModule> | null = null;
let tauriDialogModulePromise: Promise<TauriDialogModule> | null = null;

function loadTauriWindowModule(): Promise<TauriWindowModule> {
  tauriWindowModulePromise ??= import("@tauri-apps/api/window");
  return tauriWindowModulePromise;
}

function loadTauriCoreModule(): Promise<TauriCoreModule> {
  tauriCoreModulePromise ??= import("@tauri-apps/api/core");
  return tauriCoreModulePromise;
}

function loadTauriEventModule(): Promise<TauriEventModule> {
  tauriEventModulePromise ??= import("@tauri-apps/api/event");
  return tauriEventModulePromise;
}

function loadTauriDialogModule(): Promise<TauriDialogModule> {
  tauriDialogModulePromise ??= import("@tauri-apps/plugin-dialog");
  return tauriDialogModulePromise;
}

function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return loadTauriCoreModule().then(({ invoke }) => invoke<T>(command, args));
}

function detectNcMode(content: string): NcMode {
  const cleaned = content
    .replace(/\([^)]*\)/g, " ")
    .replace(/;.*$/gm, " ")
    .toUpperCase();
  return /\b(?:U|V|W)[+-]?\d+(?:\.\d+)?\b/.test(cleaned) ? "laser" : "normal";
}

function registerNcLanguage(monaco: typeof Monaco) {
  if (monaco.languages.getLanguages().some((l) => l.id === "ncgcode")) return;
  monaco.languages.register({ id: "ncgcode" });
  monaco.languages.setMonarchTokensProvider("ncgcode", {
    tokenizer: {
      root: [
        [/\([^)]*\)/, "comment"],
        [/;.*$/, "comment"],
        [/\bG0?0\b/i, "keyword.g.rapid"],
        [/\bG0?1\b/i, "keyword.g.linear"],
        [/\bG0?2\b/i, "keyword.g.arc.cw"],
        [/\bG0?3\b/i, "keyword.g.arc.ccw"],
        [/\bG1[789]\b/i, "keyword.g.plane"],
        [/\bG9[01]\b/i, "keyword.g.coord"],
        [/\bG5[4-9](?:\.1)?\b/i, "keyword.g.workoffset"],
        [/\bG4[012]\b/i, "keyword.g.comp"],
        [/\bG8[0123]\b/i, "keyword.g.cycle"],
        [/\bG\d+(?:\.\d+)?\b/i, "keyword.g.misc"],
        [/\bM\d+(?:\.\d+)?\b/i, "keyword.m"],
        [/\bT\d+\b/i, "keyword.t"],
        [/\b(?:X|Y|Z|U|V|W|A|B|C|I|J|K|R|F|S|P|Q|H|D)([+-]?\d+(?:\.\d+)?)\b/i, "number.axis"],
        [/\bN\d+\b/i, "number.line"],
      ],
    },
  });

  monaco.languages.registerFoldingRangeProvider("ncgcode", {
    provideFoldingRanges(model) {
      const ranges: Monaco.languages.FoldingRange[] = [];
      const lineCount = model.getLineCount();
      let start: number | null = null;
      let lastZ = 0;
      for (let i = 1; i <= lineCount; i += 1) {
        const text = model.getLineContent(i).toUpperCase();
        const zMatch = text.match(/\bZ([+-]?\d+(?:\.\d+)?)\b/);
        const z = zMatch ? Number(zMatch[1]) : null;
        const rapid = /\bG0?0\b/.test(text);
        const cut = /\bG0?1\b|\bG0?2\b|\bG0?3\b/.test(text);
        if (z !== null) {
          if (cut && z < lastZ - 0.2 && start === null) start = i;
          if (rapid && z > lastZ + 0.2 && start !== null && i - start > 3) {
            ranges.push({ start, end: i, kind: monaco.languages.FoldingRangeKind.Region });
            start = null;
          }
          lastZ = z;
        }
      }
      if (start !== null && lineCount - start > 3) {
        ranges.push({ start, end: lineCount, kind: monaco.languages.FoldingRangeKind.Region });
      }
      return ranges;
    },
  });

  monaco.editor.defineTheme("nc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "94a3b8", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "22d3ee", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "fb7185", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "f97316", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "2dd4bf", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "facc15", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "c084fc", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "a3e635", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "f472b6", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "38bdf8", fontStyle: "bold" },
      { token: "keyword.m", foreground: "f59e0b", fontStyle: "bold" },
      { token: "keyword.t", foreground: "818cf8", fontStyle: "bold" },
      { token: "number.axis", foreground: "cbd5e1" },
      { token: "number.line", foreground: "64748b" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#0f172a",
      "editor.foreground": "#dbeafe",
      "editorLineNumber.foreground": "#64748b",
      "editor.lineHighlightBackground": "#13213b",
      "editorCursor.foreground": "#93c5fd",
      "editor.selectionBackground": "#1e3a8a55",
    },
  });

  monaco.editor.defineTheme("nc-x-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "8b98a5", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "1d9bf0", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "f91880", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "f97316", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "00ba7c", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "ffd400", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "a78bfa", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "84cc16", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "e879f9", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "60a5fa", fontStyle: "bold" },
      { token: "keyword.m", foreground: "f59e0b", fontStyle: "bold" },
      { token: "keyword.t", foreground: "818cf8", fontStyle: "bold" },
      { token: "number.axis", foreground: "e7e9ea" },
      { token: "number.line", foreground: "556070" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#16181c",
      "editor.foreground": "#e7e9ea",
      "editorLineNumber.foreground": "#56606f",
      "editor.lineHighlightBackground": "#1e2228",
      "editorCursor.foreground": "#e7e9ea",
      "editor.selectionBackground": "#1d9bf055",
    },
  });

  monaco.editor.defineTheme("nc-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "64748b", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "0ea5e9", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "e11d48", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "ea580c", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "0d9488", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "ca8a04", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "7c3aed", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "4d7c0f", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "be185d", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "0f766e", fontStyle: "bold" },
      { token: "keyword.m", foreground: "b45309", fontStyle: "bold" },
      { token: "keyword.t", foreground: "4f46e5", fontStyle: "bold" },
      { token: "number.axis", foreground: "1e293b" },
      { token: "number.line", foreground: "94a3b8" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#94a3b8",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editorCursor.foreground": "#0f172a",
      "editor.selectionBackground": "#bfdbfe66",
    },
  });
}

function App() {
  const { t, i18n } = useTranslation();
  const isMac = isApplePlatform(typeof navigator !== "undefined" ? navigator.platform : "");
  const defaultShortcuts = useMemo(
    () => getDefaultShortcuts(typeof navigator !== "undefined" ? navigator.platform : ""),
    [],
  );
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const lazyEditorLoadRef = useRef<Promise<{ default: ComponentType<NcEditorProps> }> | null>(null);
  const lazyViewerLoadRef = useRef<Promise<{ Viewer3D: ComponentType<any> }> | null>(null);
  const viewMenuRef = useRef<HTMLDetailsElement | null>(null);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const saveCurrentFileRef = useRef<(() => Promise<boolean>) | null>(null);
  const saveAsCurrentFileRef = useRef<(() => Promise<boolean>) | null>(null);
  const editorCursorListenerRef = useRef<Monaco.IDisposable | null>(null);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const decoRef = useRef<string[]>([]);
  const parseDebounceRef = useRef<number | null>(null);
  const editorFollowResetTimerRef = useRef<number | null>(null);
  const suppressCursorSyncRef = useRef(false);
  const framesRef = useRef<FrameState[]>([]);
  const lastEditorFollowTsRef = useRef(0);
  const playProgressRef = useRef(0);
  const prevViewerSourceSignatureRef = useRef("empty");
  const prevIsPlayingRef = useRef(false);
  const playProgressUiTsRef = useRef(0);
  const playProgressUiValueRef = useRef(0);
  const launchFileHandledRef = useRef(false);
  const startupUpdateCheckHandledRef = useRef(false);
  const workspaceSessionRestoreHandledRef = useRef(false);
  const pendingWorkspaceSessionRef = useRef<StoredWorkspaceSession | null>(null);
  const allowWindowCloseRef = useRef(false);
  const suppressCameraFeedbackUntilRef = useRef(0);
  const workspaceWindowHydratedRef = useRef(false);
  const initialPanePrefs = (() => {
    const filesSaved = localStorage.getItem(STORAGE_SHOW_FILES_KEY);
    const editorSaved = localStorage.getItem(STORAGE_SHOW_EDITOR_KEY);
    const viewerSaved = localStorage.getItem(STORAGE_SHOW_VIEWER_KEY);
    const isFirstRun = filesSaved === null && editorSaved === null && viewerSaved === null;
    const files = filesSaved === "true";
    const editor = editorSaved === null ? true : editorSaved === "true";
    const viewer = viewerSaved === null ? true : viewerSaved === "true";
    // First-run default: editor + viewer opened, file list collapsed.
    if (isFirstRun) return { files: false, editor: true, viewer: true, isFirstRun: true };
    if (!files && !editor && !viewer) return { files: false, editor: true, viewer: true, isFirstRun: false };
    return { files, editor, viewer, isFirstRun: false };
  })();
  const initialToolbarPrefs = (() => {
    const raw = localStorage.getItem(STORAGE_TOOLBAR_PREFS_KEY);
    const legacyShowGrid = localStorage.getItem(STORAGE_SHOW_GRID_KEY);
    const legacyShowGizmo = localStorage.getItem(STORAGE_SHOW_GIZMO_KEY);
    const fallback = {
      speed: "Standard" as SpeedMode,
      interactionMode: "pan" as InteractionMode,
      showRapidPath: true,
      showGrid: legacyShowGrid == null ? true : legacyShowGrid === "true",
      showOrientationGizmo: legacyShowGizmo == null ? true : legacyShowGizmo === "true",
      showPathTooltip: true,
    };
    if (!raw) {
      return fallback;
    }
    try {
      return sanitizeToolbarPrefs(JSON.parse(raw)) ?? fallback;
    } catch {
      return fallback;
    }
  })();

  const [folderPath, setFolderPath] = useState("");
  const [filesInFolder, setFilesInFolder] = useState<NcFileItem[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [fileSortField, setFileSortField] = useState<FileSortField>("createdAtMs");
  const [fileSortOrder, setFileSortOrder] = useState<SortOrder>("desc");
  const [activeFile, setActiveFile] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [launchProbeDone, setLaunchProbeDone] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFileItem[]>(() => {
    const raw = localStorage.getItem(STORAGE_RECENT_FILES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as RecentFileItem[];
      return parsed
        .filter((it) => typeof it?.path === "string" && it.path && typeof it?.fileName === "string")
        .slice(0, 10);
    } catch {
      return [];
    }
  });
  const [code, setCode] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [loadedProgram, setLoadedProgram] = useState<LoadedProgramState | null>(null);
  const [frames, setFrames] = useState<FrameState[]>([]);
  const [currentFrame, setCurrentFrame] = useState<FrameState | null>(null);
  const [hoverFrame, setHoverFrame] = useState<FrameState | null>(null);
  const [pathNavActive, setPathNavActive] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [speed, setSpeed] = useState<SpeedMode>(initialToolbarPrefs.speed);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(initialToolbarPrefs.interactionMode);
  const [showFiles, setShowFiles] = useState(initialPanePrefs.files);
  const [showEditor, setShowEditor] = useState(initialPanePrefs.editor);
  const [showViewer, setShowViewer] = useState(initialPanePrefs.viewer);
  const [filesWidth, setFilesWidth] = useState(() => {
    const raw = Number(localStorage.getItem(STORAGE_FILES_WIDTH_KEY));
    if (Number.isFinite(raw)) return Math.max(160, Math.min(600, raw));
    return 240;
  });
  const [editorWidth, setEditorWidth] = useState(() => {
    const raw = Number(localStorage.getItem(STORAGE_EDITOR_WIDTH_KEY));
    if (Number.isFinite(raw)) return Math.max(320, Math.min(1400, raw));
    if (initialPanePrefs.isFirstRun) {
      const approxWorkspace = Math.max(960, window.innerWidth - 84);
      // First-run default layout: editor : viewer = 1 : 4
      return Math.max(320, Math.min(1400, Math.round(approxWorkspace * 0.2)));
    }
    return 520;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [viewerZoomRequest, setViewerZoomRequest] = useState({ nonce: 0, scale: 1 });
  const [refocusNonce, setRefocusNonce] = useState(0);
  const [showRapidPath, setShowRapidPath] = useState(initialToolbarPrefs.showRapidPath);
  const [showGrid, setShowGrid] = useState(initialToolbarPrefs.showGrid);
  const [showPathTooltip, setShowPathTooltip] = useState(initialToolbarPrefs.showPathTooltip);
  const [showOrientationGizmo, setShowOrientationGizmo] = useState(initialToolbarPrefs.showOrientationGizmo);
  const [immersiveViewer, setImmersiveViewer] = useState(() => localStorage.getItem(STORAGE_IMMERSIVE_VIEWER_KEY) === "true");
  const [immersiveTopChromeVisible, setImmersiveTopChromeVisible] = useState(false);
  const [viewerHotkeyScope, setViewerHotkeyScope] = useState(false);
  const [status, setStatus] = useState(t("ready"));
  const [showShortcutModal, setShowShortcutModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [updateCandidate, setUpdateCandidate] = useState<UpdatePromptState | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState<UpdatePromptState | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateOverlayVisible, setUpdateOverlayVisible] = useState(false);
  const [updateOverlayPhase, setUpdateOverlayPhase] = useState<UpdateOverlayPhase>("idle");
  const [preparedUpdate, setPreparedUpdate] = useState<PreparedUpdatePackage | null>(null);
  const [updateDownloadInfo, setUpdateDownloadInfo] = useState<{
    version: string;
    fileName: string;
    downloadedBytes: number;
    totalBytes: number | null;
    percent: number | null;
    error: string | null;
  }>({
    version: "",
    fileName: "",
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    error: null,
  });
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);
  const [startupMaskVisible, setStartupMaskVisible] = useState(() => "__TAURI_INTERNALS__" in window);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0, visible: false });
  const [recordingShortcutId, setRecordingShortcutId] = useState<ShortcutId | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [fallbackEditor, setFallbackEditor] = useState(false);
  const [NcEditorComponent, setNcEditorComponent] = useState<ComponentType<NcEditorProps> | null>(null);
  const [Viewer3DComponent, setViewer3DComponent] = useState<ComponentType<any> | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => {
    const raw = localStorage.getItem(STORAGE_SHORTCUTS_KEY);
    if (!raw) return defaultShortcuts;
    try {
      const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
      return migrateLegacyShortcutMap({ ...defaultShortcuts, ...parsed }, typeof navigator !== "undefined" ? navigator.platform : "");
    } catch {
      return defaultShortcuts;
    }
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    if (saved === "navy" || saved === "xdark" || saved === "light" || saved === "system") return saved;
    // Backward compatibility: old "dark" was the navy theme.
    if (saved === "dark") return "navy";
    return "system";
  });
  const [ncMode, setNcMode] = useState<NcMode>("normal");
  const [systemDark, setSystemDark] = useState(() => getSystemDarkPreference());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const dragState = useRef<{ pane: "files" | "editor"; startX: number; startWidth: number } | null>(null);
  const immersiveFilesPaneRef = useRef<HTMLElement | null>(null);
  const immersiveEditorPaneRef = useRef<HTMLElement | null>(null);
  const tooltipLayerRef = useRef<HTMLDivElement | null>(null);

  const resolvedTheme: "light" | "navy" | "dark" = resolveBootTheme(themeMode, systemDark);
  const currentLocale = i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN" ? "zh-CN" : "en-US";
  const hasUnsavedChanges = Boolean(loadedProgram) && code !== lastSavedContent;
  const visiblePaneCount = [showFiles, showEditor, showViewer].filter(Boolean).length;
  useEffect(() => {
    if (!showEditor || fallbackEditor || NcEditorComponent) return;
    if (!lazyEditorLoadRef.current) {
      lazyEditorLoadRef.current = import("./components/NcEditor");
    }
    void lazyEditorLoadRef.current
      .then((module) => {
        setNcEditorComponent(() => module.default);
      })
      .catch(() => {
        setFallbackEditor(true);
        setStatus((prev) => `${prev} | Monaco loading failed, switched to fallback editor`);
      });
  }, [NcEditorComponent, fallbackEditor, showEditor]);

  useEffect(() => {
    if (!showViewer || Viewer3DComponent) return;
    if (!lazyViewerLoadRef.current) {
      lazyViewerLoadRef.current = import("./components/Viewer3D");
    }
    void lazyViewerLoadRef.current
      .then((module) => {
        setViewer3DComponent(() => module.Viewer3D);
      })
      .catch(() => {
        setStatus((prev) => `${prev} | 3D viewer loading failed`);
      });
  }, [Viewer3DComponent, showViewer]);

  useEffect(() => {
    void resolveCurrentAppVersion()
      .then((version) => {
        setAppVersion(version);
      })
      .catch(() => {});
  }, []);

  const speedOptions: Array<{ value: SpeedMode; label: string }> = [
    { value: "Low", label: t("speedLow") },
    { value: "Standard", label: t("speedStandard") },
    { value: "High", label: t("speedHigh") },
  ];

  useEffect(() => {
    if (isMac) return;
    setShortcuts((prev) => {
      let changed = false;
      const next = { ...prev };
      if (prev.openNc === "Alt+O") {
        next.openNc = "Ctrl+O";
        changed = true;
      }
      if (prev.saveFile === "Alt+S") {
        next.saveFile = "Ctrl+S";
        changed = true;
      }
      if (prev.saveFileAs === "Alt+Shift+S") {
        next.saveFileAs = "Ctrl+Shift+S";
        changed = true;
      }
      if (prev.openShortcuts === "Alt+K") {
        next.openShortcuts = "Ctrl+K";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [isMac]);
  const shortcutItems = useMemo(() => buildShortcutItems(t), [t]);
  const shortcutItemMap = useMemo(() => buildShortcutItemMap(shortcutItems), [shortcutItems]);
  const shortcutGroups = useMemo(() => buildShortcutGroups(shortcutItemMap, t), [shortcutItemMap, t]);
  const updatePlayProgress = useCallback((value: number, force = false) => {
    playProgressRef.current = value;
    const now = performance.now();
    if (
      force
      || Math.abs(value - playProgressUiValueRef.current) >= 0.18
      || now - playProgressUiTsRef.current >= 33
    ) {
      playProgressUiValueRef.current = value;
      playProgressUiTsRef.current = now;
      setPlayProgress(value);
    }
  }, []);
  const setShortcutValue = useCallback((id: ShortcutId, value: string) => {
    setShortcuts((prev) => ({ ...prev, [id]: value }));
  }, []);
  const rememberRecentFile = useCallback((path: string) => {
    const item: RecentFileItem = {
      path,
      fileName: basename(path),
      lastOpenedAtMs: Date.now(),
    };
    setRecentFiles((prev) => {
      const deduped = prev.filter((it) => it.path !== path);
      return [item, ...deduped].slice(0, 10);
    });
  }, []);
  const handleCheckForUpdate = useCallback(async (source: "startup" | "manual") => {
    const timeoutMs = source === "startup" ? 5000 : 30000;

    if (source === "manual") {
      setUpdateChecking(true);
      setStatus(t("checkingUpdate"));
    }

    try {
      const result = await checkForAppUpdate({
        timeoutMs,
      });

      setAppVersion(result.currentVersion);

      if (result.response.update_available && result.response.latest) {
        const prompt = {
          source,
          currentVersion: result.currentVersion,
          latest: result.response.latest,
        };
        setUpdateCandidate(prompt);
        setShowUpdateModal(prompt);
        if (source === "manual") {
          setStatus(t("updateAvailableStatus", { version: result.response.latest.version }));
        }
        return;
      }

      if (source === "manual") {
        if (!preparedUpdate) {
          setUpdateCandidate(null);
          setShowUpdateModal(null);
        }
        setStatus(t("updateNoAvailable"));
      }
    } catch {
      if (source === "manual") {
        setStatus(t("updateCheckFailed"));
      }
    } finally {
      if (source === "manual") {
        setUpdateChecking(false);
      }
    }
  }, [preparedUpdate, t]);

  const startUpdateDownload = useCallback(async (prompt: UpdatePromptState) => {
    if (!inTauriRuntime()) {
      setStatus(t("updateUnsupportedRuntime"));
      return;
    }

    const fileName = deriveUpdateFileName(
      prompt.latest.url,
      prompt.latest.version,
      prompt.latest.os,
      prompt.latest.package_kind,
    );
    setUpdateOverlayVisible(true);
    setUpdateOverlayPhase("downloading");
    setPreparedUpdate(null);
    setUpdateDownloadInfo({
      version: prompt.latest.version,
      fileName,
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
      error: null,
    });
    setShowUpdateModal(null);
    setStatus(t("updateDownloadStatus", { version: prompt.latest.version, progress: "0%" }));

    try {
      const prepared = await invokeTauri<PreparedUpdatePackage>("download_update_package", {
        request: {
          url: prompt.latest.url,
          version: prompt.latest.version,
          os: prompt.latest.os,
          packageKind: prompt.latest.package_kind,
          fileName,
        },
      });
      setPreparedUpdate(prepared);
      setUpdateOverlayPhase("ready");
      setStatus(t("updateReadyStatus", { version: prompt.latest.version }));
      try {
        setUpdateInstalling(true);
        setStatus(t("updateRestartingStatus", { version: prompt.latest.version }));
        await invokeTauri("launch_prepared_update", { packagePath: prepared.path });
      } catch {
        setUpdateInstalling(false);
        setUpdateOverlayPhase("failed");
        setUpdateDownloadInfo((prev) => ({
          ...prev,
          error: t("updateLaunchFailed"),
        }));
        setStatus(t("updateLaunchFailed"));
      }
    } catch {
      setUpdateInstalling(false);
      setUpdateOverlayPhase("failed");
      setUpdateDownloadInfo((prev) => ({
        ...prev,
        error: t("updateDownloadFailed"),
      }));
      setStatus(t("updateDownloadFailed"));
    }
  }, [t]);

  const handleLaunchPreparedUpdate = useCallback(async () => {
    if (!preparedUpdate) return;
    setUpdateInstalling(true);
    try {
      setStatus(t("updateRestartingStatus", { version: preparedUpdate.version }));
      await invokeTauri("launch_prepared_update", { packagePath: preparedUpdate.path });
    } catch {
      setUpdateInstalling(false);
      setUpdateOverlayPhase("failed");
      setUpdateDownloadInfo((prev) => ({
        ...prev,
        error: t("updateLaunchFailed"),
      }));
      setStatus(t("updateLaunchFailed"));
    }
  }, [preparedUpdate, t]);

  useEffect(() => {
    if (startupUpdateCheckHandledRef.current) return;
    startupUpdateCheckHandledRef.current = true;
    void handleCheckForUpdate("startup");
  }, [handleCheckForUpdate]);

  useEffect(() => {
    if (!inTauriRuntime()) return;
    let unlistenUpdate: (() => void) | null = null;
    void (async () => {
      try {
        const { listen } = await loadTauriEventModule();
        unlistenUpdate = await listen<UpdateDownloadEventPayload>("update-download-progress", (event) => {
          const payload = event.payload;
          if (!payload) return;
          setUpdateDownloadInfo({
            version: payload.version,
            fileName: payload.fileName,
            downloadedBytes: payload.downloadedBytes,
            totalBytes: payload.totalBytes,
            percent: payload.percent,
            error: payload.error ?? null,
          });
          if (payload.status === "started" || payload.status === "progress") {
            setUpdateOverlayPhase("downloading");
            const progressText = payload.percent == null ? "..." : `${Math.round(payload.percent)}%`;
            setStatus(t("updateDownloadStatus", { version: payload.version, progress: progressText }));
            return;
          }
          if (payload.status === "finished" && payload.path) {
            setUpdateOverlayPhase("ready");
            setStatus(t("updateReadyStatus", { version: payload.version }));
          }
        });
      } catch {
        // 事件监听注册失败时仅跳过下载进度同步，不影响主界面可用性。
      }
    })();
    return () => {
      if (unlistenUpdate) unlistenUpdate();
    };
  }, [t]);

  const updateStatusTone = resolveUpdateStatusTone(updateOverlayPhase);
  const updateDownloadLabel = buildUpdateDownloadLabel({
    downloadedBytes: updateDownloadInfo.downloadedBytes,
    totalBytes: updateDownloadInfo.totalBytes,
    percent: updateDownloadInfo.percent,
  });
  const statusBarUpdateLabel = useMemo(() => {
    if (updateOverlayPhase === "downloading") {
      return t("updateDownloadingShort", { progress: updateDownloadInfo.percent == null ? "..." : `${Math.round(updateDownloadInfo.percent)}%` });
    }
    if (updateOverlayPhase === "ready" && preparedUpdate) {
      return t("updateReadyShort", { version: preparedUpdate.version });
    }
    if (updateOverlayPhase === "failed") {
      return t("updateFailedShort");
    }
    if (updateCandidate?.latest.version) {
      return t("updateAvailableStatus", { version: updateCandidate.latest.version });
    }
    return "";
  }, [preparedUpdate, t, updateCandidate, updateDownloadInfo.percent, updateOverlayPhase]);

  const visibleFiles = useMemo(() => buildVisibleFiles({
    currentLocale,
    fileSearch,
    filesInFolder,
    fileSortField,
    fileSortOrder,
  }), [currentLocale, fileSearch, filesInFolder, fileSortField, fileSortOrder]);
  const visibleRecentFiles = useMemo(
    () => buildVisibleRecentFiles({ fileSearch, recentFiles }),
    [fileSearch, recentFiles],
  );
  const codeLines = useMemo(() => splitCodeLines(code), [code]);
  const viewerSourceSignature = useMemo(() => getViewerSourceSignature(frames), [frames]);
  const shortcutConflicts = useMemo(() => findShortcutConflicts(shortcuts), [shortcuts]);
  const currentNcLineText = useMemo(() => {
    if (!currentFrame || !codeLines.length) return "-";
    const raw = codeLines[Math.max(0, currentFrame.lineNumber - 1)] ?? "";
    return raw.trim() || "-";
  }, [codeLines, currentFrame]);
  const legendTooltipText = useMemo(() => {
    const parts = [
      `${t("legendLineNo")}: ${currentFrame?.lineNumber ?? "-"}`,
      t("legendLine"),
      t("legendCurve"),
      t("legendRapid"),
      t("legendPlunge"),
      t("legendSelected"),
    ];
    if (ncMode === "laser") parts.push(t("legendUvw"));
    parts.push(`${t("currentCode")}: ${currentNcLineText}`);
    return parts.join(" | ");
  }, [currentFrame?.lineNumber, currentNcLineText, ncMode, t]);
  const startupMaskConfig = useMemo(() => getStartupMaskConfig(resolvedTheme), [resolvedTheme]);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    if (!startupMaskVisible || !startupMaskConfig.visible) return;
    const timer = window.setTimeout(() => {
      setStartupMaskVisible(false);
    }, startupMaskConfig.fadeOutMs);
    return () => window.clearTimeout(timer);
  }, [startupMaskConfig.fadeOutMs, startupMaskConfig.visible, startupMaskVisible]);

  useEffect(() => {
    const palette = getBootThemePalette(resolvedTheme);
    applyThemePaletteToDom(document, resolvedTheme, palette);
    if (inTauriRuntime()) {
      const tauriTheme = resolvedTheme === "light" ? "light" : "dark";
      void invokeTauri("set_startup_appearance", { appearance: { resolvedTheme } }).catch(() => {});
      void loadTauriWindowModule()
        .then(({ getCurrentWindow }) => {
          const appWindow = getCurrentWindow();
          return Promise.all([
            appWindow.setBackgroundColor(palette.background).catch(() => {}),
            appWindow.setTheme(tauriTheme).catch(() => {}),
          ]);
        })
        .catch(() => {});
    }
  }, [resolvedTheme]);
  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, themeMode);
  }, [themeMode]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_FILES_KEY, String(showFiles));
  }, [showFiles]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_EDITOR_KEY, String(showEditor));
  }, [showEditor]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_VIEWER_KEY, String(showViewer));
  }, [showViewer]);

  useEffect(() => {
    localStorage.setItem(STORAGE_FILES_WIDTH_KEY, String(Math.round(filesWidth)));
  }, [filesWidth]);
  useEffect(() => {
    localStorage.setItem(STORAGE_EDITOR_WIDTH_KEY, String(Math.round(editorWidth)));
  }, [editorWidth]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHORTCUTS_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);
  useEffect(() => {
    localStorage.setItem(STORAGE_RECENT_FILES_KEY, JSON.stringify(recentFiles.slice(0, 10)));
  }, [recentFiles]);
  useEffect(() => {
    localStorage.setItem(
      STORAGE_TOOLBAR_PREFS_KEY,
      JSON.stringify({
        speed,
        interactionMode,
        showRapidPath,
        showGrid,
        showOrientationGizmo,
        showPathTooltip,
      }),
    );
    localStorage.setItem(STORAGE_SHOW_GRID_KEY, String(showGrid));
  }, [interactionMode, showGrid, showOrientationGizmo, showPathTooltip, showRapidPath, speed]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_GIZMO_KEY, String(showOrientationGizmo));
  }, [showOrientationGizmo]);
  useEffect(() => {
    localStorage.setItem(STORAGE_IMMERSIVE_VIEWER_KEY, String(immersiveViewer));
  }, [immersiveViewer]);
  useEffect(() => {
    const reset = shouldClearTransientViewerState({
      previousIsPlaying: prevIsPlayingRef.current,
      nextIsPlaying: isPlaying,
      sourceChanged: prevViewerSourceSignatureRef.current !== viewerSourceSignature,
    });
    prevIsPlayingRef.current = isPlaying;
    prevViewerSourceSignatureRef.current = viewerSourceSignature;
    if (reset.clearHoverFrame) setHoverFrame(null);
  }, [isPlaying, viewerSourceSignature]);
  useEffect(() => {
    if (!activeFile || !loadedProgram || !frames.length) return;
    localStorage.setItem(
      STORAGE_WORKSPACE_SESSION_KEY,
      JSON.stringify({
        filePath: activeFile,
        frameIndex: currentFrame?.index ?? 0,
        lineNumber: currentFrame?.lineNumber ?? 1,
        playProgress: playProgressRef.current,
        cameraState,
      }),
    );
  }, [activeFile, cameraState, currentFrame, frames.length, loadedProgram]);
  useEffect(() => {
    if (activeFile) setSelectedFilePath(activeFile);
  }, [activeFile]);
  useEffect(() => {
    if (!selectedFilePath && recentFiles.length > 0) {
      setSelectedFilePath(recentFiles[0].path);
    }
  }, [recentFiles, selectedFilePath]);
  useEffect(() => {
    if (!inTauriRuntime()) return;
    let disposed = false;
    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;

    void (async () => {
      try {
        const { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } = await loadTauriWindowModule();
        if (disposed) return;
        const appWindow = getCurrentWindow();

        const persistWindowState = async () => {
          if (disposed || !workspaceWindowHydratedRef.current) return;
          try {
            const [position, size, maximized] = await Promise.all([
              appWindow.outerPosition(),
              appWindow.outerSize(),
              appWindow.isMaximized(),
            ]);
            localStorage.setItem(
              STORAGE_WINDOW_STATE_KEY,
              JSON.stringify({
                x: Math.round(position.x),
                y: Math.round(position.y),
                width: Math.round(size.width),
                height: Math.round(size.height),
                maximized,
              }),
            );
          } catch {
            // 保存窗口状态失败时不打断运行，下次仍可继续尝试持久化。
          }
        };

        const restoreWindowState = async () => {
          const raw = localStorage.getItem(STORAGE_WINDOW_STATE_KEY);
          let saved = null;
          if (raw) {
            try {
              saved = sanitizeStoredWorkspaceWindowState(JSON.parse(raw));
            } catch {
              saved = null;
            }
          }
          try {
            if (saved) {
              const monitors = (await availableMonitors()).map((monitor) => ({
                x: monitor.workArea.position.x,
                y: monitor.workArea.position.y,
                width: monitor.workArea.size.width,
                height: monitor.workArea.size.height,
              }));
              const next = clampWorkspaceWindowState(saved, monitors);
              const isCurrentlyMaximized = await appWindow.isMaximized();
              if (isCurrentlyMaximized) {
                await appWindow.unmaximize();
              }
              await appWindow.setSize(new PhysicalSize(next.width, next.height));
              await appWindow.setPosition(new PhysicalPosition(next.x, next.y));
              if (next.maximized) {
                await appWindow.maximize();
              }
            }
          } catch {
            // 旧窗口状态非法或显示器布局变化时，回退到系统默认窗口行为。
          } finally {
            workspaceWindowHydratedRef.current = true;
            void persistWindowState();
          }
        };

        await restoreWindowState();
        if (disposed) return;
        unlistenMoved = await appWindow.onMoved(() => {
          void persistWindowState();
        });
        unlistenResized = await appWindow.onResized(() => {
          void persistWindowState();
        });
      } catch {
        // 非 Tauri 或窗口 API 不可用时，直接标记已完成 hydration。
        workspaceWindowHydratedRef.current = true;
      }
    })();

    return () => {
      disposed = true;
      unlistenMoved?.();
      unlistenResized?.();
    };
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_LANG_KEY);
    if (saved && saved !== currentLocale) {
      void i18n.changeLanguage(saved);
    }
    // Restore persisted locale only once on startup.
    // Re-running this effect on every locale change can revert the user's latest selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!monacoRef.current) return;
    if (resolvedTheme === "light") {
      monacoRef.current.editor.setTheme("nc-light");
    } else if (resolvedTheme === "navy") {
      monacoRef.current.editor.setTheme("nc-dark");
    } else {
      monacoRef.current.editor.setTheme("nc-x-dark");
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (editorReady || fallbackEditor) return;
    const timer = window.setTimeout(() => {
      setFallbackEditor(true);
      setStatus((prev) => `${prev} | Monaco loading timeout, switched to fallback editor`);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [editorReady, fallbackEditor]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setSystemDark(e.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    if (typeof media.addListener === "function") {
      media.addListener(onChange);
      return () => media.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragState.current) return;
      const diff = e.clientX - dragState.current.startX;
      if (dragState.current.pane === "files") {
        const nextWidth = dragState.current.startWidth + diff;
        setFilesWidth(clampPaneWidth({
          pane: "files",
          immersive: immersiveViewer,
          viewportWidth,
          requested: nextWidth,
        }));
      } else {
        const nextWidth = dragState.current.startWidth + diff;
        setEditorWidth(clampPaneWidth({
          pane: "editor",
          immersive: immersiveViewer,
          viewportWidth,
          requested: nextWidth,
        }));
      }
    };
    const onUp = () => {
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [immersiveViewer, viewportWidth]);

  const openViewerPane = useCallback(() => {
    suppressCameraFeedbackUntilRef.current = performance.now() + 480;
    setRefocusNonce(0);
    setCameraState(frames.length > 1 ? cameraForView(frames, "Top") : null);
    setShowViewer(true);
  }, [frames]);

  const toggleFilesPane = useCallback(() => {
    if (immersiveViewer) {
      const next = toggleImmersiveDrawer({ showFiles, showEditor, showViewer: true }, "files");
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (showFiles && !showEditor && !showViewer) return;
    setShowFiles((v) => !v);
  }, [immersiveViewer, showEditor, showFiles, showViewer]);

  const toggleEditorPane = useCallback(() => {
    if (immersiveViewer) {
      const next = toggleImmersiveDrawer({ showFiles, showEditor, showViewer: true }, "editor");
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (showEditor && !showFiles && !showViewer) return;
    setShowEditor((v) => !v);
  }, [immersiveViewer, showEditor, showFiles, showViewer]);

  const toggleViewerPane = useCallback(() => {
    if (immersiveViewer) return;
    if (showViewer && !showFiles && !showEditor) return;
    if (!showViewer) {
      openViewerPane();
      return;
    }
    setShowViewer(false);
  }, [immersiveViewer, openViewerPane, showEditor, showFiles, showViewer]);

  const toggleImmersiveViewerMode = useCallback(() => {
    if (immersiveViewer) {
      const next = exitImmersivePanes({ showFiles, showEditor, showViewer: true });
      setImmersiveViewer(false);
      setImmersiveTopChromeVisible(false);
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (!showViewer) openViewerPane();
    const next = enterImmersivePanes({ showFiles, showEditor, showViewer: true });
    setImmersiveViewer(true);
    setImmersiveTopChromeVisible(false);
    setShowFiles(next.showFiles);
    setShowEditor(next.showEditor);
    setShowViewer(next.showViewer);
  }, [immersiveViewer, openViewerPane, showEditor, showFiles, showViewer]);

  const applyLoadedProgram = useCallback((result: ParseResult) => {
    const detectedMode = detectNcMode(result.content);
    setNcMode(detectedMode);
    const nextFrames = parseNcToFrames(result.content, detectedMode);
    setIsPlaying(false);
    setInteractionMode("pan");
    // Render directly at default view center (no recenter animation).
    suppressCameraFeedbackUntilRef.current = performance.now() + 520;
    setRefocusNonce(0);
    setCameraState(nextFrames.length > 1 ? cameraForView(nextFrames, "Top") : null);
    setLoadedProgram(toLoadedProgramState(result));
    setCode(result.content);
    setLastSavedContent(result.content);
    setFrames(nextFrames);
    setCurrentFrame(nextFrames[0]);
    updatePlayProgress(0, true);
    setHoverFrame(null);
    setPathNavActive(false);
    setStatus(t("loaded"));
  }, [t, updatePlayProgress]);

  const loadNcFile = useCallback(async (path: string) => {
    const result = await invokeTauri<ParseResult>("open_nc_file", { path });
    setActiveFile(path);
    setSelectedFilePath(path);
    applyLoadedProgram(result);
    rememberRecentFile(path);
  }, [applyLoadedProgram, rememberRecentFile]);

  const loadNcFileWithFolderContext = useCallback(async (filePath: string) => {
    const dir = dirname(filePath);
    const files = await invokeTauri<NcFileItem[]>("list_nc_files_in_folder", { folderPath: dir });
    setFolderPath(dir);
    setFilesInFolder(files);
    await loadNcFile(filePath);
  }, [loadNcFile]);

  const selectAndLoadFile = useCallback(async (path: string, withFolderContext: boolean) => {
    setSelectedFilePath(path);
    if (path === activeFile) return;
    if (withFolderContext) {
      await loadNcFileWithFolderContext(path);
      return;
    }
    await loadNcFile(path);
  }, [activeFile, loadNcFile, loadNcFileWithFolderContext]);

  const openNcFileByDialog = async () => {
    const { open } = await loadTauriDialogModule();
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "NC Files", extensions: ["nc", "anc"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    await loadNcFileWithFolderContext(selected);
  };

  useEffect(() => {
    if (launchFileHandledRef.current) return;
    launchFileHandledRef.current = true;
    let unlistenLaunch: (() => void) | null = null;
    if (!inTauriRuntime()) {
      setLaunchProbeDone(true);
      return;
    }
    void (async () => {
      try {
        const { listen } = await loadTauriEventModule();
        unlistenLaunch = await listen<string>("launch-nc-file", async (event) => {
          const launchPath = event.payload;
          if (!launchPath) return;
          await loadNcFileWithFolderContext(launchPath);
        });

        const pendingLaunches = await invokeTauri<string[]>("take_pending_launch_nc_files");
        for (const launchPath of pendingLaunches) {
          if (!launchPath) continue;
          await loadNcFileWithFolderContext(launchPath);
        }
      } catch {
        // Ignore startup probe failures when web runtime is not fully initialized.
      } finally {
        setLaunchProbeDone(true);
      }
    })();
    return () => {
      if (unlistenLaunch) unlistenLaunch();
    };
  }, [loadNcFileWithFolderContext]);

  useEffect(() => {
    if (!launchProbeDone || workspaceSessionRestoreHandledRef.current || activeFile) return;
    workspaceSessionRestoreHandledRef.current = true;
    const raw = localStorage.getItem(STORAGE_WORKSPACE_SESSION_KEY);
    if (!raw) return;
    let snapshot: StoredWorkspaceSession | null = null;
    try {
      snapshot = sanitizeStoredWorkspaceSession(JSON.parse(raw));
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      localStorage.removeItem(STORAGE_WORKSPACE_SESSION_KEY);
      return;
    }
    pendingWorkspaceSessionRef.current = snapshot;
    setSelectedFilePath(snapshot.filePath);
    void loadNcFileWithFolderContext(snapshot.filePath).catch(() => {
      pendingWorkspaceSessionRef.current = null;
      localStorage.removeItem(STORAGE_WORKSPACE_SESSION_KEY);
      setSelectedFilePath("");
      setStatus(t("ready"));
    });
  }, [activeFile, launchProbeDone, loadNcFileWithFolderContext, t]);

  useEffect(() => {
    if (!loadedProgram) return;
    if (parseDebounceRef.current) window.clearTimeout(parseDebounceRef.current);
    parseDebounceRef.current = window.setTimeout(() => {
      const detectedMode = detectNcMode(code);
      setNcMode((prev) => (prev === detectedMode ? prev : detectedMode));
      const updatedByMode = parseNcToFrames(code, detectedMode);
      setFrames(updatedByMode);
      setCurrentFrame((prev) => {
        if (!updatedByMode.length) return null;
        if (!prev) return updatedByMode[0];
        const byLine = frameForLine(updatedByMode, prev.lineNumber);
        if (byLine) return byLine;
        const fallbackIndex = Math.max(0, Math.min(updatedByMode.length - 1, prev.index ?? 0));
        return updatedByMode[fallbackIndex];
      });
      const safeProgress = Math.max(0, Math.min(updatedByMode.length - 1, playProgressRef.current));
      updatePlayProgress(safeProgress, true);
      setHoverFrame(null);
    }, 180);
    return () => {
      if (parseDebounceRef.current) window.clearTimeout(parseDebounceRef.current);
    };
  }, [code, loadedProgram, updatePlayProgress]);

  useEffect(() => {
    const snapshot = pendingWorkspaceSessionRef.current;
    if (!snapshot || !activeFile || snapshot.filePath !== activeFile || !frames.length) return;
    pendingWorkspaceSessionRef.current = null;
    const fallbackIndex = resolveRestoredFrameIndex(frames.length, snapshot);
    const lineFrame = frameForLine(frames, snapshot.lineNumber);
    const targetFrame = lineFrame ?? frames[fallbackIndex] ?? frames[0];
    const safeProgress = Math.max(0, Math.min(frames.length - 1, snapshot.playProgress));
    setIsPlaying(false);
    setHoverFrame(null);
    setPathNavActive(true);
    updatePlayProgress(Number.isFinite(safeProgress) ? safeProgress : targetFrame.index, true);
    setCurrentFrame(targetFrame);
    if (snapshot.cameraState) {
      suppressCameraFeedbackUntilRef.current = performance.now() + 320;
      setCameraState(snapshot.cameraState);
    }
  }, [activeFile, frames, updatePlayProgress]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;
    let rafId = 0;
    let lastTs = performance.now();
    let progress = Math.max(0, Math.min(frames.length - 1, playProgressRef.current));
    let lastIndex = Math.floor(progress);

    const tick = (ts: number) => {
      const dt = Math.max(0, ts - lastTs);
      lastTs = ts;
      progress += (dt * speedPointsPerSecond[speed]) / 1000;
      if (progress >= frames.length - 1) {
        progress = frames.length - 1;
        updatePlayProgress(progress, true);
        setCurrentFrame(frames[frames.length - 1]);
        setIsPlaying(false);
        return;
      }
      updatePlayProgress(progress);
      const index = Math.floor(progress);
      if (index !== lastIndex) {
        lastIndex = index;
        setCurrentFrame(frames[index]);
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, frames, speed, updatePlayProgress]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    if (!currentFrame) {
      decoRef.current = editorRef.current.deltaDecorations(decoRef.current, []);
      return;
    }
    const now = performance.now();
    const shouldFollowCursor = !isPlaying || (now - lastEditorFollowTsRef.current > 120);
    if (shouldFollowCursor) {
      const currentLine = editorRef.current.getPosition()?.lineNumber ?? -1;
      if (currentLine !== currentFrame.lineNumber) {
        suppressCursorSyncRef.current = true;
        editorRef.current.setPosition({ lineNumber: currentFrame.lineNumber, column: 1 });
        if (isPlaying) {
          editorRef.current.revealLineNearTop(currentFrame.lineNumber);
        } else {
          editorRef.current.revealLineInCenter(currentFrame.lineNumber);
        }
        if (editorFollowResetTimerRef.current) {
          window.clearTimeout(editorFollowResetTimerRef.current);
        }
        editorFollowResetTimerRef.current = window.setTimeout(() => {
          suppressCursorSyncRef.current = false;
        }, 0);
      }
      lastEditorFollowTsRef.current = now;
    }
    decoRef.current = editorRef.current.deltaDecorations(decoRef.current, [
      {
        range: new monacoRef.current.Range(currentFrame.lineNumber, 1, currentFrame.lineNumber, 1),
        options: { isWholeLine: true, className: "current-line-highlight", glyphMarginClassName: "current-line-glyph" },
      },
    ]);
  }, [currentFrame, editorReady, isPlaying]);

  useEffect(() => {
    return () => {
      if (editorFollowResetTimerRef.current) {
        window.clearTimeout(editorFollowResetTimerRef.current);
        editorFollowResetTimerRef.current = null;
      }
    };
  }, []);

  const onEditorMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    setEditorReady(true);
    setFallbackEditor(false);
    monacoRef.current = monaco;
    editorRef.current = editor;
    registerNcLanguage(monaco);
    if (resolvedTheme === "light") {
      monaco.editor.setTheme("nc-light");
    } else if (resolvedTheme === "navy") {
      monaco.editor.setTheme("nc-dark");
    } else {
      monaco.editor.setTheme("nc-x-dark");
    }
    editorCursorListenerRef.current?.dispose();
    editorCursorListenerRef.current = editor.onDidChangeCursorPosition((e) => {
      if (suppressCursorSyncRef.current) return;
      const target = frameForLine(framesRef.current, e.position.lineNumber);
      if (!target) return;
      setPathNavActive(true);
      setHoverFrame(null);
      updatePlayProgress(target.index, true);
      setCurrentFrame((prev) => {
        if (prev && prev.index === target.index) return prev;
        return target;
      });
    });
  };

  const handleEditorUnmount = useCallback(() => {
    editorCursorListenerRef.current?.dispose();
    editorCursorListenerRef.current = null;
    editorRef.current = null;
    decoRef.current = [];
    setEditorReady(false);
  }, []);

  useEffect(() => {
    return () => {
      editorCursorListenerRef.current?.dispose();
      editorCursorListenerRef.current = null;
    };
  }, []);

  const localizeMonacoFindWidget = useCallback(() => {
    const root = editorRef.current?.getDomNode();
    if (!root) return;
    const setLabel = (selector: string, text: string) => {
      const el = root.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      el.setAttribute("title", text);
      el.setAttribute("aria-label", text);
    };
    setLabel(".find-widget .button.toggle", t("editorToggleReplace"));
    setLabel(".find-widget .button.previous", t("editorPrevMatch"));
    setLabel(".find-widget .button.next", t("editorNextMatch"));
    setLabel(".find-widget .button.replace", t("editorReplace"));
    setLabel(".find-widget .button.replace-all", t("editorReplaceAll"));
    setLabel(".find-widget > .button.codicon-widget-close", t("close"));
  }, [t]);

  const syncMonacoFindWidgetLayout = useCallback(() => {
    const host = editorHostRef.current;
    const root = editorRef.current?.getDomNode();
    if (!root || !host) return;
    const nextWidth = Math.max(180, Math.floor(host.clientWidth - 16));
    const nextInputMinWidth = Math.max(120, Math.min(220, Math.floor((nextWidth - 168) / 2)));
    root.style.setProperty("--editor-find-widget-max-width", `${nextWidth}px`);
    root.style.setProperty("--editor-find-input-min-width", `${nextInputMinWidth}px`);
  }, []);

  useEffect(() => {
    if (!editorReady) return;
    localizeMonacoFindWidget();
    syncMonacoFindWidgetLayout();
    const root = editorRef.current?.getDomNode();
    if (!root) return;
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => {
      localizeMonacoFindWidget();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [currentLocale, editorReady, localizeMonacoFindWidget, syncMonacoFindWidgetLayout]);

  useEffect(() => {
    if (!editorReady) return;
    const host = editorHostRef.current;
    if (!host) return;
    syncMonacoFindWidgetLayout();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      syncMonacoFindWidgetLayout();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [editorReady, syncMonacoFindWidgetLayout]);

  const startSimulation = async () => {
    if (!frames.length) return;
    setPathNavActive(true);
    setHoverFrame(null);
    setIsPlaying(false);
    setCurrentFrame(frames[0]);
    updatePlayProgress(0, true);
    setStatus(t("simStarted"));
  };

  const step = async (mode: "Prev" | "Next") => {
    if (!frames.length) return;
    setPathNavActive(true);
    setHoverFrame(null);
    setCurrentFrame((prev) => {
      const idx = prev?.index ?? 0;
      const next = mode === "Next"
        ? Math.min(frames.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      updatePlayProgress(next, true);
      return frames[next];
    });
  };

  const togglePlay = () => {
    if (!frames.length) return;
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        setPathNavActive(true);
        setHoverFrame(null);
        setCurrentFrame((cur) => {
          if (!cur || cur.index >= frames.length - 1) {
            updatePlayProgress(0, true);
            return frames[0];
          }
          updatePlayProgress(cur.index, true);
          return cur;
        });
      }
      return next;
    });
  };

  const selectFrameByIndex = useCallback((index: number) => {
    if (!frames.length) return;
    const safe = Math.max(0, Math.min(frames.length - 1, index));
    updatePlayProgress(safe, true);
    setCurrentFrame(frames[safe]);
  }, [frames, updatePlayProgress]);

  const handleViewerFrameHover = useCallback((frame: FrameState) => {
    if (pathNavActive) return;
    setHoverFrame(frame);
  }, [pathNavActive]);

  const handleViewerFrameHoverEnd = useCallback(() => {
    setHoverFrame(null);
  }, []);

  const handleViewerFramePick = useCallback((frame: FrameState) => {
    setPathNavActive(true);
    setHoverFrame(null);
    setIsPlaying(false);
    selectFrameByIndex(frame.index);
  }, [selectFrameByIndex]);

  const handleViewerRefocusApplied = useCallback(() => {
    setRefocusNonce(0);
  }, []);

  const handleViewerRequestNamedView = useCallback((view: "Top" | "Front" | "Right") => {
    void setView(view);
  }, []);

  const handleViewerCameraStateChange = useCallback((next: CameraState) => {
    if (performance.now() < suppressCameraFeedbackUntilRef.current) return;
    setCameraState((prev) => {
      if (!prev) return next;
      const dp = Math.hypot(
        prev.position.x - next.position.x,
        prev.position.y - next.position.y,
        prev.position.z - next.position.z,
      );
      const dt = Math.hypot(
        prev.target.x - next.target.x,
        prev.target.y - next.target.y,
        prev.target.z - next.target.z,
      );
      if (dp < 1e-4 && dt < 1e-4 && prev.viewName === next.viewName) return prev;
      return next;
    });
  }, []);

  const setView = useCallback(async (name: string) => {
    if (frames.length) {
      suppressCameraFeedbackUntilRef.current = performance.now() + 260;
      setCameraState(cameraForView(frames, name));
    } else {
      const cur = currentFrame?.position ?? { x: 0, y: 0, z: 0 };
      const d = 220;
      const presets: Record<string, Vec3> = {
        Top: { x: cur.x, y: cur.y, z: cur.z + d },
        Bottom: { x: cur.x, y: cur.y, z: cur.z - d },
        Front: { x: cur.x, y: cur.y + d, z: cur.z },
        Left: { x: cur.x + d, y: cur.y, z: cur.z },
        Right: { x: cur.x - d, y: cur.y, z: cur.z },
      };
      suppressCameraFeedbackUntilRef.current = performance.now() + 260;
      setCameraState({ target: cur, position: presets[name] ?? presets.Top, zoom: 1, viewName: name });
    }
  }, [currentFrame?.position, frames]);

  const applyView = useCallback((name: string) => {
    viewMenuRef.current?.removeAttribute("open");
    void setView(name);
  }, [setView]);

  const closeTopMenuDropdowns = useCallback(() => {
    viewMenuRef.current?.removeAttribute("open");
    setIsHelpMenuOpen(false);
  }, []);

  const requestViewerZoom = useCallback((scale: number) => {
    setViewerZoomRequest((prev) => ({ nonce: prev.nonce + 1, scale }));
  }, []);

  const refocusCenter = useCallback(() => {
    if (!frames.length) return;
    // Hard-reset to the same initial top-view state used on file load/open.
    suppressCameraFeedbackUntilRef.current = performance.now() + 260;
    setRefocusNonce(0);
    setCameraState(cameraForView(frames, "Top"));
    setStatus(t("refocused"));
  }, [frames, t]);

  const displayShortcut = useCallback((shortcut: string) => formatShortcutForDisplay(shortcut, isMac), [isMac]);
  const tooltipWithShortcut = useCallback((label: string, shortcut: string) => `${label} (${displayShortcut(shortcut)})`, [displayShortcut]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (showShortcutModal && key === "escape") {
        e.preventDefault();
        setRecordingShortcutId(null);
        setShowShortcutModal(false);
        return;
      }
      if (recordingShortcutId) return;
      const pressed = keyboardEventToShortcut(e);
      if (pressed === shortcuts.openNc) {
        e.preventDefault();
        void openNcFileByDialog();
        return;
      }
      if (pressed === shortcuts.saveFile) {
        e.preventDefault();
        void saveCurrentFileRef.current?.();
        return;
      }
      if (pressed === shortcuts.saveFileAs) {
        e.preventDefault();
        void saveAsCurrentFileRef.current?.();
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditor = Boolean(
        target?.closest(".monaco-editor, .monaco-editor *") ||
        target?.classList?.contains("inputarea"),
      );
      const isEditable = tag === "input" || tag === "textarea" || target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && key === "f" && viewerHotkeyScope && !inEditor && !isEditable) {
        e.preventDefault();
        return;
      }

      if (isEditable || inEditor) return;

      if (pressed === shortcuts.toggleFiles) {
        e.preventDefault();
        toggleFilesPane();
        return;
      }
      if (pressed === shortcuts.openShortcuts) {
        e.preventDefault();
        setShowShortcutModal((prev) => !prev);
        setRecordingShortcutId(null);
        return;
      }
      if (pressed === shortcuts.toggleEditor) {
        e.preventDefault();
        toggleEditorPane();
        return;
      }
      if (pressed === shortcuts.toggleViewer) {
        e.preventDefault();
        toggleViewerPane();
        return;
      }
      if (pressed === shortcuts.toggleImmersiveViewer) {
        e.preventDefault();
        toggleImmersiveViewerMode();
        return;
      }
      if (key === "escape") {
        if (viewerHotkeyScope || currentFrame || hoverFrame || pathNavActive) {
          e.preventDefault();
          setIsPlaying(false);
          setHoverFrame(null);
          setPathNavActive(false);
          setCurrentFrame(null);
          return;
        }
        if (immersiveViewer) {
          e.preventDefault();
          setImmersiveTopChromeVisible(false);
          return;
        }
        return;
      }

      const is3DAction = [
        shortcuts.refocus,
        shortcuts.viewTop,
        shortcuts.viewFront,
        shortcuts.viewLeft,
        shortcuts.viewRight,
        shortcuts.viewBottom,
        shortcuts.panMode,
        shortcuts.rotateMode,
        shortcuts.zoomIn,
        shortcuts.zoomOut,
        shortcuts.toggleGrid,
        shortcuts.toggleGizmo,
        shortcuts.toggleRapidPath,
        shortcuts.togglePathTooltip,
        shortcuts.toggleImmersiveViewer,
        shortcuts.pathPrev,
        shortcuts.pathNext,
      ].includes(pressed);
      if (is3DAction && !(viewerHotkeyScope || immersiveViewer)) return;

      // Always keep plain "F" available as a hard fallback for refocus.
      if (pressed === shortcuts.refocus || (!e.ctrlKey && !e.altKey && !e.metaKey && key === "f")) {
        e.preventDefault();
        refocusCenter();
        return;
      }
      if (pressed === shortcuts.viewTop) {
        e.preventDefault();
        applyView("Top");
        return;
      }
      if (pressed === shortcuts.viewFront) {
        e.preventDefault();
        applyView("Front");
        return;
      }
      if (pressed === shortcuts.viewLeft) {
        e.preventDefault();
        applyView("Left");
        return;
      }
      if (pressed === shortcuts.viewRight) {
        e.preventDefault();
        applyView("Right");
        return;
      }
      if (pressed === shortcuts.viewBottom) {
        e.preventDefault();
        applyView("Bottom");
        return;
      }
      if (pressed === shortcuts.panMode) {
        e.preventDefault();
        setInteractionMode("pan");
        return;
      }
      if (pressed === shortcuts.rotateMode) {
        e.preventDefault();
        setInteractionMode("rotate");
        return;
      }
      if (pressed === shortcuts.zoomIn || key === "=" && shortcuts.zoomIn === "+") {
        e.preventDefault();
        requestViewerZoom(0.74);
        return;
      }
      if (pressed === shortcuts.zoomOut) {
        e.preventDefault();
        requestViewerZoom(1.35);
        return;
      }
      if (pressed === shortcuts.toggleGrid) {
        e.preventDefault();
        setShowGrid((v) => !v);
        return;
      }
      if (pressed === shortcuts.toggleGizmo) {
        e.preventDefault();
        setShowOrientationGizmo((v) => !v);
        return;
      }
      if (pressed === shortcuts.toggleRapidPath) {
        e.preventDefault();
        setShowRapidPath((v) => !v);
        return;
      }
      if (pressed === shortcuts.togglePathTooltip) {
        e.preventDefault();
        setShowPathTooltip((v) => !v);
        return;
      }
      if (!pathNavActive || !currentFrame) return;
      if (pressed === shortcuts.pathPrev) {
        e.preventDefault();
        setHoverFrame(null);
        selectFrameByIndex((currentFrame.index ?? 0) - 1);
      } else if (pressed === shortcuts.pathNext) {
        e.preventDefault();
        setHoverFrame(null);
        selectFrameByIndex((currentFrame.index ?? 0) + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    recordingShortcutId,
    showShortcutModal,
    currentFrame,
    pathNavActive,
    refocusCenter,
    selectFrameByIndex,
    toggleEditorPane,
    toggleFilesPane,
    toggleViewerPane,
    toggleImmersiveViewerMode,
    shortcuts,
    viewerHotkeyScope,
    immersiveViewer,
    requestViewerZoom,
    applyView,
  ]);

  const onShortcutRecorderKeyDown = useCallback((id: ShortcutId, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecordingShortcutId(null);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      setShortcutValue(id, "");
      setRecordingShortcutId(null);
      return;
    }
    const shortcut = keyboardEventToShortcut(e.nativeEvent);
    if (!shortcut || isModifierOnlyShortcut(shortcut)) return;
    setShortcutValue(id, shortcut);
    setRecordingShortcutId(null);
  }, [setShortcutValue]);

  useEffect(() => {
    if (showShortcutModal) return;
    setRecordingShortcutId(null);
  }, [showShortcutModal]);

  useEffect(() => {
    if (!recordingShortcutId) return;
    const onRecordKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingShortcutId(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        setShortcutValue(recordingShortcutId, "");
        setRecordingShortcutId(null);
        return;
      }
      const shortcut = keyboardEventToShortcut(e);
      if (!shortcut || isModifierOnlyShortcut(shortcut)) return;
      setShortcutValue(recordingShortcutId, shortcut);
      setRecordingShortcutId(null);
    };
    window.addEventListener("keydown", onRecordKeyDown, true);
    return () => window.removeEventListener("keydown", onRecordKeyDown, true);
  }, [recordingShortcutId, setShortcutValue]);

  const shortcutConflictMessage = useMemo(() => {
    if (!recordingShortcutId) return "";
    const conflictIds = shortcutConflicts[recordingShortcutId];
    if (!conflictIds?.length) return "";
    const names = conflictIds
      .map((id) => shortcutItemMap[id] ?? id)
      .join("��");
    return `${displayShortcut(shortcuts[recordingShortcutId])} ${t("shortcutConflictWith")} ${names}`;
  }, [displayShortcut, recordingShortcutId, shortcutConflicts, shortcutItemMap, shortcuts, t]);

  const saveToPath = useCallback(async (path: string) => {
    await invokeTauri("export_nc_file", {
      path,
      content: code,
      exportOptions: { encoding: "Utf8", lineEnding: "CrLf" },
    });
    setActiveFile(path);
    setLastSavedContent(code);
    const dir = dirname(path);
    const files = await invokeTauri<NcFileItem[]>("list_nc_files_in_folder", { folderPath: dir });
    setFolderPath(dir);
    setFilesInFolder(files);
    setStatus(t("saved"));
    return true;
  }, [code, t]);

  const saveAsCurrentFile = useCallback(async () => {
    const { save } = await loadTauriDialogModule();
    const targetPath = await save({
      filters: [{ name: "NC Files", extensions: ["nc", "anc"] }],
      defaultPath: activeFile || "program.nc",
    });
    if (!targetPath) return false;
    return saveToPath(targetPath);
  }, [activeFile, saveToPath]);

  const saveCurrentFile = useCallback(async () => {
    if (!loadedProgram) return false;
    if (!activeFile) return saveAsCurrentFile();
    return saveToPath(activeFile);
  }, [activeFile, loadedProgram, saveAsCurrentFile, saveToPath]);

  useEffect(() => {
    saveCurrentFileRef.current = saveCurrentFile;
    saveAsCurrentFileRef.current = saveAsCurrentFile;
  }, [saveAsCurrentFile, saveCurrentFile]);

  useEffect(() => {
    if (!immersiveViewer || immersiveTopChromeVisible) return;
    closeTopMenuDropdowns();
    const active = document.activeElement;
    if (active instanceof HTMLElement && topChromeRef.current?.contains(active)) {
      active.blur();
    }
  }, [closeTopMenuDropdowns, immersiveTopChromeVisible, immersiveViewer]);

  useEffect(() => {
    if (!isHelpMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && helpMenuRef.current?.contains(target)) return;
      setIsHelpMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isHelpMenuOpen]);

  useEffect(() => {
    const resolveMode = (target: HTMLElement): TooltipMode => {
      if (target.closest(".side-btn")) return "side-right";
      if (
        target.closest(".viewer-float-actions") ||
        target.closest(".top-chrome") ||
        target.closest(".view-menu-list") ||
        target.closest(".help-menu-list") ||
        target.closest(".viewer-meta")
      ) {
        return "below-right";
      }
      return "below-center";
    };

    const showTooltip = (target: HTMLElement) => {
      const text = target.getAttribute("data-ui-tooltip");
      if (!text) return;
      setActiveTooltip({
        text,
        rect: target.getBoundingClientRect(),
        mode: resolveMode(target),
      });
    };

    const hideTooltip = () => {
      setActiveTooltip(null);
      setTooltipPosition((prev) => ({ ...prev, visible: false }));
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.("[data-ui-tooltip]") as HTMLElement | null;
      if (target) showTooltip(target);
    };

    const onMouseOut = (event: MouseEvent) => {
      const current = (event.target as HTMLElement | null)?.closest?.("[data-ui-tooltip]") as HTMLElement | null;
      const related = event.relatedTarget as Node | null;
      if (!current) return;
      if (related instanceof Node && current.contains(related)) return;
      hideTooltip();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.("[data-ui-tooltip]") as HTMLElement | null;
      if (target) showTooltip(target);
    };

    const onFocusOut = (event: FocusEvent) => {
      const current = (event.target as HTMLElement | null)?.closest?.("[data-ui-tooltip]") as HTMLElement | null;
      const related = event.relatedTarget as Node | null;
      if (!current) return;
      if (related instanceof Node && current.contains(related)) return;
      hideTooltip();
    };

    const refreshTooltip = () => {
      if (!activeTooltip) return;
      setActiveTooltip((prev) => (prev ? { ...prev } : prev));
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", refreshTooltip);
    window.addEventListener("scroll", refreshTooltip, true);

    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", refreshTooltip);
      window.removeEventListener("scroll", refreshTooltip, true);
    };
  }, [activeTooltip]);

  useLayoutEffect(() => {
    if (!activeTooltip || !tooltipLayerRef.current) {
      setTooltipPosition((prev) => ({ ...prev, visible: false }));
      return;
    }

    const rect = activeTooltip.rect;
    const tooltipRect = tooltipLayerRef.current.getBoundingClientRect();
    const pad = 12;
    const gap = 10;
    let left = 0;
    let top = 0;

    if (activeTooltip.mode === "side-right") {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - tooltipRect.height / 2;
      if (left + tooltipRect.width > window.innerWidth - pad) {
        left = rect.left - tooltipRect.width - gap;
      }
    } else {
      left = activeTooltip.mode === "below-right"
        ? rect.right - tooltipRect.width
        : rect.left + rect.width / 2 - tooltipRect.width / 2;
      top = rect.bottom + gap;
      if (top + tooltipRect.height > window.innerHeight - pad) {
        top = rect.top - tooltipRect.height - gap;
      }
    }

    left = Math.min(Math.max(pad, left), window.innerWidth - tooltipRect.width - pad);
    top = Math.min(Math.max(pad, top), window.innerHeight - tooltipRect.height - pad);

    setTooltipPosition({
      left,
      top,
      visible: true,
    });
  }, [activeTooltip]);

  useEffect(() => {
    if (!inTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void loadTauriWindowModule()
      .then(({ getCurrentWindow }) => {
        if (disposed) return null;
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested(async (event) => {
          if (allowWindowCloseRef.current) {
            allowWindowCloseRef.current = false;
            return;
          }
          if (!hasUnsavedChanges) return;
          event.preventDefault();
          const { message } = await loadTauriDialogModule();
          const saveLabel = t("save");
          const discardLabel = t("discardChanges");
          const cancelLabel = t("cancel");
          const choice = await message(t("exitUnsavedPrompt"), {
            title: t("unsavedTitle"),
            kind: "warning",
            buttons: { yes: saveLabel, no: discardLabel, cancel: cancelLabel },
          });
          if (choice === saveLabel) {
            const saved = await saveCurrentFile();
            if (saved) {
              allowWindowCloseRef.current = true;
              await appWindow.close();
            }
            return;
          }
          if (choice === discardLabel) {
            allowWindowCloseRef.current = true;
            await appWindow.close();
          }
        });
      })
      .then((fn) => {
        if (disposed || !fn) return;
        unlisten = fn;
      })
      .catch(() => {});

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      disposed = true;
      if (unlisten) unlisten();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasUnsavedChanges, saveCurrentFile, t]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, pane: "files" | "editor", width: number) => {
    dragState.current = { pane, startX: event.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const changeLocale = async (locale: string) => {
    if (locale === currentLocale) return;
    await i18n.changeLanguage(locale);
    localStorage.setItem(STORAGE_LANG_KEY, locale);
    await invokeTauri("set_locale", { locale });
  };
  const showImmersiveFilesPane = immersiveViewer || showFiles;
  const showImmersiveEditorPane = immersiveViewer || showEditor;
  const showImmersiveViewerPane = immersiveViewer || showViewer;
  const normalFilesWidth = clampPaneWidth({
    pane: "files",
    immersive: false,
    viewportWidth,
    requested: filesWidth,
  });
  const normalEditorWidth = clampPaneWidth({
    pane: "editor",
    immersive: false,
    viewportWidth,
    requested: editorWidth,
  });
  const immersiveFilesWidth = clampPaneWidth({
    pane: "files",
    immersive: true,
    viewportWidth,
    requested: filesWidth,
  });
  const immersiveEditorWidth = clampPaneWidth({
    pane: "editor",
    immersive: true,
    viewportWidth,
    requested: editorWidth,
  });
  const immersiveFilePaneStyle: CSSProperties = immersiveViewer
    ? { width: `${immersiveFilesWidth}px`, maxWidth: `${immersiveFilesWidth}px` }
    : ((showEditor || showViewer)
      ? { flex: `0 1 ${normalFilesWidth}px`, maxWidth: `${normalFilesWidth}px` }
      : { flex: "1 1 auto" });
  const immersiveEditorPaneStyle: CSSProperties = immersiveViewer
    ? { width: `${immersiveEditorWidth}px`, maxWidth: `${immersiveEditorWidth}px` }
    : (showViewer
      ? { flex: `0 1 ${normalEditorWidth}px`, maxWidth: `${normalEditorWidth}px` }
      : { flex: "1 1 auto" });
  const [measuredImmersiveFilesWidth, setMeasuredImmersiveFilesWidth] = useState(immersiveFilesWidth);
  const [measuredImmersiveEditorWidth, setMeasuredImmersiveEditorWidth] = useState(immersiveEditorWidth);
  const effectiveImmersiveFilesWidth = immersiveViewer && showFiles ? measuredImmersiveFilesWidth : immersiveFilesWidth;
  const effectiveImmersiveEditorWidth = immersiveViewer && showEditor ? measuredImmersiveEditorWidth : immersiveEditorWidth;
  const immersiveSidebarStyle: CSSProperties | undefined = immersiveViewer
    ? {
      left: `${resolveImmersiveSidebarLeft({
        immersiveViewer,
        showFiles,
        showEditor,
        filesWidth: effectiveImmersiveFilesWidth,
        editorWidth: effectiveImmersiveEditorWidth,
      })}px`,
    }
    : undefined;
  const immersiveTopChromeStyle: (CSSProperties & Record<"--immersive-top-left-safe" | "--immersive-top-right-safe", string>) | undefined = immersiveViewer
    ? {
      "--immersive-top-left-safe": `${Math.max(
        84,
        resolveImmersiveSidebarLeft({
          immersiveViewer,
          showFiles,
          showEditor,
          filesWidth: effectiveImmersiveFilesWidth,
          editorWidth: effectiveImmersiveEditorWidth,
        }) + 64,
      )}px`,
      "--immersive-top-right-safe": "84px",
    }
    : undefined;
  const shortcutButtonTooltip = tooltipWithShortcut(t("shortcuts"), shortcuts.openShortcuts);
  const filesButtonTooltip = tooltipWithShortcut(t("toggleFiles"), shortcuts.toggleFiles);
  const editorButtonTooltip = tooltipWithShortcut(t("toggleEditor"), shortcuts.toggleEditor);
  const viewerButtonTooltip = tooltipWithShortcut(t("toggleViewer"), shortcuts.toggleViewer);
  const immersiveViewerTooltip = tooltipWithShortcut(
    immersiveViewer ? t("exitImmersiveViewer") : t("enterImmersiveViewer"),
    shortcuts.toggleImmersiveViewer,
  );
  const immersiveFilesSplitterStyle: CSSProperties | undefined = immersiveViewer && showFiles
    ? { left: `${effectiveImmersiveFilesWidth}px` }
    : undefined;
  const immersiveEditorSplitterStyle: CSSProperties | undefined = immersiveViewer && showEditor
    ? { left: `${effectiveImmersiveEditorWidth}px` }
    : undefined;

  useEffect(() => {
    if (!immersiveViewer) {
      setMeasuredImmersiveFilesWidth(immersiveFilesWidth);
      setMeasuredImmersiveEditorWidth(immersiveEditorWidth);
      return;
    }
    const updateMeasuredWidths = () => {
      if (immersiveFilesPaneRef.current) {
        setMeasuredImmersiveFilesWidth(Math.round(immersiveFilesPaneRef.current.getBoundingClientRect().width));
      } else {
        setMeasuredImmersiveFilesWidth(immersiveFilesWidth);
      }
      if (immersiveEditorPaneRef.current) {
        setMeasuredImmersiveEditorWidth(Math.round(immersiveEditorPaneRef.current.getBoundingClientRect().width));
      } else {
        setMeasuredImmersiveEditorWidth(immersiveEditorWidth);
      }
    };
    updateMeasuredWidths();
    window.addEventListener("resize", updateMeasuredWidths);
    if (typeof ResizeObserver !== "function") {
      return () => {
        window.removeEventListener("resize", updateMeasuredWidths);
      };
    }
    const observer = new ResizeObserver(() => updateMeasuredWidths());
    if (immersiveFilesPaneRef.current) observer.observe(immersiveFilesPaneRef.current);
    if (immersiveEditorPaneRef.current) observer.observe(immersiveEditorPaneRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMeasuredWidths);
    };
  }, [immersiveEditorWidth, immersiveFilesWidth, immersiveViewer, showEditor, showFiles]);
  const fileMenu = (
    <div className="menu-group">
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("openNc"), shortcuts.openNc)} onClick={() => void openNcFileByDialog()}><FileUp size={14} />{t("openNc")}</button>
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("save"), shortcuts.saveFile)} onClick={() => void saveCurrentFile()}><Save size={14} />{t("save")}</button>
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("saveAs"), shortcuts.saveFileAs)} onClick={() => void saveAsCurrentFile()}><SaveAll size={14} />{t("saveAs")}</button>
    </div>
  );

  const utilityControls = {
    language: (
      <div className="menu-inline-control" key="language">
        <label><Languages size={13} />{t("language")}</label>
        <select value={currentLocale} onChange={(e) => void changeLocale(e.target.value)}>
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
      </div>
    ),
    theme: (
      <div className="menu-inline-control" key="theme">
        <label>{resolvedTheme === "light" ? <Sun size={13} /> : <Moon size={13} />}{t("theme")}</label>
        <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as ThemeMode)}>
          <option value="system">{t("themeSystem")}</option>
          <option value="navy">{t("themeNavy")}</option>
          <option value="xdark">{t("themeDark")}</option>
          <option value="light">{t("themeLight")}</option>
        </select>
      </div>
    ),
    shortcuts: (
      <button key="shortcuts" className="menu-btn" data-ui-tooltip={shortcutButtonTooltip} onClick={() => setShowShortcutModal(true)}>
        <Keyboard size={14} />{t("shortcuts")}
      </button>
    ),
    help: (
      <div className="help-menu" ref={helpMenuRef} key="help">
        <button
          type="button"
          className="menu-btn"
          data-ui-tooltip={t("help")}
          aria-haspopup="menu"
          aria-expanded={isHelpMenuOpen}
          onClick={() => setIsHelpMenuOpen((open) => !open)}
        >
          <BadgeInfo size={14} />{t("help")}
        </button>
        {isHelpMenuOpen && <div className="help-menu-list">
          {HELP_MENU_ACTION_ORDER.map((item) => {
            if (item === "checkUpdate") {
              return (
                <button
                  key={item}
                  data-ui-tooltip={t("checkUpdate")}
                  onClick={() => {
                    setIsHelpMenuOpen(false);
                    void handleCheckForUpdate("manual");
                  }}
                  disabled={updateChecking || updateOverlayPhase === "downloading" || updateInstalling}
                >
                  <Download size={14} />
                  <span>{updateChecking ? t("checkingUpdate") : t("checkUpdate")}</span>
                </button>
              );
            }
            return (
              <button
                key={item}
                data-ui-tooltip={t("aboutTitle")}
                onClick={() => {
                  setIsHelpMenuOpen(false);
                  setShowAboutModal(true);
                }}
              >
                <BadgeInfo size={14} />
                <span>{t("aboutTitle")}</span>
              </button>
            );
          })}
        </div>}
      </div>
    ),
  } as const;

  return (
    <div className={`app-shell compact${immersiveViewer ? " immersive-viewer" : ""}${immersiveTopChromeVisible ? " immersive-chrome-visible" : ""}`}>
      {startupMaskConfig.visible && (
        <div
          className={`startup-mask${startupMaskVisible ? " visible" : " hidden"}`}
          style={{ "--startup-mask-background": startupMaskConfig.background } as CSSProperties}
          aria-hidden="true"
        />
      )}
      {immersiveViewer && (
        <div
          className="immersive-top-hotzone"
          onMouseEnter={() => setImmersiveTopChromeVisible(true)}
        />
      )}
      <div
        className={`top-chrome${immersiveViewer ? " immersive" : ""}${immersiveTopChromeVisible ? " visible" : ""}`}
        ref={topChromeRef}
        style={immersiveTopChromeStyle}
        onMouseEnter={() => immersiveViewer && setImmersiveTopChromeVisible(true)}
        onMouseLeave={() => immersiveViewer && setImmersiveTopChromeVisible(false)}
      >
        <div className="menu-bar">
          <div className="menu-left">
            {fileMenu}
            <div className="menu-tag">{folderPath || t("noFolder")}</div>
          </div>
          <div className="menu-right">
            <div className="menu-mode-readonly">
              <Drill size={13} />
              <span>{t("mode")}:</span>
              <b>{ncMode === "laser" ? t("modeLaser") : t("modeNormal")}</b>
            </div>
            {UTILITY_MENU_CONTROL_ORDER.map((id) => (
              <Fragment key={id}>{utilityControls[id]}</Fragment>
            ))}
          </div>
        </div>

        <div className="tool-bar">
          <div className="tool-left tool-cluster">
            <button className="icon-btn" onClick={() => void startSimulation()} data-ui-tooltip={t("resetSim")} aria-label={t("resetSim")}>
              <RotateCcw size={14} />
            </button>
            <button className="icon-btn" onClick={togglePlay} data-ui-tooltip={isPlaying ? t("pause") : t("play")} aria-label={isPlaying ? t("pause") : t("play")}>
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button className="icon-btn" onClick={() => void step("Prev")} data-ui-tooltip={t("stepPrev")} aria-label={t("stepPrev")}><ArrowLeft size={14} /></button>
            <button className="icon-btn" onClick={() => void step("Next")} data-ui-tooltip={t("stepNext")} aria-label={t("stepNext")}><ArrowRight size={14} /></button>
            <div className="tool-divider" />
            <select value={speed} onChange={(e) => setSpeed(e.target.value as SpeedMode)} title={t("speed")}>
              {speedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="tool-right tool-cluster">
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("refocus"), shortcuts.refocus)} onClick={refocusCenter}><LocateFixed size={14} /></button>
            <div className="tool-divider" />
            <details className="view-menu" ref={viewMenuRef}>
              <summary className="menu-btn icon-btn" data-ui-tooltip={t("viewPresets")}>
                <Compass size={14} />
              </summary>
              <div className="view-menu-list">
                  <button data-ui-tooltip={tooltipWithShortcut(t("top"), shortcuts.viewTop)} onClick={() => applyView("Top")}><ArrowUp size={14} /><span>{t("top")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("front"), shortcuts.viewFront)} onClick={() => applyView("Front")}><Compass size={14} /><span>{t("front")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("left"), shortcuts.viewLeft)} onClick={() => applyView("Left")}><ArrowLeft size={14} /><span>{t("left")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("right"), shortcuts.viewRight)} onClick={() => applyView("Right")}><ArrowRight size={14} /><span>{t("right")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("bottom"), shortcuts.viewBottom)} onClick={() => applyView("Bottom")}><ArrowDown size={14} /><span>{t("bottom")}</span></button>
              </div>
            </details>
            <button
              className={interactionMode === "pan" ? "mode-btn icon-btn active" : "mode-btn icon-btn"}
              data-ui-tooltip={tooltipWithShortcut(t("panMode"), shortcuts.panMode)}
              onClick={() => setInteractionMode("pan")}
              aria-label={t("panMode")}
            >
              <Hand size={14} />
            </button>
            <button
              className={interactionMode === "rotate" ? "mode-btn icon-btn active" : "mode-btn icon-btn"}
              data-ui-tooltip={tooltipWithShortcut(t("rotateMode"), shortcuts.rotateMode)}
              onClick={() => setInteractionMode("rotate")}
              aria-label={t("rotateMode")}
            >
              <Rotate3d size={14} />
            </button>
            <div className="tool-divider" />
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("zoomIn"), shortcuts.zoomIn)} onClick={() => requestViewerZoom(0.74)}><ZoomIn size={14} /></button>
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("zoomOut"), shortcuts.zoomOut)} onClick={() => requestViewerZoom(1.35)}><ZoomOut size={14} /></button>
            <div className="tool-divider" />
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showGrid ? t("hideGrid") : t("showGrid"), shortcuts.toggleGrid)}
              onClick={() => setShowGrid((v) => !v)}
            >
              <Grid3X3 size={14} />
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showOrientationGizmo ? t("hideGizmo") : t("showGizmo"), shortcuts.toggleGizmo)}
              onClick={() => setShowOrientationGizmo((v) => !v)}
            >
              <Compass size={14} />
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showRapidPath ? t("hideRapidPath") : t("showRapidPath"), shortcuts.toggleRapidPath)}
              onClick={() => setShowRapidPath((v) => !v)}
            >
              {showRapidPath ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showPathTooltip ? t("hidePathTooltip") : t("showPathTooltip"), shortcuts.togglePathTooltip)}
              onClick={() => setShowPathTooltip((v) => !v)}
            >
              <BadgeInfo size={14} />
            </button>
          </div>
        </div>
      </div>

      <main className={`${visiblePaneCount <= 1 && !immersiveViewer ? "workspace-row single-pane" : "workspace-row"}${immersiveViewer ? " immersive-viewer-layout" : ""}`}>
        <aside className="left-sidebar" style={immersiveSidebarStyle}>
          <button
            className={showFiles ? "side-btn active" : "side-btn"}
            data-ui-tooltip={filesButtonTooltip}
            onClick={toggleFilesPane}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className={showEditor ? "side-btn active" : "side-btn"}
            data-ui-tooltip={editorButtonTooltip}
            onClick={toggleEditorPane}
          >
            <Code2 size={16} />
          </button>
          <button
            className={showViewer ? "side-btn active" : "side-btn"}
            data-ui-tooltip={viewerButtonTooltip}
            onClick={toggleViewerPane}
          >
            <Box size={16} />
          </button>
        </aside>

        <div className={`workspace-flex${immersiveViewer ? " immersive-workspace-flex" : ""}`}>
          {showImmersiveFilesPane && (
          <aside
            ref={immersiveViewer ? immersiveFilesPaneRef : undefined}
            className={`file-pane panel${immersiveViewer ? " immersive-drawer immersive-drawer-files" : ""}${immersiveViewer && !showFiles ? " immersive-drawer-hidden" : ""}`}
            style={immersiveFilePaneStyle}
          >
            <h3>{t("files")}</h3>
            <div className="file-toolbar">
              <input
                className="file-search-input"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder={t("fileSearchPlaceholder")}
              />
              <div className="file-sort-row">
                <select value={fileSortField} onChange={(e) => setFileSortField(e.target.value as FileSortField)}>
                  <option value="createdAtMs">{t("fileSortByCreated")}</option>
                  <option value="fileName">{t("fileSortByName")}</option>
                  <option value="sizeBytes">{t("fileSortBySize")}</option>
                </select>
                <select value={fileSortOrder} onChange={(e) => setFileSortOrder(e.target.value as SortOrder)}>
                  <option value="desc">{t("sortDesc")}</option>
                  <option value="asc">{t("sortAsc")}</option>
                </select>
              </div>
            </div>
            <div className="file-list">
              {visibleFiles.length > 0 && visibleFiles.map((item) => (
                <button
                  key={item.path}
                  className={item.path === selectedFilePath ? "file-item active" : "file-item"}
                  onClick={() => {
                    void selectAndLoadFile(item.path, false).catch(() => {});
                  }}
                      title={`${item.fileName} | ${formatFileTime(item.createdAtMs, currentLocale)} | ${formatFileSize(item.sizeBytes)}`}
                >
                  <span className="file-item-name">{item.fileName}</span>
                  <span className="file-item-meta">
                      <span className="file-item-created">{formatFileTime(item.createdAtMs, currentLocale)}</span>
                    <span className="file-item-size">{formatFileSize(item.sizeBytes)}</span>
                  </span>
                </button>
              ))}
              {visibleFiles.length === 0 && visibleRecentFiles.length > 0 && (
                <>
                  <div className="empty">{t("recentFiles")}</div>
                  {visibleRecentFiles.map((item) => (
                    <button
                      key={item.path}
                      className={item.path === selectedFilePath ? "file-item active" : "file-item"}
                      onClick={() => {
                        void selectAndLoadFile(item.path, true).catch(() => {
                          setRecentFiles((prev) => prev.filter((it) => it.path !== item.path));
                        });
                      }}
                      title={`${item.fileName} | ${t("lastOpened")}: ${formatFileTime(item.lastOpenedAtMs, currentLocale)}`}
                    >
                      <span className="file-item-name">{item.fileName}</span>
                      <span className="file-item-meta">
                      <span className="file-item-created">{t("lastOpened")}: {formatFileTime(item.lastOpenedAtMs, currentLocale)}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
              {visibleFiles.length === 0 && visibleRecentFiles.length === 0 && (
                <div className="empty">{filesInFolder.length ? t("noSearchResult") : t("noRecentFiles")}</div>
              )}
            </div>
          </aside>
          )}

          {immersiveViewer && showFiles && (
            <div
              className="splitter immersive-splitter"
              style={immersiveFilesSplitterStyle}
              onPointerDown={(e) => startDrag(e, "files", effectiveImmersiveFilesWidth)}
            />
          )}

          {!immersiveViewer && showFiles && (showEditor || showViewer) && (
            <div className="splitter" onPointerDown={(e) => startDrag(e, "files", normalFilesWidth)} />
          )}

          {showImmersiveEditorPane && (
          <section
            ref={(node) => {
              editorPaneRef.current = node;
              if (immersiveViewer) {
                immersiveEditorPaneRef.current = node;
              } else if (immersiveEditorPaneRef.current === node) {
                immersiveEditorPaneRef.current = null;
              }
            }}
            className={`editor-pane panel${immersiveViewer ? " immersive-drawer immersive-drawer-editor" : ""}${immersiveViewer && !showEditor ? " immersive-drawer-hidden" : ""}`}
            style={immersiveEditorPaneStyle}
          >
            <h3 className="panel-title-row">
              <span className="panel-title-text">{t("editor")}</span>
              <span
                className="panel-title-badge"
                title={`${t("fileEncoding")}: ${loadedProgram?.encoding ?? "-"}`}
              >
                {loadedProgram?.encoding ?? "-"}
              </span>
            </h3>
            <div ref={editorHostRef} className="editor-host">
              {!fallbackEditor && NcEditorComponent ? (
                <NcEditorComponent
                  path={activeFile || loadedProgram?.filePath || "fnc://editor/current.nc"}
                  theme={resolvedTheme === "light" ? "nc-light" : (resolvedTheme === "navy" ? "nc-dark" : "nc-x-dark")}
                  value={code}
                  onBeforeMount={registerNcLanguage}
                  onMount={onEditorMount}
                  onUnmount={handleEditorUnmount}
                  onChange={(v) => setCode(v ?? "")}
                />
              ) : !fallbackEditor ? (
                <div className="editor-loading-shell" aria-label="Loading editor" />
              ) : (
                <textarea
                  style={{
                    width: "100%",
                    height: "100%",
                    resize: "none",
                    border: "none",
                    outline: "none",
                    overflowX: "auto",
                    overflowY: "auto",
                    whiteSpace: "pre",
                    background: resolvedTheme === "light" ? "#ffffff" : (resolvedTheme === "navy" ? "#0f172a" : "#16181c"),
                    color: resolvedTheme === "light" ? "#0f172a" : "#e7e9ea",
                    fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                    fontSize: 13,
                    lineHeight: 1.45,
                    padding: 12,
                  }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </div>
          </section>
          )}

          {immersiveViewer && showEditor && (
            <div
              className="splitter immersive-splitter"
              style={immersiveEditorSplitterStyle}
              onPointerDown={(e) => startDrag(e, "editor", effectiveImmersiveEditorWidth)}
            />
          )}

          {!immersiveViewer && showEditor && showViewer && (
            <div className="splitter" onPointerDown={(e) => startDrag(e, "editor", normalEditorWidth)} />
          )}

          {showImmersiveViewerPane && (
          <section className={`viewer-pane panel${immersiveViewer ? " immersive-viewer-pane" : ""}`} style={{ flex: "1 1 auto" }}>
            <h3>{t("viewer")}</h3>
            <div className={`viewer-float-actions${immersiveViewer ? " immersive" : ""}`}>
              <button
                className={`icon-btn viewer-float-btn viewer-float-btn-halo${immersiveViewer ? " active" : ""}`}
                data-ui-tooltip={immersiveViewerTooltip}
                onClick={toggleImmersiveViewerMode}
                aria-label={immersiveViewer ? t("exitImmersiveViewer") : t("enterImmersiveViewer")}
              >
                <span className="viewer-float-btn-icon-shell">
                  {immersiveViewer ? <Shrink size={16} strokeWidth={2.1} /> : <Expand size={16} strokeWidth={2.1} />}
                </span>
              </button>
            </div>
            {Viewer3DComponent ? (
              <Viewer3DComponent
                frames={frames}
                codeLines={codeLines}
                currentFrame={currentFrame}
                hoverFrame={hoverFrame}
                cameraState={cameraState}
                theme={resolvedTheme}
                interactionMode={interactionMode}
                showGrid={showGrid}
                showOrientationGizmo={showOrientationGizmo}
                showRapidPath={showRapidPath}
                showPathTooltip={showPathTooltip}
                refocusNonce={refocusNonce}
                zoomRequestNonce={viewerZoomRequest.nonce}
                zoomRequestScale={viewerZoomRequest.scale}
                onRefocusApplied={handleViewerRefocusApplied}
                onRequestNamedView={handleViewerRequestNamedView}
                onViewerHotkeyScopeChange={setViewerHotkeyScope}
                fitOnResize={false}
                onCameraStateChange={handleViewerCameraStateChange}
                onFrameHover={handleViewerFrameHover}
                onFrameHoverEnd={handleViewerFrameHoverEnd}
                onFramePick={handleViewerFramePick}
              />
            ) : (
              <div className="viewer-loading-shell" aria-label="Loading 3D viewer" />
            )}
            <div className="viewer-meta">
              <div className="viewer-legend" title={legendTooltipText}>
                <span className="legend-item"><b>{t("legendLineNo")}:</b> {currentFrame?.lineNumber ?? "-"}</span>
                <span className="legend-item">
                  <span className="legend-dot cut" />
                  {t("legendLine")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot curve" />
                  {t("legendCurve")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot rapid" />
                  {t("legendRapid")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot plunge" />
                  {t("legendPlunge")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot selected" />
                  {t("legendSelected")}
                </span>
                {ncMode === "laser" && (
                  <span className="legend-item">
                    <span className="legend-dot uvw" />
                    {t("legendUvw")}
                  </span>
                )}
                <span className="legend-item legend-current-code" title={currentNcLineText}>
                  <b>{t("currentCode")}:</b> {currentNcLineText}
                </span>
              </div>
              <div className="viewer-progress">
                <label htmlFor="viewer-progress">{t("progress")}</label>
                <input
                  id="viewer-progress"
                  className="viewer-progress-range"
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  step={0.01}
                  value={Math.max(0, Math.min(frames.length - 1, playProgress))}
                  style={{
                    "--progress-pct": `${frames.length > 1
                      ? (Math.max(0, Math.min(frames.length - 1, playProgress)) / (frames.length - 1)) * 100
                      : 0}%`,
                  } as CSSProperties}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const idx = Math.max(0, Math.min(frames.length - 1, Math.round(raw)));
                    updatePlayProgress(raw, true);
                    setPathNavActive(true);
                    setHoverFrame(null);
                    selectFrameByIndex(idx);
                  }}
                  disabled={frames.length < 2}
                />
                <span>{Math.min(frames.length, (currentFrame?.index ?? 0) + 1)} / {frames.length}</span>
              </div>
            </div>
          </section>
          )}
        </div>
      </main>

      {activeTooltip && (
        <div
          ref={tooltipLayerRef}
          className={`ui-tooltip-layer${tooltipPosition.visible ? " visible" : ""}`}
          style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
        >
          {activeTooltip.text}
        </div>
      )}

      {showShortcutModal && (
        <div className="modal-mask" onClick={() => setShowShortcutModal(false)}>
          <div className="shortcut-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-modal-head">
              <div className="shortcut-modal-title">
                <h4>{t("shortcutMapping")}</h4>
                <p>{t("shortcutMappingDesc")}</p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowShortcutModal(false)} data-ui-tooltip={t("close")} aria-label={t("close")}>
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-modal-body">
              <div className="shortcut-groups">
                {shortcutGroups.map((group) => (
                  <section key={group.id} className="shortcut-card">
                    <div className="shortcut-card-head">
                      <div>
                        <h5>{group.title}</h5>
                        <p>{group.description}</p>
                      </div>
                      <span className="shortcut-card-count">{group.items.length}</span>
                    </div>
                    <div className="shortcut-card-items">
                      {group.items.map((item) => (
                        <div key={item.id} className="shortcut-item">
                          <span className="shortcut-item-label">{item.label}</span>
                          <button
                            type="button"
                            className={`shortcut-chip${recordingShortcutId === item.id ? " recording" : ""}${shortcutConflicts[item.id]?.length ? " conflict" : ""}`}
                            onClick={() => setRecordingShortcutId(item.id)}
                            onKeyDown={(e) => onShortcutRecorderKeyDown(item.id, e)}
                          >
                            {recordingShortcutId === item.id
                              ? t("shortcutRecording")
                              : (displayShortcut(shortcuts[item.id]) || t("shortcutUnset"))}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <div className="shortcut-modal-foot">
              <span className={`shortcut-modal-hint${shortcutConflictMessage ? " conflict" : ""}`}>
                {shortcutConflictMessage || t("shortcutInputHint")}
              </span>
              <button className="menu-btn" onClick={() => setShortcuts(defaultShortcuts)}>{t("resetDefault")}</button>
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && (
        <div className="modal-mask" onClick={() => setShowUpdateModal(null)}>
          <div className="shortcut-modal update-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-modal-head">
              <div className="shortcut-modal-title">
                <h4>{t("updateAvailableTitle")}</h4>
                <p>{showUpdateModal.source === "startup" ? t("updateStartupDesc") : t("updateManualDesc")}</p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowUpdateModal(null)} data-ui-tooltip={t("close")} aria-label={t("close")}>
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-modal-body">
              <div className="shortcut-card update-card">
                <div className="update-version-grid">
                  <div className="update-version-item">
                    <span className="update-version-label">{t("updateCurrentVersion")}</span>
                    <strong>{showUpdateModal.currentVersion}</strong>
                  </div>
                  <div className="update-version-item">
                    <span className="update-version-label">{t("updateLatestVersion")}</span>
                    <strong>{showUpdateModal.latest.version}</strong>
                  </div>
                  <div className="update-version-item">
                    <span className="update-version-label">{t("updateChannel")}</span>
                    <strong>{showUpdateModal.latest.os}</strong>
                  </div>
                  <div className="update-version-item">
                    <span className="update-version-label">{t("appVersion")}</span>
                    <strong>{appVersion}</strong>
                  </div>
                </div>
                <div className="update-callout">
                  <strong>{t("updateInAppTitle")}</strong>
                  <span>{t("updateActionHint")}</span>
                </div>
              </div>
            </div>
            <div className="shortcut-modal-foot">
              <span className="shortcut-modal-hint">{t("updatePromptHint")}</span>
              <div className="update-modal-actions">
                <button className="menu-btn" onClick={() => setShowUpdateModal(null)}>{t("updateLater")}</button>
                <button className="menu-btn primary" onClick={() => void startUpdateDownload(showUpdateModal)}>
                  {t("updateNow")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAboutModal && (
        <div className="modal-mask" onClick={() => setShowAboutModal(false)}>
          <div className="shortcut-modal update-modal about-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-modal-head about-modal-head">
              <div className="shortcut-modal-title">
                <h4>{t("aboutTitle")}</h4>
              </div>
              <button className="modal-close-btn" onClick={() => setShowAboutModal(false)} data-ui-tooltip={t("close")} aria-label={t("close")}>
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-modal-body">
              <div className="shortcut-card about-card">
                <div className="about-brand-mark" aria-hidden="true">
                  <img
                    alt=""
                    className="about-brand-logo"
                    src={resolvedTheme === "light" ? "/logo-first-nc.png" : "/logo-first-nc-dark.png"}
                  />
                </div>
                <div className="about-version-copy">
                  <span className="update-version-label">{t("appVersion")}</span>
                  <strong className="about-version-value">{appVersion}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {updateOverlayVisible && updateOverlayPhase !== "idle" && (
        <div className="update-splash-mask">
          <div className="update-splash-shell">
            <div className="update-splash-brand">{t("appTitle")}</div>
            <div className="update-splash-card">
              <span className={`update-splash-tone ${updateStatusTone}`}>{t("updateOverlayTitle")}</span>
              <h3>{updateOverlayPhase === "ready" ? t("updateOverlayReadyTitle") : updateOverlayPhase === "failed" ? t("updateOverlayFailedTitle") : t("updateOverlayDownloadingTitle")}</h3>
              <p>
                {updateOverlayPhase === "ready"
                  ? t("updateOverlayReadyDesc")
                  : updateOverlayPhase === "failed"
                    ? (updateDownloadInfo.error || t("updateDownloadFailed"))
                    : t("updateOverlayDownloadingDesc")}
              </p>
              <div className="update-splash-version">
                <span>{appVersion}</span>
                <span className="update-splash-arrow">→</span>
                <strong>{preparedUpdate?.version || updateDownloadInfo.version || updateCandidate?.latest.version || "-"}</strong>
              </div>
              <div className="update-splash-progress-card">
                <div className="update-splash-progress-head">
                  <span>{t("updateProgressLabel")}</span>
                  <strong>{updateDownloadInfo.percent == null ? "--" : `${Math.round(updateDownloadInfo.percent)}%`}</strong>
                </div>
                <div className="update-splash-progress-track" aria-hidden="true">
                  <div className="update-splash-progress-fill" style={{ width: `${Math.max(4, Math.min(100, updateDownloadInfo.percent ?? 4))}%` }} />
                </div>
                <div className="update-splash-progress-meta">
                  <span>{updateDownloadLabel}</span>
                  <span>{preparedUpdate?.fileName || updateDownloadInfo.fileName}</span>
                </div>
              </div>
              <div className="update-splash-actions">
                {updateOverlayPhase === "failed" && (
                  <button className="menu-btn" onClick={() => setUpdateOverlayVisible(false)}>{t("updateLater")}</button>
                )}
                {updateOverlayPhase === "failed" && updateCandidate && (
                  <button className="menu-btn primary" onClick={() => void startUpdateDownload(updateCandidate)}>
                    {t("retry")}
                  </button>
                )}
                {updateOverlayPhase === "ready" && !updateInstalling && (
                  <button className="menu-btn primary" onClick={() => void handleLaunchPreparedUpdate()} disabled={updateInstalling}>
                    {updateInstalling ? t("updateInstalling") : t("updateRestartNow")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="status-bar">
        <span className="status-bar-primary" title={status}>{status}</span>
        <span className="status-bar-file" title={activeFile ? basename(activeFile) : "-"}>{activeFile ? basename(activeFile) : "-"}</span>
        <span className="status-bar-meta">
          {statusBarUpdateLabel && (
            <button
              type="button"
              className={`status-bar-update-pill ${updateStatusTone}`}
              onClick={() => {
                if (updateOverlayPhase === "idle" && updateCandidate) {
                  setShowUpdateModal(updateCandidate);
                  return;
                }
                setUpdateOverlayVisible(true);
              }}
            >
              <span>{statusBarUpdateLabel}</span>
              {updateOverlayPhase === "downloading" && <strong>{updateDownloadInfo.percent == null ? "--" : `${Math.round(updateDownloadInfo.percent)}%`}</strong>}
            </button>
          )}
          <span className="status-bar-points" title={`${frames.length} ${t("pathPointsUnit")}`}>
            {`${frames.length} ${t("pathPointsUnit")}`}
          </span>
        </span>
      </footer>
    </div>
  );
}

export default App;
