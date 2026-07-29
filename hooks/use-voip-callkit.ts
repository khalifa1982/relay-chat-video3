import { useCallback } from "react";
import type { WebView } from "react-native-webview";

/**
 * VoIP + CallKit hook — DISABLED.
 *
 * react-native-callkeep and react-native-voip-push-notification are incompatible
 * with React Native 0.83's TurboModule system. Loading either module causes a
 * fatal JS exception whose error message is ~1MB, which overflows the buffer in
 * RCTExceptionsManager.reportFatal and triggers a SIGSEGV (memmove crash).
 *
 * This stub maintains the same API surface so callers don't need changes.
 * VoIP push support can be re-added once compatible libraries are available.
 */

export type VoipCallPayload = {
  caller?: string;
  room?: string;
  hasVideo?: boolean;
  [key: string]: unknown;
};

export function useVoipCallKit(
  _webViewRef: React.RefObject<WebView | null>,
  _handlers?: { onAnswer?: (payload: VoipCallPayload) => void; onEnd?: () => void },
) {
  const onWebReady = useCallback(() => {
    // No-op: VoIP disabled
  }, []);

  return { voipToken: null, onWebReady };
}
