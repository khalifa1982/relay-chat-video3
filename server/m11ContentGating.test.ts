import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");

/**
 * v2.99.34 — M11: server-side ephemeral (view-once / disappearing) content
 * gating. Previously messages.list returned the full body + attachment for an
 * un-consumed expiring message, so a recipient could read the secret straight
 * out of the raw response (or fetch the attachment url) WITHOUT ever burning
 * it — defeating "view once". Now the content is withheld from list for a
 * LOCKED message and only handed back by revealExpiring, which burns it.
 */
describe("v2.99.34 M11 — list withholds locked expiring content", () => {
  it("nulls body + attachment for a locked (expiring, un-consumed, non-sender) message and flags it", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("list: publicProcedure"), ROUTERS.indexOf("search: publicProcedure"));
    expect(fn).toMatch(/const locked = isExpiring && !consumed && r\.senderIdentityId !== me\.id;/);
    expect(fn).toMatch(/body: locked \? null : r\.body/);
    expect(fn).toMatch(/attachment: locked \? null :/);
    expect(fn).toMatch(/\blocked,\n/); // the flag is returned to the client
  });
});

describe("v2.99.34 M11 — revealExpiring returns the content once and burns it", () => {
  it("revealExpiringMessage captures content BEFORE burning (view-once, keeps the attachments row)", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function revealExpiringMessage"),
      V2DB.indexOf("export async function markThreadRead"),
    );
    expect(fn).toMatch(/const capturedBody = row\.body \?\? null;/);
    expect(fn).toMatch(/const capturedAttachmentId = row\.attachmentId \?\? null;/);
    // v2.99.37 (M22): the burn moved into the shared ATOMIC helper, so the
    // content-nulling is asserted there (see below) and the reveal path is
    // asserted to go through it — and to hand back nothing if it lost the race.
    expect(fn).toMatch(/await burnExpiringMessage\(/);
    expect(fn).toMatch(/return null; \/\/ lost the race/);
    // authorization: not the sender, participant, not already consumed
    expect(fn).toMatch(/row\.senderIdentityId === input\.identityId\) return null;/);
    expect(fn).toMatch(/meta\.consumedAt != null\) return null;/);
  });
  it("the shared burn nulls body + attachmentId + stamps consumedAt, guarded so only one caller wins", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("async function burnExpiringMessage"),
      V2DB.indexOf("export async function consumeExpiringMessage"),
    );
    expect(fn).toMatch(/body: null,\s*\n\s*attachmentId: null,\s*\n\s*meta: \{ \.\.\.meta, consumedAt: Date\.now\(\) \}/);
    expect(fn).toMatch(/JSON_EXTRACT\(\$\{messages\.meta\}, '\$\.consumedAt'\) IS NULL/);
    expect(fn).toMatch(/affectedRows/);
  });
  it("the router inlines media as a data URL (immediate burn can't race a client fetch)", () => {
    const fn = ROUTERS.slice(
      ROUTERS.indexOf("revealExpiring: publicProcedure"),
      ROUTERS.indexOf("/* ── attachments router"),
    );
    // v2.99.57 added `maxAttachmentBytes` so the size ceiling is evaluated BEFORE
    // the irreversible burn (an over-cap attachment used to be destroyed and the
    // reader told it succeeded), so the call is no longer a single-line literal.
    // Pin the arguments individually.
    expect(fn).toMatch(/revealExpiringMessage\(\{/);
    expect(fn).toMatch(/messageId: input\.messageId,/);
    expect(fn).toMatch(/identityId: me\.id,/);
    expect(fn).toMatch(/maxAttachmentBytes: REVEAL_MAX_INLINE_BYTES,/);
    // …and the refusal must be reported honestly rather than as an empty success.
    expect(fn).toMatch(/if \(res\.tooLarge\) \{/);
    expect(fn).toMatch(/tooLarge: true as const/);
    expect(fn).toMatch(/storageGetSignedUrl\(att\.storageKey\)/);
    expect(fn).toMatch(/data:\$\{mime\};base64,/);
    // bounded so a huge object never hangs the reveal. v2.99.37 (M23): the cap
    // is now a named constant enforced against the STREAM, not a trusted header.
    expect(ROUTERS).toMatch(/REVEAL_MAX_INLINE_BYTES = 30 \* 1024 \* 1024/);
    expect(fn).toMatch(/total > REVEAL_MAX_INLINE_BYTES/);
    // fans the change to participants so their list refetches → "disappeared"
    expect(fn).toMatch(/publishToIdentity\(pid, \{ kind: "message"/);
  });
});

describe("v2.99.34 M11 — client reveals via the endpoint (no raw-body read)", () => {
  it("taps call the reveal mutation and render the returned data-URL media", () => {
    expect(MESSAGES).toMatch(/const revealExpiringMutation = trpc\.messages\.revealExpiring\.useMutation/);
    expect(MESSAGES).toMatch(/await revealExpiringMutation\.mutateAsync\(\{ messageId: m\.id \}\)/);
    expect(MESSAGES).toMatch(/url: res\.media\.dataUrl/);
  });
  it("a server-locked message renders the tap-to-view card, not the burned placeholder", () => {
    expect(MESSAGES).toMatch(/const serverLocked = \(m as \{ locked\?: boolean \}\)\.locked === true;/);
    expect(MESSAGES).toMatch(/const burned = expiring && !serverLocked && exp\?\.consumedAt != null;/);
  });
});
