import { useState, useRef, useEffect } from "react";

const A4_W = 794;
const A4_H = 1123;

export function ScaledPreview({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);


  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      // Use the parent's width to determine scale
      const available = el.parentElement?.clientWidth ?? el.clientWidth;
      const s = Math.min(1, available / A4_W);
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  // The outer wrapper is exactly the scaled size — no extra white space on the right or bottom
  const scaledW = Math.round(A4_W * scale);
  const scaledH = Math.round(A4_H * scale);

  return (
    <div
      ref={wrapperRef}
      className="scaled-preview-container"
      style={{
        // Exact scaled dimensions — wrapper hugs the content
        width: `${scaledW}px`,
        height: `${scaledH}px`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        className="scaled-preview-inner"
        style={{
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          width: `${A4_W}px`,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ScaledPreviewFit({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);


  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const availW = parent.clientWidth - 0; // padding already applied by parent
      const availH = parent.clientHeight - 0;
      const scaleW = availW / A4_W;
      const scaleH = availH / A4_H;
      const s = Math.min(1, scaleW, scaleH);
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  const scaledW = Math.round(A4_W * scale);
  const scaledH = Math.round(A4_H * scale);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: `${scaledW}px`,
        height: `${scaledH}px`,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          width: `${A4_W}px`,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
