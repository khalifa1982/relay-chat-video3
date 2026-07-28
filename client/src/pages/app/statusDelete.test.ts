/* ============================================================
   v2.99.87 — a status that will not delete now says why.

   Owner, with a screenshot of their own story viewer: "i put status but i found
   something that i cant delete and i dunno why it showing and when i posted it ??!!
   The other status showing i can delete it and who viewed but the first one is
   award [weird]?"

   THE DEFECT WAS THAT THE UI THREW THE SERVER'S ANSWER AWAY. `status.remove`
   answers `{ ok: false }` — deliberately NOT an error — whenever `deleteStatus`
   finds the row's `identityId` is not the caller's. The handler was:

       await remove.mutateAsync({ id: item.id }).catch(() => {});
       await utils.status.feed.invalidate();
       next();

   which lies three separate ways: the `.catch` swallows a real transport failure,
   the `ok` verdict is never read, and it advances regardless — so the story slides
   past, comes back on the next open, and tapping Delete looks like it worked.
   Whatever the underlying data situation, "nothing happened and nobody said
   anything" is the bug the owner actually experienced.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const STATUS = read("client/src/pages/app/Status.tsx");
const ROUTERS = read("server/v2routers.ts");
const DB = read("server/v2db.ts");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** The delete button's handler. */
const HANDLER = (() => {
  const at = STATUS.indexOf("<Trash2 className=\"size-4\" /> {remove.isPending");
  expect(at, "the Delete button exists").toBeGreaterThan(0);
  const start = STATUS.lastIndexOf("<button", at);
  const s = STATUS.slice(start, at);
  expect(s.length).toBeGreaterThan(400);
  return s;
})();

describe("the server genuinely can refuse a delete", () => {
  it("deleteStatus returns FALSE when the row is not the caller's", () => {
    // This is why the verdict has to be read: a refusal is a normal return value,
    // not a thrown error, so a `.catch()` cannot see it.
    const fn = DB.slice(DB.indexOf("export async function deleteStatus"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    expect(body).toMatch(/eq\(statuses\.identityId, ownerId\)/);
    expect(body).toMatch(/if \(!own\) return false;/);
  });

  it("status.remove passes that boolean through to the client", () => {
    const r = ROUTERS.slice(ROUTERS.indexOf("  /** Delete one of my statuses. */"));
    const body = r.slice(0, r.indexOf("\n    }),") + 8);
    expect(body).toMatch(/const ok = await deleteStatus\(input\.id, me\.id\);/);
    expect(body).toMatch(/return \{ ok \};/);
    // Argument ORDER matters and is easy to get backwards: deleteStatus(id, ownerId)
    // while its neighbour deleteContact is (ownerId, contactId).
    expect(body).not.toMatch(/deleteStatus\(me\.id, input\.id\)/);
  });
});

describe("the client reads the verdict instead of discarding it", () => {
  it("no longer swallows the result with a bare catch", () => {
    expect(codeOnly(HANDLER)).not.toMatch(/mutateAsync\(\{ id: item\.id \}\)\.catch\(\(\) => \{\}\)/);
    expect(HANDLER).toMatch(/const res = await remove\.mutateAsync\(\{ id: item\.id \}\);/);
    expect(HANDLER).toMatch(/ok = !!res\?\.ok;/);
  });

  it("says something when the delete is REFUSED, and does not advance", () => {
    // Advancing on a refusal is what made it look like it had worked.
    expect(HANDLER).toMatch(/if \(!ok\) \{/);
    // The message describes the EFFECT and what to do, and deliberately asserts no
    // cause: the first version blamed a second identity on the browser and the
    // owner's own data disproved it (both of their statuses are on the identity
    // they are signed into). A stale cached id after the 24h reaper is the likelier
    // cause, but "likelier" is not grounds for telling somebody why.
    expect(HANDLER).toMatch(/no longer there to delete/);
    expect(HANDLER).not.toMatch(/different sign-in/);
    const refusal = HANDLER.slice(HANDLER.indexOf("if (!ok) {"));
    expect(refusal).toMatch(/return; \/\/ do NOT advance/);
  });

  it("says something when the request itself fails", () => {
    // v2.101.0: the ephemeral post is a STORY in every user-facing string.
    expect(HANDLER).toMatch(/toast\.error\("Couldn't reach the server — story not deleted\."\)/);
  });

  it("confirms a delete that DID happen", () => {
    expect(HANDLER).toMatch(/toast\.success\("Story deleted"\)/);
  });

  it("refreshes BOTH status reads, not just the feed", () => {
    // `status.mine` backs the avatar's status pip (v2.99.86) and the strip's own
    // ring. Invalidating only `feed` left them advertising a status that was gone.
    expect(HANDLER).toMatch(/utils\.status\.feed\.invalidate\(\)/);
    expect(HANDLER).toMatch(/utils\.status\.mine\.invalidate\(\)/);
  });

  it("re-clamps the index rather than stepping past a shorter list", () => {
    // Deleting shifts the array under the index; `next()` from the last item walked
    // off the end of a list that had just got shorter.
    expect(HANDLER).toMatch(/setIi\(\(v\) => Math\.max\(0, Math\.min\(v, \(group\.items\.length - 2\) \| 0\)\)\)/);
    expect(codeOnly(HANDLER)).not.toMatch(/\bnext\(\);/);
  });

  it("cannot be double-tapped into two deletes", () => {
    expect(HANDLER).toMatch(/disabled=\{remove\.isPending\}/);
    expect(STATUS).toMatch(/\{remove\.isPending \? "Deleting…" : "Delete"\}/);
  });
});

describe("when a story was posted", () => {
  it("keeps the relative time but exposes the exact one", () => {
    // "i dunno … when i posted it" — "16h ago" genuinely does not answer that.
    expect(STATUS).toMatch(/title=\{new Date\(item\.createdAt\)\.toLocaleString\(\)\}/);
    expect(STATUS).toMatch(/\{timeAgo\(item\.createdAt\)\}/);
  });

  it("the time is the CURRENT item's, not the group's newest", () => {
    // A per-group timestamp would mislabel every story but the newest.
    // v2.105.6: the header's name line branches on the reel kind (a group is named
    // in full and never as "My story"), so the anchor moved to timeAgo's own site.
    const hdr = STATUS.slice(STATUS.indexOf("{/* header */}"));
    const block = hdr.slice(0, hdr.indexOf("</div>", hdr.indexOf("timeAgo")));
    expect(block).toMatch(/timeAgo\(item\.createdAt\)/);
    expect(block).not.toMatch(/group\.items\[0\]|group\.newest/);
  });
});
