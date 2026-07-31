/* ============================================================
   v2.99.66 — OWNER UI BATCH (five screenshots).

   1. The dialer preview read "last seen on Jul 23" with no clock — "it shows you
      below last seen on this, but doesn't show you the time and the minutes".
   2a. The composer carried a separate image button and paperclip; the owner asked
      for "the attachment and the image into one icon like you click a plus… so it
      will give more space for the input box of chatting".
   2b. The chat header's bell + magnifier squeezed the name to "Ibrahi…" and left
      "last seen" with nothing after it. They move into the peer's profile ("make
      it inside the profile of the person when you click on his name"), which is
      also where the full last-seen date and time now live.
   3. The landing page's live counters go on the sign-in screen too, below the
      login/register card and above the Voice/Video/Chat chips, and gain a
      MESSAGES figure alongside registered / guests / call parties / online.
   4. The away auto-reply existed but fired for everyone unconditionally. It is
      now opt-in ("you should allow the user to enable and disable it. You don't
      enable it by default").
   5. Contacts rows put "last seen" beside the PIN with no room, so every row
      wrapped mid-phrase. It moves BELOW the pin.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatLastSeen } from "@shared/profileFields";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.resolve(root, ...p), "utf8");
const MESSAGES = read("client", "src", "pages", "app", "Messages.tsx");
const CONTACTS = read("client", "src", "pages", "app", "Contacts.tsx");
const OVERLAYS = read("client", "src", "app", "PeerOverlays.tsx");
const GATE = read("client", "src", "app", "OnboardingGate.tsx");
const LIVESTATS = read("client", "src", "app", "LiveStats.tsx");
const HOME = read("client", "src", "pages", "Home.tsx");
const V2DB = read("server", "v2db.ts");
const ROUTERS = read("server", "v2routers.ts");
const SCHEMA = read("drizzle", "schema.ts");

describe("1 — last seen carries the time on every dated branch", () => {
  const base = new Date("2026-07-25T15:30:00").getTime();

  it("an older day now reports the clock, not just the date", () => {
    expect(formatLastSeen(new Date("2026-07-23T14:07:00").getTime(), base)).toBe(
      "last seen on Jul 23 at 2:07 PM"
    );
  });

  it("today and yesterday are unchanged", () => {
    expect(formatLastSeen(new Date("2026-07-25T09:05:00").getTime(), base)).toBe(
      "last seen today at 9:05 AM"
    );
    expect(formatLastSeen(new Date("2026-07-24T22:30:00").getTime(), base)).toBe(
      "last seen yesterday at 10:30 PM"
    );
  });

  it("a different year is named, so a date can't silently read as this year", () => {
    expect(formatLastSeen(new Date("2025-07-23T14:07:00").getTime(), base)).toBe(
      "last seen on Jul 23, 2025 at 2:07 PM"
    );
  });

  it("minutes and invalid stamps behave as before", () => {
    expect(formatLastSeen(base - 5 * 60_000, base)).toBe("last seen 5 minutes ago");
    expect(formatLastSeen(0, base)).toBe("");
  });
});

describe("2a — one + replaces the media and paperclip buttons", () => {
  it("the composer has a single attach control", () => {
    /* RE-ANCHORED (v2.106.40). This sliced from the composer row's opening div to `<Input`,
       which located the control by its POSITION BESIDE THE FIELD — so board 1d moving it
       INSIDE the field turned it red while saying nothing about the property. THE PROPERTY
       is that there is exactly ONE attach affordance and the two icons it replaced are not
       buttons anywhere in the composer, wherever the one control now sits. */
    const composer = MESSAGES.slice(
      MESSAGES.indexOf('<div className="flex items-end gap-1.5">'),
      MESSAGES.indexOf('aria-label={recording ? "Stop" : "Record"}'),
    );
    expect(composer.length).toBeGreaterThan(500);
    expect((composer.match(/<Plus className=/g) ?? []).length, "exactly one").toBe(1);
    // The two icons it replaced must no longer be buttons in the composer.
    expect(composer).not.toMatch(/<ImageIcon className="size-5"/);
    expect(composer).not.toMatch(/<Paperclip className="size-5"/);
  });

  it("the menu it opens offers media AND file, so nothing was lost", () => {
    const menu = MESSAGES.slice(
      MESSAGES.indexOf("{attachMenuOpen && ("),
      MESSAGES.indexOf("{expire !== null && (")
    );
    expect(menu).toMatch(/Photo &amp; video/);
    expect(menu).toMatch(/Attach file/);
    expect(menu).toMatch(/Record video/);
    // The file picker is what the paperclip used to open.
    expect(menu).toMatch(/fileRef\.current\?\.click\(\)/);
    expect(menu).toMatch(/imageRef\.current\?\.click\(\)/);
    // Record video only when the in-app recorder actually exists.
    expect(menu).toMatch(/videoRecorderSupported\(\) && \(/);
  });

  it("the + is a plain toggle — it no longer depends on recorder support", () => {
    // It used to open the menu only when a recorder existed and otherwise jump
    // straight to the library, which would now hide "Attach file" entirely.
    const composer = MESSAGES.slice(
      MESSAGES.indexOf('<div className="flex items-end gap-1.5">'),
      MESSAGES.indexOf('aria-label={recording ? "Stop" : "Record"}'),
    );
    expect(composer.length).toBeGreaterThan(500);
    expect(composer).toMatch(/onClick=\{\(\) => setAttachMenuOpen\(\(v\) => !v\)\}/);
  });
});

describe("2b — search and notifications live in the peer profile", () => {
  it("the header no longer carries them permanently", () => {
    const header = MESSAGES.slice(
      MESSAGES.indexOf('className="flex-1 min-w-0 leading-tight"'),
      MESSAGES.indexOf("Voice call")
    );
    expect(header).not.toMatch(/Mute conversation/);
    expect(header).not.toMatch(/Search this conversation/);
    // Closing an OPEN search stays inline — it acts on what's on screen.
    expect(header).toMatch(/\{searchOpen && \(/);
  });

  it("tapping the name passes this conversation's actions to the profile", () => {
    expect(MESSAGES).toMatch(/openPeerProfile\(thread\.peerNumber, peerProfileChat\)/);
    const memo = MESSAGES.slice(
      MESSAGES.indexOf("const peerProfileChat"),
      MESSAGES.indexOf("const peerProfileChat") + 700
    );
    expect(memo).toMatch(/onSearch: \(\) => setSearchOpen\(true\)/);
    expect(memo).toMatch(/onToggleMute: \(\) => setMuted\(!muted\)/);
    expect(memo).toMatch(/lastSeenText:/);
    expect(memo).toMatch(/formatLastSeen\(/);
    // Rebuilt when mute changes, or the popup would act on a stale value.
    expect(memo).toMatch(/\[muted, setMuted, thread\?\.peerLastSeenAt\]/);
  });

  it("the popup renders them only when opened from a conversation", () => {
    expect(OVERLAYS).toMatch(/export interface PeerProfileChatActions/);
    expect(OVERLAYS).toMatch(/openPeerProfile\(number: string, chat\?: PeerProfileChatActions\)/);
    expect(OVERLAYS).toMatch(/\{\(chatActions\?\.onSearch \|\| chatActions\?\.onToggleMute\) && \(/);
    // Contacts / History / the dialer pass nothing and are unaffected.
    expect(CONTACTS).toMatch(/openPeerProfile\(c\.number\)/);
  });

  it("the popup shows the full last-seen line when the caller supplies one", () => {
    /* Pinned as the PROPERTY — a caller-supplied line takes PRECEDENCE over the derived
     * one — rather than as the exact expression. It used to freeze
     * `chatActions?.lastSeenText || presenceLine(p)`, so it broke the moment v2.105.24
     * moved that rule into `shared/profileFields.ts` as `describePeerPresence` (a third
     * surface, the outgoing dial card, needed the same answer) while saying nothing about
     * whether the precedence still held. */
    expect(OVERLAYS).toMatch(/chatActions\?\.lastSeenText \|\|\s*describePeerPresence\(p\)/);
    // Imported, never re-implemented locally: two copies is the divergence this move fixed.
    expect(OVERLAYS).toMatch(/import \{ describePeerPresence \} from "@shared\/profileFields"/);
    expect(OVERLAYS).not.toMatch(/function (?:presenceLine|describePeerPresence)\(/);
  });
});

describe("3 — live counters on the sign-in screen", () => {
  it("sits below the card and above the Voice/Video/Chat chips", () => {
    const at = GATE.indexOf("<LiveStats");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(GATE.indexOf("{/* Feature chips */}"));
    expect(GATE).toMatch(/import \{ LiveStats \} from "\.\/LiveStats";/);
  });

  it("shows all five figures and marks the live one", () => {
    for (const label of ["Registered", "Guests served", "Call parties", "Messages", "Online now"]) {
      expect(LIVESTATS, `${label} is shown`).toContain(label);
    }
    expect(LIVESTATS).toMatch(/live: true/);
    // v2.99.71 REWROTE this half rather than relaxing it. It pinned
    // `refetchInterval: 15_000` — the polling that has now been replaced by a pushed
    // SSE feed, which is the whole point of that release. The durable invariant is
    // that the figures come from the SHARED live source, not the cadence of a poll
    // that no longer exists here.
    expect(LIVESTATS).toMatch(/const d = useLiveStats\(\);/);
    expect(LIVESTATS).not.toMatch(/refetchInterval/);
  });

  it("renders nothing rather than a wall of zeros when the query has no data", () => {
    // getPublicStats answers zeros when the DB is down; five "0"s on the
    // sign-in screen would read as a broken product.
    expect(LIVESTATS).toMatch(/if \(!d\) return null;/);
  });

  it("the landing page gained the same MESSAGES figure, in both languages", () => {
    expect(HOME).toMatch(/statMessages: "MESSAGES SENT"/);
    expect(HOME).toMatch(/statMessages: "رسائل مُرسلة"/);
    expect(HOME).toMatch(/\$\{tile\("messages", t\.statMessages\)\}/);
    expect(HOME).toMatch(/put\("messages", d\.messagesSent\)/);
  });

  it("the server counts messages, aggregate-only and never fatally", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function getPublicStats"),
      V2DB.indexOf("export async function getPublicStats") + 2200
    );
    expect(fn).toMatch(/messagesSent/);
    expect(fn).toMatch(/count\(\*\)/);
    // A headline number must never stop the landing page rendering.
    expect(fn).toMatch(/try \{[\s\S]*?\} catch \{\s*\n?\s*messagesSent = 0;/);
    // Zero-filled on a dead DB, like the other four.
    expect(fn).toMatch(/onlineNow: 0, messagesSent: 0/);
  });
});

describe("4 — the away auto-reply is opt-in", () => {
  it("stored per IDENTITY, so guests can set it and it survives registration", () => {
    expect(SCHEMA).toMatch(/autoReplyEnabled: boolean\("autoReplyEnabled"\)/);
    expect(V2DB).toMatch(
      /table: "identities", column: "autoReplyEnabled", ddl: "ADD COLUMN `autoReplyEnabled` boolean"/
    );
  });

  it("only an explicit true counts — NULL is off for existing rows", () => {
    expect(V2DB).toMatch(/autoReplyEnabled: row\.autoReplyEnabled === true/);
    const reader = V2DB.slice(
      V2DB.indexOf("export async function autoReplyEnabledFor"),
      V2DB.indexOf("export async function markIdentityVerified")
    );
    expect(reader).toMatch(/return rows\[0\]\?\.on === true;/);
    // Fails CLOSED: it posts a line in someone's name while they're away.
    expect(reader).toMatch(/if \(!db\) return false;/);
    expect(reader).toMatch(/catch \{\s*\n?\s*return false;/);
  });

  it("the send path checks the PEER's choice before anything else", () => {
    // Bounded by the block's OWN end rather than a fixed +1200 characters, which
    // silently shrank as the comments above the presence read grew — the v2.99.78
    // lesson, and it broke on v2.99.92's added explanation of why this one
    // deliberately does NOT use the shared notification rule.
    const blockAt = ROUTERS.indexOf("// Offline auto-reply (1:1 only");
    const block = ROUTERS.slice(blockAt, ROUTERS.indexOf("\n      } catch {", blockAt));
    expect(block.length).toBeGreaterThan(400);
    expect(block).toMatch(/peerIds\.length === 1 && \(await autoReplyEnabledFor\(peerIds\[0\]\)\)/);
    // The pref gate precedes the presence and dedupe reads.
    expect(block.indexOf("autoReplyEnabledFor")).toBeLessThan(block.indexOf("getPresenceForIds"));
    expect(block.indexOf("autoReplyEnabledFor")).toBeLessThan(block.indexOf("recentAutoReplyExists"));
  });

  it("is reachable from the Messages section, as the owner asked", () => {
    expect(MESSAGES).toMatch(/function AutoReplyToggle\(\)/);
    expect(MESSAGES).toMatch(/<AutoReplyToggle \/>/);
    expect(MESSAGES).toMatch(/trpc\.identity\.setAutoReply\.useMutation/);
    expect(MESSAGES).toMatch(/Auto-reply when I'm away/);
    expect(MESSAGES).toMatch(/Off by default/);
    // Optimistic with a real rollback, so the switch can't misreport its state.
    const c = MESSAGES.slice(MESSAGES.indexOf("function AutoReplyToggle()"));
    expect(c.slice(0, 2200)).toMatch(/onError:[\s\S]*?setData\(undefined, cxt\.prev\)/);
  });

  it("the endpoint exists and whoami reports the current value", () => {
    expect(ROUTERS).toMatch(/setAutoReply: publicProcedure/);
    expect(ROUTERS).toMatch(/await setIdentityAutoReply\(me\.id, input\.enabled\)/);
    expect(ROUTERS).toMatch(/autoReplyEnabled: ctx\.identity\.autoReplyEnabled/);
  });
});

/* Was "5 — contacts put last seen below the pin". v2.99.66 put the PIN above the presence
   line because they had shared one line and every row wrapped mid-phrase; v2.106.43 REVERSED
   the order at the owner's request, because after the two-line split the PIN was `shrink-0`
   in front of the only shrinkable thing and the presence line read "last seen …" at every
   width. The arrangement is theirs to choose; what these two guard is the property that
   survives either arrangement. */
describe("5 — contacts keep the pin and the presence line apart, and every state renders", () => {
  /* RE-ANCHORED (v2.106.41). Both of these sliced 1400 characters from the COMMENT "PIN on
     its own line" — the prose-anchor trap, and board 1e moved the PIN onto its own LINE 2
     (measured: the single-line row left the name 119px of the 228 it needs), so the anchor
     went with it. The property survives the move: the PIN is its own element, LTR-isolated,
     never glued to the presence text with a middot, and every presence state still renders.
     Anchored on the PIN'S OWN CODE now, which no comment can move. */
  /** The presence line's own element, wherever in the row it now sits. */
  const presenceEl = () => {
    const at = CONTACTS.indexOf("last seen {relativeTime(c.lastSeenAt)}");
    expect(at, "the presence line").toBeGreaterThan(-1);
    return CONTACTS.slice(CONTACTS.lastIndexOf("<span", CONTACTS.lastIndexOf("{c.blocked ?", at)), at + 200);
  };

  it("the pin and the presence line are separate elements, never one joined string", () => {
    /* The defect v2.99.66 fixed was that they SHARED a line and wrapped mid-phrase, so what
       must never come back is the two being concatenated into one run. Which line each sits on
       is the owner's call and has now changed twice; that they are distinct elements has not. */
    const pinAt = CONTACTS.indexOf("{c.number.length === 6 ? c.number.slice(0, 3)");
    const seenAt = CONTACTS.indexOf("last seen {relativeTime(c.lastSeenAt)}");
    expect(pinAt).toBeGreaterThan(-1);
    expect(seenAt).toBeGreaterThan(-1);
    // Distinct elements: there is a tag boundary between them, whichever order they are in.
    const between = CONTACTS.slice(Math.min(pinAt, seenAt), Math.max(pinAt, seenAt));
    expect(between, "a real element boundary separates them").toMatch(/<\/span>/);
    // The PIN is still LTR-isolated, which is what stops an RTL name reordering its groups.
    const pinSpan = CONTACTS.slice(CONTACTS.lastIndexOf("<span", pinAt), pinAt);
    expect(pinSpan).toMatch(/dir="ltr"/);
    expect(pinSpan).toMatch(/\[unicode-bidi:isolate\]/);
    // The pre-v2.99.66 shape glued them with a middot; that must stay gone.
    expect(CONTACTS).not.toMatch(/<> · last seen/);
  });

  it("keeps the blocked / on-a-call / online states it had", () => {
    const el = presenceEl();
    for (const state of ["blocked", "on a call", "online"]) {
      expect(el, `${state} still rendered`).toContain(state);
    }
    // Presence hidden still renders nothing at all.
    expect(el).toMatch(/c\.presenceHidden \? null/);
  });
});
