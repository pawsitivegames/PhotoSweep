// Google Photos thumbnail URLs are bare until a rendition directive is added.
// Keep URL construction in one place so grid, detector, and viewer requests
// stay consistent.

export function buildThumbUrl(
  thumb: string,
  size: { height: number; width?: number }
): string {
  if (thumb.startsWith("data:")) return thumb

  const { width, height } = size
  return width ? `${thumb}=w${width}-h${height}` : `${thumb}=h${height}`
}
