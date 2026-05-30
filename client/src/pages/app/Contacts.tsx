import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Phone, MessageSquare, Star, StarOff, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "??";
}

function relativeTime(d: Date | string | null): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function ContactsPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const contacts = trpc.contacts.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
  });
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => setLocation(`/app/messages?c=${res.conversationId}`),
  });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{
    id?: number;
    number: string;
    displayName: string;
    notes: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = contacts.data ?? [];
    return list
      .filter(
        (c) =>
          !q ||
          (c.displayName?.toLowerCase().includes(q) ?? false) ||
          c.number.includes(q)
      )
      .sort((a, b) => {
        if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (a.displayName || a.number).localeCompare(b.displayName || b.number);
      });
  }, [contacts.data, search]);

  return (
    <div className="h-full md:p-6 flex flex-col gap-4">
      <header className="px-4 md:px-0 flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Contacts</h2>
        <Button
          onClick={() =>
            setEditing({ id: undefined, number: "", displayName: "", notes: "" })
          }
          size="sm"
        >
          <UserPlus className="size-4 mr-1.5" /> Add
        </Button>
      </header>
      <div className="px-4 md:px-0">
        <Input
          placeholder="Search by name or number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11"
        />
      </div>
      <div className="flex-1 overflow-y-auto md:rounded-2xl md:border md:border-border md:bg-card">
        {contacts.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <p>{search ? "No matches." : "No contacts yet."}</p>
            <p className="mt-1">Tap “Add” or dial a number to save someone.</p>
          </div>
        ) : (
          <ul>
            {filtered.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <div className="relative shrink-0">
                  <div className="size-11 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold text-sm">
                    {initialsFrom(c.displayName || c.number)}
                  </div>
                  <span
                    className={
                      "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card " +
                      (c.isOnline
                        ? "bg-[color:var(--relay-online)]"
                        : "bg-[color:var(--relay-offline)]")
                    }
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    {c.favourite && <Star className="size-3.5 text-primary fill-primary" />}
                    {c.displayName || c.number}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {c.number} ·{" "}
                    {c.isOnline ? (
                      <span className="text-[color:var(--relay-online)]">online</span>
                    ) : (
                      <>last seen {relativeTime(c.lastSeenAt)}</>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Favorite"
                    onClick={() =>
                      upsert.mutate({
                        number: c.number,
                        displayName: c.displayName,
                        favourite: !c.favourite,
                      })
                    }
                  >
                    {c.favourite ? (
                      <StarOff className="size-4" />
                    ) : (
                      <Star className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Edit"
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        number: c.number,
                        displayName: c.displayName ?? "",
                        notes: c.notes ?? "",
                      })
                    }
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete"
                    onClick={() => {
                      if (confirm(`Remove ${c.displayName || c.number}?`)) {
                        remove.mutate({ id: c.id });
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Message"
                  onClick={() => openThread.mutate({ number: c.number })}
                >
                  <MessageSquare className="size-4" />
                </Button>
                <Button
                  size="icon"
                  aria-label="Call"
                  onClick={() => setLocation(`/app/call?to=${encodeURIComponent(c.number)}`)}
                >
                  <Phone className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card border border-border p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{editing.id ? "Edit contact" : "Add contact"}</h3>
              <Button size="icon" variant="ghost" onClick={() => setEditing(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                  Number
                </label>
                <Input
                  value={editing.number}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      number: e.target.value.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  disabled={!!editing.id}
                  placeholder="6-digit number"
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                  Display name
                </label>
                <Input
                  value={editing.displayName}
                  onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                  placeholder="Friend's name"
                  maxLength={64}
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                  Notes
                </label>
                <Textarea
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={3}
                  maxLength={500}
                />
              </div>
              {upsert.error && (
                <p className="text-sm text-destructive">{upsert.error.message}</p>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  upsert.mutate(
                    {
                      number: editing.number,
                      displayName: editing.displayName.trim() || null,
                      notes: editing.notes.trim() || null,
                    },
                    { onSuccess: () => setEditing(null) }
                  );
                }}
                disabled={editing.number.length !== 6 || upsert.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
