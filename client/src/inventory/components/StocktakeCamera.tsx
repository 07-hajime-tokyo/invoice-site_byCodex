import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Continuous decoding: unlike receipt scanning, keep the camera running between items. */
export function StocktakeCamera({
  onScan,
  disabled,
}: {
  onScan: (code: string) => void;
  disabled: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const running = useRef(false);
  const frame = useRef(0);
  const callback = useRef(onScan);
  callback.current = onScan;
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  function stop() {
    running.current = false;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    setActive(false);
  }
  useEffect(
    () => () => {
      running.current = false;
      cancelAnimationFrame(frame.current);
      stream.current?.getTracks().forEach(t => t.stop());
    },
    []
  );
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  async function start() {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      const { default: jsQR } = await import("jsqr");
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!running.current || !video.current) {
        media.getTracks().forEach(t => t.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      setActive(true);
      await video.current.play();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let last = "";
      let lastAt = 0;
      let decodedAt = 0;
      function tick() {
        if (!running.current) return;
        const v = video.current;
        const now = Date.now();
        if (v && context && v.readyState >= 2 && now - decodedAt > 180) {
          decodedAt = now;
          const scale = Math.min(
            1,
            800 / Math.max(v.videoWidth, v.videoHeight)
          );
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          if (canvas.width && canvas.height) {
            context.drawImage(v, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );
            const code = jsQR(image.data, image.width, image.height)?.data;
            if (code && (code !== last || now - lastAt > 5000)) {
              last = code;
              lastAt = now;
              callback.current(code);
            }
          }
        }
        frame.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      setError(
        "カメラを起動できません。権限を確認するか、QRリーダー・手入力をご利用ください。"
      );
      stop();
    }
  }
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={active ? stop : start}
      >
        {active ? "カメラ停止" : "カメラで連続スキャン"}
      </Button>
      <video
        ref={video}
        muted
        playsInline
        className={active ? "mt-3 max-h-72 w-full rounded bg-black" : "hidden"}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
