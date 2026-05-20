export type ToolPointArrowMetrics = {
  arrowLen: number;
  headLen: number;
  headWidth: number;
};

/**
 * 基于相机距离计算屏幕空间恒定尺寸的箭头参数
 * @param cameraDistance 相机到箭头位置的距离
 * @param fov 相机垂直视场角（弧度）
 * @param canvasHeight 画布高度（像素）
 */
export function resolveScreenSpaceArrowMetrics(
  cameraDistance: number,
  fov: number,
  canvasHeight: number,
): ToolPointArrowMetrics {
  const worldPerPixel = (2 * cameraDistance * Math.tan(fov / 2)) / canvasHeight;
  // 锥体尺寸，箭头总长等于锥体高度（无杆），紧贴路径末端
  const targetHeadLen = worldPerPixel * 9;
  const targetHeadWidth = worldPerPixel * 4;

  const minSize = worldPerPixel * 2;
  const maxSize = worldPerPixel * 50;

  const headLen = Math.max(minSize, Math.min(targetHeadLen, maxSize));
  const headWidth = Math.max(minSize * 0.3, Math.min(targetHeadWidth, maxSize));
  const arrowLen = headLen;

  return { arrowLen, headLen, headWidth };
}

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
