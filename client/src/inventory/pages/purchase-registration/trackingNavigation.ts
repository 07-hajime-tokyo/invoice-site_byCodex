import { normalizedTrackingNumber } from "./tracking";

export function openEcohaiTracking(trackingNumber: string) {
  if (typeof document === "undefined") return;
  const num = normalizedTrackingNumber(trackingNumber);
  if (!num) return;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://www.ecohai.co.jp/cargo_tracking/search";
  form.target = "_blank";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "slip[]";
  input.value = num;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}
