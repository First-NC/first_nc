import { getShortcutGroups } from "./shortcutGroups";
import type { ShortcutId } from "./shortcuts";
import type { NcFileItem } from "../types";

type Translate = (key: string) => string;

export type RecentFileLike = {
  path: string;
  fileName: string;
  lastOpenedAtMs: number;
};

export type FileSortField = "createdAtMs" | "fileName" | "sizeBytes";
export type SortOrder = "asc" | "desc";

export function buildShortcutItems(t: Translate): Array<{ id: ShortcutId; label: string }> {
  return [
    { id: "openShortcuts", label: t("openShortcuts") },
    { id: "openNc", label: t("shortcutOpenNc") },
    { id: "saveFile", label: t("shortcutSaveFile") },
    { id: "saveFileAs", label: t("shortcutSaveFileAs") },
    { id: "toggleFiles", label: t("toggleFiles") },
    { id: "toggleEditor", label: t("toggleEditor") },
    { id: "toggleViewer", label: t("toggleViewer") },
    { id: "toggleImmersiveViewer", label: t("toggleImmersiveViewer") },
    { id: "refocus", label: t("refocus") },
    { id: "viewTop", label: t("shortcutViewTop") },
    { id: "viewFront", label: t("shortcutViewFront") },
    { id: "viewLeft", label: t("shortcutViewLeft") },
    { id: "viewRight", label: t("shortcutViewRight") },
    { id: "viewBottom", label: t("shortcutViewBottom") },
    { id: "panMode", label: t("panMode") },
    { id: "rotateMode", label: t("rotateMode") },
    { id: "zoomIn", label: t("zoomIn") },
    { id: "zoomOut", label: t("zoomOut") },
    { id: "toggleGrid", label: t("toggleGrid") },
    { id: "toggleGizmo", label: t("toggleGizmo") },
    { id: "toggleRapidPath", label: t("hideRapidPath") },
    { id: "togglePathTooltip", label: t("shortcutToggleLegend") },
    { id: "pathPrev", label: t("stepPrev") },
    { id: "pathNext", label: t("stepNext") },
  ];
}

export function buildShortcutItemMap(
  items: Array<{ id: ShortcutId; label: string }>,
): Record<ShortcutId, string> {
  const itemMap = {} as Record<ShortcutId, string>;
  for (const item of items) {
    itemMap[item.id] = item.label;
  }
  return itemMap;
}

export function buildShortcutGroups(
  itemMap: Record<ShortcutId, string>,
  t: Translate,
) {
  const descriptions = {
    file: t("shortcutGroupFileDesc"),
    panels: t("shortcutGroupPanelsDesc"),
    viewer: t("shortcutGroupViewerDesc"),
    path: t("shortcutGroupPathDesc"),
  } as const;
  const titles = {
    file: t("shortcutGroupFile"),
    panels: t("shortcutGroupPanels"),
    viewer: t("shortcutGroupViewer"),
    path: t("shortcutGroupPath"),
  } as const;

  return getShortcutGroups().map((group) => ({
    ...group,
    title: titles[group.id],
    description: descriptions[group.id],
    items: group.itemIds.map((id) => ({
      id,
      label: itemMap[id],
    })),
  }));
}

export function buildVisibleFiles({
  currentLocale,
  fileSearch,
  filesInFolder,
  fileSortField,
  fileSortOrder,
}: {
  currentLocale: string;
  fileSearch: string;
  filesInFolder: NcFileItem[];
  fileSortField: FileSortField;
  fileSortOrder: SortOrder;
}): NcFileItem[] {
  const keyword = fileSearch.trim().toLowerCase();
  const filteredFiles = keyword
    ? filesInFolder.filter((item) => item.fileName.toLowerCase().includes(keyword))
    : filesInFolder.slice();

  return filteredFiles.sort((left, right) => {
    const byNameAsc = left.fileName.localeCompare(right.fileName, currentLocale, { numeric: true });
    let result = 0;

    if (fileSortField === "fileName") {
      result = byNameAsc;
    } else if (fileSortField === "createdAtMs") {
      result = left.createdAtMs - right.createdAtMs;
    } else {
      result = left.sizeBytes - right.sizeBytes;
    }

    if (result === 0) {
      result = byNameAsc;
    }

    if (fileSortField === "createdAtMs") {
      return fileSortOrder === "asc"
        ? result
        : (left.createdAtMs === right.createdAtMs ? result : -result);
    }

    return fileSortOrder === "asc" ? result : -result;
  });
}

export function buildVisibleRecentFiles({
  fileSearch,
  recentFiles,
}: {
  fileSearch: string;
  recentFiles: RecentFileLike[];
}): RecentFileLike[] {
  const keyword = fileSearch.trim().toLowerCase();
  const filteredFiles = keyword
    ? recentFiles.filter((item) => item.fileName.toLowerCase().includes(keyword))
    : recentFiles.slice();

  return filteredFiles
    .sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs)
    .slice(0, 10);
}
