import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppShell } from "./app/AppShell";
import { OnboardingGate } from "./app/OnboardingGate";
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
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TurnTest = lazy(() => import("./pages/TurnTest"));
const NotFound = lazy(() => import("./pages/NotFound"));
const History = lazy(() => import("./pages/app/History"));
const Messages = lazy(() => import("./pages/app/Messages"));
const Contacts = lazy(() => import("./pages/app/Contacts"));
const Profile = lazy(() => import("./pages/app/Profile"));
const Admin = lazy(() => import("./pages/app/Admin"));
const Join = lazy(() => import("./pages/app/Join"));
const GroupInvite = lazy(() => import("./pages/GroupInvite"));

/** Minimal route-loading fallback — theme-aware, no layout shift drama. */
function RouteSpinner() {
  return (
    <div className="flex flex-1 min-h-32 items-center justify-center py-16" aria-label="Loading">
      <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ShellRoute({
  tab,
}: {
  tab: "dialer" | "history" | "messages" | "groups" | "contacts" | "profile" | "admin" | "join";
}) {
  const View =
    tab === "dialer" ? Dialer :
    tab === "history" ? History :
    // GROUPS IS THE SAME PAGE, FILTERED (design_handoff_relay_app, 5-tab bar).
    // The board's own Messages frame still lists group threads, so this is a second
    // ENTRY POINT rather than a move — and rendering the same component means the
    // rows, swipe actions, search, presence and story rings are shared rather than
    // reimplemented. A separate page would be a second thread list to keep in step.
    tab === "messages" || tab === "groups" ? Messages :
    tab === "contacts" ? Contacts :
    tab === "admin" ? Admin :
    tab === "join" ? Join :
    Profile;
  return (
    <AppShell>
      <Suspense fallback={<RouteSpinner />}>
        <View {...(tab === "groups" ? { only: "groups" as const } : {})} />
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
        {/* The board's 5th tab, between Messages and Contacts. */}
        <Route path={"/app/groups"}>{() => <ShellRoute tab="groups" />}</Route>
        <Route path={"/app/contacts"}>{() => <ShellRoute tab="contacts" />}</Route>
        <Route path={"/app/profile"}>{() => <ShellRoute tab="profile" />}</Route>
        <Route path={"/app/admin"}>{() => <ShellRoute tab="admin" />}</Route>
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
        {/* #109 — the invite/party-line JOIN screen. A shared link now lands on a
            screen that names what you're joining and who is already inside, rather
            than on the keypad with six anonymous digits prefilled (owner: "clicking
            the link joins the call automatically instead of landing on the dial
            pad"). The Join button is still a real tap — see Join.tsx for why a
            zero-gesture dial is the M48/M60 hot-mic hole. */}
        <Route path={"/app/join"}>{() => <ShellRoute tab="join" />}</Route>
        {/* Short, clean invite link: /i/<pin> → the join screen for that number.
            Keeps the shareable URL terse. */}
        <Route path={"/i/:pin"}>
          {(params) => {
            const pin = (params.pin ?? "").replace(/\D/g, "").slice(0, 6);
            return <Redirect to={pin ? `/app/join?to=${pin}` : "/app/dialer"} replace />;
          }}
        </Route>
        {/* A group INVITE LINK. Deliberately its own route rather than a second meaning
            for /i/<pin>: that one carries a NUMBER and dials it, this carries a signed
            capability and joins a conversation, and one screen guessing which of the two
            a path segment meant would be guessing on a string somebody else chose.
            Wrapped in OnboardingGate because joining needs an identity, so a visitor with
            none picks a name first — exactly as the rest of the app does. */}
        <Route path={"/g/:token"}>
          {(params) => (
            <OnboardingGate>
              <Suspense fallback={<RouteSpinner />}>
                <GroupInvite token={params.token ?? ""} />
              </Suspense>
            </OnboardingGate>
          )}
        </Route>
        <Route path={"/docs"} component={Docs} />
        <Route path={"/technology"} component={Technology} />
        <Route path={"/privacy-policy"} component={PrivacyPolicy} />
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
