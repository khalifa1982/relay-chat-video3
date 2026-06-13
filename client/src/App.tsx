import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Docs from "./pages/Docs";
import TurnTest from "./pages/TurnTest";
import { AppShell } from "./app/AppShell";
import { RelayEngineProvider } from "./app/RelayEngine";
import Dialer from "./pages/app/Dialer";
import Messages from "./pages/app/Messages";
import Contacts from "./pages/app/Contacts";
import Profile from "./pages/app/Profile";

function ShellRoute({ tab }: { tab: "dialer" | "messages" | "contacts" | "profile" }) {
  const View =
    tab === "dialer" ? Dialer :
    tab === "messages" ? Messages :
    tab === "contacts" ? Contacts :
    Profile;
  return (
    <AppShell>
      <View />
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* Phone-app shell */}
      <Route path={"/app"}>{() => <ShellRoute tab="dialer" />}</Route>
      <Route path={"/app/"}>{() => <ShellRoute tab="dialer" />}</Route>
      <Route path={"/app/dialer"}>{() => <ShellRoute tab="dialer" />}</Route>
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
      <Route path={"/docs"} component={Docs} />
      <Route path={"/turn-test"} component={TurnTest} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
            <Router />
          </RelayEngineProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
