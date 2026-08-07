/**
 * MESSAGE EDITING (QW-4, v2.107.55) — edit the text of your own message, with an
 * "edited" marker both sides see.
 *
 * House style: source-string pins over codeOnly()-stripped source, so a test can
 * never pass on a comment. The DB helper's guards (sender-only, text-only, no
 * expiring messages, never UGC-filtered) are the safety surface and are pinned
 * explicitly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const mount = codeOnly(read("./routers.ts"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────────────── server: the editMessage helper ─────────────────── */

describe("QW-4 — editMessage DB helper", () => {
  it("exists and returns the conversation id (for the SSE fan-out)", () => {
    expect(db).toMatch(/export async function editMessage\(input: \{/);
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    expect(body).toMatch(/Promise<number \| null>/);
    expect(body).toMatch(/return row\.conversationId;/);
  });

  it("is sender-only and refuses a deleted message", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    expect(body).toMatch(/row\.senderIdentityId !== input\.identityId \|\| row\.deletedAt/);
  });

  it("is text-only", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    expect(body).toMatch(/row\.kind !== "text"/);
  });

  it("refuses an expiring (view-once / countdown) message", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    // Reads meta.expire and bails when it is present.
    expect(body).toMatch(/meta\.expire != null/);
  });

  it("writes ONLY body + editedAt (never kind/attachment/reply/receipts)", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    // The set clause is exactly these two fields.
    expect(body).toMatch(/\.set\(\{ body: input\.body, editedAt: new Date\(\) \}\)/);
  });

  it("uses the atomic claim (affectedRows) shape, like unsend", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    expect(body).toMatch(/affectedRows/);
    expect(body).toMatch(/if \(!claimed\) return null;/);
  });

  it("does NOT run the body through the UGC content filter (private-message rule)", () => {
    const at = db.indexOf("export async function editMessage");
    const body = db.slice(at, at + 1600);
    expect(body).not.toMatch(/sanitizeUgcText/);
  });
});

/* ─────────────────── server: the edit procedure ─────────────────── */

describe("QW-4 — messages.edit procedure", () => {
  it("is a mutation in the messages router, reachable as trpc.messages.edit", () => {
    expect(routers).toMatch(/edit: publicProcedure/);
    expect(mount).toMatch(/messages: v2MessagesRouter/);
    // The proc sits in v2MessagesRouter (between remove and consumeExpiring).
    const idxEdit = routers.indexOf("edit: publicProcedure");
    const idxRouter = routers.indexOf("export const v2MessagesRouter");
    const idxNextRouter = routers.indexOf("export const v2", idxRouter + 10);
    expect(idxEdit).toBeGreaterThan(idxRouter);
    expect(idxEdit).toBeLessThan(idxNextRouter);
  });

  it("requires an identity, bounds the body like send, and trims it", () => {
    const at = routers.indexOf("edit: publicProcedure");
    const proc = routers.slice(at, at + 900);
    expect(proc).toMatch(/requireIdentity\(ctx\)/);
    expect(proc).toMatch(/body: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(8000\)/);
  });

  it("calls editMessage and fans out a message event to every participant", () => {
    const at = routers.indexOf("edit: publicProcedure");
    const proc = routers.slice(at, at + 900);
    expect(proc).toMatch(/await editMessage\(\{/);
    expect(proc).toMatch(/getConversationParticipantIds\(conversationId\)/);
    expect(proc).toMatch(/publishToIdentity\(pid, \{ kind: "message", conversationId, from: me\.id \}\)/);
  });

  it("refuses a foreign / non-text / expiring message with FORBIDDEN", () => {
    const at = routers.indexOf("edit: publicProcedure");
    const proc = routers.slice(at, at + 900);
    expect(proc).toMatch(/code: "FORBIDDEN"/);
  });
});

/* ─────────────────── client: menu action + editor + marker ─────────────────── */

describe("QW-4 — client editing UI", () => {
  it("offers Edit in the message menu only on my own text, non-expiring bubbles", () => {
    // The mine-side call site gates onEdit on kind === 'text' and not expiring.
    expect(messages).toMatch(/onEdit=\{/);
    expect(messages).toMatch(/m\.kind === "text" && !isExpiringMsg\(m\.meta\)/);
    // The menu renders the Edit item behind `mine && onEdit`.
    expect(messages).toMatch(/mine && onEdit &&/);
    expect(messages).toMatch(/t\("msg\.editAction"\)/);
  });

  it("has an edit mutation with optimistic patch + restore-on-error", () => {
    const at = messages.indexOf("const editMutation = trpc.messages.edit.useMutation");
    expect(at).toBeGreaterThan(0);
    const body = messages.slice(at, at + 1200);
    // Optimistic patch stamps body + editedAt…
    expect(body).toMatch(/editedAt: new Date\(\)/);
    // …and a failure restores the snapshot and toasts.
    expect(body).toMatch(/setData\(context\.input, context\.prev\)/);
    expect(body).toMatch(/t\("msg\.editFailed"\)/);
  });

  it("commitEdit no-ops on empty or unchanged text", () => {
    const at = messages.indexOf("async function commitEdit");
    expect(at).toBeGreaterThan(0);
    const body = messages.slice(at, at + 600);
    expect(body).toMatch(/if \(!next \|\| next === \(m\.body \?\? ""\)\.trim\(\)\)/);
  });

  it("keeps the edit text OUT of the composer draft (its own state)", () => {
    expect(messages).toMatch(/const \[editingMsg, setEditingMsg\] = useState<Msg \| null>\(null\)/);
    expect(messages).toMatch(/const \[editDraft, setEditDraft\] = useState\(""\)/);
  });

  it("renders an 'edited' marker on the bubble when editedAt is set", () => {
    expect(messages).toMatch(/m\.editedAt && <span>\{t\("msg\.editedMark"\)\}/);
  });

  it("the editor dialog saves on the Save action and is inert when empty", () => {
    const at = messages.indexOf("open={editingMsg !== null}");
    expect(at).toBeGreaterThan(0);
    const dlg = messages.slice(at, at + 1400);
    expect(dlg).toMatch(/<Textarea/);
    expect(dlg).toMatch(/disabled=\{!editDraft\.trim\(\)\}/);
    expect(dlg).toMatch(/commitEdit\(\)/);
    expect(dlg).toMatch(/t\("msg\.editSave"\)/);
  });
});

/* ─────────────────── dictionary ─────────────────── */

describe("QW-4 — dictionary keys are bilingual", () => {
  it("edit action / title / save / marker / failure keys are all present in en+ar", () => {
    for (const key of ["msg.editAction", "msg.editTitle", "msg.editSave", "msg.editedMark", "msg.editFailed"]) {
      expect(hasBilingualKey(msgDict, key, '"msg.')).toBe(true);
    }
  });
});
