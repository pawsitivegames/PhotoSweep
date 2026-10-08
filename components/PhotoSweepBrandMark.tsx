import Box from "@mui/material/Box"

function getBrandIconUrl(): string {
  if (typeof chrome === "undefined") {
    throw new Error("PhotoSweepBrandMark requires the Chrome extension runtime")
  }

  const runtime = chrome.runtime
  const iconPath = runtime.getManifest().icons?.["128"]
  if (!iconPath) {
    throw new Error("The extension manifest is missing its 128px brand icon")
  }

  return runtime.getURL(iconPath)
}

export function PhotoSweepBrandMark({ size = 34 }: { size?: number }) {
  return (
    <Box
      component="img"
      src={getBrandIconUrl()}
      alt=""
      aria-hidden="true"
      draggable={false}
      sx={{
        display: "block",
        width: size,
        height: size,
        flexShrink: 0,
        objectFit: "contain"
      }}
    />
  )
}
