import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthGate } from "./components/AuthGate";

const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function AppLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] text-sm text-muted-foreground">
      Loading...
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
        <Route path={"/inventory/deliveries"} component={Home} />
        <Route path={"/inventory/history"} component={Home} />
        <Route path={"/inventory/delivery-history"} component={Home} />
        <Route path={"/inventory/purchase-history"} component={Home} />
        <Route path={"/inventory/order-management"} component={Home} />
        <Route path={"/inventory/deleted-items"} component={Home} />
        <Route path={"/inventory/monthly-report"} component={Home} />
        <Route path={"/inventory/settings"} component={Home} />
        <Route path={"/inventory/overseas-shipping"} component={Home} />
        <Route path={"/inventory/partner/:code"} component={Home} />
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
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
