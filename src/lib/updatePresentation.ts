import type { UpdateVersionInfo } from "./updateClient";

export type UpdateOverlayPhase = "idle" | "downloading" | "ready" | "failed";
export type UpdateStatusTone = "muted" | "active" | "success" | "danger";

export type UpdateDownloadSnapshot = {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function inferInstallerExtension(os: UpdateVersionInfo["os"]): string {
  switch (os) {
    case "windows":
      return "exe";
    case "ubuntu":
      return "deb";
    default:
      return "dmg";
  }
}

export function deriveUpdateFileName(url: string, version: string, os: UpdateVersionInfo["os"]): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (/\.(msi|exe|deb|dmg|app)$/i.test(name)) {
      return decodeURIComponent(name);
    }
  } catch {
  }

  return `first-nc-${version}.${inferInstallerExtension(os)}`;
}

export function buildUpdateDownloadLabel(snapshot: UpdateDownloadSnapshot): string {
  const downloaded = formatBytes(Math.max(0, snapshot.downloadedBytes));
  if (!snapshot.totalBytes || snapshot.totalBytes <= 0) {
    return downloaded;
  }

  const total = formatBytes(snapshot.totalBytes);
  const percent = snapshot.percent == null ? null : Math.max(0, Math.min(100, Math.round(snapshot.percent)));
  if (percent == null) {
    return `${downloaded} / ${total}`;
  }
  return `${downloaded} / ${total} (${percent}%)`;
}

export function resolveUpdateStatusTone(phase: UpdateOverlayPhase): UpdateStatusTone {
  switch (phase) {
    case "downloading":
      return "active";
    case "ready":
      return "success";
    case "failed":
      return "danger";
    default:
      return "muted";
  }
}
