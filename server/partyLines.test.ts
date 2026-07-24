import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MAX_PARTY_LINES_PER_OWNER } from "./v2db";

/**
 * v2.89 — party lines: number-space + wiring contracts.
 *
 * The dial-path protocol behavior lives in relayPartyLine.test.ts; these pin
 * the DB/router/client wiring that a DB-less vitest can't execute directly.
 */

const V2DB = fs.readFileSync(path.resolve(__dirname, "v2db.ts"), "utf8");
const V2ROUTERS = fs.readFileSync(path.resolve(__dirname, "v2routers.ts"), "utf8");
const ROUTERS = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
const SERVER_INDEX = fs.readFileSync(path.resolve(__dirname, "_core", "index.ts"), "utf8");
const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "drizzle", "schema.ts"), "utf8");
const DIALER = fs.readFileSync(
  path.resolve(__dirname, "..", "client", "src", "pages", "app", "Dialer.tsx"),
  "utf8",
);
const GROUP_SCREEN = fs.readFileSync(
  path.resolve(__dirname, "..", "client", "src", "pages", "app", "GroupCallScreen.tsx"),
  "utf8",
);
const RELAY_CLIENT = fs.readFileSync(
  path.resolve(__dirname, "..", "client", "src", "lib", "relayClient.ts"),
  "utf8",
);

describe("shared 6-digit number space", () => {
  it("BOTH allocators check BOTH tables (a line can never shadow a person or vice versa)", () => {
    // numberTaken consults identities AND party_lines…
    expect(V2DB).toMatch(/async function numberTaken/);
    expect(V2DB).toMatch(/\.from\(partyLines\)\s*\n?\s*\.where\(eq\(partyLines\.number, candidate\)\)/);
    // …via the shared allocator both delegate to (v2.99.30 M20 refactor).
    expect(V2DB).toMatch(/async function allocateSharedNumber/);
    const shared = V2DB.slice(V2DB.indexOf("async function allocateSharedNumber"));
    // Window widened for v2.99.48's global mint budget, which now sits at the
    // top of the shared allocator; the candidate loop below it is unchanged.
    expect(shared.slice(0, 900)).toMatch(/numberTaken\(db, candidate\)/);
    const allocIdentity = V2DB.slice(V2DB.indexOf("export async function allocateNumber"));
    expect(allocIdentity.slice(0, 200)).toMatch(/allocateSharedNumber\(db\)/);
    const allocLine = V2DB.slice(V2DB.indexOf("export async function allocatePartyLineNumber"));
    expect(allocLine.slice(0, 400)).toMatch(/allocateSharedNumber\(db\)/);
  });
  it("party_lines is created by the boot migrator with a UNIQUE number, mirrored in drizzle", () => {
    expect(V2DB).toMatch(/CREATE TABLE IF NOT EXISTS \\`party_lines\\`/);
    expect(V2DB).toMatch(/UNIQUE KEY \\`party_lines_number_unique\\`/);
    expect(SCHEMA).toMatch(/mysqlTable\(\s*"party_lines"/);
    expect(SCHEMA).toMatch(/uniqueIndex\("party_lines_number_unique"\)/);
    expect(SCHEMA).toMatch(/title: varchar\("title", \{ length: 64 \}\)/);
  });
  it("caps lines per owner so one identity can't farm the number space", () => {
    expect(MAX_PARTY_LINES_PER_OWNER).toBeGreaterThan(0);
    expect(MAX_PARTY_LINES_PER_OWNER).toBeLessThanOrEqual(50);
    expect(V2DB).toMatch(/owned\.length >= MAX_PARTY_LINES_PER_OWNER/);
  });
});

describe("dial + directory wiring", () => {
  it("attachRelay gets an onResolveDial hook backed by getPartyLineByNumber", () => {
    expect(SERVER_INDEX).toMatch(/getPartyLineByNumber\(pin\)/);
    expect(SERVER_INDEX).toMatch(/partyLine:\s*true as const,\s*title:\s*line\.title/);
    expect(SERVER_INDEX).toMatch(/"identity" as const/);
  });
  it("directory.lookup resolves the party line FIRST (same precedence as the dial path) with title + live count", () => {
    const lookup = V2ROUTERS.slice(V2ROUTERS.indexOf("lookup: publicProcedure"));
    const lineIdx = lookup.indexOf("getPartyLineByNumber");
    const identIdx = lookup.indexOf("getIdentityByNumber");
    expect(lineIdx).toBeGreaterThan(-1);
    expect(identIdx).toBeGreaterThan(lineIdx);
    // v2.91: tiered read — Redis mirror on API-tier instances, local otherwise.
    expect(lookup.slice(0, 1200)).toMatch(/await partyLineLiveCountsAsync\(\[line\.number\]\)/);
    expect(lookup.slice(0, 1200)).toMatch(/displayName: line\.title/);
  });
  it("the partyLines router (create/list/remove) is rate-limited, guest-allowed, and mounted", () => {
    expect(V2ROUTERS).toMatch(/export const v2PartyLinesRouter = router\(\{/);
    expect(V2ROUTERS).toMatch(/partyLineGate\(ctx\)/);
    // Guests allowed = the same requireIdentity gate as contacts/messages.
    const router = V2ROUTERS.slice(V2ROUTERS.indexOf("export const v2PartyLinesRouter"));
    expect(router).toMatch(/requireIdentity\(ctx\)/);
    expect(router).toMatch(/deletePartyLine\(me\.id, input\.id\)/);
    expect(ROUTERS).toMatch(/partyLines: v2PartyLinesRouter/);
  });
  it("conference history resolves pl- rooms to the line's title", () => {
    expect(V2ROUTERS).toMatch(/startsWith\("pl-"\)/);
    expect(V2ROUTERS).toMatch(/getPartyLinesByNumbers\(lineNumbers\)/);
    expect(V2ROUTERS).toMatch(/partyLineTitle/);
  });
});

describe("client surfaces", () => {
  it("Dialer preview shows 'Party line · N on the line' and the call button reads Join", () => {
    expect(DIALER).toMatch(/Party line · \{previewIdentity\.memberCount\} on the line/);
    expect(DIALER).toMatch(/previewIsLine \? "Join" : "Voice Call"/);
  });
  it("GroupCallScreen manages lines: create with a title, list with live counts, share via /i/<pin>, delete", () => {
    expect(GROUP_SCREEN).toMatch(/function PartyLinesSection\(\)/);
    expect(GROUP_SCREEN).toMatch(/trpc\.partyLines\.create\.useMutation/);
    expect(GROUP_SCREEN).toMatch(/trpc\.partyLines\.list\.useQuery/);
    expect(GROUP_SCREEN).toMatch(/trpc\.partyLines\.remove\.useMutation/);
    expect(GROUP_SCREEN).toMatch(/\/i\/\$\{l\.number\}/);
    expect(GROUP_SCREEN).toMatch(/on the line/);
  });
  it("relayClient: rejected/busy while alone never tear down a PARKED room (group call / pl- line)", () => {
    // v2.89.0 review fix D3 (client half): a lone line occupant whose add-
    // invite is declined must stay parked — the teardown is gated behind
    // inParkedCall(), which recognizes group calls AND pl- rooms (the rejoin
    // envelope carries no partyLine flag, so the room-id prefix is the tell).
    expect(RELAY_CLIENT).toMatch(/function inParkedCall\(\): boolean \{\s*\n\s*return callIsGroup \|\| \(!!roomId && roomId\.startsWith\("pl-"\)\);/);
    const rejected = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf('case "rejected":'));
    expect(rejected.slice(0, 600)).toMatch(/aloneInCall\(\) && !inParkedCall\(\)/);
    const busy = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf('case "busy":'));
    expect(busy.slice(0, 400)).toMatch(/aloneInCall\(\) && !inParkedCall\(\)/);
  });
});
