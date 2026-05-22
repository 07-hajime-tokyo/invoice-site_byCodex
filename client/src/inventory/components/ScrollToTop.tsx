import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ページを 200px 以上スクロールすると右下に表示される「トップへ戻る」ボタン。
 * DashboardLayout の SidebarInset（<main> タグ）は overflow-auto を持つため、
 * その要素を data-slot 属性で取得してスクロール位置を監視する。
 * 見つからない場合は window にフォールバックする。
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // SidebarInset の <main data-slot="sidebar-inset"> を取得
    const getScrollTarget = (): Element | Window => {
      return document.querySelector("[data-slot='sidebar-inset']") ?? window;
    };

    const onScroll = (e: Event) => {
      const target = e.currentTarget;
      const scrollY =
        target instanceof Window
          ? target.scrollY
          : (target as Element).scrollTop;
      setVisible(scrollY > 200);
    };

    const target = getScrollTarget();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = () => {
    const target =
      document.querySelector("[data-slot='sidebar-inset']") ?? window;
    if (target instanceof Window) {
      target.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      (target as Element).scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (!visible) return null;

  return (
    <Button
      onClick={handleClick}
      size="icon"
      variant="outline"
      className="fixed bottom-6 right-6 z-50 h-10 w-10 rounded-full shadow-lg bg-background border-border hover:bg-accent transition-all duration-200"
      aria-label="ページトップへ戻る"
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  );
}
