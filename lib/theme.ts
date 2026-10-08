import "@fontsource/dm-sans/400.css"
import "@fontsource/dm-sans/500.css"
import "@fontsource/dm-sans/600.css"
import "@fontsource/dm-sans/700.css"
import { createTheme } from "@mui/material/styles"
import { photoSweepColors } from "./photo-sweep-colors"

export { photoSweepColors } from "./photo-sweep-colors"

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: photoSweepColors.primary,
      dark: photoSweepColors.primaryDark,
      light: photoSweepColors.primarySoft,
      contrastText: "#FFFFFF"
    },
    success: {
      main: photoSweepColors.success,
      light: photoSweepColors.successSoft,
      dark: photoSweepColors.successDark
    },
    warning: {
      main: photoSweepColors.warning,
      light: photoSweepColors.warningSoft,
      dark: "#8A5A14"
    },
    info: {
      main: photoSweepColors.primary,
      light: photoSweepColors.primarySoft,
      dark: photoSweepColors.primaryDark,
      contrastText: "#FFFFFF"
    },
    error: {
      main: photoSweepColors.error,
      light: photoSweepColors.errorSoft,
      dark: photoSweepColors.errorDark,
      contrastText: "#FFFFFF"
    },
    background: {
      default: photoSweepColors.canvasTop,
      paper: photoSweepColors.surfaceTint
    },
    divider: photoSweepColors.border,
    text: {
      primary: photoSweepColors.ink,
      secondary: photoSweepColors.muted
    }
  },
  typography: {
    fontFamily: [
      '"DM Sans"',
      "-apple-system",
      "BlinkMacSystemFont",
      '"SF Pro Text"',
      '"SF Pro Display"',
      '"Segoe UI"',
      "Arial",
      "sans-serif"
    ].join(","),
    h5: {
      fontWeight: 700,
      letterSpacing: 0
    },
    h6: {
      fontWeight: 700,
      letterSpacing: 0
    },
    button: {
      fontWeight: 700,
      letterSpacing: 0
    },
    caption: {
      letterSpacing: 0
    }
  },
  shape: {
    borderRadius: 8
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: photoSweepColors.surfaceTint,
          color: photoSweepColors.ink,
          boxShadow: `0 1px 0 ${photoSweepColors.shadow}`,
          backdropFilter: "saturate(160%) blur(18px)"
        }
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true
      },
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 8,
          fontWeight: 600,
          boxShadow: "none",
          minHeight: 40,
          letterSpacing: 0,
          transition:
            "background-color 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease",
          "&.MuiButton-contained": {
            minHeight: 44
          },
          "&:focus-visible": {
            outline: `3px solid ${photoSweepColors.primary}`,
            outlineOffset: 2
          }
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none"
        }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          border: `1px solid ${photoSweepColors.border}`,
          borderRadius: 12,
          backgroundColor: photoSweepColors.surface,
          backgroundImage: "none",
          boxShadow: `0 18px 56px ${photoSweepColors.shadowDeep}`
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
        message: { lineHeight: 1.45 }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 6
        }
      }
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 6,
          minHeight: 40,
          borderColor: photoSweepColors.border,
          transition:
            "background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease",
          "&.Mui-selected": {
            color: photoSweepColors.primary,
            backgroundColor: photoSweepColors.primarySoft,
            borderColor: photoSweepColors.primaryBorder
          }
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined"
      }
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 7,
          backgroundColor: photoSweepColors.borderStrong
        }
      }
    }
  }
})

export default theme
