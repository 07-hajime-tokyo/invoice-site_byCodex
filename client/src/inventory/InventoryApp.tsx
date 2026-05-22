import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import InventoryDashboardLayout from "@/inventory/components/DashboardLayout";
import Purchases from "@/inventory/pages/Purchases";
import Deliveries from "@/inventory/pages/Deliveries";
import DeliveryHistory from "@/inventory/pages/DeliveryHistory";
import PurchaseHistory from "@/inventory/pages/PurchaseHistory";
import Settings from "@/inventory/pages/Settings";
import OrderManagement from "@/inventory/pages/OrderManagement";
import DeletedItems from "@/inventory/pages/DeletedItems";
import MonthlyReport from "@/inventory/pages/MonthlyReport";
import OverseasShipping from "@/inventory/pages/OverseasShipping";
import PartnerPortal from "@/inventory/pages/PartnerPortal";
import NotFound from "@/inventory/pages/NotFound";

const INVENTORY_HOME = "/inventory/purchases";
const REMEMBERED_PATHS = [
  "/inventory/purchases",
  "/inventory/deliveries",
  "/inventory/history",
  "/inventory/delivery-history",
  "/inventory/purchase-history",
  "/inventory/order-management",
  "/inventory/deleted-items",
  "/inventory/monthly-report",
  "/inventory/settings",
  "/inventory/overseas-shipping",
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
      <Switch>
        <Route path={"/inventory/partner/:code"} component={PartnerPortal} />
      </Switch>
    );
  }

  return (
    <InventoryDashboardLayout>
      <InventoryLocationPersister />
      <Switch>
        <Route path={"/inventory"} component={Purchases} />
        <Route path={"/inventory/purchases"} component={Purchases} />
        <Route path={"/inventory/deliveries"} component={Deliveries} />
        <Route path={"/inventory/history"} component={DeliveryHistory} />
        <Route path={"/inventory/delivery-history"} component={DeliveryHistory} />
        <Route path={"/inventory/purchase-history"} component={PurchaseHistory} />
        <Route path={"/inventory/order-management"} component={OrderManagement} />
        <Route path={"/inventory/deleted-items"} component={DeletedItems} />
        <Route path={"/inventory/monthly-report"} component={MonthlyReport} />
        <Route path={"/inventory/settings"} component={Settings} />
        <Route path={"/inventory/overseas-shipping"} component={OverseasShipping} />
        <Route component={NotFound} />
      </Switch>
    </InventoryDashboardLayout>
  );
}
