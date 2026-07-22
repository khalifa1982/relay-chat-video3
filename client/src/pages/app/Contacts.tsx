import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Phone,
  PhoneCall,
  Video,
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
  MoreVertical,
  Ban,
  Crown,
  Users as UsersIcon,
  Home,
  Heart,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { VerifiedBadge } from "@/app/VerifiedBadge";
import { PeerAvatar, openPeerProfile } from "@/app/PeerOverlays";

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "??";
}

type Category = "vip" | "family" | "friend" | "team";
/** Ordered category sections. `favourite` (star) is its own leading section,
 *  then the explicit groups, then everyone else. */
const CATEGORY_META: Record<Category, { label: string; icon: typeof Crown; tint: string }> = {
  vip: { label: "VIP", icon: Crown, tint: "text-amber-400" },
  family: { label: "Family", icon: Home, tint: "text-rose-400" },
  friend: { label: "Friends", icon: Heart, tint: "text-sky-400" },
  team: { label: "Team", icon: UsersIcon, tint: "text-violet-400" },
};
const CATEGORY_ORDER: Category[] = ["vip", "family", "friend", "team"];

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
  // onError toasts (v2.88): a silently-failed favorite/block/delete/message
  // tap is the worst case — the row just doesn't change and the user retries
  // into the void. (The edit dialog surfaces upsert errors inline itself.)
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: (err) => toast.error(err.message || "Couldn't save that change."),
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: () => toast.error("Couldn't remove that contact — try again."),
  });
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => setLocation(`/app/messages?c=${res.conversationId}`),
    onError: (err) => toast.error(err.message || "Couldn't open that conversation."),
  });

  const [search, setSearch] = useState("");
  // Collapsible section state (the prototype's chevron headers). Presentational
  // only — a set of collapsed section keys; every section is expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Contact pending delete confirmation (AlertDialog, replacing window.confirm()).
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deletingContact = (contacts.data ?? []).find((c) => c.id === deleteId) ?? null;
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
    category?: Category | null;
  } | null>(null);

  // Shared by the desktop icon button AND the mobile dropdown menu item, so the
  // edit-state object isn't constructed twice.
  function openEdit(c: NonNullable<typeof contacts.data>[number]) {
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
      category: c.category ?? null,
    });
  }

  type Row = NonNullable<typeof contacts.data>[number];
  const filtered = useMemo<Row[]>(() => {
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
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (a.displayName || a.number).localeCompare(b.displayName || b.number);
      });
  }, [contacts.data, search]);

  // Group into sections: Favorites first (the star pin, cross-cuts categories),
  // then each explicit category, then "Other". Within a section, online-first.
  const sections = useMemo(() => {
    const favorites = filtered.filter((c) => c.favourite);
    const out: Array<{ key: string; label: string; icon: typeof Crown; tint: string; rows: Row[] }> = [];
    if (favorites.length) out.push({ key: "fav", label: "Favorites", icon: Star, tint: "text-amber-400", rows: favorites });
    for (const cat of CATEGORY_ORDER) {
      const rows = filtered.filter((c) => c.category === cat && !c.favourite);
      if (rows.length) out.push({ key: cat, ...CATEGORY_META[cat], rows });
    }
    const other = filtered.filter((c) => !c.favourite && !c.category);
    if (other.length) out.push({ key: "other", label: "All contacts", icon: UsersIcon, tint: "text-muted-foreground", rows: other });
    return out;
  }, [filtered]);

  return (
    <div className="flex-1 min-h-0 md:p-6 flex flex-col gap-4">
      {/* Top row: search field + violet "add by PIN" (opens the same Add dialog). */}
      <div className="px-4 md:px-0 pt-1 flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-10 rounded-xl bg-secondary/60"
          />
        </div>
        <button
          type="button"
          aria-label="Add by PIN"
          title="Add by PIN"
          onClick={() =>
            setEditing({ id: undefined, number: "", displayName: "", notes: "" })
          }
          className="grid place-items-center size-11 shrink-0 rounded-xl text-white transition hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
            boxShadow: "0 6px 16px -6px rgba(124,58,237,.6)",
          }}
        >
          <UserPlus className="size-[19px]" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto md:rounded-2xl md:glass-surface-md">
        {contacts.isLoading ? (
          <ul>
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-border last:border-b-0"
              >
                <Skeleton className="size-11 rounded-2xl shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-3.5 w-32 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <Empty className="border-none p-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserPlus />
              </EmptyMedia>
              <EmptyTitle>{search ? "No matches" : "No contacts yet"}</EmptyTitle>
              <EmptyDescription>
                {search
                  ? `Nobody matches "${search}".`
                  : "Save someone's number to call or message them in one tap."}
              </EmptyDescription>
            </EmptyHeader>
            {!search && (
              <EmptyContent>
                <Button
                  onClick={() =>
                    setEditing({ id: undefined, number: "", displayName: "", notes: "" })
                  }
                  size="sm"
                >
                  <UserPlus className="size-4 mr-1.5" /> Add a contact
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div>
            {sections.map((section) => {
              const SIcon = section.icon;
              const isCollapsed = collapsed.has(section.key);
              // "any member active" → the online pip on the sticky header.
              const anyActive = section.rows.some(
                (r) => !r.presenceHidden && (r.isOnline || r.inCall)
              );
              return (
                <section key={section.key}>
                  <button
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    className="sticky top-0 z-10 w-full flex items-center gap-2 px-4 md:px-5 py-2 bg-card/85 backdrop-blur-md border-b border-border/60 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3 shrink-0" strokeWidth={2.4} />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" strokeWidth={2.4} />
                    )}
                    <SIcon className={"size-3.5 shrink-0 " + section.tint} />
                    <span className="flex-1 text-left text-[11px] font-semibold uppercase tracking-widest">
                      {section.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">{section.rows.length}</span>
                    {anyActive && (
                      <span
                        aria-hidden
                        className="size-2 rounded-full shrink-0"
                        style={{ background: "#06d6a0" }}
                      />
                    )}
                  </button>
                  {!isCollapsed && (
                    <ul>
                      {section.rows.map((c) => (
                        <ContactRow
                          key={c.id}
                          c={c}
                          onVoice={() => setLocation(`/app/dialer?to=${encodeURIComponent(c.number)}&voice=1`)}
                          onVideo={() => setLocation(`/app/dialer?to=${encodeURIComponent(c.number)}&video=1`)}
                          onMessage={() => openThread.mutate({ number: c.number })}
                          onEdit={() => openEdit(c)}
                          onDelete={() => setDeleteId(c.id)}
                          onToggleFavorite={() =>
                            upsert.mutate({ number: c.number, favourite: !c.favourite })
                          }
                          onToggleBlock={() =>
                            upsert.mutate({ number: c.number, blocked: !c.blocked })
                          }
                          onSetCategory={(category) =>
                            upsert.mutate({ number: c.number, category: c.category === category ? null : category })
                          }
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
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

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingContact
                ? `${deletingContact.displayName || deletingContact.number} will be removed from your contacts. This can't be undone.`
                : "This contact will be removed. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId !== null) remove.mutate({ id: deleteId });
                setDeleteId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============================================================
   One contact row: avatar (photo + status ring) + presence LED, name +
   PIN + verified, online/last-seen, and inline actions — Message, Video,
   Voice, plus a 3-dot menu (Favorite / category / Block / Edit / Delete).
   v2.96 (owner spec): tapping the row's main area opens the PROFILE POPUP
   ("click anywhere on the name … see their profile, status, and avatar —
   in the contacts too"); the popup has one-tap Voice/Video/Message, and
   the green circle still voice-dials directly.
   ============================================================ */
function ContactRow({
  c,
  onVoice,
  onVideo,
  onMessage,
  onEdit,
  onDelete,
  onToggleFavorite,
  onToggleBlock,
  onSetCategory,
}: {
  c: {
    id: number;
    number: string;
    displayName: string | null;
    avatarUrl: string | null;
    favourite: boolean;
    verified: boolean;
    isOnline: boolean;
    /** Busy line (v2.88): in a live call right now. */
    inCall: boolean;
    lastSeenAt: Date | string | null;
    presenceHidden: boolean;
    company: string | null;
    jobTitle: string | null;
    category: Category | null;
    blocked: boolean;
  };
  onVoice: () => void;
  onVideo: () => void;
  onMessage: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onToggleBlock: () => void;
  onSetCategory: (cat: Category) => void;
}) {
  return (
    <li
      className={
        "flex items-center gap-3 px-4 md:px-5 py-2.5 border-b border-border/60 last:border-b-0 hover:bg-muted/30 transition-colors " +
        (c.blocked ? "opacity-60" : "")
      }
    >
      {/* Avatar is its own button (status ring → viewer / profile popup);
          it sits OUTSIDE the main-area button — nested buttons are invalid. */}
      <PeerAvatar
        number={c.number}
        name={c.displayName}
        avatarUrl={c.avatarUrl}
        size={42}
        rounded="rounded-2xl"
      >
        {/* Presence LED — amber "on a call" (v2.88 busy line) / green online /
            grey offline; hidden for a stale guest. */}
        {!c.presenceHidden && (
          <span
            aria-label={c.inCall ? "On a call" : c.isOnline ? "Online" : "Offline"}
            title={c.inCall ? "On a call right now" : undefined}
            className={
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card " +
              (c.inCall
                ? "bg-amber-400"
                : c.isOnline
                  ? "bg-[color:var(--relay-online)]"
                  : "bg-[color:var(--relay-offline)]")
            }
          />
        )}
      </PeerAvatar>
      {/* Main area → the peer PROFILE POPUP (v2.96 owner spec). */}
      <button
        type="button"
        onClick={() => openPeerProfile(c.number)}
        className="flex flex-1 min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
        aria-label={`View ${c.displayName || c.number}'s profile`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold truncate">{c.displayName || c.number}</span>
            {c.favourite && <Star className="size-3 shrink-0 text-amber-400 fill-amber-400" />}
            {c.verified && <VerifiedBadge size={14} />}
            {c.blocked && <Ban className="size-3.5 shrink-0 text-[#ff8d84]" />}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {c.number.length === 6 ? c.number.slice(0, 3) + "-" + c.number.slice(3) : c.number}
            {c.blocked ? (
              <> · <span className="text-[#ff8d84]">blocked</span></>
            ) : c.presenceHidden ? null : c.inCall ? (
              <> · <span className="text-amber-500">on a call</span></>
            ) : c.isOnline ? (
              <> · <span className="text-[color:var(--relay-online)]">online</span></>
            ) : (
              <> · last seen {relativeTime(c.lastSeenAt)}</>
            )}
          </div>
          {(c.company || c.jobTitle) && (
            <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
              {[c.jobTitle, c.company].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </button>

      {/* Inline actions: Message / Video / Voice + overflow menu — circular
          gradient tap targets (message orange, video blue, call green). */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          aria-label="Message"
          title="Message"
          onClick={onMessage}
          className="grid place-items-center size-[34px] rounded-full shrink-0 transition hover:brightness-110"
          style={{
            background: "linear-gradient(160deg, rgba(251,146,60,.26), rgba(251,146,60,.08))",
            color: "#fb923c",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
          }}
        >
          <MessageSquare className="size-[15px]" />
        </button>
        <button
          type="button"
          aria-label="Video call"
          title="Video call"
          onClick={onVideo}
          disabled={c.blocked}
          className="hidden xs:grid place-items-center size-[34px] rounded-full shrink-0 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(160deg, rgba(56,189,248,.26), rgba(56,189,248,.08))",
            color: "#38bdf8",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
          }}
        >
          <Video className="size-[15px]" />
        </button>
        <button
          type="button"
          aria-label="Voice call"
          title="Voice call"
          onClick={onVoice}
          disabled={c.blocked}
          className="grid place-items-center size-[34px] rounded-full shrink-0 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(160deg, rgba(34,197,94,.26), rgba(34,197,94,.08))",
            color: "#22c55e",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
          }}
        >
          <PhoneCall className="size-[15px]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More options"
              className="grid place-items-center size-[34px] rounded-full shrink-0 text-muted-foreground bg-secondary/60 hover:bg-secondary transition-colors"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onVideo} className="xs:hidden">
              <Video className="size-4" /> Video call
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleFavorite}>
              {c.favourite ? <><StarOff className="size-4" /> Unfavorite</> : <><Star className="size-4" /> Favorite</>}
            </DropdownMenuItem>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 pt-2">
              Category
            </DropdownMenuLabel>
            {CATEGORY_ORDER.map((cat) => {
              const CIcon = CATEGORY_META[cat].icon;
              const active = c.category === cat;
              return (
                <DropdownMenuItem key={cat} onClick={() => onSetCategory(cat)}>
                  <CIcon className={"size-4 " + CATEGORY_META[cat].tint} />
                  {CATEGORY_META[cat].label}
                  {active && <CheckCircle2 className="size-3.5 ml-auto text-primary" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleBlock}>
              <Ban className={"size-4 " + (c.blocked ? "" : "text-red-500")} />
              {c.blocked ? "Unblock" : "Block"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
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
    category?: Category | null;
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
    category?: Category | null;
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
  const [category, setCategory] = useState<Category | null>(editing.category ?? null);
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
    // Migrated onto the shared Dialog primitive (Radix): this gives the form a
    // real focus trap (the hand-rolled overlay div had none) and Escape-to-close
    // for free, on top of the existing backdrop-click-to-close behavior.
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-md flex flex-col max-h-[90dvh] p-0 gap-0 rounded-2xl"
      >
        <div className="flex items-center justify-between p-5 pb-3 shrink-0 border-b border-border/60">
          <DialogTitle className="font-semibold text-base">
            {editing.id ? "Edit contact" : "Add by PIN"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing.id ? "Edit this contact's details." : "Add a contact by their 6-digit RELAY number."}
          </DialogDescription>
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
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_ORDER.map((cat) => {
                const CIcon = CATEGORY_META[cat].icon;
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(active ? null : cat)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors " +
                      (active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    <CIcon className={"size-3.5 " + CATEGORY_META[cat].tint} />
                    {CATEGORY_META[cat].label}
                  </button>
                );
              })}
            </div>
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
                category,
              })
            }
            disabled={number.length !== 6 || saving}
          >
            {editing.id ? "Save" : "Add to contacts"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
