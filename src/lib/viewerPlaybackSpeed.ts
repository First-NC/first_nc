import type { FrameState } from "../types";

export type PlaybackSpeedMode = "Low" | "Standard" | "High";

export const playbackUnitsPerSecond: Record<PlaybackSpeedMode, number> = {
  Low: 500,
  Standard: 1000,
  High: 3000,
};

export function buildPlaybackDistanceMap(frames: FrameState[]): number[] {
  if (!frames.length) return [];
  const distances = new Array<number>(frames.length).fill(0);
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1].position;
    const cur = frames[i].position;
    const segmentLength = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    distances[i] = distances[i - 1] + (Number.isFinite(segmentLength) ? segmentLength : 0);
  }
  return distances;
}

export function resolvePlaybackDistance(progress: number, distances: number[]): number {
  if (!distances.length) return 0;
  const maxIndex = distances.length - 1;
  const safeProgress = Math.max(0, Math.min(maxIndex, progress));
  const lower = Math.floor(safeProgress);
  const upper = Math.min(maxIndex, lower + 1);
  const ratio = safeProgress - lower;
  return distances[lower] + (distances[upper] - distances[lower]) * ratio;
}

export function resolvePlaybackProgress(distance: number, distances: number[]): number {
  if (!distances.length) return 0;
  const maxIndex = distances.length - 1;
  const total = distances[maxIndex];
  if (total <= 1e-8) return Math.max(0, Math.min(maxIndex, distance));
  const safeDistance = Math.max(0, Math.min(total, distance));
  let lo = 0;
  let hi = maxIndex;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (distances[mid] < safeDistance) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return 0;
  const prevDistance = distances[lo - 1];
  const nextDistance = distances[lo];
  const span = nextDistance - prevDistance;
  if (span <= 1e-8) return lo;
  return (lo - 1) + (safeDistance - prevDistance) / span;
}

export function advancePlaybackProgress(
  currentProgress: number,
  deltaMs: number,
  unitsPerSecond: number,
  distances: number[],
): number {
  if (!distances.length) return 0;
  const totalDistance = distances[distances.length - 1];
  if (totalDistance <= 1e-8) {
    return Math.min(distances.length - 1, currentProgress + (deltaMs * unitsPerSecond) / 1000);
  }
  const currentDistance = resolvePlaybackDistance(currentProgress, distances);
  return resolvePlaybackProgress(currentDistance + (deltaMs * unitsPerSecond) / 1000, distances);
}

export function resolvePlaybackFrame(progress: number, frames: FrameState[]): FrameState | null {
  if (!frames.length) return null;
  const maxIndex = frames.length - 1;
  const safeProgress = Math.max(0, Math.min(maxIndex, progress));
  const lowerIndex = Math.floor(safeProgress);
  const upperIndex = Math.min(maxIndex, lowerIndex + 1);
  const lower = frames[lowerIndex];
  const upper = frames[upperIndex];
  if (!lower || !upper || lowerIndex === upperIndex) return lower ?? upper ?? null;

  const ratio = safeProgress - lowerIndex;
  return {
    ...upper,
    index: safeProgress,
    lineNumber: ratio > 0 ? upper.lineNumber : lower.lineNumber,
    position: {
      x: lower.position.x + (upper.position.x - lower.position.x) * ratio,
      y: lower.position.y + (upper.position.y - lower.position.y) * ratio,
      z: lower.position.z + (upper.position.z - lower.position.z) * ratio,
    },
    motion: upper.motion ?? lower.motion,
    axisDomain: upper.axisDomain ?? lower.axisDomain,
  };
}
