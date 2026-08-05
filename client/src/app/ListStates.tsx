import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE ONE WAY A LIST SAYS "LOADING" (v2.107.41).
 *
 * The audit that produced this found ELEVEN surfaces announcing a load with a
 * bare grey sentence — admin search, three admin consoles (which showed nothing
 * at all while loading), call history, the group-call roster and its lines,
 * the thread list, the in-conversation history, message search, the account
 * gate — while a handful of others spun a `Loader2`. Same app, same moment,
 * five different faces.
 *
 * This is that face, singular. Three decisions inside it:
 *
 *   THE LABEL STAYS. A spinner-only state reads as "something is happening" to
 *   a sighted user and as NOTHING to a screen reader; every call site already
 *   owned a translated sentence, so the unification keeps the words and adds
 *   the motion — nothing bilingual was lost to make something prettier.
 *
 *   `role="status"`. A polite live region, so assistive tech announces the
 *   wait once, unprompted, and moves on — the exact semantics of what the
 *   pixel is doing.
 *
 *   NOT for skeletons. Contacts renders five ghost rows while loading because
 *   it KNOWS its row shape, and a skeleton that matches the incoming layout is
 *   strictly better than any spinner — that surface is deliberately exempt,
 *   and the sweep pin names it so nobody "unifies" it downward.
 */
export function ListLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
