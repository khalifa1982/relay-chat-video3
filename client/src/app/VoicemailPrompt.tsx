import { useEffect, useRef, useState } from "react";
import { Bell, Check, Mic, PhoneMissed, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { recorderSupported, startVoiceRecording, type VoiceRecording } from "@/lib/voiceNote";

export interface FailedDialInfo {
  pin: string;
  name: string | null;
  reason: string; // "no-answer" | "peer-rejected" | "server-error:offline"
}

/** Voicemail cap — carrier-style 60 seconds. */
export const VOICEMAIL_MAX_MS = 60_000;

function reasonLine(reason: string): string {
  if (reason === "peer-rejected") return "They declined your call.";
  if (reason === "server-error:offline") return "They're offline right now.";
  return "They didn't answer.";
}

/**
 * Post-dial voicemail card (v2.88). Raised by the call engine's onDialFailed
 * hook when a 1:1 outgoing dial ends unconnected (no answer / declined /
 * offline): offers to record a ≤60s voice message — delivered as a normal
 * chat AUDIO message tagged meta:{voicemail:true} into the caller↔callee DM
 * thread (zero new server infrastructure) — and to register a "tell me when
 * they're back online" alert (the v2.88 call-back watch).
 */
export function VoicemailPrompt({ info, onClose }: { info: FailedDialInfo; onClose: () => void }) {
  const openThread = trpc.messages.openThread.useMutation();
  const sendMessage = trpc.messages.send.useMutation();
  const watchOnline = trpc.directory.watchOnline.useMutation();

  const [recState, setRecState] = useState<"idle" | "recording" | "sending" | "sent">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [watched, setWatched] = useState(false);
  // Text-message composer (v2.99.11): the offline card lets you drop a quick
  // written message into the DM thread without leaving the call flow.
  const [text, setText] = useState("");
  const [textState, setTextState] = useState<"idle" | "sending" | "sent">("idle");
  const recRef = useRef<VoiceRecording | null>(null);
  // Still mounted? Guards the mic-acquisition await (v2.99.36) and releases a
  // live recording if the prompt closes mid-record — otherwise the microphone
  // stays captured with no handle left to stop it.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      try { recRef.current?.cancel(); } catch { /* */ }
      recRef.current = null;
    };
  }, []);

  // Elapsed ticker while recording (also proves the 60s cap visually).
  useEffect(() => {
    if (recState !== "recording") return;
    const started = Date.now();
    const t = setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => clearInterval(t);
  }, [recState]);

  // Unmount safety: never leave the mic live.
  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      recRef.current = null;
    };
  }, []);

  const who = info.name || info.pin;

  async function beginRecording() {
    if (!recorderSupported()) {
      toast.error("Voice recording isn't supported by this browser — send them a message instead.");
      return;
    }
    try {
      const rec = await startVoiceRecording({ maxMs: VOICEMAIL_MAX_MS });
      if (!aliveRef.current) { rec.cancel(); return; }
      recRef.current = rec;
      setElapsedMs(0);
      setRecState("recording");
      void rec.done.then(async (result) => {
        recRef.current = null;
        if (!result) {
          setRecState("idle");
          return;
        }
        setRecState("sending");
        try {
          const uploaded = await uploadAttachment(result.blob, {
            filename: `voicemail.${result.ext}`,
            mimeType: result.blob.type,
            durationMs: result.durationMs,
          });
          const thread = await openThread.mutateAsync({ number: info.pin });
          await sendMessage.mutateAsync({
            conversationId: thread.conversationId,
            kind: "audio",
            body: null,
            attachmentId: uploaded.id,
            meta: { voicemail: true },
          });
          setRecState("sent");
          toast.success(`Voicemail sent to ${who}.`);
          window.setTimeout(onClose, 1400);
        } catch (err) {
          setRecState("idle");
          toast.error(
            "Couldn't send the voicemail: " + (err instanceof Error ? err.message : String(err))
          );
        }
      });
    } catch (err) {
      toast.error(
        "Mic access is required to leave a voicemail: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  function stopRecording() {
    recRef.current?.stop();
  }

  async function sendText() {
    const body = text.trim();
    if (!body || textState === "sending") return;
    setTextState("sending");
    try {
      const thread = await openThread.mutateAsync({ number: info.pin });
      await sendMessage.mutateAsync({ conversationId: thread.conversationId, kind: "text", body });
      setTextState("sent");
      toast.success(`Message sent to ${who}.`);
      window.setTimeout(onClose, 1200);
    } catch (err) {
      setTextState("idle");
      toast.error("Couldn't send the message: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function requestWatch() {
    try {
      await watchOnline.mutateAsync({ number: info.pin });
      setWatched(true);
      toast.success(`You'll be alerted when ${who} is back online.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't set the alert.");
    }
  }

  const secs = Math.min(60, Math.floor(elapsedMs / 1000));

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-label={`Call to ${who} didn't connect`}
    >
      <div className="w-[min(94vw,400px)] rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
              <PhoneMissed className="size-5" />
            </span>
            <div>
              <div className="font-semibold leading-tight">{who}</div>
              <div className="text-sm text-muted-foreground">{reasonLine(info.reason)}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        {recState === "recording" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm">
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono">
                0:{String(secs).padStart(2, "0")} / 1:00
              </span>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive px-4 py-3 font-semibold text-destructive-foreground active:scale-[0.98] transition-transform"
            >
              <Square className="size-4" /> Stop &amp; send
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Recording stops automatically at 60 seconds.
            </p>
          </div>
        ) : recState === "sending" ? (
          <div className="py-3 text-center text-sm text-muted-foreground">Sending voicemail…</div>
        ) : recState === "sent" ? (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-[color:var(--relay-online,#06d6a0)]">
            <Check className="size-4" /> Voicemail sent
          </div>
        ) : (
          <div className="space-y-2">
            {/* Send a written message (v2.99.11) — a quick text into the DM. */}
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/20 p-1.5 pl-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
                disabled={textState !== "idle"}
                placeholder={`Message ${who}…`}
                aria-label={`Message ${who}`}
                maxLength={2000}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={sendText}
                disabled={!text.trim() || textState !== "idle"}
                aria-label="Send message"
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 active:scale-95 transition-transform"
              >
                {textState === "sent" ? <Check className="size-4" /> : <Send className="size-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={beginRecording}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 font-semibold text-primary-foreground active:scale-[0.98] transition-transform"
            >
              <Mic className="size-4" /> Leave a voice message
            </button>
            <button
              type="button"
              onClick={requestWatch}
              disabled={watched || watchOnline.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {watched ? (
                <>
                  <Check className="size-4 text-[color:var(--relay-online,#06d6a0)]" /> You'll be alerted when they're online
                </>
              ) : (
                <>
                  <Bell className="size-4" /> Tell me when they're back online
                </>
              )}
            </button>
            <p className="pt-1 text-center text-xs text-muted-foreground">
              The voice message lands in your chat with {who} — they'll get a
              "Voicemail" alert.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
