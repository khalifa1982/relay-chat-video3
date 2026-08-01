import { useEffect, useRef, useState } from "react";
import { Lock, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { attemptOpenGroup, isValidLockCode } from "./groupLock";

/**
 * The screen a locked group shows INSTEAD of its messages (v2.105.20).
 *
 * IT LIVES IN THE CONVERSATION VIEW, NOT ON THE THREAD ROW'S TAP, and that choice
 * is what makes the lock hard to walk around. Gating the tap would leave every
 * other way in open — a deep link, a notification tap, a reload with `?c=<id>` in
 * the URL, the swipe row's own navigation — each of which would have needed its own
 * check, and one of them would have been forgotten. Gating the VIEW means every
 * route into the conversation passes through here by construction.
 *
 * The copy says what the lock is, because a screen that implies it is a permission
 * would be a lie: anyone in the group still has the messages, and the same account
 * on another device shows them unlocked.
 */
/*
 * NO `onUnlocked` CALLBACK, deliberately. `attemptOpenGroup` notifies the module's
 * own subscribers, and the conversation view already subscribes via
 * `useGroupLocks()` — so it re-renders and this gate unmounts. A callback as well
 * would be a SECOND mechanism for one transition, and the one that gets forgotten
 * is how a correct unlock leaves the gate on screen.
 */
export function GroupLockGate({
  conversationId,
  title,
}: {
  conversationId: number;
  title: string;
}) {
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-focus when the conversation changes, so switching between two locked groups
  // does not leave the caret in the old one's field.
  useEffect(() => {
    setCode("");
    setWrong(false);
    inputRef.current?.focus();
  }, [conversationId]);

  async function submit(value: string) {
    if (busy || !isValidLockCode(value)) return;
    setBusy(true);
    try {
      // ONE rule, and it lives in the module: the group code opens for the session,
      // the app passcode REMOVES the lock (the recovery). Deciding that here would
      // put the recovery policy in a component and let a second caller disagree.
      const r = await attemptOpenGroup(conversationId, value);
      if (r === "recovered") {
        toast.success("Lock removed with your app passcode. Set a new one from the group's details.");
      }
      // On success the module notifies and the conversation view re-renders this
      // gate away — nothing to call here.
      if (r !== "no") return;
      setWrong(true);
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-muted/50 text-muted-foreground">
        <Lock className="size-7" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold tracking-tight" dir="auto">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">Locked on this device. Enter the 4-digit code.</p>
      </div>

      <input
        ref={inputRef}
        // `inputMode="numeric"` rather than `type="number"`, which brings spinners,
        // accepts "1e4" and drops a leading zero — the v2.99.75 reasoning.
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        dir="ltr"
        value={code}
        aria-label="Group lock code"
        aria-invalid={wrong || undefined}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
          setCode(v);
          setWrong(false);
          // Auto-submit on the fourth digit, like the app lock: a separate Unlock
          // tap adds a step to something that can only ever be four characters.
          if (v.length === 4) void submit(v);
        }}
        className={
          "w-40 rounded-2xl border bg-card px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] tabular-nums outline-none " +
          (wrong ? "border-destructive" : "border-border focus-visible:border-ring")
        }
      />
      {wrong && (
        <p role="alert" className="text-sm font-medium text-destructive">
          That code doesn&apos;t match. Try again.
        </p>
      )}

      {/* WHAT THE LOCK IS, said plainly. Without this the screen reads as "you are
          not allowed in", which is not true and would be a promise the code cannot
          keep — every member still has these messages, and this account on another
          device shows them unlocked. */}
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        <ShieldQuestion className="mb-0.5 me-1 inline size-3.5" aria-hidden="true" />
        This hides the chat on this device only. Everyone in the group still has these
        messages, and your other devices still show them.
      </p>
      {/* THE RECOVERY, offered HERE rather than in the group's details, because the
          details sit behind this gate — a code you have forgotten would otherwise
          have no route back at all. Entering the app passcode removes the lock
          outright, so it is not a question you have to answer again next session. */}
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground/80">
        Forgotten it? Enter your app passcode instead — that removes the lock.
      </p>
    </div>
  );
}
