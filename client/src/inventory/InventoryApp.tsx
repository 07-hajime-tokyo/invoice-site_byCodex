import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import InventoryDashboardLayout from "@/inventory/components/DashboardLayout";

const Purchases = lazy(() => import("@/inventory/pages/Purchases"));
const PurchaseRegistration = lazy(() => import("@/inventory/pages/PurchaseRegistration"));
const Deliveries = lazy(() => import("@/inventory/pages/Deliveries"));
const EbayInventory = lazy(() => import("@/inventory/pages/EbayInventory"));
const DeliveryHistory = lazy(() => import("@/inventory/pages/DeliveryHistory"));
const PurchaseHistory = lazy(() => import("@/inventory/pages/PurchaseHistory"));
const Settings = lazy(() => import("@/inventory/pages/Settings"));
const OrderManagement = lazy(() => import("@/inventory/pages/OrderManagement"));
const DeletedItems = lazy(() => import("@/inventory/pages/DeletedItems"));
const MonthlyReport = lazy(() => import("@/inventory/pages/MonthlyReport"));
const InventoryTrend = lazy(() => import("@/inventory/pages/InventoryTrend"));
const OverseasShipping = lazy(() => import("@/inventory/pages/OverseasShipping"));
const PartnerPortal = lazy(() => import("@/inventory/pages/PartnerPortal"));
const AiInvestigation = lazy(() => import("@/inventory/pages/AiInvestigation"));
const ActionItems = lazy(() => import("@/inventory/pages/ActionItems"));
const WorkManagement = lazy(() => import("@/inventory/pages/WorkManagement"));
const WhatsappHistory = lazy(() => import("@/inventory/pages/WhatsappHistory"));
const NotFound = lazy(() => import("@/inventory/pages/NotFound"));

function InventoryPageLoading() {
  return (
    <div className="min-h-[240px] flex items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

const INVENTORY_HOME = "/inventory/purchases";
const REMEMBERED_PATHS = [
  "/inventory/purchases",
  "/inventory/purchase-registration",
  "/inventory/deliveries",
  "/inventory/ebay-inventory",
  "/inventory/history",
  "/inventory/delivery-history",
  "/inventory/purchase-history",
  "/inventory/order-management",
  "/inventory/deleted-items",
  "/inventory/monthly-report",
  "/inventory/trend",
  "/inventory/settings",
  "/inventory/overseas-shipping",
  "/inventory/ai-investigation",
  "/inventory/action-items",
  "/inventory/work-management",
  "/inventory/whatsapp-history",
];

const LAST_PATH_KEY = "invoice_site_inventory_last_path";

function InventoryLocationPersister() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (REMEMBERED_PATHS.includes(location)) {
      localStorage.setItem(LAST_PATH_KEY, location);
    }
  }, [location]);

  useEffect(() => {
    if (location === "/inventory") {
      const saved = localStorage.getItem(LAST_PATH_KEY);
      setLocation(saved && REMEMBERED_PATHS.includes(saved) ? saved : INVENTORY_HOME, { replace: true });
    }
  }, [location, setLocation]);

  return null;
}

export default function InventoryApp() {
  const [location] = useLocation();

  if (location.startsWith("/inventory/partner/")) {
    return (
      <Suspense fallback={<InventoryPageLoading />}>
        <Switch>
          <Route path={"/inventory/partner/:code"} component={PartnerPortal} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <InventoryDashboardLayout>
      <InventoryLocationPersister />
      <Suspense fallback={<InventoryPageLoading />}>
        <Switch>
          <Route path={"/inventory"} component={Purchases} />
          <Route path={"/inventory/purchases"} component={Purchases} />
          <Route path={"/inventory/purchase-registration"} component={PurchaseRegistration} />
          <Route path={"/inventory/deliveries"} component={Deliveries} />
          <Route path={"/inventory/ebay-inventory"} component={EbayInventory} />
          <Route path={"/inventory/history"} component={DeliveryHistory} />
          <Route path={"/inventory/delivery-history"} component={DeliveryHistory} />
          <Route path={"/inventory/purchase-history"} component={PurchaseHistory} />
          <Route path={"/inventory/order-management"} component={OrderManagement} />
          <Route path={"/inventory/deleted-items"} component={DeletedItems} />
          <Route path={"/inventory/monthly-report"} component={MonthlyReport} />
          <Route path={"/inventory/trend"} component={InventoryTrend} />
          <Route path={"/inventory/settings"} component={Settings} />
          <Route path={"/inventory/overseas-shipping"} component={OverseasShipping} />
          <Route path={"/inventory/ai-investigation"} component={AiInvestigation} />
          <Route path={"/inventory/action-items"} component={ActionItems} />
          <Route path={"/inventory/work-management"} component={WorkManagement} />
          <Route path={"/inventory/whatsapp-history"} component={WhatsappHistory} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </InventoryDashboardLayout>
  );
}
