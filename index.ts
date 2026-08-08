import { registerRootComponent } from "expo";

import App from "./App";

// The one and only screen. No router — a shell with a single WebView has no
// routes; navigation happens inside the web app.
registerRootComponent(App);
