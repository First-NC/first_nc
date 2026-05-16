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
  const headLen = Math.min(
    arrowLen * 0.42,
    Math.max(1.2, safeSceneScale * 0.028),
  );
  const headWidth = Math.min(
    Math.max(headLen * 0.74, arrowLen * 0.22),
    Math.max(0.8, safeSceneScale * 0.02),
  );

  return {
    arrowLen,
    headLen,
    headWidth,
  };
}
