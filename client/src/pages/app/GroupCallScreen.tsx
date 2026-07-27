import { useMemo, useState } from "react";
import { X, Users, Plus, Check, Video, Phone, Search, Radio, Copy, Share2, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRelayEngine } from "@/app/RelayEngine";
import { presenceDot } from "@/app/presenceDot";
import { matchQuery } from "@/app/searchMatch";

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
    const n = manual.replace(/\D/g, "").slice(0, 6);
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
        <PartyLinesSection />

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
              onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
              placeholder="Add a number (6 digits)"
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

function fmtNum(n: string): string {
  return n.length === 6 ? `${n.slice(0, 3)} ${n.slice(3)}` : n;
}

/**
 * Party lines (v2.89): create a dialable ROOM number, list the ones you own
 * (with live head-counts), copy/share the dial-in, delete. Collapsed by
 * default so the group-call picker stays clean. Sharing reuses the /i/<pin>
 * invite-link pattern — opening the link auto-dials the line.
 */
function PartyLinesSection() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const lines = trpc.partyLines.list.useQuery(undefined, {
    enabled: open,
    refetchInterval: open ? 15_000 : false, // keep "N on the line" fresh
  });
  const createLine = trpc.partyLines.create.useMutation({
    onSuccess: (line) => {
      utils.partyLines.list.invalidate();
      setTitle("");
      toast.success(`Party line created — its number is ${fmtNum(line.number)}`);
    },
    onError: (err) => toast.error(err.message || "Couldn't create the party line."),
  });
  const removeLine = trpc.partyLines.remove.useMutation({
    onSuccess: () => {
      utils.partyLines.list.invalidate();
      toast.success("Party line deleted");
    },
    onError: (err) => toast.error(err.message || "Couldn't delete the party line."),
  });

  function shareLine(l: { title: string; number: string }) {
    const url = `${window.location.origin}/i/${l.number}`;
    const text = `Join "${l.title}" on RELAY — dial ${fmtNum(l.number)}`;
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
      ?.writeText(`${l.title} — dial ${fmtNum(l.number)} on RELAY or open ${window.location.origin}/i/${l.number}`)
      .then(() => toast.success("Dial-in copied"))
      .catch(() => toast.error("Couldn't copy"));
  }

  return (
    <div className="shrink-0 border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <Radio className="size-4 text-violet-400" />
        <span className="flex-1 text-sm font-medium">Party lines</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Manage"}</span>
        <ChevronDown className={"size-4 text-muted-foreground transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3">
          <p className="text-xs text-muted-foreground">
            A party line is a room with its own 6-digit number — anyone who dials it
            lands in the same call. No ringing, no invites: just share the number.
          </p>
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
              onClick={() => createLine.mutate({ title: title.trim() })}
              disabled={!title.trim() || createLine.isPending}
            >
              {createLine.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
          {lines.isLoading ? (
            <div className="py-1 text-xs text-muted-foreground">Loading…</div>
          ) : (lines.data?.length ?? 0) === 0 ? (
            <div className="py-1 text-xs text-muted-foreground">No party lines yet.</div>
          ) : (
            (lines.data ?? []).map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.title}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {fmtNum(l.number)}
                    {l.liveCount > 0 ? (
                      <span className="ml-1.5 font-sans font-medium text-[color:var(--relay-online)]">
                        · {l.liveCount} on the line
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Copy dial-in for ${l.title}`} title="Copy dial-in" onClick={() => copyLine(l)}>
                  <Copy className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Share ${l.title}`} title="Share invite link" onClick={() => shareLine(l)}>
                  <Share2 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${l.title}`}
                  title="Delete this party line"
                  disabled={removeLine.isPending}
                  onClick={() => removeLine.mutate({ id: l.id })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
