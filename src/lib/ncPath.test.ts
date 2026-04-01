import test from "node:test";
import assert from "node:assert/strict";
import { parseNcToFrames } from "./ncPath.ts";

function maximumChordSagitta(frames: ReturnType<typeof parseNcToFrames>, centerX: number, centerY: number, radius: number) {
  let maxSagitta = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1].position;
    const current = frames[i].position;
    const midpointX = (previous.x + current.x) * 0.5;
    const midpointY = (previous.y + current.y) * 0.5;
    const midpointRadius = Math.hypot(midpointX - centerX, midpointY - centerY);
    maxSagitta = Math.max(maxSagitta, Math.abs(radius - midpointRadius));
  }
  return maxSagitta;
}

test("parseNcToFrames adaptively subdivides large arcs for smooth circular output", () => {
  const frames = parseNcToFrames("G90\nG0 X0 Y0\nG2 X100 Y0 I50 J0", "normal");
  const arcFrames = frames.filter((frame) => frame.motion === "ArcCw");

  assert.ok(arcFrames.length >= 48, `expected a densely sampled arc, got ${arcFrames.length} frames`);

  const maxSagitta = maximumChordSagitta(arcFrames, 50, 0, 50);
  assert.ok(maxSagitta <= 0.03, `expected max chord sagitta <= 0.03, got ${maxSagitta}`);
});

test("parseNcToFrames keeps consecutive arc segments positionally continuous", () => {
  const frames = parseNcToFrames("G90\nG0 X10 Y0\nG3 X0 Y10 I-10 J0\nG3 X-10 Y0 I0 J-10", "normal");
  const arcFrames = frames.filter((frame) => frame.motion === "ArcCcw");

  assert.ok(arcFrames.length > 10, "expected multiple interpolated arc frames");

  const firstArcEnd = arcFrames.findLast((frame) => frame.lineNumber === 3);
  const secondArcStart = arcFrames.find((frame) => frame.lineNumber === 4);

  assert.ok(firstArcEnd, "expected first arc to produce frames");
  assert.ok(secondArcStart, "expected second arc to produce frames");
  assert.ok(Math.abs(firstArcEnd.position.x - 0) <= 1e-6);
  assert.ok(Math.abs(firstArcEnd.position.y - 10) <= 1e-6);
  assert.ok(Math.abs(secondArcStart.position.x - firstArcEnd.position.x) <= 1.5);
  assert.ok(Math.abs(secondArcStart.position.y - firstArcEnd.position.y) <= 1.5);
});
