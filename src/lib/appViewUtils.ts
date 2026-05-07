import type { CameraState, FrameState, Vec3 } from "../types";

const VIEWER_VERTICAL_FOV = (55 * Math.PI) / 180;
const VIEWER_ASSUMED_MIN_ASPECT = 0.55;
const VIEWER_MIN_DISTANCE = 120;
const VIEWER_FIT_MARGIN = 1.16;

export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatFileTime(createdAtMs: number, locale: string): string {
  if (!createdAtMs || Number.isNaN(createdAtMs)) return "-";
  return new Date(createdAtMs).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function cameraForView(frames: FrameState[], viewName: string): CameraState {
  const center = centerOf(frames);
  const distance = fitDistanceForView(frames, viewName);
  const presets: Record<string, Vec3> = {
    Top: { x: center.x, y: center.y, z: center.z + distance },
    Bottom: { x: center.x, y: center.y, z: center.z - distance },
    Front: { x: center.x, y: center.y + distance, z: center.z },
    Left: { x: center.x + distance, y: center.y, z: center.z },
    Right: { x: center.x - distance, y: center.y, z: center.z },
  };

  return {
    target: center,
    position: presets[viewName] ?? presets.Top,
    zoom: 1,
    viewName,
  };
}

function centerOf(frames: FrameState[]): Vec3 {
  const bounds = boundsOf(frames);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function framesForCenter(frames: FrameState[]): FrameState[] {
  if (frames.length < 2) return frames;

  const firstCut = frames.findIndex((frame, index) => index > 0 && frame.motion && frame.motion !== "Rapid");
  let baseFrames = firstCut > 0 ? frames.slice(Math.max(0, firstCut - 1)) : frames;
  if (baseFrames.length < 2) {
    baseFrames = frames;
  }

  const firstPosition = baseFrames[0]?.position;
  if (!firstPosition) {
    return baseFrames;
  }

  const startsNearOrigin = Math.hypot(firstPosition.x, firstPosition.y, firstPosition.z) < 1e-6;
  if (!startsNearOrigin || baseFrames.length <= 2) {
    return baseFrames;
  }

  const framesWithoutFirst = baseFrames.slice(1);
  const hasFarPoint = framesWithoutFirst.some(
    (frame) => Math.hypot(frame.position.x, frame.position.y, frame.position.z) > 1,
  );
  return hasFarPoint ? framesWithoutFirst : baseFrames;
}

function boundsOf(frames: FrameState[]) {
  const targetFrames = framesForCenter(frames);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const frame of targetFrames) {
    minX = Math.min(minX, frame.position.x);
    minY = Math.min(minY, frame.position.y);
    minZ = Math.min(minZ, frame.position.z);
    maxX = Math.max(maxX, frame.position.x);
    maxY = Math.max(maxY, frame.position.y);
    maxZ = Math.max(maxZ, frame.position.z);
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function fitDistanceForView(frames: FrameState[], viewName: string): number {
  const bounds = boundsOf(frames);
  const sizeX = Math.max(1, bounds.maxX - bounds.minX);
  const sizeY = Math.max(1, bounds.maxY - bounds.minY);
  const sizeZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const radius = Math.max(1, Math.hypot(sizeX, sizeY, sizeZ) * 0.5);
  const horizontalFov = 2 * Math.atan(Math.tan(VIEWER_VERTICAL_FOV / 2) * VIEWER_ASSUMED_MIN_ASPECT);
  const minHalfFov = Math.max(0.08, Math.min(VIEWER_VERTICAL_FOV / 2, horizontalFov / 2));
  const sphereDistance = radius / Math.sin(minHalfFov);
  const invTanV = 1 / Math.tan(VIEWER_VERTICAL_FOV / 2);
  const invTanH = 1 / Math.tan(horizontalFov / 2);
  const fitPlane = (width: number, height: number) =>
    Math.max(width * 0.5 * invTanH, height * 0.5 * invTanV) * VIEWER_FIT_MARGIN;

  if (viewName === "Top" || viewName === "Bottom") {
    return Math.max(VIEWER_MIN_DISTANCE, fitPlane(sizeX, sizeY));
  }
  if (viewName === "Front") {
    return Math.max(VIEWER_MIN_DISTANCE, fitPlane(sizeX, sizeZ));
  }
  if (viewName === "Left" || viewName === "Right") {
    return Math.max(VIEWER_MIN_DISTANCE, fitPlane(sizeY, sizeZ));
  }
  return Math.max(VIEWER_MIN_DISTANCE, Math.max(radius * invTanV * VIEWER_FIT_MARGIN, sphereDistance * 1.15));
}
