import type { FrameState, Vec3 } from "../types";
import type { SegmentRecord } from "./viewerSegments";

export function resolveViewerFocusSegment(
  frames: FrameState[],
  markerFrame: FrameState | null,
  pickedSegment: SegmentRecord | null,
): Vec3[] | null {
  if (!markerFrame || frames.length < 2) return null;

  const markerIdx = typeof markerFrame.index === "number"
    ? Math.max(0, Math.min(frames.length - 1, markerFrame.index))
    : Math.max(0, frames.findIndex((f) => f.lineNumber === markerFrame.lineNumber));

  const makeSeg = (aIdx: number, bIdx: number) => {
    if (aIdx < 0 || bIdx < 0 || aIdx >= frames.length || bIdx >= frames.length) return null;
    const a = frames[aIdx].position;
    const b = frames[bIdx].position;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 1e-8) return null;
    return [a, b];
  };

  const line = markerFrame.lineNumber;
  const sameLineIndices: number[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].lineNumber === line) sameLineIndices.push(i);
  }
  if (sameLineIndices.length > 0) {
    const startIndex = Math.max(0, sameLineIndices[0] - 1);
    const points: Vec3[] = [frames[startIndex].position];
    for (const index of sameLineIndices) {
      const previous = points[points.length - 1];
      const current = frames[index].position;
      const len = Math.hypot(
        current.x - previous.x,
        current.y - previous.y,
        current.z - previous.z,
      );
      if (len >= 1e-8) {
        points.push(current);
      }
    }
    if (points.length > 1) return points;
  }

  const exact = markerIdx > 0 ? makeSeg(markerIdx - 1, markerIdx) : makeSeg(0, 1);
  if (exact) return exact;

  for (let d = 1; d < Math.min(60, frames.length); d += 1) {
    const left = markerIdx - d;
    const right = markerIdx + d;
    const leftSeg = left > 0 ? makeSeg(left - 1, left) : null;
    if (leftSeg) return leftSeg;
    const rightSeg = right < frames.length ? makeSeg(Math.max(0, right - 1), right) : null;
    if (rightSeg) return rightSeg;
  }

  const fallbackLine = pickedSegment?.endFrame.lineNumber ?? markerFrame.lineNumber;
  const all: Vec3[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].lineNumber !== fallbackLine) continue;
    const seg = makeSeg(i - 1, i);
    if (!seg) continue;
    all.push(seg[0], seg[1]);
  }
  return all.length > 1 ? all : null;
}

export function resolveViewerFocusPointBuffer(
  frames: FrameState[],
  markerFrame: FrameState | null,
  pickedSegment: SegmentRecord | null,
): number[] | null {
  const points = resolveViewerFocusSegment(frames, markerFrame, pickedSegment);
  if (!points || points.length < 2) return null;
  const out = new Array<number>(points.length * 3);
  let offset = 0;
  for (const point of points) {
    out[offset++] = point.x;
    out[offset++] = point.y;
    out[offset++] = point.z;
  }
  return out;
}
