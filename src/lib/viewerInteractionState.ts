import type { FrameState } from "../types";
import { isSegmentRecordStale } from "./viewerPlaybackState.ts";
import type { SegmentRecord } from "./viewerSegments.ts";

export function resolveViewerAdaptiveFactor(frameCount: number): number {
  if (frameCount > 120_000) return 0.28;
  if (frameCount > 60_000) return 0.42;
  if (frameCount > 20_000) return 0.62;
  return 1;
}

export function resolveViewerCanvasDpr(adaptiveFactor: number): [number, number] {
  if (adaptiveFactor <= 0.42) return [0.55, 0.9];
  if (adaptiveFactor < 1) return [0.7, 1];
  return [0.85, 1.25];
}

export function resolveHoverLineText(
  codeLines: string[],
  segment: SegmentRecord | null,
): string {
  if (!segment) return "";
  return codeLines[Math.max(0, (segment.endFrame.lineNumber ?? 1) - 1)] ?? "";
}

export function shouldKeepPickedSegment(
  pickedSegment: SegmentRecord | null,
  currentFrame: FrameState | null | undefined,
): boolean {
  if (!pickedSegment || !currentFrame) return false;
  return (
    pickedSegment.endFrame.index === currentFrame.index
    && pickedSegment.endFrame.lineNumber === currentFrame.lineNumber
  );
}

export function resolveActivePickedSegment(
  pickedSegment: SegmentRecord | null,
  frames: FrameState[],
  currentFrame: FrameState | null | undefined,
): SegmentRecord | null {
  if (!pickedSegment) return null;
  if (isSegmentRecordStale(pickedSegment, frames)) return null;
  if (currentFrame && !shouldKeepPickedSegment(pickedSegment, currentFrame)) return null;
  return pickedSegment;
}
