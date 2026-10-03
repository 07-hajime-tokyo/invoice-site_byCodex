import { useMemo } from "react";
import { createQrMatrix, buildQrPath, QR_QUIET_ZONE } from "./qr";

export function ProductQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => createQrMatrix(value), [value]);
  const path = useMemo(() => buildQrPath(matrix), [matrix]);
  const size = matrix.length + QR_QUIET_ZONE * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR ${value}`} className="h-full w-full bg-white">
      <rect width={size} height={size} fill="white" />
      {path ? <path d={path} fill="#0f172a" shapeRendering="crispEdges" /> : null}
    </svg>
  );
}
