import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppShell } from "./app/AppShell";
import { RelayEngineProvider } from "./app/RelayEngine";
import { PresenceManager } from "./app/PresenceManager";
import { MessagePopups } from "./app/MessagePopups";
import { UpdateChecker } from "./app/UpdateChecker";
// The DIALER stays eager: it's the phone app's first screen and hosts the
// keypad the user lands on — it must paint instantly.
import Dialer from "./pages/app/Dialer";

/* Everything else is LAZY (React.lazy → its own chunk, fetched on first
 * visit). This is the app's single biggest startup lever: the docs page alone
 * drags a markdown/diagram/highlighting stack (mermaid, KaTeX, per-language
 * grammars) that used to sit in the ENTRY chunk — ~1.9 MB of JS parsed before
 * the keypad could paint. The marketing page, docs, and secondary app tabs now
 * load on demand; tab switches show a lightweight spinner for the first visit
 * only (chunks are cached + hashed thereafter). */
const Home = lazy(() => import("./pages/Home"));
const Docs = lazy(() => import("./pages/Docs"));
const Technology = lazy(() => import("./pages/Technology"));
const TurnTest = lazy(() => import("./pages/TurnTest"));
const NotFound = lazy(() => import("./pages/NotFound"));
const History = lazy(() => import("./pages/app/History"));
const Messages = lazy(() => import("./pages/app/Messages"));
const Contacts = lazy(() => import("./pages/app/Contacts"));
const Profile = lazy(() => import("./pages/app/Profile"));

/** Minimal route-loading fallback — theme-aware, no layout shift drama. */
function RouteSpinner() {
  return (
    <div className="flex flex-1 min-h-32 items-center justify-center py-16" aria-label="Loading">
      <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ShellRoute({ tab }: { tab: "dialer" | "history" | "messages" | "contacts" | "profile" }) {
  const View =
    tab === "dialer" ? Dialer :
    tab === "history" ? History :
    tab === "messages" ? Messages :
    tab === "contacts" ? Contacts :
    Profile;
  return (
    <AppShell>
      <Suspense fallback={<RouteSpinner />}>
        <View />
      </Suspense>
    </AppShell>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <Switch>
        <Route path={"/"} component={Home} />
        {/* Phone-app shell */}
        <Route path={"/app"}>{() => <ShellRoute tab="dialer" />}</Route>
        <Route path={"/app/"}>{() => <ShellRoute tab="dialer" />}</Route>
        <Route path={"/app/dialer"}>{() => <ShellRoute tab="dialer" />}</Route>
        <Route path={"/app/history"}>{() => <ShellRoute tab="history" />}</Route>
        <Route path={"/app/messages"}>{() => <ShellRoute tab="messages" />}</Route>
        <Route path={"/app/contacts"}>{() => <ShellRoute tab="contacts" />}</Route>
        <Route path={"/app/profile"}>{() => <ShellRoute tab="profile" />}</Route>
        {/* Legacy in-call route. The Dialer now hosts the call engine in-place,
            so redirect here (preserving ?to=) to guarantee only ONE relay engine
            instance ever mounts — two engines sharing one relay_cid used to fight
            over the same peer slot and tear down each other's call. */}
        <Route path={"/app/call"}>
          {() => (
            <Redirect
              to={"/app/dialer" + (typeof window !== "undefined" ? window.location.search : "")}
              replace
            />
          )}
        </Route>
        {/* Short, clean invite link: /i/<pin> → auto-dials that number. Keeps the
            shareable URL terse and lands users straight in the dialer. */}
        <Route path={"/i/:pin"}>
          {(params) => {
            const pin = (params.pin ?? "").replace(/\D/g, "").slice(0, 6);
            return <Redirect to={pin ? `/app/dialer?to=${pin}` : "/app/dialer"} replace />;
          }}
        </Route>
        <Route path={"/docs"} component={Docs} />
        <Route path={"/technology"} component={Technology} />
        <Route path={"/turn-test"} component={TurnTest} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {/* RelayEngineProvider hosts the call engine once for the whole /app
              session (above the router, so it survives tab navigation) and
              renders the fullscreen call/ring overlay. */}
          <RelayEngineProvider>
            {/* One presence heartbeat for the whole app (not one per
                useIdentity() call site). */}
            <PresenceManager />
            <MessagePopups />
            {/* Polls /api/version every 30s; silent reload mid-call, centered
                refresh prompt when idle. */}
            <UpdateChecker />
            <Router />
          </RelayEngineProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
