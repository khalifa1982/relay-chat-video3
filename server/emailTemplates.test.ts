import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { verifyHtml } from "./authLocal";
import { otpHtml } from "./authOtp";
import { lockEmailHtml } from "./authPin";

/**
 * ROUND 5 — every transactional email must be a COMPLETE HTML document, not a
 * bare <div> fragment. Three templates live in import-safe router modules and
 * are tested behaviorally; the fourth (missedCallHtml) lives in the
 * self-starting server entry (server/_core/index.ts), so it's verified by
 * reading the source (importing the entry would boot the server).
 */

function assertIsFullDocument(html: string, expectedTitle: string) {
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html.trimEnd().endsWith("</html>")).toBe(true);
  expect(html).toContain(`<html lang="en">`);
  expect(html).toContain(`<meta charset="utf-8">`);
  expect(html).toContain(`name="viewport"`);
  expect(html).toContain(`<title>${expectedTitle}</title>`);
  expect(html).toContain("<body");
  expect(html).toContain("</body>");
  // Light-themed copy on a light body (dark body would hide the text).
  expect(html).not.toContain("#0b0c10");
}

describe("ROUND 5 — transactional emails are full HTML documents", () => {
  it("verifyHtml wraps the verification email + preserves its copy and link", () => {
    const html = verifyHtml({ link: "https://example.io/api/auth/verify?token=abc123", email: "a@b.c" });
    assertIsFullDocument(html, "Verify your email · RELAY");
    expect(html).toContain("https://example.io/api/auth/verify?token=abc123");
    expect(html).toContain("Confirm your email to finish creating your RELAY account.");
    expect(html).toContain("Verify my email");
  });

  it("otpHtml wraps the sign-in code email + preserves the code and copy", () => {
    const html = otpHtml("246813");
    assertIsFullDocument(html, "Your RELAY sign-in code");
    expect(html).toContain("246813");
    expect(html).toContain("Your sign-in code is:");
    expect(html).toContain("This code expires in 10 minutes.");
  });

  it("lockEmailHtml wraps the account-locked email + preserves its copy", () => {
    const html = lockEmailHtml();
    assertIsFullDocument(html, "Your RELAY account was locked");
    expect(html).toContain("Your account has been locked.");
    expect(html).toContain("PIN sign-in is disabled until you sign in with an email code");
  });

  it("missedCallHtml (in the self-starting entry) routes through wrapEmailDocument with a STATIC title", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "_core/index.ts"), "utf8");
    // The template must delegate to the shared envelope helper…
    expect(src).toMatch(/wrapEmailDocument\(/);
    // …and the entry must import it.
    expect(src).toMatch(/import\s*\{[^}]*wrapEmailDocument[^}]*\}\s*from\s*"\.\.\/email"/);
    // …with a static title (the user-controlled callerLabel must NEVER be the
    // <title>, which wrapEmailDocument does not escape).
    expect(src).toContain(`"Missed call · RELAY"`);
    expect(src).not.toMatch(/wrapEmailDocument\([^)]*\$\{[^)]*,\s*`?[^)]*callerLabel/);
  });
});
