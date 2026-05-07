import test from "node:test";
import assert from "node:assert/strict";

import type { FrameState } from "../types";
import type { SegmentRecord } from "./viewerSegments.ts";
import {
  resolveActivePickedSegment,
  resolveHoverLineText,
  resolveViewerAdaptiveFactor,
  resolveViewerCanvasDpr,
  shouldKeepPickedSegment,
} from "./viewerInteractionState.ts";

function makeFrame(index: number, lineNumber: number, motion: FrameState["motion"] = "Linear"): FrameState {
  return {
    index,
    lineNumber,
    position: { x: index, y: lineNumber, z: 0 },
    motion,
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

function makeSegment(lineNumber: number, index: number): SegmentRecord {
  return {
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1, y: 1, z: 0 },
    endFrame: makeFrame(index, lineNumber),
    sourceIndex: index,
    lane: "cut",
  };
}

test("resolveViewerAdaptiveFactor and resolveViewerCanvasDpr downgrade quality for large frame sets", () => {
  assert.equal(resolveViewerAdaptiveFactor(10_000), 1);
  assert.equal(resolveViewerAdaptiveFactor(30_000), 0.62);
  assert.equal(resolveViewerAdaptiveFactor(70_000), 0.42);
  assert.equal(resolveViewerAdaptiveFactor(130_000), 0.28);

  assert.deepEqual(resolveViewerCanvasDpr(1), [0.85, 1.25]);
  assert.deepEqual(resolveViewerCanvasDpr(0.62), [0.7, 1]);
  assert.deepEqual(resolveViewerCanvasDpr(0.28), [0.55, 0.9]);
});

test("resolveHoverLineText reads the matching source line and falls back safely", () => {
  const lines = ["G0 X0 Y0", "G1 X10 Y10", "M30"];

  assert.equal(resolveHoverLineText(lines, makeSegment(2, 1)), "G1 X10 Y10");
  assert.equal(resolveHoverLineText(lines, makeSegment(99, 1)), "");
  assert.equal(resolveHoverLineText(lines, null), "");
});

test("shouldKeepPickedSegment only keeps the picked segment while current frame still matches it", () => {
  const picked = makeSegment(5, 8);

  assert.equal(shouldKeepPickedSegment(picked, makeFrame(8, 5)), true);
  assert.equal(shouldKeepPickedSegment(picked, makeFrame(7, 5)), false);
  assert.equal(shouldKeepPickedSegment(picked, makeFrame(8, 4)), false);
  assert.equal(shouldKeepPickedSegment(picked, null), false);
  assert.equal(shouldKeepPickedSegment(null, makeFrame(8, 5)), false);
});

test("resolveActivePickedSegment hides stale or out-of-sync selections without mutating source state", () => {
  const picked = makeSegment(5, 8);
  const frames = Array.from({ length: 9 }, (_, index) =>
    index === 8 ? makeFrame(8, 5) : makeFrame(index, index + 1),
  );

  assert.equal(resolveActivePickedSegment(picked, frames, makeFrame(8, 5)), picked);
  assert.equal(resolveActivePickedSegment(picked, frames, makeFrame(9, 5)), null);
  assert.equal(resolveActivePickedSegment(picked, [], makeFrame(8, 5)), null);
  assert.equal(resolveActivePickedSegment(null, frames, makeFrame(8, 5)), null);
});
