import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import { resolveViewerFocusPointBuffer, resolveViewerFocusSegment } from "./viewerFocusSegment.ts";
import type { SegmentRecord } from "./viewerSegments.ts";

function makeFrame(index: number, lineNumber: number, x: number, y = 0, z = 0): FrameState {
  return {
    index,
    lineNumber,
    position: { x, y, z },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

test("resolveViewerFocusSegment expands a picked arc frame to the full highlighted path for that NC line", () => {
  const frames = [
    makeFrame(0, 1, 0, 0, 0),
    makeFrame(1, 2, 10, 0, 0),
    makeFrame(2, 2, 20, 5, 0),
    makeFrame(3, 2, 30, 10, 0),
    makeFrame(4, 3, 40, 10, 0),
  ];
  const picked: SegmentRecord = {
    start: frames[1].position,
    end: frames[2].position,
    endFrame: frames[2],
    sourceIndex: 1,
    lane: "cut",
  };

  assert.deepEqual(resolveViewerFocusSegment(frames, frames[2], picked), [
    frames[0].position,
    frames[1].position,
    frames[2].position,
    frames[3].position,
  ]);
});

test("resolveViewerFocusSegment falls back to the nearest visible segment when target is degenerate", () => {
  const frames = [
    makeFrame(0, 1, 0, 0, 0),
    makeFrame(1, 2, 0, 0, 0),
    makeFrame(2, 3, 5, 0, 0),
    makeFrame(3, 4, 9, 0, 0),
  ];

  assert.deepEqual(resolveViewerFocusSegment(frames, frames[1], null), [
    frames[1].position,
    frames[2].position,
  ]);
});

test("resolveViewerFocusSegment follows the interpolated machining playhead during playback", () => {
  const frames = [
    makeFrame(0, 1, 0, 0, 0),
    makeFrame(1, 2, 100, 0, 0),
  ];
  const playhead: FrameState = {
    ...frames[1],
    index: 0.25,
    position: { x: 25, y: 0, z: 0 },
  };

  assert.deepEqual(resolveViewerFocusSegment(frames, playhead, null), [
    frames[0].position,
    playhead.position,
  ]);
});

test("resolveViewerFocusPointBuffer flattens the highlighted path into a continuous line payload", () => {
  const frames = [
    makeFrame(0, 1, 0, 0, 0),
    makeFrame(1, 2, 10, 0, 0),
    makeFrame(2, 2, 20, 5, 0),
    makeFrame(3, 2, 30, 10, 0),
  ];
  const picked: SegmentRecord = {
    start: frames[1].position,
    end: frames[2].position,
    endFrame: frames[2],
    sourceIndex: 1,
    lane: "cut",
  };

  assert.deepEqual(resolveViewerFocusPointBuffer(frames, frames[2], picked), [
    0, 0, 0,
    10, 0, 0,
    20, 5, 0,
    30, 10, 0,
  ]);
});
