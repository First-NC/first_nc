import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import {
  advancePlaybackProgress,
  buildPlaybackDistanceMap,
  playbackUnitsPerSecond,
  resolvePlaybackDistance,
  resolvePlaybackProgress,
} from "./viewerPlaybackSpeed.ts";

function makeFrame(index: number, x: number, y = 0, z = 0): FrameState {
  return {
    index,
    lineNumber: index + 1,
    position: { x, y, z },
    motion: "Linear",
    pausedByBreakpoint: false,
    axisDomain: "xyz",
  };
}

test("buildPlaybackDistanceMap measures real 3D path distance instead of frame count", () => {
  const distances = buildPlaybackDistanceMap([
    makeFrame(0, 0),
    makeFrame(1, 10),
    makeFrame(2, 10, 10),
  ]);

  assert.deepEqual(distances, [0, 10, 20]);
});

test("resolvePlaybackProgress maps a path distance back to fractional frame progress", () => {
  const distances = [0, 10, 30];

  assert.equal(resolvePlaybackProgress(20, distances), 1.5);
  assert.equal(resolvePlaybackDistance(1.5, distances), 20);
});

test("advancePlaybackProgress makes speed modes visually distinct over the same time slice", () => {
  const distances = [0, 1000];
  const low = advancePlaybackProgress(0, 1000, playbackUnitsPerSecond.Low, distances);
  const standard = advancePlaybackProgress(0, 1000, playbackUnitsPerSecond.Standard, distances);
  const high = advancePlaybackProgress(0, 1000, playbackUnitsPerSecond.High, distances);

  assert.ok(standard >= low * 5);
  assert.ok(high >= standard * 5);
});
