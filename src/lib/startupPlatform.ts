export function shouldShowStartupMaskOnPlatform(platform: string | null | undefined): boolean {
  const normalized = (platform ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return !normalized.includes("linux");
}
