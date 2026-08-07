/**
 * Calls → voicemail: the WIRING guard (v2.107.48, owner).
 *
 * The behavioural decision logic is covered by callRouting.test.ts. This test
 * pins every LINK of the chain across files so a future refactor turns a red
 * test rather than a silent no-op — and, most importantly, so the specific
 * mistake that got the feature reverted (a DB call / await on the ring hot path)
 * can never come back unnoticed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const RELAY = readFileSync("server/relay.ts", "utf8");
const CORE = readFileSync("server/_core/index.ts", "utf8");
const ROUTING = readFileSync("server/callRouting.ts", "utf8");
const V2DB = readFileSync("server/v2db.ts", "utf8");
const ROUTERS = readFileSync("server/v2routers.ts", "utf8");
const SCHEMA = readFileSync("drizzle/schema.ts", "utf8");
const CONTACTS_UI = readFileSync("client/src/pages/app/Contacts.tsx", "utf8");
const CALLSET_UI = readFileSync("client/src/pages/app/CallSettingsSection.tsx", "utf8");
const PROFILE_UI = readFileSync("client/src/pages/app/Profile.tsx", "utf8");

describe("voicemail routing — the ring-path safety contract", () => {
  it("the ring gate is SYNCHRONOUS — no await, no .then, no DB in front of the ring", () => {
    // The gate calls the injected hook and returns a boolean directly.
    expect(RELAY).toMatch(/if \(onCheckVoicemailRouting && onCheckVoicemailRouting\(to, callerPin\)\)/);
    // The gate block itself must not await or hit the DB.
    const gate = RELAY.slice(
      RELAY.indexOf("CALLS → VOICEMAIL"),
      RELAY.indexOf("CALLS → VOICEMAIL") + 1400,
    );
    expect(gate).not.toMatch(/await /);
    expect(gate).not.toMatch(/getIdentityByNumber|loadCallRoutingConfig|getDb/);
  });

  it("the hook type is declared synchronous (returns boolean, not a promise)", () => {
    expect(RELAY).toMatch(
      /export type VoicemailRoutingHook = \(calleePin: string, callerPin: string\) => boolean;/,
    );
  });

  it("_core wires the in-memory cache lookup as the ring-time hook", () => {
    expect(CORE).toMatch(/routeCallToVoicemail\(calleePin, callerPin\)/);
    expect(CORE).toContain("initCallRoutingBus()");
    expect(CORE).toMatch(/relayReg\.onRegister = .*loadRoutingForNumber/);
  });

  it("the cache's hot-path check is a plain map lookup that fails open on a miss", () => {
    const start = ROUTING.indexOf("export function routeCallToVoicemail");
    // slice ONLY this function's body — up to its closing brace at column 0
    const end = ROUTING.indexOf("\n}", start) + 2;
    const fn = ROUTING.slice(start, end);
    expect(fn).toMatch(/if \(!e\) return false/); // miss → ring
    expect(fn).not.toMatch(/\bawait\b|\basync\b/);
  });
});

describe("voicemail routing — data + API wiring", () => {
  it("both columns exist in the schema (per-contact + global), opt-in booleans", () => {
    expect(SCHEMA).toMatch(/callsToVoicemail: boolean\("callsToVoicemail"\)/);
    expect(SCHEMA).toMatch(/allCallsToVoicemail: boolean\("allCallsToVoicemail"\)/);
  });

  it("both columns are applied to the live DB by ensureSchemaExtensions", () => {
    expect(V2DB).toMatch(/column: "callsToVoicemail", ddl: "ADD COLUMN `callsToVoicemail` boolean"/);
    expect(V2DB).toMatch(/column: "allCallsToVoicemail", ddl: "ADD COLUMN `allCallsToVoicemail` boolean"/);
  });

  it("the per-contact toggle accepts the flag and refreshes the routing cache", () => {
    expect(ROUTERS).toMatch(/callsToVoicemail: z\.boolean\(\)\.optional\(\)/);
    // after a contact write that touched the flag, propagate across boxes
    const contactMut = ROUTERS.slice(ROUTERS.indexOf("const row = await upsertContact"));
    expect(contactMut.slice(0, 500)).toMatch(/publishRoutingChanged\(me\.number\)/);
  });

  it("the global master switch accepts the flag and refreshes the routing cache", () => {
    expect(ROUTERS).toMatch(/allCallsToVoicemail: z\.boolean\(\)\.optional\(\)/);
    const profileMut = ROUTERS.slice(ROUTERS.indexOf("await updateIdentityProfile(me.id, filteredInput)"));
    expect(profileMut.slice(0, 500)).toMatch(/publishRoutingChanged\(me\.number\)/);
  });

  it("the loader reads BOTH the global flag and the per-contact set for a number", () => {
    const loader = V2DB.slice(V2DB.indexOf("export async function loadCallRoutingConfigByNumber"));
    expect(loader.slice(0, 900)).toMatch(/allCallsToVoicemail/);
    expect(loader.slice(0, 900)).toMatch(/contacts\.callsToVoicemail/);
  });
});

describe("voicemail routing — the three UI surfaces", () => {
  it("contact three-dots menu offers the per-contact toggle", () => {
    expect(CONTACTS_UI).toContain("onToggleVoicemail");
    expect(CONTACTS_UI).toMatch(/callsToVoicemail: !c\.callsToVoicemail/);
    expect(CONTACTS_UI).toMatch(/contacts\.callsVoicemailOn|contacts\.callsVoicemailOff/);
  });

  it("Profile has a Call Settings pane with a master switch and a contact picker", () => {
    expect(PROFILE_UI).toContain("CallSettingsSection");
    expect(PROFILE_UI).toMatch(/openPane\("calls"\)/);
    // master switch + picker both write through the real endpoints
    expect(CALLSET_UI).toMatch(/allCallsToVoicemail: !allOn/);
    expect(CALLSET_UI).toMatch(/callsToVoicemail: !on/);
  });
});
