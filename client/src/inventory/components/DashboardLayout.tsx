import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { PackageCheck, PackageMinus, History, ClipboardList, Settings, PanelLeft, LogOut, BarChart2, Trash2, CalendarDays, Globe, Store, Sparkles, ListTodo, Timer, TrendingUp } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const menuItems = [
  { icon: PackageCheck, label: "入庫管理", path: "/inventory/purchases", color: "text-emerald-500" },
  { icon: ClipboardList, label: "入庫履歴", path: "/inventory/purchase-history", color: "text-teal-500" },
  { icon: PackageMinus, label: "在庫一覧", path: "/inventory/deliveries", color: "text-blue-500" },
  { icon: History, label: "出庫履歴", path: "/inventory/history", color: "text-violet-500" },
  { icon: BarChart2, label: "発注管理", path: "/inventory/order-management", color: "text-orange-500" },
  { icon: Globe, label: "海外発送", path: "/inventory/overseas-shipping", color: "text-sky-500" },
  { icon: Trash2, label: "削除済み商品", path: "/inventory/deleted-items", color: "text-rose-400" },
  { icon: CalendarDays, label: "月次棚卸し", path: "/inventory/monthly-report", color: "text-amber-500" },
  { icon: TrendingUp, label: "在庫の推移", path: "/inventory/trend", color: "text-emerald-600" },
  { icon: Settings, label: "設定", path: "/inventory/settings", color: "text-slate-500" },
];

menuItems.splice(1, 0, { icon: ClipboardList, label: "発注登録", path: "/inventory/purchase-registration", color: "text-amber-500" });
menuItems.splice(4, 0, { icon: Store, label: "eBay在庫", path: "/inventory/ebay-inventory", color: "text-cyan-500" });

menuItems.splice(8, 0, { icon: Sparkles, label: "AI調査", path: "/inventory/ai-investigation", color: "text-emerald-500" });
menuItems.splice(9, 0, { icon: ListTodo, label: "やること", path: "/inventory/action-items", color: "text-lime-600" });
menuItems.splice(10, 0, { icon: Timer, label: "作業管理", path: "/inventory/work-management", color: "text-indigo-500" });

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery(undefined, { enabled: !!user });

  // メールアドレスに紐づく操作者名を取得（一致しない場合はGoogleアカウント名を使用）
  const displayName = operators?.find(op => op.email === user?.email)?.name ?? user?.name;

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.open(getLoginUrl(), "_blank", "noopener");
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout: originalLogout } = useAuth();
  const [location, setLocation] = useLocation();

  // ログアウト時にAuthGateの認証済みフラグをクリアする
  const logout = async () => {
    if (user?.openId) {
      localStorage.removeItem(`auth_gate_verified_${user.openId}`);
    }
    await originalLogout();
  };
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery(undefined, { enabled: !!user });
  const { data: openActionItems = [] } = trpc.inventory.actionItems.list.useQuery(
    { status: "open" },
    {
      enabled: !!user,
      refetchOnWindowFocus: true,
      refetchInterval: 60000,
    },
  );
  // メールアドレスに紐づく操作者名を取得（一致しない場合はGoogleアカウント名を使用）
  const displayName = operators?.find(op => op.email === user?.email)?.name ?? user?.name;
  const openActionItemCount = openActionItems.length;

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-sm">
                    入出庫管理
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                const badgeCount = item.path === "/inventory/action-items" ? openActionItemCount : 0;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${item.color}`}
                      />
                      <span>{item.label}</span>
                      {badgeCount > 0 && !isCollapsed ? (
                        <div className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-semibold leading-none text-emerald-700 ring-1 ring-emerald-200">
                          {badgeCount > 9 ? "9+" : badgeCount}
                        </div>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {displayName?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {displayName || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-2 pb-36 sm:p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
