/**
 * GET-THE-APP PROMPT (v2.107.79, owner's ask): a mobile-BROWSER-only card that
 * offers the native app, with two tabs — Android live (direct APK download) and
 * iPhone visibly present but disabled until the App Store listing lands. The
 * detected OS picks the default tab.
 *
 * WHO NEVER SEES IT, and each exclusion is the point rather than politeness:
 *  - THE NATIVE APP ITSELF. The shell injects `__RELAY_NATIVE__` and react-native-
 *    webview exposes `window.ReactNativeWebView`; either mark means the person is
 *    already inside the thing being offered, and an app advertising itself to its
 *    own users reads as a bug.
 *  - DESKTOP. `detectMobileOs` returns null and the component renders nothing —
 *    there is no APK story on a laptop.
 *  - AN INSTALLED PWA (display-mode: standalone). They chose an install already;
 *    nagging them to switch installs is churn, not help.
 *  - ANYONE WHO DISMISSED IT, for 14 days. The X writes a timestamp; a prompt
 *    with no memory is a nag. The key is versioned so a future build that should
 *    re-offer can bump it.
 */
import { useMemo, useState } from "react";
import { X, Smartphone, Download } from "lucide-react";
import { APP_DOWNLOAD, detectMobileOs } from "@shared/appDownload";
import { useT } from "./i18n";

const DISMISS_KEY = "relay_get_app_dismissed_v1";
const DISMISS_MS = 14 * 24 * 60 * 60_000;

function dismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

/** The full gate, pure-ish and exported for the test: mobile browser, not the
 *  native shell, not an installed PWA. */
export function shouldOfferApp(w: Window): "android" | "ios" | null {
  const anyW = w as unknown as { ReactNativeWebView?: unknown; __RELAY_NATIVE__?: unknown };
  if (anyW.ReactNativeWebView || anyW.__RELAY_NATIVE__) return null; // inside the app already
  try {
    if (w.matchMedia?.("(display-mode: standalone)")?.matches) return null; // installed PWA
  } catch {
    /* matchMedia unavailable → treat as a plain browser */
  }
  return detectMobileOs(w.navigator.userAgent, {
    platform: w.navigator.platform,
    maxTouchPoints: w.navigator.maxTouchPoints,
  });
}

export function AppDownloadPrompt() {
  const t = useT();
  const os = useMemo(
    () => (typeof window === "undefined" ? null : shouldOfferApp(window)),
    [],
  );
  const [gone, setGone] = useState(() => dismissed());
  // Default tab = the detected OS (owner: "it will deduct by default"). An iOS
  // visitor therefore lands on the iPhone tab and SEES the coming-soon state —
  // which is the honest answer — with Android one tap away.
  const [tab, setTab] = useState<"android" | "ios">(os === "ios" ? "ios" : "android");
  if (!os || gone) return null;

  function close() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* no storage — it simply reappears next load */
    }
    setGone(true);
  }

  const active = tab === "android" ? APP_DOWNLOAD.android : APP_DOWNLOAD.ios;

  return (
    <div
      className="fixed inset-x-0 z-40 px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
      role="dialog"
      aria-label={t("getapp.title")}
    >
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/95 backdrop-blur p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="shrink-0 size-10 grid place-items-center rounded-xl" style={{ background: "rgba(var(--rb-rgb, 63, 224, 197), .15)" }}>
            <Smartphone className="size-5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">{t("getapp.title")}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{t("getapp.desc")}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="rhit shrink-0 -m-1 p-2 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* The two platform tabs. Both always render (the ask), the disabled one
            in its coming-soon state rather than hidden — an absent Apple tab
            reads as "no iPhone app ever", which is not the message. */}
        <div className="mt-3 grid grid-cols-2 gap-2" role="tablist">
          {(["android", "ios"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={
                "rhit h-10 rounded-xl text-sm font-semibold border transition " +
                (tab === k ? "text-foreground" : "border-border text-muted-foreground")
              }
              style={
                tab === k
                  ? { background: "rgba(var(--rb-rgb, 63, 224, 197), .10)", borderColor: "rgba(var(--rb-rgb, 63, 224, 197), .55)" }
                  : undefined
              }
            >
              {k === "android" ? t("getapp.android") : t("getapp.ios")}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {active.enabled && active.url ? (
            <a
              href={active.url}
              className="flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold text-[#04211a] active:scale-[0.99] transition-transform"
              style={{ background: "rgb(var(--rb-rgb, 63, 224, 197))" }}
            >
              <Download className="size-4" />
              {tab === "android" ? t("getapp.downloadApk") : t("getapp.appStore")}
            </a>
          ) : (
            <div className="flex h-11 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              {t("getapp.iosSoon")}
            </div>
          )}
          {tab === "android" && active.enabled && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("getapp.apkNote")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
