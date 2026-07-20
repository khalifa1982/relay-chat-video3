export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// v2.92 (R3, owner decision): the Manus OAuth sign-in UI is REMOVED. The native
// AuthPanel (email one-time code + optional 4-digit PIN, v2.87) is the only
// sign-in. The old login-URL builder — which assembled the Manus portal URL
// from the OAuth portal env var — was deleted along with every call site
// (main.tsx 401 redirect, useAuth's default redirectPath, DashboardLayout's
// Sign in button, ManusDialog). The SERVER'S /api/oauth/callback route is
// intentionally kept so pre-existing OAuth sessions/cookies stay valid; it is
// simply unreachable from the UI. Existing Manus-OAuth users sign in via email
// code at the same address (server/authOtp.ts findUserByEmailAny falls back to
// any user row with that email).
