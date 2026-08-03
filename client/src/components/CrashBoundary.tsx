/**
 * THE RENDER-CRASH NET (v2.107.x). Wraps the ENTIRE tree in main.tsx — outside
 * ThemeProvider, LocaleProvider, the query client, everything — because the
 * whole point is to catch the crash those providers might be. That placement
 * dictates two deliberate oddities:
 *
 *  • THE FALLBACK TEXT IS INLINE, IN BOTH LANGUAGES AT ONCE, not `t()` keys.
 *    This component cannot call `useLocale()` — the provider it needs may be
 *    the thing that just died — and reading a persisted locale to pick one
 *    language would make the recovery screen itself depend on state. Showing
 *    both is the failure mode with no failure mode. (The app-wide i18n sweeps
 *    pin SCREENS, keyed by file; this net renders only when a screen could
 *    not.)
 *
 *  • THE STYLING IS INLINE too — the board's own dark (#0A0D10, the Capacitor
 *    shell background) — because index.css classes may not have loaded if the
 *    crash happened early enough.
 *
 * componentDidCatch reports through the SAME pipe as every other crash, with
 * the componentStack attached — that stack names the component that threw,
 * which a window-level handler never sees.
 */
import React from "react";
import { reportCrash } from "@/lib/crashReporter";

type Props = { children: React.ReactNode };
type State = { crashed: boolean };

export class CrashBoundary extends React.Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportCrash(error, { componentStack: info.componentStack ?? null, kind: "RenderCrash" });
  }

  render(): React.ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div
        dir="auto"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          background: "#0A0D10",
          color: "#e7e9ec",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: "0.3em", color: "#e8c94a" }}>RELAY</div>
        <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 340 }}>
          Something went wrong. The error was reported automatically.
          <br />
          حدث خطأ ما، وتم إرسال تقرير العطل تلقائيًا.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 6,
            padding: "10px 22px",
            borderRadius: 12,
            border: "1px solid rgba(232,201,74,.45)",
            background: "#e8c94a",
            color: "#04211a",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Reload · إعادة التحميل
        </button>
      </div>
    );
  }
}
