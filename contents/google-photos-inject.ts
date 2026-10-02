import type { PlasmoCSConfig } from "plasmo"

import { photoSweepColors } from "../lib/photo-sweep-colors"
import {
  injectProviderScript,
  requestProviderCommandPublicKey
} from "../lib/provider-script-injection"

// Content script that injects MAIN world scripts into Google Photos pages.
// These scripts need to run in the page's JS context to access GPTK globals
// (window.gptkApi, window.gptkCore, window.WIZ_global_data).

export const config: PlasmoCSConfig = {
  matches: ["https://photos.google.com/*"],
  run_at: "document_idle"
}

async function injectGooglePhotosScripts(): Promise<void> {
  const publicKey = await requestProviderCommandPublicKey()
  // Order matters: GPTK requires the unsafeWindow shim, and the command
  // handler expects GPTK globals to be available when health checks run.
  await injectProviderScript("scripts/unsafewindow-shim.js")
  await injectProviderScript("scripts/google-photos-toolkit.user.js")
  applyPhotoSweepToolkitTheme()
  await injectProviderScript("scripts/photo-provider-command-host.js", publicKey)
  await injectProviderScript("scripts/google-photos-commands.js")
  console.log("GPD: Injected MAIN world scripts into Google Photos page")
}

function applyPhotoSweepToolkitTheme(): void {
  const styleId = "photosweep-gptk-theme"
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style")
    style.id = styleId
    style.textContent = `
      #gptk,
      #gptk-button {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
          "SF Pro Display", "DM Sans", "Segoe UI", Arial, sans-serif;
        --accent: ${photoSweepColors.primary};
        --accent-hover: ${photoSweepColors.primaryDark};
        --accent-muted: ${photoSweepColors.primarySoft};
        --accent-glow: ${photoSweepColors.primaryShadow};
        --bg-base: ${photoSweepColors.canvasTop};
        --bg-raised: ${photoSweepColors.surface};
        --bg-overlay: ${photoSweepColors.surfaceSubtle};
        --bg-surface: ${photoSweepColors.surface};
        --bg-surface-hover: ${photoSweepColors.surfaceSoft};
        --bg-surface-active: ${photoSweepColors.primarySoft};
        --border-subtle: ${photoSweepColors.border};
        --border-default: ${photoSweepColors.border};
        --border-strong: ${photoSweepColors.borderStrong};
        --text-primary: ${photoSweepColors.ink};
        --text-secondary: ${photoSweepColors.muted};
        --text-tertiary: ${photoSweepColors.muted};
        --text-disabled: ${photoSweepColors.muted};
        --danger: ${photoSweepColors.error};
        --danger-muted: ${photoSweepColors.errorSoft};
        --danger-hover: ${photoSweepColors.errorDark};
        --success: ${photoSweepColors.success};
        --warning-text: ${photoSweepColors.warning};
        --overlay-filter: blur(12px) brightness(0.58) saturate(0.82);
        --shadow-panel: 0 24px 80px ${photoSweepColors.shadowDeep},
          0 0 0 1px var(--border-subtle);
      }

      #gptk .header {
        background: linear-gradient(
          135deg,
          ${photoSweepColors.primaryShadow} 0%,
          transparent 55%
        );
      }

      #gptk .source input:checked + .sourceHeader {
        box-shadow: 0 2px 8px ${photoSweepColors.primaryShadow},
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      #gptk option.shared {
        background-color: ${photoSweepColors.primarySoft};
      }

      #gptk .warning-badge {
        background-color: ${photoSweepColors.warningSoft};
        border-color: ${photoSweepColors.borderStrong};
      }

      #gptk-button svg {
        fill: ${photoSweepColors.primary} !important;
      }

      .photosweep-toolkit-overlay {
        backdrop-filter: blur(12px) brightness(0.58) saturate(0.82);
        -webkit-backdrop-filter: blur(12px) brightness(0.58) saturate(0.82);
      }
    `
    document.head.appendChild(style)
  }

  document
    .getElementById("gptk")
    ?.previousElementSibling?.classList.add("photosweep-toolkit-overlay")
}

void injectGooglePhotosScripts().catch((error) => {
  console.warn("GPD: Failed to inject Google Photos scripts", error)
})
