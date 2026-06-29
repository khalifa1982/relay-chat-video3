/**
 * Cross-platform media capability detection (Phase 4 / v2.55). Pure: takes a
 * plain feature-presence record (so it's unit-testable without a browser) and
 * returns a normalized report + human labels. The client passes in the real
 * browser feature checks; the diagnostics overlay renders the report so QA can
 * see EXACTLY what each device/browser supports during a live session.
 *
 * Honest-by-design: where a capability genuinely isn't available (e.g. Android
 * Chrome has no web audio-OUTPUT selection — the OS/Bluetooth routes it), the
 * report says so plainly instead of the control silently vanishing.
 */
export interface MediaFeatureProbe {
  /** navigator.mediaDevices.getUserMedia exists (camera/mic). */
  getUserMedia: boolean;
  /** navigator.mediaDevices.getDisplayMedia exists (screen share). */
  getDisplayMedia: boolean;
  /** HTMLMediaElement.prototype.setSinkId exists (choose audio OUTPUT). */
  setSinkId: boolean;
  /** navigator.mediaDevices.enumerateDevices exists. */
  enumerateDevices: boolean;
  /** Standard Picture-in-Picture (document.pictureInPictureEnabled). */
  pictureInPicture: boolean;
  /** WebKit presentation-mode PiP (iOS). */
  webkitPresentationPip: boolean;
  /** canvas.captureStream exists (filters / 2-up PiP compositor). */
  canvasCaptureStream: boolean;
  /** Is this a WebKit/iOS engine (Safari, or any iOS browser)? */
  isIOSWebKit: boolean;
}

export interface CapabilityRow {
  key: string;
  label: string;
  supported: boolean;
  /** Short, honest note shown when unsupported (or for context). */
  note?: string;
}

export interface CapabilityReport {
  rows: CapabilityRow[];
  /** True when ANY PiP path works. */
  pipSupported: boolean;
  /** Screen sharing actually works here. */
  screenShareSupported: boolean;
  /** Selecting an audio OUTPUT device actually works here. */
  audioOutputSelectable: boolean;
}

export function buildCapabilityReport(p: MediaFeatureProbe): CapabilityReport {
  const screenShareSupported = p.getDisplayMedia;
  const audioOutputSelectable = p.setSinkId && p.enumerateDevices;
  const pipSupported =
    (p.pictureInPicture && p.canvasCaptureStream) || p.webkitPresentationPip;

  const rows: CapabilityRow[] = [
    {
      key: "camera-mic",
      label: "Camera & microphone",
      supported: p.getUserMedia,
      note: p.getUserMedia ? undefined : "Needs a secure (https) context and permission.",
    },
    {
      key: "screen-share",
      label: "Screen sharing",
      supported: screenShareSupported,
      note: screenShareSupported
        ? undefined
        : p.isIOSWebKit
          ? "iPhone/iPad browsers can't screen-share a web page (Apple limitation)."
          : "This browser/in-app webview doesn't expose screen capture.",
    },
    {
      key: "audio-output",
      label: "Choose audio output",
      supported: audioOutputSelectable,
      note: audioOutputSelectable
        ? undefined
        : "Your device routes call audio automatically — use the system / Bluetooth controls.",
    },
    {
      key: "pip",
      label: "Picture-in-Picture",
      supported: pipSupported,
      note: pipSupported ? undefined : "Not available in this browser.",
    },
  ];

  return { rows, pipSupported, screenShareSupported, audioOutputSelectable };
}

/** Read the real browser features into a probe. Safe to call anywhere (guards
 *  every access); returns all-false in a non-DOM environment. */
export function probeBrowserMedia(): MediaFeatureProbe {
  const allFalse: MediaFeatureProbe = {
    getUserMedia: false,
    getDisplayMedia: false,
    setSinkId: false,
    enumerateDevices: false,
    pictureInPicture: false,
    webkitPresentationPip: false,
    canvasCaptureStream: false,
    isIOSWebKit: false,
  };
  try {
    if (typeof navigator === "undefined" || typeof document === "undefined") return allFalse;
    const md = navigator.mediaDevices as (MediaDevices & {
      getDisplayMedia?: unknown;
      getUserMedia?: unknown;
      enumerateDevices?: unknown;
    }) | undefined;
    const mediaEl = typeof HTMLMediaElement !== "undefined"
      ? (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown })
      : undefined;
    const canvasProto = typeof HTMLCanvasElement !== "undefined"
      ? (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown })
      : undefined;
    const videoEl = typeof HTMLVideoElement !== "undefined"
      ? (HTMLVideoElement.prototype as unknown as { webkitSetPresentationMode?: unknown })
      : undefined;
    const ua = navigator.userAgent || "";
    const isIOSWebKit = /iP(hone|od|ad)/.test(ua)
      || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    return {
      getUserMedia: !!md && typeof md.getUserMedia === "function",
      getDisplayMedia: !!md && typeof md.getDisplayMedia === "function",
      setSinkId: !!mediaEl && typeof mediaEl.setSinkId === "function",
      enumerateDevices: !!md && typeof md.enumerateDevices === "function",
      pictureInPicture:
        "pictureInPictureEnabled" in document &&
        !!(document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled,
      webkitPresentationPip: !!videoEl && typeof videoEl.webkitSetPresentationMode === "function",
      canvasCaptureStream: !!canvasProto && typeof canvasProto.captureStream === "function",
      isIOSWebKit,
    };
  } catch {
    return allFalse;
  }
}
