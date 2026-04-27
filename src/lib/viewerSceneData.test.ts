import test from "node:test";
import assert from "node:assert/strict";
import type { FrameState } from "../types";
import {
  buildViewerSceneData,
  buildViewerRenderBuffers,
  buildViewerPickCollections,
} from "./viewerSceneData.ts";

function makeFrame(
  index: number,
  lineNumber: number,
  position: [number, number, number],
  motion: FrameState["motion"],
  axisDomain: FrameState["axisDomain"] = "xyz",
): FrameState {
  return {
    index,
    lineNumber,
    position: { x: position[0], y: position[1], z: position[2] },
    motion,
    axisDomain,
    pausedByBreakpoint: false,
  };
}

test("buildViewerSceneData derives stable scene metadata from frames and code lines", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 5], "Rapid"),
    makeFrame(1, 2, [0, 0, 0], "Linear"),
    makeFrame(2, 3, [10, 0, 0], "Linear"),
    makeFrame(3, 4, [10, 4, 0], "Rapid"),
  ];

  const scene = buildViewerSceneData(frames, ["", "G1 Z0", "G1 X10", "G0 Y4"]);

  assert.equal(scene.segmentData.cutSegments.length, 2);
  assert.equal(scene.segmentData.rapidSegments.length, 1);
  assert.equal("centerFrames" in scene, false);
  assert.deepEqual(scene.geometryCenter, { x: 5, y: 2, z: 2.5 });
  assert.equal(scene.sceneScale, 80);
});

test("buildViewerRenderBuffers stays stable while dragging even when adaptive limits apply", () => {
  const frames: FrameState[] = [makeFrame(0, 1, [0, 0, 0], "Linear")];
  for (let i = 1; i <= 5000; i += 1) {
    frames.push(makeFrame(i, i + 1, [i * 10, 0, 0], i === 5000 ? "Rapid" : "Linear"));
  }

  const scene = buildViewerSceneData(
    frames,
    Array.from({ length: frames.length }, (_, idx) => (idx === frames.length - 1 ? "G0 X50000" : `G1 X${idx * 10}`)),
  );
  const compact = buildViewerRenderBuffers(scene.segmentData, (base, floor = 0) => Math.max(floor, Math.floor(base / 10_000) + 1));
  const pointerDown = buildViewerRenderBuffers(scene.segmentData, (base, floor = 0) => Math.max(floor, Math.floor(base / 10_000) + 1));

  assert.deepEqual(compact.cutPoints, pointerDown.cutPoints);
  assert.deepEqual(compact.uvwPoints, pointerDown.uvwPoints);
  assert.deepEqual(compact.plungePoints, pointerDown.plungePoints);
  assert.deepEqual(compact.rapidPoints, pointerDown.rapidPoints);
});

test("buildViewerRenderBuffers keeps cut paths grouped as continuous polylines", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 0], "Linear"),
    makeFrame(1, 2, [1, 0, 0], "ArcCw"),
    makeFrame(2, 3, [2, 0, 0], "ArcCw"),
    makeFrame(3, 4, [5, 0, 0], "Rapid"),
    makeFrame(4, 5, [6, 0, 0], "Linear"),
  ];

  const scene = buildViewerSceneData(frames, ["G1 X0", "G2 X1", "G2 X2", "G0 X5", "G1 X6"]);
  const buffers = buildViewerRenderBuffers(scene.segmentData, (base) => base);

  assert.deepEqual(buffers.cutPoints, [[
    0, 0, 0,
    1, 0, 0,
    2, 0, 0,
  ], [
    5, 0, 0,
    6, 0, 0,
  ]]);
});

test("buildViewerRenderBuffers does not downsample visible cut polylines", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 0], "Linear"),
    makeFrame(1, 2, [1, 0, 0], "Linear"),
    makeFrame(2, 3, [2, 0, 0], "Linear"),
    makeFrame(3, 4, [3, 0, 0], "Linear"),
    makeFrame(4, 5, [4, 0, 0], "Linear"),
  ];

  const scene = buildViewerSceneData(frames, ["G1 X0", "G1 X1", "G1 X2", "G1 X3", "G1 X4"]);
  const buffers = buildViewerRenderBuffers(scene.segmentData, () => 2);

  assert.deepEqual(buffers.cutPoints, [[
    0, 0, 0,
    1, 0, 0,
    2, 0, 0,
    3, 0, 0,
    4, 0, 0,
  ]]);
});

test("buildViewerPickCollections only expands combined picks when rapid path is visible", () => {
  const frames: FrameState[] = [
    makeFrame(0, 1, [0, 0, 0], "Linear"),
    makeFrame(1, 2, [5, 0, 0], "Linear"),
    makeFrame(2, 3, [5, 5, 0], "Rapid"),
  ];

  const scene = buildViewerSceneData(frames, ["G1 X0", "G1 X5", "G0 Y5"]);
  const hidden = buildViewerPickCollections(scene.segmentData, (base) => base);
  const visible = buildViewerPickCollections(scene.segmentData, (base) => base);

  assert.equal(hidden.pickCutSegments, visible.pickCutSegments);
  assert.equal(hidden.pickRapidSegments, visible.pickRapidSegments);
  assert.equal("sampledSegments" in hidden, false);
  assert.equal("fullSegments" in hidden, false);
  assert.equal("sampledSegments" in visible, false);
  assert.equal("fullSegments" in visible, false);
});
