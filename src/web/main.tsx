import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { LearnApp } from "./learn/LearnApp.tsx";
import { applyTheme, readTheme } from "./theme.ts";
import "./index.css";

// Apply theme before first render so we don't flash light mode.
applyTheme(readTheme());

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

// Route detection. The /learn surface is a separate component; the
// rest of the app stays in App.tsx. import.meta.env.BASE_URL handles
// the Pages-vs-custom-domain split: on github.io/flightpath/ it's
// "/flightpath/", on a custom domain it's "/". We do the check here
// rather than inside App so the App component's hooks ordering stays
// stable.
function Root() {
  const baseTrimmed = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const isLearnRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith(`${baseTrimmed}/learn`);
  return isLearnRoute ? <LearnApp /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
);
