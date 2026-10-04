import { useEffect, useRef, useState } from "react";

export type BarcodeDetectorResult = { rawValue?: string };

export type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]> };

export type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function getBarcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
}

export function useQrCameraScanner(onDetected: (rawValue: string) => void) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimationRef = useRef<number | null>(null);
  const scannerRunningRef = useRef(false);
  const lastDetectedRef = useRef<{ value: string; time: number } | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  function stopCamera() {
    scannerRunningRef.current = false;
    if (scanAnimationRef.current != null) {
      window.cancelAnimationFrame(scanAnimationRef.current);
      scanAnimationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function startCamera() {
    if (cameraActive) return;
    setCameraError("");
    const Detector = getBarcodeDetectorConstructor();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("このブラウザではカメラQR読み取りが使えません。商品IDを入力してください。");
      return;
    }

    // iOS Safari は BarcodeDetector を持たないので、jsQR でフレームを自前デコードする
    let decodeFrame: (video: HTMLVideoElement) => Promise<string>;
    if (Detector) {
      const detector = new Detector({ formats: ["qr_code"] });
      decodeFrame = async (video) => {
        const codes = await detector.detect(video);
        return codes.find((code) => code.rawValue?.trim())?.rawValue?.trim() ?? "";
      };
    } else {
      const { default: jsQR } = await import("jsqr");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      decodeFrame = async (video) => {
        if (!ctx || !video.videoWidth) return "";
        // 長辺640pxに落として毎フレームのデコード負荷を下げる
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data?.trim() ?? "";
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is not ready");

      streamRef.current = stream;
      video.srcObject = stream;
      setCameraActive(true);
      await video.play();

      scannerRunningRef.current = true;
      const scanFrame = async () => {
        if (!scannerRunningRef.current) return;
        const currentVideo = videoRef.current;
        if (currentVideo && currentVideo.readyState >= 2) {
          try {
            const rawValue = await decodeFrame(currentVideo);
            if (rawValue) {
              const now = Date.now();
              const previous = lastDetectedRef.current;
              if (!previous || previous.value !== rawValue || now - previous.time > 1600) {
                lastDetectedRef.current = { value: rawValue, time: now };
                stopCamera();
                onDetectedRef.current(rawValue);
                return;
              }
            }
          } catch (error) {
            setCameraError(error instanceof Error ? error.message : "QR読み取りに失敗しました");
            stopCamera();
            return;
          }
        }
        scanAnimationRef.current = window.requestAnimationFrame(scanFrame);
      };
      scanAnimationRef.current = window.requestAnimationFrame(scanFrame);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "カメラを起動できませんでした");
      stopCamera();
    }
  }

  useEffect(() => {
    return () => {
      scannerRunningRef.current = false;
      if (scanAnimationRef.current != null) window.cancelAnimationFrame(scanAnimationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { cameraActive, cameraError, videoRef, startCamera, stopCamera };
}

export function extractScannedLabelId(value: string): string {
  const normalized = value.normalize("NFKC").toUpperCase();
  const exact = normalized.trim().match(/^[A-Z]{7}$/)?.[0];
  if (exact) return exact;
  const tokens = normalized
    .split(/[^A-Z]+/)
    .flatMap((token) => token.match(/[A-Z]{7}/g) ?? []);
  return tokens.at(-1) ?? "";
}

export function normalizeProductLabelInput(value: string): string {
  return (extractScannedLabelId(value) || value).trim().normalize("NFKC").toUpperCase();
}
