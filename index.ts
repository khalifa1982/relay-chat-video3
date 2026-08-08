/* Sentry FIRST (build 47): native-crash + JS-error capture for the SHELL itself.
 * The web app inside the WebView reports to the relay-web project on its own —
 * this covers the ~25 files the WebView cannot see: a shell render crash, a
 * native module failure, an OOM kill. DSN is the ingest-only public key for
 * relay-mobile; the readable org token lives only in EAS secrets (sourcemap
 * upload), never in this repo. */
import * as Sentry from "@sentry/react-native";
Sentry.init({
  dsn: "https://dca2ddba60fc9e4a653d5b27eb3e13ce@o4511875054108672.ingest.us.sentry.io/4511875279945728",
  release: "relay-mobile@1.1.0+47",
  environment: "production",
  sampleRate: 1,
  tracesSampleRate: 0, // errors-only, matching web + server
  enableNativeCrashHandling: true,
});

import { registerRootComponent } from "expo";

import App from "./App";

// The one and only screen. No router — a shell with a single WebView has no
// routes; navigation happens inside the web app.
registerRootComponent(App);
