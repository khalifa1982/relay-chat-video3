import { useMemo, useState } from "react";
import { X, Users, Plus, Check, Video, Phone, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRelayEngine } from "@/app/RelayEngine";

const MAX_PARTICIPANTS = 10;

function initials(name: string): string {
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

/**
 * Create-group-call picker. Select up to 10 participants from contacts or add
 * numbers manually, then start the call — the engine rings everyone into one
 * room (first to accept joins; the rest keep ringing). Dismissible via the X,
 * a backdrop click, or Cancel.
 */
export function GroupCallScreen({ onClose }: { onClose: () => void }) {
  const engine = useRelayEngine();
  const contacts = trpc.contacts.list.useQuery(undefined, { staleTime: 15_000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState("");
  // Voice-first (v2.81 protocol, applied here in v2.88): a group call starts
  // camera-OFF unless the user explicitly picks Video — this was the last
  // video-default dial site.
  const [voice, setVoice] = useState(true);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (contacts.data ?? []).filter(
      (c) =>
        !q ||
        (c.displayName?.toLowerCase().includes(q) ?? false) ||
        c.number.includes(q)
    );
  }, [contacts.data, search]);

  const nameByNumber = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts.data ?? []) m.set(c.number, c.displayName || c.number);
    return m;
  }, [contacts.data]);

  const atLimit = selected.size >= MAX_PARTICIPANTS;

  function toggle(number: string) {
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
                        {/* presence dot — hidden for >24h-inactive guests */}
                        {!c.presenceHidden && (
                          <span
                            className={
                              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card " +
                              (c.isOnline
                                ? "bg-[color:var(--relay-online)]"
                                : "bg-[color:var(--relay-offline)]")
                            }
                          />
                        )}
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
