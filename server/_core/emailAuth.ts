import { createHash } from "crypto";
import { ADMIN_EMAILS } from "@shared/const";

export const EMAIL_AUTH_LOGIN_METHOD = "email_allowlist";

export function normalizeLoginEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

export function getAllowedLoginEmails() {
  const envEmails = (process.env.ALLOWED_LOGIN_EMAILS ?? "")
    .split(",")
    .map(normalizeLoginEmail)
    .filter(Boolean);

  return Array.from(
    new Set([...ADMIN_EMAILS.map(normalizeLoginEmail), ...envEmails].filter(Boolean))
  );
}

export function isAllowedLoginEmail(email: string | null | undefined) {
  const normalized = normalizeLoginEmail(email);
  if (!normalized) return false;
  return getAllowedLoginEmails().includes(normalized);
}

export function createEmailOpenId(email: string) {
  const normalized = normalizeLoginEmail(email);
  if (!normalized) throw new Error("Email is required");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 48);
  return `email:${hash}`;
}
