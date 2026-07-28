import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { normalizeDesiredNumber } from "./v2db";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = R("server/v2db.ts");
const ROUTERS = R("server/v2routers.ts");
const TOOL = R("scripts/admin-tool.mjs");
const OPS = R(".github/workflows/aws-ops.yml");

/**
 * v2.105.8 — a RESERVED number (000/111) may be assigned by an admin, on purpose.
 *
 * Owner asked for 339631 → 111112 and, when told 111 is reserved, said: *"Keep all
 * 111 blocked just do this"*. So the reservation stays exactly as it is for everybody
 * and everything automatic, and only a deliberate administrative assignment may use
 * one. That is the honest reading of what a reservation is for — never handed out by
 * accident, assignable on purpose — and it is the whole of this change.
 */
describe("the reservation still holds everywhere it mattered", () => {
  it("self-service still refuses a reserved prefix", () => {
    // BEHAVIOURAL: the default has to be "no", because `identity.setNumber` passes
    // no options and a user must not be able to claim one for themselves.
    expect(normalizeDesiredNumber("111112")).toBeNull();
    expect(normalizeDesiredNumber("000123")).toBeNull();
    expect(normalizeDesiredNumber("211112")).toBe("211112");
  });

  it("the RANDOM allocator skips them unconditionally — no options, no override", () => {
    // The reservation's real job. If this ever took a flag, an ordinary signup could
    // be handed a trivially-confused number, which is what the rule exists to stop.
    const loop = V2DB.slice(
      V2DB.indexOf("RESERVED_PREFIXES.some((p) => candidate.startsWith(p))"),
    ).slice(0, 200);
    expect(loop).toMatch(/continue;/);
    const alloc = V2DB.slice(
      V2DB.indexOf("async function allocateSharedNumber"),
      V2DB.indexOf("async function allocateSharedNumber") + 1400,
    );
    expect(alloc).toMatch(/RESERVED_PREFIXES/);
    expect(codeOnly(alloc)).not.toMatch(/allowReserved/);
  });

  it("the relaxation is OFF by default, so every existing caller is unchanged", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export function normalizeDesiredNumber"),
      V2DB.indexOf("export function normalizeDesiredNumber") + 1800,
    );
    expect(fn).toMatch(/if \(!opts\?\.allowReserved && RESERVED_PREFIXES\.some/);
  });
});

describe("the admin path is a NAMED function, not a privilege flag", () => {
  it("`claimIdentityNumberAsAdmin` exists and delegates to the single writer", () => {
    /* The house rule this codebase already follows for exactly this shape: v2.104.0
       shipped `deleteMessageAsGroupAdmin` beside `deleteMessage` rather than widening
       one function with an `isAdmin` parameter, because a boolean in that position is
       something a caller can pass by mistake and a NAME is not. */
    const at = V2DB.search(/export async function claimIdentityNumberAsAdmin\b/);
    expect(at).toBeGreaterThan(-1);
    const body = V2DB.slice(at, V2DB.indexOf("\nexport ", at + 10));
    expect(body).toMatch(/return claimIdentityNumber\(identityId, desired, \{ allowReserved: true \}\)/);
    // It writes nothing itself — one writer of identities.number, still.
    expect(codeOnly(body)).not.toMatch(/\.update\(|\.insert\(|transaction/);
  });

  it("there is STILL exactly one writer of identities.number", () => {
    // The invariant `guestUpgrade.test.ts` has pinned since v2.99.75: propagation is
    // the whole difficulty of renumbering, so a parallel writer that skipped it is
    // how History's copies came to rot.
    const writes = V2DB.match(/\.update\(identities\)\s*\n?\s*\.set\(\{\s*\n?\s*number:/g) ?? [];
    expect(writes.length).toBeLessThanOrEqual(1);
  });

  it("the admin procedure requires an EXPLICIT flag to use the relaxed path", () => {
    const at = ROUTERS.indexOf("  setIdentityNumber: publicProcedure");
    expect(at).toBeGreaterThan(0);
    const proc = ROUTERS.slice(at, ROUTERS.indexOf("  setAccountType:", at));
    expect(proc.length).toBeGreaterThan(400);
    expect(proc).toMatch(/allowReserved: z\.boolean\(\)\.optional\(\)/);
    // Named function on the relaxed branch, shared one otherwise.
    expect(proc).toMatch(/input\.allowReserved\s*\n?\s*\? await claimIdentityNumberAsAdmin\(/);
    expect(proc).toMatch(/: await claimIdentityNumber\(input\.identityId, input\.number\)/);
    // Still admin-gated, before anything happens.
    expect(proc.indexOf("requireAdmin(ctx)")).toBeLessThan(proc.indexOf("claimIdentityNumber"));
  });

  it("self-service `identity.setNumber` cannot pass the flag", () => {
    // The one thing that would make this a real hole: a user relaxing it for
    // themselves. Its input has no such field and it calls the shared function.
    const at = ROUTERS.indexOf("  setNumber: publicProcedure");
    expect(at).toBeGreaterThan(0);
    const proc = ROUTERS.slice(at, at + 2200);
    expect(codeOnly(proc)).not.toMatch(/allowReserved|AsAdmin/);
  });
});

describe("the CLI and the server agree — two implementations, one rule", () => {
  it("the tool refuses a reserved prefix unless --allow-reserved is given", () => {
    expect(TOOL).toMatch(/RESERVED_PREFIXES\.some\(\(p\) => to\.startsWith\(p\)\) && !args\["allow-reserved"\]/);
    // It says how to proceed, rather than just refusing.
    expect(TOOL).toMatch(/Pass --allow-reserved to assign it anyway/);
    expect(TOOL).toMatch(/allow-reserved/);
  });

  it("the tool still keeps the same prefix list as the server", () => {
    // `adminToolParity.test.ts` cross-checks the renumber COLUMNS; this pins the one
    // constant both copies read, since a divergence here would mean the CLI could
    // assign something the app considers illegal.
    const srv = /const RESERVED_PREFIXES = \[([^\]]*)\]/.exec(V2DB);
    const cli = /const RESERVED_PREFIXES = \[([^\]]*)\]/.exec(TOOL);
    expect(srv).toBeTruthy();
    expect(cli).toBeTruthy();
    const norm = (m: RegExpExecArray) =>
      Array.from(m[1].matchAll(/"(\d+)"/g)).map((x) => x[1]).sort();
    expect(norm(cli!)).toEqual(norm(srv!));
    expect(norm(srv!)).toEqual(["000", "111"]);
  });

  it("the workflow threads the flag as a CLOSED boolean, needing no base64", () => {
    // Every free-TEXT input still crosses on base64 (the injection class this file's
    // neighbours have been bitten by three times). A boolean compared to the literal
    // "true" can only ever add a fixed flag, so it needs no encoding — and asserting
    // that keeps the distinction deliberate rather than an oversight.
    expect(OPS).toMatch(/admin_allow_reserved:/);
    expect(OPS).toMatch(/ADM_ALLOW_RESERVED: \$\{\{ inputs\.admin_allow_reserved \}\}/);
    expect(OPS).toMatch(/if \[ "\$ADM_ALLOW_RESERVED" = "true" \]; then\n\s*FLAG="\$FLAG --allow-reserved"/);
    // The text inputs are still base64'd.
    expect(OPS).toMatch(/ADM_TO_B64=\$\(printf %s "\$ADM_TO" \| base64 -w0\)/);
  });

  it("the dry run is still the default on the write path", () => {
    expect(OPS).toMatch(/admin_apply:[\s\S]{0,240}default: false/);
    expect(OPS).toMatch(/MODE: DRY RUN/);
  });
});
