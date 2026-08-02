import { useEffect, useMemo, useState } from "react";
import { contactTagsOf, sectionsFor, CONTACT_TAGS, TAG_LABEL, primaryTag, toggleContactTag, type ContactTag } from "@shared/contactTags";

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
  Radio,
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
import { PIN_INPUT_MAXLENGTH, capPinInput, pinDigits } from "@/app/pinInput";
import { RoleBadge, roleFromFlags } from "@/app/VerifiedBadge";
import { PeerAvatar, openPeerProfile } from "@/app/PeerOverlays";
import { presenceDot } from "@/app/presenceDot";
import { matchQuery } from "@/app/searchMatch";
import { useT, type TKey } from "@/app/i18n";

/** The four tag recipes in index.css. A STATIC map, never a composed string: the class
 *  names have to exist literally somewhere the CSS can be found by, and this is that place. */
const TAG_CLASS: Record<ContactTag, string> = {
  vip: "rtag-vip",
  family: "rtag-family",
  friend: "rtag-friend",
  team: "rtag-team",
};

/**
 * Is this contact reachable RIGHT NOW? (v2.99.97)
 *
 * ONE predicate, because it now answers three questions that must never disagree:
 * which rows the Online section holds, what the green count beside each category
 * header says, and whether the header shows an active marker at all. Three copies of
 * "is this person online" is how a section comes to list four people over a header
 * that says three.
 *
 * `presenceHidden` is respected FIRST: a guest inactive for over a day has their
 * presence suppressed entirely (v2.95 privacy), so they must not be counted as online
 * or pulled into the Online section — that would leak exactly what the suppression
 * exists to withhold. And `inCall` counts as active, because somebody on a call is
 * plainly there.
 */
function isActiveContact(c: { presenceHidden?: boolean | null; isOnline?: boolean | null; inCall?: boolean | null }): boolean {
  if (c.presenceHidden) return false;
  return !!c.isOnline || !!c.inCall;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "??";
}

type Category = "vip" | "family" | "friend" | "team";
/** Ordered category sections. `favourite` (star) is its own leading section,
 *  then the explicit groups, then everyone else. */
/* v2.106.85: the label is a dictionary KEY rather than a finished string, because a
   module-level constant cannot call a hook. That is also the honest shape — "Family"
   the section heading and "Family" the row chip are the SAME fact and must never be
   able to disagree about their Arabic. */
const CATEGORY_META: Record<Category, { labelKey: TKey; icon: typeof Crown; tint: string }> = {
  vip: { labelKey: "contacts.tag.vip", icon: Crown, tint: "text-amber-400" },
  family: { labelKey: "contacts.tag.family", icon: Home, tint: "text-rose-400" },
  friend: { labelKey: "contacts.tag.friend", icon: Heart, tint: "text-sky-400" },
  team: { labelKey: "contacts.tag.team", icon: UsersIcon, tint: "text-violet-400" },
};
const CATEGORY_ORDER: Category[] = ["vip", "family", "friend", "team"];

/**
 * A tag's label key — the SAME key the section heading uses.
 *
 * The filter chips and the row chip used to render `TAG_LABEL[tag]` from
 * `@shared/contactTags` while the heading rendered `CATEGORY_META[tag].labelKey`, so
 * one fact had two sources: in English they already disagreed ("Friend" on the chip,
 * "Friends" on the heading), and in Arabic the heading was translated while the chip
 * was not. Reading both off `CATEGORY_META` makes them unable to disagree by
 * construction rather than by anyone remembering to keep two lists in step.
 *
 * `Category` and `ContactTag` are the same four values; this is the one place that
 * has to be said, so a fifth tag becomes a compile error here rather than an
 * untranslated chip.
 */
export function tagLabelKey(tag: ContactTag): TKey {
  return CATEGORY_META[tag as Category].labelKey;
}

/**
 * Which band a count falls in — the shape `guestExpiryKey` established (v2.106.93).
 *
 * A count cannot be a placeholder in one sentence: English needs one/other and Arabic
 * needs the DUAL at 2 (where the numeral disappears into the word entirely), the
 * plural genitive at 3-10 and the singular accusative at 11+. So a WHOLE key is
 * selected per band and nothing is ever assembled from a stem plus a suffix.
 *
 * Shared by both counts on this screen, because "which band is this number in" is one
 * rule and two copies of it is how the two headers come to disagree at 2.
 *
 * EACH KEY IS RETURNED AS A LITERAL, never composed as `` `contacts.onlineCount${band}` ``.
 * That is not a style preference and it cost two real properties when it was written the
 * other way: a template literal needs an `as TKey` cast, which switches the type checker
 * OFF for exactly the strings that must match the dictionary — a misspelt band would
 * compile and render the raw key on somebody's phone; and the dead-key sweep looks for
 * each key's TEXT in the sources, so composed keys read as having no reader at all and
 * the whole family looked like coverage nobody consumes. `guestExpiryKey` returns
 * literals for the same two reasons.
 *
 * Exported so the bands can be driven behaviourally: whether "1 online" ever renders as
 * "1 onlines", or Arabic ever puts a numeral where the dual belongs, is exactly what a
 * source pin cannot answer.
 */
export function onlineCountKey(n: number): TKey {
  if (n <= 1) return "contacts.onlineCountOne";
  if (n === 2) return "contacts.onlineCountTwo";
  return n <= 10 ? "contacts.onlineCountFew" : "contacts.onlineCountMany";
}
export function contactCountKey(n: number): TKey {
  if (n <= 1) return "contacts.contactCountOne";
  if (n === 2) return "contacts.contactCountTwo";
  return n <= 10 ? "contacts.contactCountFew" : "contacts.contactCountMany";
}

/**
 * "last seen …" for one row.
 *
 * TOTAL BY CONSTRUCTION, and that is not defensiveness for its own sake — it is a
 * blast-radius fix with a demonstrated failure mode. The previous shape took
 * `Date | string | null` and called `.getTime()` on whatever was not a string, so a
 * value of any OTHER type threw a TypeError out of the render — and because this is
 * called from a row inside the list, React unwound the whole page and the error
 * boundary replaced the entire Contacts screen with "An unexpected error occurred."
 * Measured, not theorised: driving the real bundle with one numeric `lastSeenAt`
 * rendered ZERO contacts and that message.
 *
 * Today the server sends a Drizzle `timestamp`, i.e. a real Date that superjson
 * revives as a Date, so the throwing path is not reachable through the ordinary
 * wire — this is about the cost when it is wrong, not a claim that it is. One row
 * losing its "last seen" line is a cosmetic degradation; the entire address book
 * disappearing is the failure the owner would report as "the contact is not
 * showing". A whole screen must not rest on one field's runtime type.
 *
 * It also accepts a NUMBER now, because that is what the sibling formatter in
 * `shared/profileFields.ts` takes (`formatLastSeen(lastSeenMs)`) — two functions
 * answering one question with different input types is how a future caller passes
 * the wrong one, and that formatter is likewise total (`!Number.isFinite` → "").
 */
export function relativeTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === "") return "never";
  // Only three shapes can be a time. Everything else is coerced by `new Date()` into
  // something that looks plausible and is not: `new Date(true)` is one millisecond
  // after the epoch, so a boolean would render as "1/1/1970" — no crash, and still a
  // date printed about somebody nobody has a time for. Caught by this file's own test.
  if (!(d instanceof Date) && typeof d !== "string" && typeof d !== "number") return "never";
  const date = d instanceof Date ? d : new Date(d);
  const ms = date.getTime();
  // An unparseable date yields NaN, which would make every comparison below false and
  // fall through to `toLocaleDateString()` → the literal text "Invalid Date" in the row.
  // `<= 0` matches `formatLastSeen`'s own rule in `shared/profileFields.ts`, which is
  // the whole point of touching this: 0 is what a null column becomes on plenty of
  // paths, and the two formatters disagreeing about it is the divergence being closed.
  if (!Number.isFinite(ms) || ms <= 0) return "never";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function ContactsPage() {
  const t = useT();
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
    onError: (err) => toast.error(err.message || t("contacts.saveFailed")),
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: () => toast.error(t("contacts.removeFailed")),
  });
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => setLocation(`/app/messages?c=${res.conversationId}`),
    onError: (err) => toast.error(err.message || t("contacts.openFailed")),
  });

  const [search, setSearch] = useState("");
  /* Board 3b's top filter chips: All · VIP · Family · Friend · Team, SINGLE-SELECT.
     `null` is All. Single-select because the board draws one chip lit and a
     multi-select would need an "and/or" the frame does not express — and because
     the sections below already give you every tag at once, so a multi-filter would
     be a second way to do the thing the page does by default. */
  const [tagFilter, setTagFilter] = useState<ContactTag | null>(null);
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
    /* THE RESOLVED TAG SET, not the `category` mirror. The dialog used to carry
       `category` alone and save it alone, which — because `contactUpdateKeys`
       couples the two columns — re-derived `tags` from that ONE value and
       destroyed every other label the contact had. Saving a contact's phone
       number silently dropped them out of their sections. */
    tags?: ContactTag[];
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
      tags: contactTagsOf({ tags: c.tags?.join(",") ?? null, category: c.category ?? null }),
    });
  }

  type Row = NonNullable<typeof contacts.data>[number];
  const filtered = useMemo<Row[]>(() => {
    const list = contacts.data ?? [];
    return list
      .filter((c) =>
        // v2.99.96: one shared rule, and the FIELDS ARE SEPARATE rather than joined
        // into one haystack. This used to be a lowercase substring test against the
        // saved name plus `c.number.includes(rawQuery)` — so typing the `777-777`
        // this very list DISPLAYS matched nothing, "khalifa ali" missed "Khalifa
        // Mohamed Ali", and "jose" missed "José". `liveName` is searched too, so
        // somebody saved as "Dad" is also findable by their real name.
        matchQuery(search, [c.displayName, c.liveName, c.number])
      )
      /* The chip narrows the INPUT, so every section, count and empty state below
         asks the already-narrowed list. Filtering per-section instead is how a
         header comes to say a number its own rows do not add up to. */
      .filter((c) =>
        !tagFilter ||
        contactTagsOf({ tags: (c as { tags?: string[] }).tags?.join(",") ?? null, category: c.category ?? null }).includes(tagFilter)
      )
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (a.displayName || a.number).localeCompare(b.displayName || b.number);
      });
  }, [contacts.data, search, tagFilter]);

  /** True while the user is actively searching. */
  const searching = search.trim().length > 0;

  // Group into sections: ONLINE first (v2.99.97), then Favorites (the star pin,
  // cross-cuts categories), then each explicit category, then "Other". Within a
  // section, online-first.
  const sections = useMemo(() => {
    const out: Array<{
      key: string;
      labelKey: TKey;
      icon: typeof Crown;
      tint: string;
      rows: Row[];
      /** True for the ONLINE section, whose total IS its online count. */
      allActive?: boolean;
    }> = [];
    // v2.99.97 (owner): "add in the top online. Online means whoever on your
    // contacts and all type of categories will be showing online also on that one
    // beside of the assigned category." So this section CROSS-CUTS the others: a
    // person appears here AND under whatever category they were filed in, exactly
    // as Favorites already cross-cuts. It is not a category, so it is not part of
    // CATEGORY_ORDER and nothing can be "moved into" it.
    const online = filtered.filter(isActiveContact);
    if (online.length)
      out.push({ key: "online", labelKey: "contacts.online", icon: Radio, tint: "text-[color:var(--relay-online,#06d6a0)]", rows: online, allActive: true });
    const favorites = filtered.filter((c) => c.favourite);
    if (favorites.length) out.push({ key: "fav", labelKey: "contacts.favorites", icon: Star, tint: "text-amber-400", rows: favorites });
    /* DATA-CONTRACTS §1 (board 3b), and it changes TWO real behaviours rather
       than restyling anything.
       (1) VIP IS A CHIP, NOT A SECTION. It used to have its own heading; the
           contract makes it a gold chip on whichever row already appears, so
           `SECTION_TAGS` excludes it.
       (2) A CONTACT APPEARS IN EVERY SECTION IT QUALIFIES FOR. The old rule was
           `c.category === cat && !c.favourite`, which HID a favourited contact
           from their own category — you starred somebody and they left Family.
           Membership, not a partition, which is what already made ONLINE
           cross-cutting (v2.99.97).
       The derivation itself lives in `shared/contactTags.ts` so the section list,
       its counts and 4a's chips cannot come to disagree about who is in what. */
    for (const { key, contacts: rows } of sectionsFor(
      filtered.map((c) => ({
        number: c.number,
        tags: contactTagsOf({ tags: (c as { tags?: string[] }).tags?.join(",") ?? null, category: c.category ?? null }),
        favourite: c.favourite,
        online: isActiveContact(c),
      }))
    )) {
      // ONLINE and FAVORITES are already pushed above with their own icons and
      // tints; taking them from here too would render each section twice.
      if (key === "online" || key === "favorites") continue;
      const rowsByNumber = new Set(rows.map((r) => r.number));
      const real = filtered.filter((c) => rowsByNumber.has(c.number));
      if (!real.length) continue;
      if (key === "other") {
        /* "Everyone else", NOT "All contacts". This bucket is `!favourite && no tags`, so
           labelling it "All contacts" was a false claim about somebody's own directory —
           a VIP, a favourite and anybody with a label are all EXCLUDED from it, which is
           precisely the shape of "many things are not showing there". The key and the
           shared module already call it "other"; only the label lied. */
        out.push({ key: "other", labelKey: "contacts.everyoneElse", icon: UsersIcon, tint: "text-muted-foreground", rows: real });
      } else {
        out.push({ key, ...CATEGORY_META[key as Category], rows: real });
      }
    }
    return out;
  }, [filtered]);

  return (
    <div className="flex-1 min-h-0 md:p-6 flex flex-col gap-4">
      {/* Top row: search field + violet "add by PIN" (opens the same Add dialog). */}
      <div className="px-4 md:px-0 pt-1 flex items-center gap-2.5">
        <div className="relative flex-1">
          {/* THE ICON AND THE FIELD'S PADDING ARE ONE DECISION AND MUST MIRROR TOGETHER.
              The icon is absolutely positioned at the field's LEADING edge and `ps-10`
              is the space reserved to clear it; converting one alone puts the glyph on
              the opposite edge from its own gap, so in Arabic the typed text runs
              straight underneath it. `top-1/2 -translate-y-1/2` is the BLOCK axis and
              stays physical — it does not mirror. */}
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("contacts.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 ps-10 rounded-xl bg-secondary/60"
          />
        </div>
        <button
          type="button"
          aria-label={t("contacts.addByPin")}
          title={t("contacts.addByPin")}
          onClick={() =>
            setEditing({ id: undefined, number: "", displayName: "", notes: "" })
          }
          /* Board 1e: "Add by PIN accent chip". The violet was this tab's own
             wayfinding hue, and it still is — it lives on the tab bar's glyph and on
             this page's section icons; what the board asks for is that the one PRIMARY
             action on the screen reads as the app's accent rather than as a fourth
             colour beside three coloured row actions. */
          className="rchip-accent grid place-items-center size-11 shrink-0 rounded-xl transition hover:brightness-110"
        >
          <UserPlus className="size-[19px]" />
        </button>
      </div>
      {/* BOARD 3b — the filter chips. Single-select, `null` is All.
          It scrolls horizontally rather than wrapping: five chips plus their
          labels do not fit 320px on one line, and a second row would push the
          list itself further down the screen on the phone that can least afford
          it. `shrink-0` on each chip is what stops flex squeezing them into
          unreadable slivers instead of scrolling. */}
      <div className="px-4 md:px-0 -mt-1 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setTagFilter(null)}
          aria-pressed={tagFilter === null}
          className={
            "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition " +
            (tagFilter === null ? "rchip-accent" : "bg-secondary/60 text-muted-foreground hover:text-foreground")
          }
        >
          {t("contacts.filterAll")}
        </button>
        {CONTACT_TAGS.map((tag) => {
          const on = tagFilter === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(on ? null : tag)}
              aria-pressed={on}
              /* The lit chip wears the TAG'S OWN colour rather than the accent —
                 unlike every other selection in the app. These four are fixed
                 identities (the board gives each its own hue and the row chips
                 use it), so lighting them all in one cycling accent would throw
                 away the thing that makes a tag readable at a glance.
                 `.rtag-<tag>` rather than an inline style, and that is not tidying:
                 the label MEASURED 1.53-1.71:1 on the light card against AA's 4.5,
                 and the readable value differs per theme (the darker light value is
                 ~2:1 on the dark chip), which an inline style cannot express. The
                 class list is a LITERAL per tag — a runtime-composed Tailwind class
                 is invisible to the JIT and comes out unstyled, but these are plain
                 CSS rules in index.css, so a static lookup is safe. */
              className={
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition " +
                (on
                  ? "rtag " + TAG_CLASS[tag]
                  : "bg-secondary/60 text-muted-foreground hover:text-foreground")
              }
            >
              {/* The heading's own key — see `tagLabelKey`: one fact, one source. */}
              {t(tagLabelKey(tag))}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto md:rounded-2xl md:glass-surface-md">
        {/* A FAILED READ SAYS SO — IT IS NOT AN EMPTY ADDRESS BOOK.
         *
         * This is the owner's report ("the contact is not showing") and the mechanism
         * was that there was no error arm at all: any failure of `contacts.list`
         * fell through to `filtered.length === 0` and rendered "No contacts yet"
         * with an "Add a contact" button — a confident false claim about somebody's
         * own directory, and a persistent one, because once react-query's retries
         * are spent `isLoading` is false and a background refetch never flips it
         * back. Messages has rendered `threads.isError` first with a Retry since
         * v2.99.x and that behaviour is pinned ("not blank-forever"); this screen
         * simply never got it.
         *
         * THE ORDER IS LOAD-BEARING: the error arm comes BEFORE `isLoading`, because
         * a background retry on an errored query sets `isFetching` and would
         * otherwise drop the screen back to the skeleton, hiding the failure again
         * on a loop. And the copy must never say the directory is empty — that
         * wording is the whole defect. */}
        {contacts.isError ? (
          <Empty className="border-none p-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertCircle />
              </EmptyMedia>
              <EmptyTitle>{t("contacts.loadFailed")}</EmptyTitle>
              <EmptyDescription>{t("contacts.loadFailedHint")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => void contacts.refetch()}>
                {t("common.retry")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : contacts.isLoading ? (
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
              {/* THE EMPTY STATE HAS TO SAY WHICH KIND OF EMPTY IT IS. A narrowed
                  list is not an empty directory, and saying "No contacts yet" when a
                  filter chip is lit is a false statement about somebody's own address
                  book — the same defect v2.106.2 fixed in Messages, where an unfiltered
                  count made the page render `No conversations match ""`. The narrowing
                  is recoverable in one tap (All, or the lit chip again), so what is
                  needed is honest copy rather than a new control. */}
              <EmptyTitle>
                {search ? t("contacts.noMatches") : tagFilter ? t("contacts.noneInLabel") : t("contacts.none")}
              </EmptyTitle>
              <EmptyDescription>
                {/* BOTH narrowings can be active at once, and the three-way version blamed
                    the SEARCH alone — so it never mentioned the lit chip and never offered
                    the one-tap recovery, leaving somebody retyping a query that was never
                    the reason. Four cases, one expression. */}
                {/* `label` and `all` are the CHIPS' OWN labels rather than the words
                    spelled again, so the sentence pointing at a control and the control
                    itself cannot come to disagree — in either language. */}
                {search && tagFilter
                  ? t("contacts.noMatchesInLabel", {
                      query: search,
                      label: t(tagLabelKey(tagFilter)),
                      all: t("contacts.filterAll"),
                    })
                  : search
                    ? t("contacts.noMatchesFor", { query: search })
                    : tagFilter
                      ? t("contacts.noneWithLabel", {
                          label: t(tagLabelKey(tagFilter)),
                          all: t("contacts.filterAll"),
                        })
                      : t("contacts.noneHint")}
              </EmptyDescription>
            </EmptyHeader>
            {!search && !tagFilter && (
              <EmptyContent>
                <Button
                  onClick={() =>
                    setEditing({ id: undefined, number: "", displayName: "", notes: "" })
                  }
                  size="sm"
                >
                  <UserPlus className="size-4 me-1.5" /> {t("contacts.addContact")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div>
            {sections.map((section) => {
              const SIcon = section.icon;
              // A COLLAPSED SECTION USED TO SWALLOW MATCHES (v2.99.96). The
              // filter above kept the row and the header counted it, but the body
              // was gated on collapse state — so a search could report "1" beside a
              // section heading and render nothing at all. That is a large part of
              // "the search doesn't detect 100%": the match was found and then
              // hidden. While a query is active, every section is open.
              /* …and a TAG FILTER narrows exactly the same way, so it needs the same
                 escape. Without it, tapping "Family" while the Family section happened
                 to be collapsed rendered a header stating a count above nothing at all,
                 with no empty state to explain it — the rows were found and then hidden,
                 which is the same defect one filter along. */
              const isCollapsed = !searching && !tagFilter && collapsed.has(section.key);
              // v2.99.97 (owner): "mention number of contacts in each category and
              // also mention number of online in each category … it will mention
              // total ten. On beside, it will show green color … to show that is
              // online." Both counts come from the SAME predicate the Online section
              // uses, so a header can never disagree with the rows under it.
              const total = section.rows.length;
              const onlineCount = section.rows.filter(isActiveContact).length;
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
                    {/* Board 1e: the section label takes the ACCENT and the board's .26em
                        mono tracking — it is the strongest wayfinding cue on a long list.

                        `text-primary`, NOT the raw `var(--rb)` this used to set. The owner's
                        report was "the contacts section is not showing", and the section
                        LABELS were the literal answer: measured 1.59:1 on the light card
                        against AA's 4.5, i.e. ONLINE / FAVORITES / FAMILY / FRIENDS / TEAM
                        were invisible in the theme the app defaults to. v2.106.4 repointed
                        `--primary` at `--rb` inside `.dark.relay-v2` for exactly this, so
                        the DARK look is byte-identical and only light changes (4.59:1).
                        The heading sits on a plain surface, not on an accent tint, which is
                        what makes `text-primary` the right half of the v2.106.31 rule. */}
                    <span
                      className="flex-1 text-start font-mono text-[11px] font-semibold uppercase text-primary"
                      style={{ letterSpacing: ".26em" }}
                    >
                      {t(section.labelKey)}
                    </span>
                    {/* The counts. The Online section's total IS its online count,
                        so it shows one green number rather than "5 · 5". Everywhere
                        else: total in muted, then the online count in green — and
                        only when it is non-zero, because a green 0 spends attention
                        on the one answer that needs none.

                        BOARD 1e SAYS THE ONLINE COUNT CARRIES THE WORD, and that is not
                        decoration: rendered as two bare integers this header read "10 3",
                        and what the second number means lived only in a `title`, which a
                        phone has no way to show. `● 3 online` answers it on the row. The
                        TOTAL stays a bare mono number, because the label right beside it
                        already says what is being counted. */}
                    {section.allActive ? (
                      /* …and this one does NOT take the word, because its own LABEL is
                         "Online": "Online … 3 online" says it twice. Measured with the
                         word in place and it read exactly like that. */
                      <span
                        className="flex shrink-0 items-center gap-1 font-mono text-[10px] font-bold tabular-nums text-[color:var(--relay-green-text)]"
                        title={t(onlineCountKey(total), { count: total })}
                      >
                        <span className="size-1.5 rounded-full bg-[color:var(--relay-online)]" />
                        {total}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
                        <span
                          className="text-muted-foreground/70"
                          title={t(contactCountKey(total), { count: total })}
                        >
                          {total}
                        </span>
                        {onlineCount > 0 && (
                          <span className="flex items-center gap-1 font-bold text-[color:var(--relay-green-text)]">
                            <span className="size-1.5 rounded-full bg-[color:var(--relay-online)]" />
                            {t(onlineCountKey(onlineCount), { count: onlineCount })}
                          </span>
                        )}
                      </span>
                    )}
                    {/* The pip the counts replaced said only "somebody here is
                        online" — strictly less than the number now beside it. */}
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
                          /* SEND THE WHOLE FACT, not the mirror. `category` is the derived
                             mirror of `tags[0]`, and `contactUpdateKeys` couples the two —
                             so a category-only write re-derived `tags` FROM it and silently
                             destroyed every tag after the first. Toggle "Family" on a
                             contact tagged VIP + Family and they lost VIP, left the VIP
                             section, and their row chip changed, with nothing saying so.
                             `toggleContactTag` over the RESOLVED list is the same expression
                             4a's profile chips already use, so both editors now agree. */
                          onSetCategory={(category) =>
                            upsert.mutate({
                              number: c.number,
                              tags: toggleContactTag(
                                contactTagsOf({
                                  tags: c.tags?.join(",") ?? null,
                                  category: c.category ?? null,
                                }),
                                category,
                              ),
                            })
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
            <AlertDialogTitle>{t("contacts.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingContact
                ? t("contacts.removeNamed", {
                    name: deletingContact.displayName || deletingContact.number,
                  })
                : t("contacts.removeBody")}
              {deletingContact?.blocked && (
                <span className="mt-2 block font-medium text-[#ff8d84]">
                  {t("contacts.removeBlockedBody")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (deleteId !== null) remove.mutate({ id: deleteId });
                setDeleteId(null);
              }}
            >
              {t("contacts.removeAction")}
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
    /** Three-tier badge (v2.99.6): guest / registered / admin. `null` (v2.99.28
     *  / M14) = a saved number that isn't a RELAY user → no badge. */
    role?: "guest" | "registered" | "admin" | null;
    isOnline: boolean;
    idle?: boolean;
    /** Busy line (v2.88): in a live call right now. */
    inCall: boolean;
    lastSeenAt: Date | string | null;
    presenceHidden: boolean;
    company: string | null;
    jobTitle: string | null;
    category: Category | null;
    /** Resolved by the caller through the ONE shared reader, so a pre-v2.106.14
     *  contact (category only) still shows its chip. */
    tags?: string[];
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
  const t = useT();
  return (
    /* BOARD 1e — TWO LINES, AND THE REASON IS A MEASUREMENT RATHER THAN THE FRAME.
       At 390px the single-line row spent its width like this: 32px of list padding, 42px
       of avatar, 114px of quick-action buttons, 33px of tag chip and the gaps between
       them — leaving the NAME 119px of the 228 that "Abdulrahman Alhammadi" needs, and
       49px of it at 320px. So the row was cut off at EVERY width, and it spent more of
       itself on chrome than on the one thing a contact row is for. Measured before
       touching it, and this is the most literal reading of the owner's "the contacts
       section is not showing".
       LINE 1 is avatar + name + badges + tag: the name now gets ~265px at 390 and fits.
       LINE 2 carries the PIN, the presence line and the quick actions — the same shape
       v2.99.39 gave the Messages rows after the owner reported this exact truncation
       ("A…"), so the two lists answer it the same way.
       AND IT BRINGS THE VIDEO BUTTON BACK ON EVERY PHONE: it was `hidden xs:grid`, and
       `--breakpoint-xs` is 480px, so board 1e's third quick action was absent on every
       iPhone with only a ⋮-menu fallback. Nothing is removed; the row is reorganised so
       all three fit. */
    <li
      className={
        "flex flex-col gap-1.5 px-4 md:px-5 py-2.5 border-b border-border/60 last:border-b-0 hover:bg-muted/30 transition-colors " +
        (c.blocked ? "opacity-60" : "")
      }
    >
      <div className="flex items-center gap-3">
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
            FADED green away (v2.99.92 idle) / grey offline; hidden for a stale
            guest. The rule lives in `presenceDot`, shared with every other dot in
            the app, because eight copies is how two surfaces end up disagreeing
            about the same person. */}
        {!c.presenceHidden && (() => {
          const dot = presenceDot(c);
          return (
            <span
              aria-label={dot.label}
              title={c.inCall ? t("contacts.onACall") : dot.label}
              /* `-end-0.5` so the LED hangs off the avatar's TRAILING corner in both
                 directions, which is the edge Messages' thread rows and History's
                 `PresenceLed` already use for this same affordance — one presence dot
                 sitting on a different corner per screen, in Arabic only, is exactly
                 the divergence those sweeps closed. `-bottom-0.5` is the block axis
                 and is direction-independent. */
              className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-card"
              style={{ background: dot.color, boxShadow: dot.glow || undefined }}
            />
          );
        })()}
      </PeerAvatar>
      {/* Main area → the peer PROFILE POPUP (v2.96 owner spec). */}
      <button
        type="button"
        onClick={() => openPeerProfile(c.number)}
        className="flex flex-1 min-w-0 items-center gap-3 text-start outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
        /* The shared phrase — the possessive has no Arabic equivalent, so the name
           MOVES within the sentence, which only a whole key can express. */
        aria-label={t("peer.viewNamedProfile", { name: c.displayName || c.number })}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold truncate">{c.displayName || c.number}</span>
            {c.favourite && <Star className="size-3 shrink-0 text-amber-400 fill-amber-400" />}
            <RoleBadge role={roleFromFlags(c.role, c.verified)} size={14} />
            {/* THE PIN SITS AFTER THE BADGE, ON LINE 1 (owner, with a screenshot of the
                deployed row): *"Move the pin for contact from below the name to after the
                badge and coloured green — because last seen doesn't show fully, so keep it
                visible now."*
                THEIR REASON IS THE MEASUREMENT. On line 2 the PIN was `shrink-0` and the
                presence text was the only thing that could shrink, so at 375px the presence
                line got ~67px of the ~110 that "last seen 3h ago" needs and every row read
                "last seen …". Moving the PIN up hands line 2 the PIN's whole cell, and the
                presence line is then the only occupant of the space between the indent and
                the buttons.
                GREEN IS THE APP'S EXISTING WORD FOR "A RELAY NUMBER", not a new meaning: the
                top bar has rendered the viewer's OWN number in this exact token since
                v2.99.86, which is where the token came from — the LED hue measures 4.46:1 as
                small text and FAILS AA, so `--relay-green-text` (5.92:1 light / 9.27:1 dark)
                exists precisely for a number at this size. So a contact's number now matches
                the reader's own.
                `dir="ltr"` + bidi isolation stays, and matters more here than it did on line
                2: this row's display name may be Arabic — the owner's own directory has
                several — and an RTL name would otherwise reorder the digit groups (v2.99.77). */}
            <span
              className="shrink-0 font-mono text-[12px] tabular-nums text-[color:var(--relay-green-text)] [unicode-bidi:isolate]"
              dir="ltr"
            >
              {c.number.length === 6 ? c.number.slice(0, 3) + "-" + c.number.slice(3) : c.number}
            </span>
            {c.blocked && <Ban className="size-3.5 shrink-0 text-[#ff8d84]" />}
            {/* BOARD 3b — the tag chip. `.rtag-<tag>` carries the board's 13% fill and
                45% hairline plus a MEASURED light-theme text colour (the raw pastel is
                1.53-1.71:1 on a light card).

                THE ROW SHOWS THE PRIMARY TAG ONLY, and that is a layout decision rather
                than a simplification: the chips are `shrink-0` and the name is the only
                thing in this row that CAN shrink, so two chips ate the name on a 390px
                phone — a contact labelled VIP + Family became a pair of chips with no
                person attached to them. The contract already calls the first tag the row
                chip; the full set is the profile's business (4a's editable chips). */}
            {(() => {
              const first = primaryTag(
                contactTagsOf({ tags: c.tags?.join(",") ?? null, category: c.category ?? null }),
              );
              return first ? (
                <span
                  className={
                    "rtag " + TAG_CLASS[first] +
                    " shrink-0 !rounded-md px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider"
                  }
                >
                  {/* The section heading's own key — see `tagLabelKey`. */}
                  {t(tagLabelKey(first))}
                </span>
              ) : null;
            })()}
          </div>
          {/* The company/role line stays on LINE 1, under the name it belongs to.
              The PIN and the presence line moved to LINE 2 (see below) — they are what
              line 2 has room for, and keeping them here would leave line 1 three lines
              tall while line 2 held nothing but buttons. */}
          {(c.company || c.jobTitle) && (
            <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
              {[c.jobTitle, c.company].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </button>
      </div>

      {/* LINE 2 — the presence line and the quick actions.
          THE PIN MOVED UP TO LINE 1 (owner's screenshot: every row read "last seen …").
          It was `shrink-0` here while the presence text was the only shrinkable thing, so
          the PIN's cell was taken out of the presence line's budget at every width — and
          the presence line is the one thing on line 2 that has something to say. Now it
          owns the whole span between the indent and the buttons; the buttons stay
          `shrink-0` and `ms-auto` pins them to the trailing edge in both directions. */}
      <div className="flex items-center gap-2 ps-[54px]">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {/* `presence.onCall` and `presence.away` are the APP's shared words for those
              two states and their English matches this row exactly, so they are reused
              rather than copied — one state must not end up with two Arabic words. The
              bare "online" is deliberately NOT `presence.online` ("online now"): a
              different English phrase, and swapping it would be an unrequested copy
              change to a row whose width was measured. */}
          {c.blocked ? (
            <span className="text-[#ff8d84]">{t("contacts.blocked")}</span>
          ) : c.presenceHidden ? null : c.inCall ? (
            <span className="text-amber-500">{t("presence.onCall")}</span>
          ) : c.isOnline && c.idle ? (
            // Backgrounded (v2.99.92): "away", not "online" and definitely not
            // "last seen 3s ago", which is what minimising used to produce.
            <span className="text-muted-foreground">{t("presence.away")}</span>
          ) : c.isOnline ? (
            <span className="text-[color:var(--relay-online)]">{t("contacts.rowOnline")}</span>
          ) : (
            /* STILL ENGLISH, AND DELIBERATELY SO. `relativeTime` is a relative-time
               formatter of exactly the same class as `formatLastSeen`, which five other
               surfaces share and which is being translated as its own piece of work.
               Translating this one alone would make a contact's row and that same
               person's profile popup answer the same question in two languages; and
               translating the "last seen" wrapper WITHOUT the duration would assemble a
               sentence from a fragment, which is the one thing the dictionary's rules
               forbid outright. Named in the release notes rather than half-done. */
            <>last seen {relativeTime(c.lastSeenAt)}</>
          )}
        </span>
        {/* Inline actions: Message / Video / Voice + overflow menu — circular
            gradient tap targets (message orange, video blue, call accent). */}
        <div className="ms-auto flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          aria-label={t("contacts.message")}
          title={t("contacts.message")}
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
          aria-label={t("contacts.videoCall")}
          title={t("contacts.videoCall")}
          onClick={onVideo}
          disabled={c.blocked}
          /* NO LONGER `hidden xs:grid`. `--breakpoint-xs` is 480px, so board 1e's third
             quick action was absent on every iPhone, reachable only from the ⋮ menu — a
             deliberate trade back when all four controls shared line 1 with the name.
             Line 2 has the room, so the trade is off. */
          className="grid place-items-center size-[34px] rounded-full shrink-0 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
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
          aria-label={t("contacts.voiceCall")}
          title={t("contacts.voiceCall")}
          onClick={onVoice}
          disabled={c.blocked}
          /* Board 1e: of the three quick actions, "call = accent chip" — so the row's
             own primary is the accent while chat and video keep their hues, which is
             the same primary/secondary split the Dialer's action row uses. */
          className="rchip-accent grid place-items-center size-[34px] rounded-full shrink-0 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PhoneCall className="size-[15px]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("contacts.moreOptions")}
              className="grid place-items-center size-[34px] rounded-full shrink-0 text-muted-foreground bg-secondary/60 hover:bg-secondary transition-colors"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {/* The video FALLBACK is gone with the breakpoint that made it necessary:
                a duplicate of a control that is now always on screen is a second way to
                do one thing, and the one that is harder to find. */}
            <DropdownMenuItem onClick={onToggleFavorite}>
              {c.favourite ? (
                <><StarOff className="size-4" /> {t("contacts.unfavorite")}</>
              ) : (
                <><Star className="size-4" /> {t("contacts.favorite")}</>
              )}
            </DropdownMenuItem>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 pt-2">
              {t("contacts.category")}
            </DropdownMenuLabel>
            {CATEGORY_ORDER.map((cat) => {
              const CIcon = CATEGORY_META[cat].icon;
              /* Ticked from the RESOLVED tags, not the mirror. `category` is only
                 `tags[0]`, so a contact tagged VIP + Family had Family sitting
                 unticked in a menu whose row above it was rendering a Family chip
                 and whose section header the row was sitting under said FAMILY. */
              const active = contactTagsOf({
                tags: c.tags?.join(",") ?? null,
                category: c.category ?? null,
              }).includes(cat);
              return (
                <DropdownMenuItem key={cat} onClick={() => onSetCategory(cat)}>
                  <CIcon className={"size-4 " + CATEGORY_META[cat].tint} />
                  {t(CATEGORY_META[cat].labelKey)}
                  {active && <CheckCircle2 className="size-3.5 ms-auto text-primary" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" /> {t("contacts.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleBlock}>
              <Ban className={"size-4 " + (c.blocked ? "" : "text-red-500")} />
              {c.blocked ? t("contacts.unblock") : t("contacts.block")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
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
    /* The RESOLVED tag list. `category` is only its first slot, and saving through
       the mirror destroyed the rest (see the state comment on `editing` above). */
    tags?: ContactTag[];
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
    tags?: ContactTag[];
  }) => void;
  saving: boolean;
  error: string | null;
}) {
  const t = useT();
  const [number, setNumber] = useState(editing.number);
  const [displayName, setDisplayName] = useState(editing.displayName);
  const [notes, setNotes] = useState(editing.notes);
  const [email, setEmail] = useState(editing.email ?? "");
  const [phone, setPhone] = useState(editing.phone ?? "");
  const [company, setCompany] = useState(editing.company ?? "");
  const [jobTitle, setJobTitle] = useState(editing.jobTitle ?? "");
  const [website, setWebsite] = useState(editing.website ?? "");
  const [birthday, setBirthday] = useState(editing.birthday ?? "");
  /* MULTI-select over the real 0..n model, replacing a single-select picker that could
     only ever express one label and, on save, wiped the rest. The store has held a list
     since v2.106.14 and 4a's profile chips already toggle it; this dialog was the one
     writer still speaking through the mirror. */
  const [tags, setTags] = useState<ContactTag[]>(editing.tags ?? []);
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
            {editing.id ? t("contacts.editTitle") : t("contacts.addByPin")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing.id ? t("contacts.editBody") : t("contacts.addBody")}
          </DialogDescription>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("contacts.close")}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Scrollable body so the form never pushes the Save button off-screen
            on small/mobile viewports (the bug where "Save" was unreachable). */}
        <div className="space-y-4 p-5 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              {t("contacts.relayNumber")}
            </label>
            <div className="relative">
              <Input
                value={number}
                onChange={(e) =>
                  // v2.106.65 — `replace(/\D/g, "")` FOLDED letters away, so `7a7b7c7d7e7f`
                  // became `777777`: a typo turning into a saved contact for somebody
                  // else's number. `capPinInput` drops them as typed instead, so the field
                  // always shows exactly what will be saved.
                  setNumber(capPinInput(e.target.value))
                }
                disabled={!!editing.id}
                placeholder={t("contacts.numberPlaceholder")}
                maxLength={PIN_INPUT_MAXLENGTH}
                inputMode="numeric"
                autoFocus={!editing.id}
                className="font-mono text-lg tracking-[0.35em] ps-10"
              />
              {/* Same pairing as the list's search field: the glyph's edge and the
                  padding that clears it are one decision. */}
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            </div>
            {!editing.id && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {t("contacts.numberHint")}
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
                        // Trailing corner, matching the row LED above.
                        "absolute -bottom-0.5 -end-0.5 size-3.5 rounded-full border-2 border-card " +
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
                      {/* The same two words the row above uses, from the same keys. */}
                      {lookup.data!.presenceHidden ? null : lookup.data!.isOnline ? (
                        <>
                          {" · "}
                          <span className="text-[color:var(--relay-online)] font-medium">
                            {t("contacts.rowOnline")}
                          </span>
                        </>
                      ) : (
                        <span> · {t("presence.offline")}</span>
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
                      {t("contacts.noSuchUser")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("contacts.noSuchUserHint")}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              {t("contacts.displayName")}
            </label>
            <Input
              value={displayName}
              onChange={(e) => {
                setTouchedName(true);
                setDisplayName(e.target.value);
              }}
              placeholder={t("contacts.name")}
              maxLength={64}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                {t("contacts.email")}
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
                {t("contacts.phone")}
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
                {t("contacts.company")}
              </label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t("contacts.company")}
                maxLength={128}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                {t("contacts.jobTitleLabel")}
              </label>
              <Input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder={t("contacts.jobTitle")}
                maxLength={128}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
                {t("contacts.website")}
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
                {t("contacts.birthday")}
              </label>
              <Input
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                placeholder={t("contacts.birthdayPlaceholder")}
                maxLength={32}
              />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground block mb-1.5">
              {t("contacts.notes")}
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
              {t("contacts.category")}
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_ORDER.map((cat) => {
                const CIcon = CATEGORY_META[cat].icon;
                const active = tags.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTags(toggleContactTag(tags, cat))}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors " +
                      (active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    <CIcon className={"size-3.5 " + CATEGORY_META[cat].tint} />
                    {t(CATEGORY_META[cat].labelKey)}
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
            {t("common.cancel")}
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
                tags,
              })
            }
            disabled={number.length !== 6 || saving}
          >
            {editing.id ? t("common.save") : t("contacts.addToContacts")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
