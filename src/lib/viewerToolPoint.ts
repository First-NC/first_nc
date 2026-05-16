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
    arrowLen * (shortSegment ? 0.9 : 0.56),
    Math.max(2.2, safeSceneScale * 0.044),
  );
  const headWidth = Math.min(
    arrowLen,
    Math.max(headLen * 1.15, arrowLen * (shortSegment ? 0.82 : 0.38)),
    Math.max(1.8, safeSceneScale * 0.05),
  );

  return {
    arrowLen,
    headLen,
    headWidth,
  };
}
