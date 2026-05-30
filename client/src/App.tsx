import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Docs from "./pages/Docs";
import Relay from "./pages/Relay";
import { AppShell } from "./app/AppShell";
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
      {/* Legacy / in-call screen: kept reachable for the actual call UI */}
      <Route path={"/app/call"} component={Relay} />
      <Route path={"/docs"} component={Docs} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
