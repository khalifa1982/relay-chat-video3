/**
 * Contact tags — `DATA-CONTRACTS.md` §1, for board 3b (categories) and 4a (peer
 * profile).
 *
 * WHAT THIS ACTUALLY IS: A WIDENING, NOT A NEW FIELD
 * --------------------------------------------------
 * `contacts.category` has existed since v2.82 — one of vip/family/friend/team, or
 * NULL. The contract asks for `tags: ContactTag[]`, 0..n. So the store already had
 * this idea; what changes is the arity.
 *
 * That framing decides the migration. There is NO backfill: a row with a category
 * and no tags reads as `[category]`, which is exactly what it always meant. Every
 * pre-release contact therefore lands in the right section on the first render
 * with nothing run against the database.
 *
 * `category` IS KEPT AS A DERIVED MIRROR, AND THAT IS DELIBERATE
 * -------------------------------------------------------------
 * It is on the wire, and during a rolling deploy a not-yet-updated client is still
 * reading it. So the writer sets it from `tags[0]`, never independently — one
 * writer, so the two cannot drift, and a test pins that. Dropping the column
 * outright would blank the category for every client on the old bundle for the
 * ~60s of a deploy; writing it by hand in two places is how they come to disagree.
 *
 * TAGS ARE THE VIEWER'S OWN LABELS
 * --------------------------------
 * The contract is explicit — "never synced to the peer". They live on the OWNER's
 * contact row, which is already scoped by `ownerId`, so that property comes for
 * free and there is nothing to enforce. Worth saying out loud anyway: a future
 * "share my tags" would be a disclosure of what you privately call somebody.
 */

/** The four assignable tags. Order is the contract's section order. */
export const CONTACT_TAGS = ["vip", "family", "friend", "team"] as const;
export type ContactTag = (typeof CONTACT_TAGS)[number];

/**
 * VIP IS A CHIP, NOT A SECTION (contract §1).
 *
 * Every other tag derives a section; VIP renders as a gold chip on the row
 * wherever that row already appears. This is the one asymmetry in the model, so it
 * is named here rather than being a condition buried in the list component — a
 * section list that hardcodes "all tags except the first" is how VIP comes back as
 * a section the next time somebody adds a tag.
 */
export const SECTION_TAGS = ["family", "friend", "team"] as const;
export type SectionTag = (typeof SECTION_TAGS)[number];

/** The board's chip colours (contract §1). Not a theme token: these are four fixed
 *  identities, and the cycling accent must not be one of them or a tag would
 *  change colour under the reader. */
export const TAG_COLOR: Record<ContactTag, string> = {
  vip: "#e8c94a",
  family: "#f9a8d4",
  friend: "#93c5fd",
  team: "#c4b5fd",
};

export const TAG_LABEL: Record<ContactTag, string> = {
  vip: "VIP",
  family: "Family",
  friend: "Friend",
  team: "Team",
};

function isTag(v: unknown): v is ContactTag {
  return typeof v === "string" && (CONTACT_TAGS as readonly string[]).includes(v);
}

/**
 * Parse the stored form into an ordered, de-duplicated tag list.
 *
 * FAILS TO EMPTY, NEVER TO A GUESS. This value is rendered as somebody's own
 * labels for a person; a malformed row should show no tags rather than invent one.
 * Unknown entries are DROPPED rather than rejecting the whole list, so a row
 * written by a future build carrying a fifth tag still shows the four this build
 * understands instead of losing all of them.
 *
 * ORDER IS THE USER'S, NOT `CONTACT_TAGS`'s — the contract says "ordered (first tag
 * = row chip)", so the stored sequence is meaning, not incidental.
 */
export function parseContactTags(stored: unknown): ContactTag[] {
  const raw = typeof stored === "string" ? stored.split(",") : Array.isArray(stored) ? stored : [];
  const out: ContactTag[] = [];
  for (const v of raw) {
    const t = typeof v === "string" ? v.trim().toLowerCase() : v;
    if (isTag(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** The stored form: a comma-separated set, or null for none. NULL rather than ""
 *  so "never set" and "explicitly cleared" look the same to every reader — there
 *  is no meaningful difference between them for a label set. */
export function serializeContactTags(tags: readonly ContactTag[]): string | null {
  const clean = parseContactTags(tags as unknown[]);
  return clean.length ? clean.join(",") : null;
}

/**
 * The tags a stored row means, given BOTH columns.
 *
 * This is the whole compatibility story in one function: `tags` when it has
 * anything, else the legacy single `category`, else none. Every reader goes
 * through it, so no surface can end up showing a v2.82 contact as untagged.
 */
export function contactTagsOf(row: {
  tags?: string | null;
  category?: string | null;
}): ContactTag[] {
  const t = parseContactTags(row.tags ?? null);
  if (t.length) return t;
  return parseContactTags(row.category ?? null);
}

/** The value `contacts.category` must carry for a given tag list — the mirror.
 *  Exported so the writer has exactly one expression to use and a test can pin
 *  that nothing else computes it. */
export function categoryMirror(tags: readonly ContactTag[]): ContactTag | null {
  return tags[0] ?? null;
}

/** The chip a row shows: the first tag (contract: "first tag = row chip"). */
export function primaryTag(tags: readonly ContactTag[]): ContactTag | null {
  return tags[0] ?? null;
}

/** Toggle one tag, preserving the order of the rest. Assignment is a toggle
 *  because 4a's chips are the editor — tapping an assigned chip must remove it, or
 *  there is no way to unassign without a second control. */
export function toggleContactTag(
  tags: readonly ContactTag[],
  tag: ContactTag
): ContactTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/* ────────────────────────────────────────────────────────────────────────────
   3b — the sections.
   ──────────────────────────────────────────────────────────────────────────── */

export type SectionKey = "online" | "favorites" | SectionTag | "other";

export interface TaggableContact {
  number: string;
  tags: ContactTag[];
  favourite: boolean;
  /** Derived elsewhere (presence + the guest-privacy suppression) so this module
   *  stays free of presence rules — there is exactly one place that decides who
   *  counts as online (v2.99.97) and it is not here. */
  online: boolean;
}

/**
 * Which sections a contact list produces, in the contract's order.
 *
 * A CONTACT APPEARS IN EVERY SECTION IT QUALIFIES FOR — the contract says so, and
 * it is what makes ONLINE and FAVORITES cross-cutting rather than rival categories
 * (v2.99.97 established that for ONLINE). So this returns membership, not a
 * partition, and the same person legitimately appears three times.
 *
 * "OTHER" CATCHES THE UNTAGGED, because a contact with no tags must not vanish
 * from a screen whose whole job is listing contacts. It is emitted LAST and only
 * when non-empty.
 */
export function sectionsFor(contacts: readonly TaggableContact[]): {
  key: SectionKey;
  contacts: TaggableContact[];
}[] {
  const out: { key: SectionKey; contacts: TaggableContact[] }[] = [];
  const push = (key: SectionKey, rows: TaggableContact[]) => {
    if (rows.length) out.push({ key, contacts: rows });
  };
  push("online", contacts.filter((c) => c.online));
  push("favorites", contacts.filter((c) => c.favourite));
  for (const t of SECTION_TAGS) push(t, contacts.filter((c) => c.tags.includes(t)));
  /* "OTHER" MEANS "IN NO SECTION", NOT "UNTAGGED" — and that distinction is a real
     bug I wrote and this file's own test caught. Keyed on `tags.length === 0`, a
     contact tagged ONLY `vip` qualifies for nothing: VIP is a chip rather than a
     section, so it has no section of its own, and it is not untagged either. The
     row disappeared from the contacts screen entirely.
     Favourites are excluded for the separate reason that they are already shown
     above — listing one person twice adds no information. */
  push(
    "other",
    contacts.filter(
      (c) => !c.tags.some((t) => (SECTION_TAGS as readonly string[]).includes(t)) && !c.favourite
    )
  );
  return out;
}

/** The count pair a section header carries: total, and how many are online. */
export function sectionCounts(rows: readonly TaggableContact[]): {
  total: number;
  online: number;
} {
  return { total: rows.length, online: rows.filter((c) => c.online).length };
}

/** The top filter chips (contract: "All · VIP · Family · Friend · Team",
 *  single-select). `null` is All. */
export function filterContacts<T extends { tags: ContactTag[] }>(
  contacts: readonly T[],
  filter: ContactTag | null
): T[] {
  return filter ? contacts.filter((c) => c.tags.includes(filter)) : [...contacts];
}
