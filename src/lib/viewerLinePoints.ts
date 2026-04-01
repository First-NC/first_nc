import type { SegmentRecord } from "./viewerSegments";

function samePoint(a: SegmentRecord["start"], b: SegmentRecord["end"] | SegmentRecord["start"]): boolean {
  return Math.abs(a.x - b.x) <= 1e-6
    && Math.abs(a.y - b.y) <= 1e-6
    && Math.abs(a.z - b.z) <= 1e-6;
}

function downsampleGroup(points: number[], stride: number): number[] {
  if (stride <= 1 || points.length <= 6) return points;

  const sampled = points.slice(0, 3);
  const pointCount = points.length / 3;

  for (let pointIndex = stride; pointIndex < pointCount - 1; pointIndex += stride) {
    const offset = pointIndex * 3;
    sampled.push(points[offset], points[offset + 1], points[offset + 2]);
  }

  const lastOffset = points.length - 3;
  if (
    sampled[sampled.length - 3] !== points[lastOffset]
    || sampled[sampled.length - 2] !== points[lastOffset + 1]
    || sampled[sampled.length - 1] !== points[lastOffset + 2]
  ) {
    sampled.push(points[lastOffset], points[lastOffset + 1], points[lastOffset + 2]);
  }

  return sampled;
}

export function buildLinePointGroups(segments: SegmentRecord[], maxCount?: number): number[][] {
  if (!segments.length) return [];

  const groups: number[][] = [];
  let current: number[] | null = null;
  let previousEnd: SegmentRecord["end"] | null = null;

  for (const segment of segments) {
    const startsNewGroup = !current || !previousEnd || !samePoint(segment.start, previousEnd);
    if (startsNewGroup) {
      current = [
        segment.start.x,
        segment.start.y,
        segment.start.z,
        segment.end.x,
        segment.end.y,
        segment.end.z,
      ];
      groups.push(current);
    } else {
      current!.push(segment.end.x, segment.end.y, segment.end.z);
    }
    previousEnd = segment.end;
  }

  if (!maxCount) return groups;

  const totalSegments = groups.reduce((sum, group) => sum + Math.max(0, group.length / 3 - 1), 0);
  if (totalSegments <= maxCount) return groups;

  const stride = Math.ceil(totalSegments / maxCount);
  return groups.map((group) => downsampleGroup(group, stride));
}

export function asDreiLinePoints(points: number[]): readonly number[] {
  return points;
}
