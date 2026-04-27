import type { FrameState, Vec3 } from "../types";
import { buildLinePointGroups } from "./viewerLinePoints.ts";
import { buildViewerSegmentData, type SegmentRecord, type ViewerSegmentData } from "./viewerSegments.ts";

export type ViewerSceneData = {
  segmentData: ViewerSegmentData;
  sceneScale: number;
  geometryCenter: Vec3;
};

export type ViewerPickCollections = {
  pickCutSegments: SegmentRecord[];
  pickRapidSegments: SegmentRecord[];
};

export type ViewerRenderBuffers = {
  cutPoints: number[][];
  uvwPoints: number[][];
  plungePoints: number[][];
  rapidPoints: number[][];
};

function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v);
}

function resolveCenterStartIndex(frames: FrameState[]): number {
  if (frames.length < 2) return 0;
  const firstCut = frames.findIndex((f, i) => i > 0 && f.motion && f.motion !== "Rapid");
  let startIndex = firstCut > 0 ? Math.max(0, firstCut - 1) : 0;
  if (frames.length - startIndex < 2) startIndex = 0;

  const p0 = frames[startIndex]?.position;
  if (p0) {
    const nearOrigin = Math.hypot(p0.x, p0.y, p0.z) < 1e-6;
    if (nearOrigin && frames.length - startIndex > 2) {
      let hasFarPoint = false;
      for (let i = startIndex + 1; i < frames.length; i += 1) {
        const { x, y, z } = frames[i].position;
        if (Math.hypot(x, y, z) > 1) {
          hasFarPoint = true;
          break;
        }
      }
      if (hasFarPoint) {
        startIndex += 1;
      }
    }
  }
  return startIndex;
}

export function sampleViewerSegments(segments: SegmentRecord[], maxCount: number): SegmentRecord[] {
  if (segments.length <= maxCount) return segments;
  const stride = Math.ceil(segments.length / maxCount);
  const out: SegmentRecord[] = [];
  for (let i = 0; i < segments.length; i += stride) out.push(segments[i]);
  const last = segments[segments.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function buildViewerSceneData(frames: FrameState[], codeLines: string[]): ViewerSceneData {
  const segmentData = buildViewerSegmentData(frames, codeLines);
  const centerStartIndex = resolveCenterStartIndex(frames);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = centerStartIndex; i < frames.length; i += 1) {
    const f = frames[i];
    const { x, y, z } = f.position;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (
    !isFiniteNumber(minX) || !isFiniteNumber(minY) || !isFiniteNumber(minZ)
    || !isFiniteNumber(maxX) || !isFiniteNumber(maxY) || !isFiniteNumber(maxZ)
  ) {
    return {
      segmentData,
      sceneScale: 100,
      geometryCenter: { x: 0, y: 0, z: 0 },
    };
  }

  return {
    segmentData,
    sceneScale: Math.max(80, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)),
    geometryCenter: {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      z: (minZ + maxZ) * 0.5,
    },
  };
}

export function buildViewerPickCollections(
  segmentData: ViewerSegmentData,
  scaledCount: (base: number, floor?: number) => number,
): ViewerPickCollections {
  const pickCutSegments = sampleViewerSegments(segmentData.cutSegments, scaledCount(9000, 1800));
  const pickRapidSegments = sampleViewerSegments(segmentData.rapidSegments, scaledCount(4500, 900));
  return {
    pickCutSegments,
    pickRapidSegments,
  };
}

export function buildViewerRenderBuffers(
  segmentData: ViewerSegmentData,
  scaledCount: (base: number, floor?: number) => number,
): ViewerRenderBuffers {
  return {
    cutPoints: buildLinePointGroups(segmentData.cutRenderSegments),
    plungePoints: buildLinePointGroups(segmentData.plungeRenderSegments),
    uvwPoints: buildLinePointGroups(
      segmentData.uvwRenderSegments,
      scaledCount(22000, 2800),
    ),
    rapidPoints: buildLinePointGroups(
      segmentData.rapidRenderSegments,
      scaledCount(18000, 2400),
    ),
  };
}
