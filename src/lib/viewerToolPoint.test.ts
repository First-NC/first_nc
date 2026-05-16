import test from "node:test";
import assert from "node:assert/strict";
import { resolveToolPointArrowMetrics } from "./viewerToolPoint.ts";

test("resolveToolPointArrowMetrics keeps the arrow within tiny highlighted segments", () => {
  const metrics = resolveToolPointArrowMetrics(2, 500);

  assert.ok(metrics);
  assert.equal(metrics.arrowLen, 2);
  assert.ok(metrics.headLen <= metrics.arrowLen);
  assert.ok(metrics.headWidth <= metrics.arrowLen);
  assert.ok(metrics.headLen >= metrics.arrowLen * 0.85);
  assert.ok(metrics.headWidth >= metrics.arrowLen * 0.8);
});

test("resolveToolPointArrowMetrics caps large arrows by scene scale", () => {
  const metrics = resolveToolPointArrowMetrics(500, 100);

  assert.ok(metrics);
  assert.equal(metrics.arrowLen, 9);
});

test("resolveToolPointArrowMetrics ignores degenerate segments", () => {
  assert.equal(resolveToolPointArrowMetrics(0, 100), null);
  assert.equal(resolveToolPointArrowMetrics(Number.NaN, 100), null);
});
