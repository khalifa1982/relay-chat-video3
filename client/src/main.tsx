import { trpc } from "@/lib/trpc";
import { DEVICE_ID_HEADER, getDeviceId } from "@/lib/deviceId";
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
