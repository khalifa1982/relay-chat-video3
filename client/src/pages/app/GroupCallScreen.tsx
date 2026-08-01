import { useMemo, useState } from "react";
import {
  X,
  Users,
  Plus,
  Check,
  Video,
  Phone,
  Search,
  Radio,
  Copy,
  Share2,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PIN_INPUT_MAXLENGTH, capPinInput, pinDigits } from "@/app/pinInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRelayEngine } from "@/app/RelayEngine";
import { presenceDot } from "@/app/presenceDot";
import { matchQuery } from "@/app/searchMatch";
import { formatPin } from "@/app/TopBar";
import { formatElapsedSince } from "@shared/profileFields";

function initials(name: string): string {
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

/**
 * Create-group-call picker. Select up to the transport's cap (mesh 6 / SFU 10)
 * participants from contacts or add numbers manually, then start the call — the
 * engine rings everyone into one room (first to accept joins; the rest keep
 * ringing). Dismissible via the X, a backdrop click, or Cancel.
 */
export function GroupCallScreen({ onClose }: { onClose: () => void }) {
  const engine = useRelayEngine();
  // Cap selection to what the ACTIVE transport can actually connect. QA M19:
  // engine.maxParticipants is the TOTAL room cap (mesh 6 / SFU 10) INCLUDING the
  // caller, but this picker counts the OTHERS to invite — so reserve the
  // caller's own slot (−1), or the last person to accept hits a full room and
  // bounces with error{full}.
  const MAX_PARTICIPANTS = Math.max(1, engine.maxParticipants - 1);
  const contacts = trpc.contacts.list.useQuery(undefined, { staleTime: 15_000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState("");
  // Voice-first (v2.81 protocol, applied here in v2.88): a group call starts
  // camera-OFF unless the user explicitly picks Video — this was the last
  // video-default dial site.
  const [voice, setVoice] = useState(true);

  const list = useMemo(
    // Same shared rule as Contacts (v2.99.96) — this picker had an independent copy
    // of the old substring test, so a number typed as `777-777` found nobody here
    // either, and the two screens could disagree about the same query.
    () => (contacts.data ?? []).filter((c) => matchQuery(search, [c.displayName, c.liveName, c.number])),
    [contacts.data, search]
  );

  const nameByNumber = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts.data ?? []) m.set(c.number, c.displayName || c.number);
    return m;
  }, [contacts.data]);

  const atLimit = selected.size >= MAX_PARTICIPANTS;

  function toggle(number: string) {
    if (number === engine.pin) return; // QA L7: you can't group-call yourself
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else if (next.size < MAX_PARTICIPANTS) next.add(number);
      return next;
    });
  }

  function addManual() {
    const n = pinDigits(manual);
    if (!/^\d{6}$/.test(n)) return;
    // QA L7: reject the caller's OWN number — programmaticGroupDial silently
    // drops it anyway, which used to burn an invitee slot at the mesh cap and
    // show the host as a participant of their own call.
    if (n === engine.pin) { setManual(""); return; }
    if (selected.size >= MAX_PARTICIPANTS) return;
    setSelected((prev) => new Set(prev).add(n));
    setManual("");
  }

  function start() {
    const nums = Array.from(selected);
    if (nums.length === 0) return;
    const ok = engine.dialGroup(nums, { voice });
    if (ok) onClose();
  }

  const selectedArr = Array.from(selected);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h3 className="font-semibold">Create group call</h3>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {/* Party lines (v2.89): dialable room numbers you own. */}
        <PartyLinesSection onJoined={onClose} />

        {/* Selected chips */}
        {selectedArr.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/60 p-3">
            {selectedArr.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs font-medium text-primary"
              >
                {nameByNumber.get(n) ?? n}
                <button
                  type="button"
                  aria-label={`Remove ${n}`}
                  onClick={() => toggle(n)}
                  className="rounded-full hover:bg-primary/20"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <span className="self-center text-xs text-muted-foreground">
              {selected.size}/{MAX_PARTICIPANTS}
            </span>
          </div>
        )}

        {/* Manual add + search */}
        <div className="shrink-0 space-y-2 border-b border-border/60 p-3">
          <div className="flex gap-2">
            <Input
              value={manual}
              // v2.106.65 — dropped rather than folded (see pinInput.ts), and the browser's
              // own cap now agrees with ours instead of being absent entirely.
              onChange={(e) => setManual(capPinInput(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
              placeholder="Add a number (6 digits)"
              maxLength={PIN_INPUT_MAXLENGTH}
              inputMode="numeric"
              className="font-mono tracking-widest"
              disabled={atLimit}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addManual}
              disabled={manual.length !== 6 || atLimit}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts"
              className="pl-9"
            />
          </div>
        </div>

        {/* Contact list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {contacts.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {search ? "No matches." : "No contacts yet — add numbers above."}
            </div>
          ) : (
            <ul>
              {list.map((c) => {
                const on = selected.has(c.number);
                const disabled = !on && atLimit;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(c.number)}
                      className={
                        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-40 " +
                        (on ? "bg-primary/10" : "hover:bg-muted/40")
                      }
                    >
                      <div className="relative shrink-0">
                        <div className="grid size-10 place-items-center rounded-2xl bg-primary/15 text-sm font-bold text-primary">
                          {initials(c.displayName || c.number)}
                        </div>
                        {/* Presence dot — hidden for >24h-inactive guests.
                            v2.99.95: folded onto `presenceDot`, the one rule every
                            LED in the app shares. It was the last inline copy that
                            knew nothing about `idle`, so a backgrounded person read
                            here as plain online while Contacts said "away". */}
                        {!c.presenceHidden && (() => {
                          const dot = presenceDot({ isOnline: c.isOnline, idle: c.idle });
                          return (
                            <span
                              aria-label={dot.label}
                              title={dot.label}
                              className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card"
                              style={{ background: dot.color, boxShadow: dot.glow || undefined }}
                            />
                          );
                        })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.displayName || c.number}</div>
                        <div className="font-mono text-xs text-muted-foreground">{c.number}</div>
                      </div>
                      <span
                        className={
                          "grid size-6 shrink-0 place-items-center rounded-full border " +
                          (on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-transparent")
                        }
                      >
                        <Check className="size-3.5" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer: voice/video toggle + start */}
        <div className="shrink-0 space-y-3 border-t border-border/60 p-4">
          <div className="flex items-center justify-center gap-2">
            {/* Voice leads (v2.88): it's the default, so it comes first. */}
            <button
              type="button"
              onClick={() => setVoice(true)}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition " +
                (voice ? "text-white" : "bg-muted text-muted-foreground")
              }
              style={voice ? { background: "#2563eb" } : undefined}
            >
              <Phone className="size-4" /> Voice
            </button>
            <button
              type="button"
              onClick={() => setVoice(false)}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition " +
                (!voice ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              <Video className="size-4" /> Video
            </button>
          </div>
          <Button className="w-full" disabled={selected.size === 0} onClick={start}>
            Start group call{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Party lines (v2.89; board 5a in v2.106.22): create a dialable ROOM number,
 * list the ones you own (with live head-counts), JOIN one, copy/share the
 * dial-in, delete. Collapsed by default so the group-call picker stays clean.
 * Sharing reuses the /i/<pin> invite-link pattern — opening the link auto-dials
 * the line.
 *
 * BOARD 5a, AND THE THREE ITEMS DELIBERATELY NOT TAKEN — each of them would be a
 * UI asserting a mechanism that does not exist:
 *
 *  - "PIN required to join" + the gold lock. There is NO party-line passcode
 *    anywhere: `party_lines` has no pin column and `joinPartyLine` performs no
 *    admission check beyond having an identity, so anyone who dials the number
 *    lands in the room. A lock glyph on this screen would tell the owner their
 *    line is gated when it is wide open, which is worse than saying nothing. It
 *    also cannot be borrowed from the v2.105.20 group lock, which is explicitly
 *    a PER-DEVICE privacy screen over content the device already holds rather
 *    than server-enforced admission.
 *  - "· hosted by you". `joinPartyLine` sets `hostPin: null` on purpose — "a
 *    party line has no host (its owner may never dial in)" — so as a statement
 *    about the live call it is false, and as a statement about ownership it is
 *    vacuous, because `partyLines.list` is owner-scoped and EVERY row here is
 *    already yours.
 *  - "Quiet — last used Tue". There is no `lastUsedAt` column and nothing writes
 *    one; the subline reports the line's CREATION age instead, which is a fact
 *    the query already carries.
 *
 * `liveCount: 0` also means "the registry was unreadable" (no signaling node,
 * empty Redis mirror), so nothing below ever asserts a line is EMPTY — the same
 * refusal v2.105.25 made on the sibling invite screen.
 */
export function PartyLinesSection({
  onJoined,
  defaultOpen = false,
}: {
  onJoined: () => void;
  /**
   * v2.106.64 — the Groups tab mounts this OPEN, because there it IS the section the
   * owner asked for ("in the group section you will have a group call and group
   * message") rather than a fold-out inside a dial picker. ONE component with two
   * mounts, never a second copy: two party-line lists is how the two come to disagree
   * about which lines exist, and the `enabled: open` query means a closed mount still
   * costs nothing.
   */
  defaultOpen?: boolean;
}) {
  const engine = useRelayEngine();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState("");
  /** Which row's manage card is expanded (in flow, below the list). */
  const [manageId, setManageId] = useState<number | null>(null);
  /** The row a delete confirmation is open for. */
  const [deleting, setDeleting] = useState<{ id: number; title: string; number: string } | null>(null);
  const lines = trpc.partyLines.list.useQuery(undefined, {
    enabled: open,
    refetchInterval: open ? 15_000 : false, // keep "N on the line" fresh
  });
  const createLine = trpc.partyLines.create.useMutation({
    onSuccess: (line) => {
      utils.partyLines.list.invalidate();
      setTitle("");
      toast.success(`Party line created — its number is ${formatPin(line.number)}`);
    },
    onError: (err) => toast.error(err.message || "Couldn't create the party line."),
  });
  const removeLine = trpc.partyLines.remove.useMutation({
    onSuccess: () => {
      utils.partyLines.list.invalidate();
      setManageId(null);
      toast.success("Party line deleted");
    },
    onError: (err) => toast.error(err.message || "Couldn't delete the party line."),
  });

  function shareLine(l: { title: string; number: string }) {
    const url = `${window.location.origin}/i/${l.number}`;
    const text = `Join "${l.title}" on RELAY — dial ${formatPin(l.number)}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title: text, text, url }).catch(() => {});
    } else {
      navigator.clipboard
        ?.writeText(`${text}\n${url}`)
        .then(() => toast.success("Invite copied"))
        .catch(() => toast.error("Couldn't copy the invite"));
    }
  }
  function copyLine(l: { title: string; number: string }) {
    navigator.clipboard
      ?.writeText(`${l.title} — dial ${formatPin(l.number)} on RELAY or open ${window.location.origin}/i/${l.number}`)
      .then(() => toast.success("Dial-in copied"))
      .catch(() => toast.error("Couldn't copy"));
  }

  const rows = lines.data ?? [];
  /** The cap the server already reports; no second copy of the number 10. */
  const maxLines = rows[0]?.max ?? MAX_PARTY_LINES_FALLBACK;
  const atOwnerCap = rows.length >= maxLines;
  /**
   * Joining is a real dial, so it is only offered when the engine can perform
   * one — `programmaticDial` requires `!inCall` and would otherwise return
   * false, i.e. a control whose handler silently does nothing (v2.103.3). The
   * gate is the RENDER condition, never an early return in the handler.
   */
  const canJoin = engine.ready && engine.phase === "idle";
  /**
   * A party line's cap counts EVERYONE who dials in, the caller included — so it
   * is the transport's own room cap and deliberately NOT the picker's
   * MAX_PARTICIPANTS, which is cap−1 because it counts invitees.
   */
  const lineCap = engine.maxParticipants;
  const managed = manageId == null ? null : rows.find((r) => r.id === manageId) ?? null;
  const now = Date.now();

  function joinLine(l: { number: string; title: string }) {
    // The same call the Dialer's own party-line Join makes. Nothing rings.
    // CLOSING THE PICKER ON SUCCESS is not cosmetic: `start()` does it for a
    // group dial, and without it the user lands in a live call with this modal
    // still over the top of it.
    const ok = engine.dial(l.number, { voice: true, displayName: l.title });
    if (ok) onJoined();
  }

  return (
    <div className="shrink-0 border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <Radio className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">Party lines</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Manage"}</span>
        <ChevronDown className={"size-4 text-muted-foreground transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3">
          {/* The board's mono caption. The cap is read from the live transport,
              never the frame's literal 10 — every call runs the mesh, whose cap is
              6, so a hardcoded 10 would be a false claim about capacity (the
              v2.106.9 argument). */}
          <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
            Dial the number — you drop straight in · up to {lineCap}
          </p>
          <p className="text-xs text-muted-foreground">
            A party line is a room with its own 6-digit number — anyone who dials it
            lands in the same call. No ringing, no invites: just share the number.
          </p>
          {atOwnerCap ? (
            // Rule 5: at the cap the field is ABSENT rather than a button that
            // always refuses. `max` was already on the wire and read by nothing,
            // so before this you typed a name and got a server refusal.
            <p className="text-xs text-muted-foreground">
              You have all {maxLines} party lines — delete one to make room.
            </p>
          ) : (
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 64))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim()) createLine.mutate({ title: title.trim() });
                }}
                placeholder="Line name (e.g. Family room)"
              />
              <Button
                type="button"
                className="rcta shrink-0"
                onClick={() => createLine.mutate({ title: title.trim() })}
                disabled={!title.trim() || createLine.isPending}
              >
                {createLine.isPending ? "Creating…" : "New line"}
              </Button>
            </div>
          )}
          {lines.isLoading ? (
            <div className="py-1 text-xs text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-1 text-xs text-muted-foreground">No party lines yet.</div>
          ) : (
            rows.map((l) => {
              const live = l.liveCount > 0;
              return (
                // A DIV holding buttons: nested buttons are invalid HTML, the
                // rule this repo follows on thread rows, call tiles and the
                // v2.106.12 device row.
                // FLEX-WRAP + a floor on the text column, rather than letting
                // the text column be squeezed: MEASURED at 320px, the subline
                // needs 119px and a non-wrapping row gave it 63, so "Live · 4 on
                // the line" broke over THREE lines and the row grew to 94px. The
                // actions move to a second line instead, which keeps the number
                // pill, the subline and every 44px hit target intact — the
                // v2.106.19 lesson: fix the geometry by construction rather than
                // by nudging one value until it looks right.
                <div
                  key={l.id}
                  className="rglass flex flex-wrap items-center gap-[11px] rounded-[15px] px-3 py-2.5"
                  // A LITERAL fallback, never a self-referencing one: a custom-
                  // property CYCLE resolves to the guaranteed-invalid value and
                  // the browser DROPS the declaration, so a live row would have
                  // no border at all rather than a plain one (the v2.106.7 trap).
                  style={
                    live
                      ? { borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.35)" }
                      : undefined
                  }
                >
                  {/* The number is the row's identity and must never truncate.
                      `dir="ltr"` + bidi isolation so an Arabic line title cannot
                      reorder the digits. */}
                  <span
                    dir="ltr"
                    className="rchip-accent shrink-0 rounded-[12px] px-2 py-1 text-center font-mono text-[13px] font-semibold [unicode-bidi:isolate]"
                    style={{ minWidth: 64 }}
                  >
                    {formatPin(l.number)}
                  </span>
                  <div className="min-w-[120px] flex-1 basis-0">
                    <div className="truncate text-[13.5px] font-bold" dir="auto">
                      {l.title}
                    </div>
                    {live ? (
                      // ACCENT, not `--relay-online`: green means ONLINE and
                      // nothing else in this app (it is what every presence LED
                      // is drawn with, which is why v2.99.86/v2.106.9/v2.106.11
                      // each moved something off it), and a live ROOM is ACTIVE.
                      // It was also 12px text in the LED green, which fails AA
                      // at text sizes — the reason `--relay-green-text` exists.
                      <div
                        className="flex items-center gap-1.5 text-[11.5px] font-medium"
                        style={{ color: "var(--rb, #3FE0C5)" }}
                      >
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
                          style={{ background: "var(--rb, #3FE0C5)" }}
                        />
                        Live · {l.liveCount} on the line
                      </div>
                    ) : (
                      <div className="text-[11.5px] text-muted-foreground">
                        {createdAgo(l.createdAt, now)}
                      </div>
                    )}
                  </div>
                  {/* One group so the two controls stay together and stay
                      right-aligned on whichever line they land on. */}
                  <div className="ms-auto flex shrink-0 items-center gap-2">
                    {canJoin && (
                      <Button
                        type="button"
                        size="sm"
                        variant={live ? "default" : "secondary"}
                        className={"h-11 px-3" + (live ? " rcta" : "")}
                        aria-label={`Join ${l.title}`}
                        onClick={() => joinLine(l)}
                      >
                        Join
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-11"
                      aria-label={`Manage ${l.title}`}
                      aria-expanded={manageId === l.id}
                      onClick={() => setManageId((v) => (v === l.id ? null : l.id))}
                    >
                      <SlidersHorizontal className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
          {managed && (
            // IN FLOW rather than a portalled dialog — the frame's own structure
            // AND the safer one: this section already lives inside a `fixed`
            // modal, and an absolutely-positioned card over a row that can sit
            // at either edge needs measuring and clamping (the class that
            // clipped the ⋮ menu in v2.99.0). Paired with the theme tokens
            // because `.rsheet` is dark-scoped and declares nothing in light.
            <div className="rsheet space-y-2 rounded-[15px] border border-border bg-card p-3">
              <div className="text-[11px] font-bold" dir="auto">
                Manage “{managed.title}”
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-11"
                  onClick={() => copyLine(managed)}
                >
                  <Copy className="size-4" /> Copy dial-in
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-11"
                  onClick={() => shareLine(managed)}
                >
                  <Share2 className="size-4" /> Share number
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-11"
                  disabled={removeLine.isPending}
                  onClick={() => setDeleting({ id: managed.id, title: managed.title, number: managed.number })}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this party line?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone on the line right now keeps talking, and {deleting ? formatPin(deleting.number) : "the number"}{" "}
              stops resolving for new dials. That number won't come back — it's retired for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (deleting) removeLine.mutate({ id: deleting.id });
                setDeleting(null);
              }}
            >
              Delete line
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Last-resort cap label when the list is empty, so the copy is never blank. */
const MAX_PARTY_LINES_FALLBACK = 10;

/**
 * "Created 3h ago", reusing the app's ONE duration formatter rather than rolling
 * another (v2.106.12). Renders nothing for a missing value or a clock that has
 * gone backwards, which `formatElapsedSince` already answers as "".
 */
function createdAgo(createdAt: Date | string | number | null | undefined, nowMs: number): string {
  if (createdAt == null) return "";
  const ms = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const ago = formatElapsedSince(ms, nowMs);
  return ago ? `Created ${ago} ago` : "";
}
