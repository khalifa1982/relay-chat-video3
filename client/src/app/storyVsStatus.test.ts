/**
 * v2.101.0 — STORY and STATUS stop being the same word.
 *
 * The owner corrected this vocabulary twice, and it was still wrong throughout:
 *
 *   *"For the story is the one on the message where you can post video, voice,
 *   text, image… The status will be showing on your profile, and it will give you,
 *   like, you are in work, vacation, travel, free, and you can put some notes on
 *   it… So fix the pronouncing properly everywhere."*
 *
 * So: a STORY is the ephemeral post on Messages that people react and reply to,
 * signified by the avatar ring. A STATUS is the profile label.
 *
 * THE RENAME IS DELIBERATELY USER-FACING ONLY. The `statuses` table, the `status.*`
 * tRPC router and the `relay:open-status` event keep their names, because a
 * half-renamed API is worse than a consistently-misnamed one — a caller reading
 * `status.feed` and finding it returns stories has one thing to learn, whereas a
 * codebase where some story paths say story and others say status has a trap in it.
 * That decision is asserted here so it reads as a choice rather than an omission.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SHELL = read("client/src/app/AppShell.tsx");
const OVERLAYS = read("client/src/app/PeerOverlays.tsx");
const TOPBAR = read("client/src/app/TopBar.tsx");
const STATUS = read("client/src/pages/app/Status.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const PANE = read("client/src/app/profilePane.ts");

const SURFACES: Array<[string, string]> = [
  ["AppShell.tsx", SHELL],
  ["PeerOverlays.tsx", OVERLAYS],
  ["TopBar.tsx", TOPBAR],
  ["Status.tsx", STATUS],
  ["Messages.tsx", MESSAGES],
  ["Profile.tsx", PROFILE],
];

/**
 * Every user-visible string literal on a surface: the things a person actually
 * reads. Comments are stripped first — the point is what the app SAYS, and a
 * comment explaining the distinction legitimately uses both words.
 */
function visibleStrings(src: string): string[] {
  const code = src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  const out: string[] = [];
  // Only the attributes and calls that put text in front of somebody.
  for (const re of [
    /(?:title|placeholder|aria-label)=\{?"([^"]{2,})"/g,
    /(?:title|placeholder|aria-label)=\{`([^`]{2,})`/g,
    /toast\.(?:success|error|info|message)\(\s*"([^"]{2,})"/g,
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

describe("the ephemeral post is called a STORY", () => {
  it("no user-visible title, placeholder, aria-label or toast calls a story a status", () => {
    // The one exception is the profile label itself, which IS a status: Profile's
    // "Who can see my stories" was renamed, and the audience control is about
    // stories, so nothing on these surfaces should say "status" to a person.
    const offenders: string[] = [];
    for (const [name, src] of SURFACES) {
      for (const s of visibleStrings(src)) {
        if (/\bstatus(es)?\b/i.test(s)) offenders.push(`${name}: "${s}"`);
      }
    }
    expect(offenders, `these still say "status" to the user:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the ring, the pip and the viewer all say story", () => {
    expect(OVERLAYS).toMatch(/"New story — tap to view"/);
    expect(OVERLAYS).toMatch(/"View story"/);
    expect(OVERLAYS).toMatch(/View \$\{label\}'s story/);
    expect(TOPBAR).toMatch(/title="You have an active story"/);
    expect(SHELL).toMatch(/title="New stories"/);
  });

  it("the composer and the viewer say story", () => {
    expect(STATUS).toMatch(/>New story</);
    expect(STATUS).toMatch(/placeholder="Type a story…"/);
    expect(STATUS).toMatch(/Share story/);
    expect(STATUS).toMatch(/"My story"/);
    expect(STATUS).toMatch(/Story deleted/);
    expect(STATUS).toMatch(/aria-label="Reply to this story"/);
  });

  it("a story reply in a chat bubble says story", () => {
    // v2.99.80 put a "replied to your status" chip on the message. It is a reply to
    // a STORY, and the chip is the only thing telling the recipient what it was about.
    expect(MESSAGES).toMatch(/"Replied to their story" : "Replied to your story"/);
    expect(MESSAGES).toMatch(/text: "Story",/);
    expect(MESSAGES).toMatch(/image: "📷 Photo story",/);
    expect(MESSAGES).toMatch(/video: "🎬 Video story",/);
    expect(MESSAGES).toMatch(/audio: "🎤 Audio story",/);
  });

  it("the audience control is about STORIES, and says so", () => {
    // `statusAudience` gates who can see an ephemeral post — a story — not the
    // profile label. This row used to read "Status privacy", which named the wrong
    // feature entirely.
    expect(PROFILE).toMatch(/privacy: "Story privacy",/);
    expect(PROFILE).toMatch(/sub="Who can watch your stories"/);
    expect(PROFILE).toMatch(/aria-label="Who can see my stories"/);
  });

  it("the PROFILE LABEL is still called Status — the rename is one-directional", () => {
    // Renaming this too would have swapped one wrong word for another. The pane
    // that opens `StatusSection` (the away/travel picker) is the status.
    expect(PROFILE).toMatch(/    status: "Status",/);
    expect(PROFILE).toMatch(/pane === "status" && <StatusSection/);
  });

  it("the API keeps its names, deliberately", () => {
    // A half-renamed API is worse than a consistently-misnamed one. Asserted so the
    // next person reads this as a decision.
    expect(OVERLAYS).toMatch(/const OPEN_STATUS = "relay:open-status"/);
    expect(SHELL).toMatch(/trpc\.status\.mine\.useQuery/);
    expect(STATUS).toMatch(/trpc\.status\./);
  });
});

describe("the avatar menu, to the owner's own list", () => {
  /**
   * The avatar menu's own body, with COMMENTS STRIPPED.
   *
   * Two reasons. The `{/* … *\/}` block inside it explains why opening a story is
   * imperative and quotes `navigate("/app/status")` to say what it is NOT — which a
   * `not.toMatch` for that call happily matched, the prose trap this repo has now hit
   * nine times. And the slice is anchored on the ONE menu that carries these items
   * (the shell has three DropdownMenuContent blocks), asserted by count so a second
   * copy of this menu could not appear without being noticed.
   */
  const menu = () => {
    expect(SHELL.match(/Open my story/g)?.length).toBe(1);
    const anchor = SHELL.indexOf("Open my story");
    const at = SHELL.lastIndexOf("<DropdownMenuContent", anchor);
    const end = SHELL.indexOf("</DropdownMenuContent>", anchor);
    expect(at).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(at);
    return SHELL.slice(at, end)
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
  };

  it("carries open story / add story / set status / profile / sign out", () => {
    // The owner's words: *"open story / add story / add status / profile / log out"*.
    const m = menu();
    expect(m).toMatch(/Open my story/);
    expect(m).toMatch(/Add a story/);
    expect(m).toMatch(/Set my status/);
    expect(m).toMatch(/Profile/);
    expect(m).toMatch(/Sign out/);
  });

  it("ADD-a-story is offered even when one already exists", () => {
    // It used to be an either/or: having a story replaced the composer entry with a
    // viewer entry, so somebody with one story had no way to post a second from
    // here. Only the OPEN row is conditional now.
    const m = menu();
    expect(m).toMatch(/\{hasStatus && \(/);
    expect(m).not.toMatch(/\{hasStatus \? \(/);
    // …and the add row sits outside that conditional.
    const cond = m.indexOf("{hasStatus && (");
    const closes = m.indexOf(")}", cond);
    expect(m.slice(cond, closes)).not.toMatch(/Add a story/);
  });

  it("opening a story goes through the imperative host, never a route", () => {
    // There is no `/app/status` route — stories are a strip atop Messages — so a
    // navigate() here would be a silent no-op no source pin could catch (v2.99.86).
    expect(menu()).toMatch(/openPeerStatus\(me\.number\)/);
    expect(menu()).not.toMatch(/navigate\("\/app\/status"\)/);
  });

  it("Set my status sets the intent AND navigates, in one handler", () => {
    // Both in the same onClick, so the intent can never be set without navigating
    // (which would silently open a pane on some later visit) and navigation can
    // never happen without the intent (which would land on the hub).
    //
    // Their ORDER is deliberately NOT asserted. A mutation that swapped them
    // survived, and it was right to: both calls are synchronous and Profile mounts
    // in a later render either way, so the order carries no behaviour today.
    // Pinning it would have frozen an arbitrary detail as though it were a property.
    const m = menu();
    const at = m.indexOf('requestProfilePane("status")');
    expect(at).toBeGreaterThan(0);
    const handler = m.slice(m.lastIndexOf("onClick={", at), m.indexOf("}}", at));
    expect(handler).toMatch(/requestProfilePane\("status"\)/);
    expect(handler).toMatch(/navigate\("\/app\/profile"\)/);
  });
});

describe("the out-of-band pane request", () => {
  it("is one-shot: the read clears it", () => {
    // Otherwise returning to Profile later silently reopens a pane the person shut.
    expect(PANE).toMatch(/sessionStorage\.removeItem\(KEY\)/);
    const fn = PANE.slice(PANE.indexOf("export function takeProfilePane"));
    expect(fn.indexOf("getItem")).toBeLessThan(fn.indexOf("removeItem"));
  });

  it("degrades instead of throwing when storage is unavailable", () => {
    // Private mode and some embedded webviews throw on sessionStorage. Landing on
    // the hub is one extra tap; an exception on the way to a page is a broken app.
    expect((PANE.match(/try \{/g) || []).length).toBe(2);
    expect((PANE.match(/catch \{/g) || []).length).toBe(2);
  });

  it("is NOT a URL, and the reason is recorded", () => {
    // wouter's useLocation returns pathname only, so `#pane` re-renders nothing —
    // the tap would do nothing with no error to explain why (v2.99.89).
    expect(PANE).toMatch(/pathname/);
    expect(PROFILE).not.toMatch(/location\.hash/);
  });

  it("Profile validates the requested pane against the REAL set", () => {
    // An unknown value must land on the hub rather than put the page into a state it
    // has no branch for — and the set is derived from one runtime list, so a pane
    // added later cannot become un-requestable with nothing to say so.
    expect(PROFILE).toMatch(/const PANES = \[/);
    expect(PROFILE).toMatch(/type Pane = \(typeof PANES\)\[number\]/);
    expect(PROFILE).toMatch(/if \(want && PANES\.includes\(want as Pane\)\) openPane\(want as Pane\)/);
  });

  it("every pane the hub can open is in that list", () => {
    // Cross-checked against the panes actually rendered, so the list cannot rot.
    const rendered = new Set(
      Array.from(PROFILE.matchAll(/pane === "(\w+)"/g)).map((m) => m[1])
    );
    const declared = PROFILE.slice(PROFILE.indexOf("const PANES = ["), PROFILE.indexOf("] as const"));
    expect(rendered.size).toBeGreaterThan(5);
    for (const p of rendered) {
      expect(declared, `pane "${p}" is rendered but not declared`).toMatch(new RegExp(`"${p}"`));
    }
  });
});
