export type ToolPointArrowMetrics = {
  arrowLen: number;
  headLen: number;
  headWidth: number;
};

export function resolveToolPointArrowMetrics(segmentLength: number, sceneScale: number): ToolPointArrowMetrics | null {
  if (!Number.isFinite(segmentLength) || segmentLength < 1e-8) return null;
  const safeSceneScale = Number.isFinite(sceneScale) && sceneScale > 0 ? sceneScale : 1;

  // 箭头整体跟随当前高亮段长度，避免小圆弧上出现比红色段更大的方向标记。
  const sceneCap = Math.max(8, safeSceneScale * 0.09);
  const arrowLen = Math.min(segmentLength, sceneCap);
  const shortSegment = segmentLength <= safeSceneScale * 0.025;
  const headLen = Math.min(
    arrowLen * (shortSegment ? 0.72 : 0.48),
    Math.max(1.6, safeSceneScale * 0.036),
  );
  const headWidth = Math.min(
    Math.max(headLen * 1.05, arrowLen * (shortSegment ? 0.46 : 0.28)),
    Math.max(1.2, safeSceneScale * 0.034),
  );

  return {
    arrowLen,
    headLen,
    headWidth,
  };
}
