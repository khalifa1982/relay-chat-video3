import { trpc } from "@/lib/trpc";
import { DEVICE_ID_HEADER, getDeviceId } from "@/lib/deviceId";
// Crash telemetry (v2.107.x): installed BEFORE anything else runs, so even a
// crash during the very first render is caught, queued and delivered. The
// boundary at the bottom of this file is the render-crash half of the same net.
import { initCrashReporter } from "@/lib/crashReporter";
import { initSessionTelemetry, sessionEvent } from "./lib/sessionTelemetry";
import { CrashBoundary } from "@/components/CrashBoundary";
// M48: capture the boot URL before any routing, so the Dialer can tell an in-app
// "call" tap from someone ARRIVING on /app/dialer?to=… (see lib/bootUrl.ts).
import "@/lib/bootUrl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./app/i18n";
import "./index.css";

const queryClient = new QueryClient();

// v2.92 (R3): an UNAUTHED tRPC error used to hard-navigate the whole tab to the
// Manus OAuth portal. With the OAuth UI removed, auth errors are just logged —
// RELAY is guest-first, and the in-app AuthPanel (email code + PIN) is the only
// sign-in affordance. Nothing app-level should ever yank the user off the page.
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Query Error]", event.query.state.error);
    // "What does not function" (v2.107.23): a failed request is a journey
    // event, not just console noise — the session log is where it testifies.
    sessionEvent(
      "fail",
      "query " + JSON.stringify(event.query.queryKey).slice(0, 100) + " — " +
        String((event.query.state.error as Error | null)?.message ?? "").slice(0, 80)
    );
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Mutation Error]", event.mutation.state.error);
    sessionEvent(
      "fail",
      "mutation — " + String((event.mutation.state.error as Error | null)?.message ?? "").slice(0, 100)
    );
  }
});

// Analytics (v2.99.35): injected at runtime ONLY when configured. The old
// static tag in index.html left the literal "%VITE_ANALYTICS_ENDPOINT%/umami"
// in the built page whenever the env was unset (vite keeps unknown %VARS%
// verbatim) — every production page load fetched that bogus URL, got a 400,
// and logged a strict-MIME console error. import.meta.env values are inlined
// at build time, so an unset endpoint compiles to a no-op here.
{
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined;
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined;
  if (endpoint && websiteId && !endpoint.startsWith("%")) {
    const s = document.createElement("script");
    s.defer = true;
    s.src = `${endpoint}/umami`;
    s.dataset.websiteId = websiteId;
    document.body.appendChild(s);
  }
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      /*
       * Attach the sticky per-browser device id on every request so the
       * server can resolve the guest identity even when the cookie is
       * gone (Safari ITP, third-party-cookie blocking, ad blockers,
       * etc.). See client/src/lib/deviceId.ts and
       * server/_core/context.ts for the matching contract.
       */
      headers() {
        const deviceId = getDeviceId();
        return deviceId ? { [DEVICE_ID_HEADER]: deviceId } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

initCrashReporter();
initSessionTelemetry();

createRoot(document.getElementById("root")!).render(
  <CrashBoundary>
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" switchable>
        {/* Language + text size sit INSIDE the theme provider and above everything
            else: both write `<html>`, and the appearance pane changes all three from
            one screen, so they must share a tree. */}
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </trpc.Provider>
  </CrashBoundary>
);
