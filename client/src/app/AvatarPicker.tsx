import { useState } from "react";
import { X, ImagePlus, Trash2, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { uploadAvatarImage } from "@/lib/uploadAttachment";
import { AVATAR_EMOJIS, AVATAR_BGS, renderEmojiAvatar } from "@/lib/emojiAvatar";
import { renderAnimatedEmojiAvatar } from "@/lib/animatedAvatar";
import { toast } from "sonner";

/**
 * Avatar chooser (v2.99.2). Three ways to set a profile picture:
 *   1. Upload a photo from the device.
 *   2. Pick a smiley/character EMOJI on a gradient — rendered to a PNG and
 *      uploaded through the same photo path, so it shows everywhere avatars do.
 *   3. Remove it (fall back to initials).
 * Self-contained: it uploads + saves to the current identity and calls
 * `onSaved` with the new url (or null on remove). Works inside Profile and the
 * registration "Finish setting up" screen alike.
 */
export function AvatarPicker({
  open,
  onClose,
  displayName,
  onSaved,
  onSave,
  title = "Choose your avatar",
  removeLabel = "your photo",
}: {
  open: boolean;
  onClose: () => void;
  displayName?: string;
  onSaved?: (url: string | null) => void;
  /**
   * Where the chosen url is WRITTEN (v2.102.1). Omitted, it saves to the caller's own
   * identity — the historical behaviour, byte-identical. A GROUP passes its own sink
   * (`messages.setGroupProfile`), which is why this is injected rather than branched
   * on inside: a second copy of this component would mean a second copy of the upload
   * pipeline, the emoji renderer, the animated-GIF path, the 4 MB cap and the mime
   * check — and v2.99.89 found a DEAD duplicate upload path doing exactly that.
   *
   * The uploaded key lands in the CALLER's own storage namespace either way, which is
   * exactly what `setGroupProfile`'s ownership gate requires, so a member setting a
   * group photo needs no server change.
   */
  onSave?: (url: string | null) => Promise<void>;
  title?: string;
  removeLabel?: string;
}) {
  const utils = trpc.useUtils();
  const updateProfile = trpc.identity.updateProfile.useMutation();
  const [bgIdx, setBgIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  // Animated avatars (v2.99.18): when on, a picked character is rendered to an
  // ANIMATED GIF (gentle bounce/pulse) instead of a static PNG — uploaded the
  // same way, so it animates on every surface that shows the avatar.
  const [animated, setAnimated] = useState(false);

  if (!open) return null;
  const bg = AVATAR_BGS[bgIdx];

  async function save(url: string | null) {
    if (onSave) {
      await onSave(url);
    } else {
      await updateProfile.mutateAsync({ avatarUrl: url });
      await utils.identity.whoami.invalidate();
    }
    onSaved?.(url);
    onClose();
  }

  async function pickEmoji(emoji: string) {
    if (busy) return;
    setBusy(true);
    try {
      const blob = animated
        ? await renderAnimatedEmojiAvatar(emoji, bg)
        : await renderEmojiAvatar(emoji, bg);
      const { url } = await uploadAvatarImage(blob, {
        mimeType: animated ? "image/gif" : "image/png",
      });
      await save(url);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't set that avatar.");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose an image file."); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Photo must be under 4 MB."); return; }
    setBusy(true);
    try {
      const { url } = await uploadAvatarImage(file, { mimeType: file.type });
      await save(url);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await save(null);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? `Couldn't remove ${removeLabel}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dark fixed inset-0 z-[130] grid place-items-end sm:place-items-center p-0 sm:p-4 text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div aria-hidden className="glass-overlay absolute inset-0" onClick={busy ? undefined : onClose} />
      <div className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur-2xl sm:w-[min(94vw,440px)] sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rhit rounded-full p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* photo upload + remove */}
          <div className="flex gap-2">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-3 text-sm font-semibold transition hover:bg-muted/60">
              <ImagePlus className="size-4" /> Upload photo
              <input type="file" accept="image/*" className="hidden" onChange={onPhoto} disabled={busy} />
            </label>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-4" /> Remove
            </button>
          </div>

          {/* background palette */}
          <div className="mt-5 mb-2 text-xs font-medium text-muted-foreground">Background</div>
          <div className="flex flex-wrap gap-2">
            {AVATAR_BGS.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Background ${b.id}`}
                aria-pressed={i === bgIdx}
                onClick={() => setBgIdx(i)}
                className={`size-8 rounded-full ring-2 transition ${i === bgIdx ? "ring-primary" : "ring-transparent"}`}
                style={{ background: `linear-gradient(135deg,${b.from},${b.to})` }}
              />
            ))}
          </div>

          {/* emoji / character grid */}
          <div className="mt-5 mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Pick a character</span>
            {/* Animated toggle — renders the picked character as a looping GIF. */}
            <button
              type="button"
              role="switch"
              aria-checked={animated}
              disabled={busy}
              onClick={() => setAnimated((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 " +
                (animated
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-background/50 text-muted-foreground hover:bg-muted/60")
              }
            >
              <Sparkles className="size-3.5" /> {animated ? "Animated ✨" : "Animated"}
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
            {AVATAR_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={busy}
                onClick={() => pickEmoji(emoji)}
                aria-label={`Avatar ${emoji}`}
                className="grid aspect-square place-items-center rounded-full text-xl transition active:scale-90 disabled:opacity-50"
                style={{ background: `linear-gradient(135deg,${bg.from},${bg.to})` }}
              >
                <span className="drop-shadow-sm">{emoji}</span>
              </button>
            ))}
          </div>

          {displayName && (
            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              No photo? We'll show your initials ({initialsOf(displayName)}).
            </p>
          )}
        </div>

        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-background/40 backdrop-blur-sm">
            <Loader2 className="size-7 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}
