import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const SHOW_AFTER_PX = 240;

function getWindowScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function getLayoutScrollTarget() {
  const target = document.querySelector<HTMLElement>("[data-slot='sidebar-inset']");
  if (!target) return null;
  return target.scrollHeight > target.clientHeight + 8 ? target : null;
}

function getCurrentScrollTop() {
  const layoutTarget = getLayoutScrollTarget();
  return Math.max(getWindowScrollTop(), layoutTarget?.scrollTop ?? 0);
}

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    let frame = 0;
    let layoutTarget: HTMLElement | null = null;

    const updateVisible = () => {
      frame = 0;
      setVisible(getCurrentScrollTop() > SHOW_AFTER_PX);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateVisible);
    };

    const attachLayoutTarget = () => {
      layoutTarget?.removeEventListener("scroll", requestUpdate);
      layoutTarget = getLayoutScrollTarget();
      layoutTarget?.addEventListener("scroll", requestUpdate, { passive: true });
    };

    attachLayoutTarget();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });

    const settleTimer = window.setTimeout(() => {
      attachLayoutTarget();
      updateVisible();
    }, 120);

    updateVisible();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      layoutTarget?.removeEventListener("scroll", requestUpdate);
    };
  }, [location]);

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    getLayoutScrollTarget()?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      size="icon"
      variant="outline"
      className={`fixed bottom-5 right-5 z-[100] h-11 w-11 rounded-full border bg-background/95 shadow-lg backdrop-blur transition-all duration-200 hover:bg-accent sm:bottom-7 sm:right-7 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
      aria-label="上に戻る"
      title="上に戻る"
    >
      <ArrowUp className="h-5 w-5" />
    </Button>
  );
}
