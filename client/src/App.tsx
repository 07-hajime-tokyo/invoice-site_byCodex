import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthGate } from "./components/AuthGate";
import { ScrollToTop } from "@/components/ScrollToTop";

const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function AppLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function MaintenanceCleanupCorrupt0909() {
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(confirmed = false) {
    setBusy(true);
    try {
      const path = confirmed
        ? "/api/maintenance/cleanup-corrupt-0909?confirm=delete-corrupt-0909"
        : "/api/maintenance/cleanup-corrupt-0909";
      const res = await fetch(path, { credentials: "include" });
      const text = await res.text();
      try {
        setResult(JSON.parse(text));
      } catch {
        setResult({ ok: res.ok, status: res.status, text });
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(false);
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F5F7] p-8 text-slate-900">
      <div className="mx-auto max-w-5xl rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">0909 corrupted inventory cleanup</h1>
        <div className="mb-4 flex gap-3">
          <button
            className="rounded-md border px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void run(false)}
            type="button"
          >
            Preview
          </button>
          <button
            className="rounded-md bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(true)}
            type="button"
          >
            Delete fixed targets
          </button>
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Suspense fallback={<AppLoading />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/inventory"} component={Home} />
        <Route path={"/inventory/purchases"} component={Home} />
        <Route path={"/inventory/inbound"} component={Home} />
        <Route path={"/inventory/purchase-registration"} component={Home} />
        <Route path={"/inventory/deliveries"} component={Home} />
        <Route path={"/inventory/ebay-inventory"} component={Home} />
        <Route path={"/inventory/history"} component={Home} />
        <Route path={"/inventory/delivery-history"} component={Home} />
        <Route path={"/inventory/purchase-history"} component={Home} />
        <Route path={"/inventory/order-management"} component={Home} />
        <Route path={"/inventory/deleted-items"} component={Home} />
        <Route path={"/inventory/restore-management"} component={Home} />
        <Route path={"/inventory/monthly-report"} component={Home} />
        <Route path={"/inventory/trend"} component={Home} />
        <Route path={"/inventory/settings"} component={Home} />
        <Route path={"/inventory/overseas-shipping"} component={Home} />
        <Route path={"/inventory/ai-investigation"} component={Home} />
        <Route path={"/inventory/action-items"} component={Home} />
        <Route path={"/inventory/work-management"} component={Home} />
        <Route path={"/inventory/whatsapp-history"} component={Home} />
        <Route path={"/inventory/yahoo-listings"} component={Home} />
        <Route path={"/inventory/partner/:code"} component={Home} />
        <Route path={"/inventory/maintenance/cleanup-corrupt-0909"} component={MaintenanceCleanupCorrupt0909} />
        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
      >
        <TooltipProvider>
          <Toaster />
          <AuthGate>
            <Router />
            <ScrollToTop />
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
