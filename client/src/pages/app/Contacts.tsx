import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Phone,
  MessageSquare,
  Star,
  StarOff,
  Pencil,
  Trash2,
  UserPlus,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
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
    email?: string;
    phone?: string;
    company?: string;
    jobTitle?: string;
    website?: string;
    birthday?: string;
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
                  {/* Presence dot — fully hidden for a guest inactive >24h (privacy). */}
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
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    {c.favourite && <Star className="size-3.5 text-primary fill-primary" />}
                    {c.displayName || c.number}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {c.number}
                    {c.presenceHidden ? null : c.isOnline ? (
                      <> · <span className="text-[color:var(--relay-online)]">online</span></>
                    ) : (
                      <> · last seen {relativeTime(c.lastSeenAt)}</>
                    )}
                  </div>
                  {(c.company || c.jobTitle) && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {[c.jobTitle, c.company].filter(Boolean).join(" · ")}
                    </div>
                  )}
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
                        email: c.email ?? "",
                        phone: c.phone ?? "",
                        company: c.company ?? "",
                        jobTitle: c.jobTitle ?? "",
                        website: c.website ?? "",
                        birthday: c.birthday ?? "",
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
                  onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(c.number)}`)}
                >
                  <Phone className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <AddContactDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(values) =>
            upsert.mutate(values, {
              onSuccess: () => setEditing(null),
            })
          }
          saving={upsert.isPending}
          error={upsert.error?.message ?? null}
        />
      )}
    </div>
  );
}

/* ============================================================
   Add / Edit contact dialog with live PIN preview.

   When the user types a complete 6-digit number, we hit
   `directory.lookup` so they can confirm avatar, display name,
   and online/offline status BEFORE saving. Found numbers also
   prefill the display name field if the user hasn't typed one.
   ============================================================ */
function AddContactDialog({
  editing,
  onClose,
  onSave,
  saving,
  error,
}: {
  editing: {
    id?: number;
    number: string;
    displayName: string;
    notes: string;
    email?: string;
    phone?: string;
    company?: string;
    jobTitle?: string;
    website?: string;
    birthday?: string;
  };
  onClose: () => void;
  onSave: (values: {
    number: string;
    displayName: string | null;
    notes: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    jobTitle: string | null;
    website: string | null;
    birthday: string | null;
    favourite?: boolean;
  }) => void;
  saving: boolean;
  error: string | null;
}) {
  const [number, setNumber] = useState(editing.number);
  const [displayName, setDisplayName] = useState(editing.displayName);
  const [notes, setNotes] = useState(editing.notes);
  const [email, setEmail] = useState(editing.email ?? "");
  const [phone, setPhone] = useState(editing.phone ?? "");
  const [company, setCompany] = useState(editing.company ?? "");
  const [jobTitle, setJobTitle] = useState(editing.jobTitle ?? "");
  const [website, setWebsite] = useState(editing.website ?? "");
  const [birthday, setBirthday] = useState(editing.birthday ?? "");
  const [touchedName, setTouchedName] = useState(
    Boolean(editing.displayName)
  );

  const lookup = trpc.directory.lookup.useQuery(
    { number },
    {
      enabled: !editing.id && number.length === 6,
      // Don't refetch as the user re-opens the dialog — 12s is plenty
      // for staleness on a presence-aware UI.
      staleTime: 12_000,
      retry: false,
    }
  );

  // Auto-fill the display name from the lookup unless the user has
  // already typed something into the field themselves.
  useEffect(() => {
    if (editing.id) return;
    if (touchedName) return;
    if (lookup.data?.displayName) {
      setDisplayName(lookup.data.displayName);
    }
  }, [editing.id, lookup.data, touchedName]);

  const isComplete = number.length === 6;
  const isLooking = isComplete && lookup.isFetching;
  const found = isComplete && lookup.data;
  const notFound =
    isComplete && !lookup.isFetching && lookup.data === null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col max-h-[90dvh] rounded-2xl bg-card border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 pb-3 shrink-0 border-b border-border/60">
          <h3 className="font-semibold">
            {editing.id ? "Edit contact" : "Add by PIN"}
          </h3>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {/* Scrollable body so the form never pushes the Save button off-screen
            on small/mobile viewports (the bug where "Save" was unreachable). */}
        <div className="space-y-4 p-5 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              RELAY number
            </label>
            <div className="relative">
              <Input
                value={number}
                onChange={(e) =>
                  setNumber(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={!!editing.id}
                placeholder="e.g. 482015"
                inputMode="numeric"
                autoFocus={!editing.id}
                className="font-mono text-lg tracking-[0.35em] pl-10"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            </div>
            {!editing.id && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Type a 6-digit RELAY number to preview the user.
              </p>
            )}
          </div>

          {/* Live preview card */}
          {!editing.id && isComplete && (
            <div
              className={
                "rounded-2xl border p-4 transition-all duration-200 " +
                (found
                  ? "border-primary/40 bg-primary/5"
                  : notFound
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-muted/20")
              }
            >
              {isLooking ? (
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-2xl bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ) : found ? (
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    {lookup.data!.avatarUrl ? (
                      <img
                        src={lookup.data!.avatarUrl}
                        alt={lookup.data!.displayName}
                        className="size-12 rounded-2xl object-cover border border-border"
                      />
                    ) : (
                      <div className="size-12 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold">
                        {initialsFrom(
                          lookup.data!.displayName || lookup.data!.number
                        )}
                      </div>
                    )}
                    <span
                      className={
                        "absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card " +
                        (lookup.data!.isOnline
                          ? "bg-[color:var(--relay-online)]"
                          : "bg-[color:var(--relay-offline)]")
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate flex items-center gap-1.5">
                      {lookup.data!.displayName || lookup.data!.number}
                      <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {lookup.data!.number}
                      {lookup.data!.presenceHidden ? null : lookup.data!.isOnline ? (
                        <>
                          {" · "}
                          <span className="text-[color:var(--relay-online)] font-medium">
                            online
                          </span>
                        </>
                      ) : (
                        <span> · offline</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : notFound ? (
                <div className="flex items-center gap-3 text-destructive-foreground">
                  <div className="size-10 rounded-2xl bg-destructive/15 grid place-items-center text-destructive">
                    <AlertCircle className="size-5" />
                  </div>
                  <div className="text-sm">
                    <div className="font-medium text-foreground">
                      No RELAY user with this number
                    </div>
                    <div className="text-xs text-muted-foreground">
                      You can still save it — they'll show up once they
                      register.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              Display name
            </label>
            <Input
              value={displayName}
              onChange={(e) => {
                setTouchedName(true);
                setDisplayName(e.target.value);
              }}
              placeholder="Friend's name"
              maxLength={64}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                maxLength={320}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Phone
              </label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 0100"
                maxLength={40}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Company
              </label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company"
                maxLength={128}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Title / role
              </label>
              <Input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Title"
                maxLength={128}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Website
              </label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="example.com"
                maxLength={256}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                Birthday
              </label>
              <Input
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                placeholder="e.g. Mar 14"
                maxLength={32}
              />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              Notes
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        {/* Sticky footer — always visible regardless of form length. */}
        <div className="shrink-0 flex items-center justify-end gap-2 p-4 border-t border-border/60 bg-card rounded-b-2xl">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                number,
                displayName: displayName.trim() || null,
                notes: notes.trim() || null,
                email: email.trim() || null,
                phone: phone.trim() || null,
                company: company.trim() || null,
                jobTitle: jobTitle.trim() || null,
                website: website.trim() || null,
                birthday: birthday.trim() || null,
              })
            }
            disabled={number.length !== 6 || saving}
          >
            {editing.id ? "Save" : "Add to contacts"}
          </Button>
        </div>
      </div>
    </div>
  );
}
