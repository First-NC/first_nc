import test from "node:test";
import assert from "node:assert/strict";
import { buildLinePointGroups } from "./viewerLinePoints.ts";
import type { SegmentRecord } from "./viewerSegments.ts";
import type { FrameState } from "../types";

function makeFrame(index: number, lineNumber: number): FrameState {
  return {
    index,
    lineNumber,
    position: { x: index, y: 0, z: 0 },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

function makeSegment(
  sourceIndex: number,
  start: [number, number, number],
  end: [number, number, number],
): SegmentRecord {
  return {
    start: { x: start[0], y: start[1], z: start[2] },
    end: { x: end[0], y: end[1], z: end[2] },
    endFrame: makeFrame(sourceIndex + 1, sourceIndex + 1),
    sourceIndex,
    lane: "cut",
  };
}

test("buildLinePointGroups stitches connected segments into one continuous polyline", () => {
  const segments = [
    makeSegment(0, [0, 0, 0], [1, 1, 1]),
    makeSegment(1, [1, 1, 1], [2, 2, 2]),
  ];

  assert.deepEqual(buildLinePointGroups(segments), [[
    0, 0, 0,
    1, 1, 1,
    2, 2, 2,
  ]]);
});

test("buildLinePointGroups splits disconnected segments into separate polylines", () => {
  const segments = [
    makeSegment(0, [0, 0, 0], [1, 0, 0]),
    makeSegment(1, [3, 0, 0], [4, 0, 0]),
  ];

  assert.deepEqual(buildLinePointGroups(segments), [
    [0, 0, 0, 1, 0, 0],
    [3, 0, 0, 4, 0, 0],
  ]);
});

test("buildLinePointGroups downsamples connected paths without splitting the polyline", () => {
  const segments = [
    makeSegment(0, [0, 0, 0], [1, 0, 0]),
    makeSegment(1, [1, 0, 0], [2, 0, 0]),
    makeSegment(2, [2, 0, 0], [3, 0, 0]),
    makeSegment(3, [3, 0, 0], [4, 0, 0]),
    makeSegment(4, [4, 0, 0], [5, 0, 0]),
  ];

  assert.deepEqual(buildLinePointGroups(segments, 2), [[
    0, 0, 0,
    3, 0, 0,
    5, 0, 0,
  ]]);
});
