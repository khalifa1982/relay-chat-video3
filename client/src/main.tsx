import { trpc } from "@/lib/trpc";
import { DEVICE_ID_HEADER, getDeviceId } from "@/lib/deviceId";
// M48: capture the boot URL before any routing, so the Dialer can tell an in-app
// "call" tap from someone ARRIVING on /app/dialer?to=… (see lib/bootUrl.ts).
import "@/lib/bootUrl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";

const queryClient = new QueryClient();

// v2.92 (R3): an UNAUTHED tRPC error used to hard-navigate the whole tab to the
// Manus OAuth portal. With the OAuth UI removed, auth errors are just logged —
// RELAY is guest-first, and the in-app AuthPanel (email code + PIN) is the only
// sign-in affordance. Nothing app-level should ever yank the user off the page.
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Query Error]", event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Mutation Error]", event.mutation.state.error);
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

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" switchable>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
