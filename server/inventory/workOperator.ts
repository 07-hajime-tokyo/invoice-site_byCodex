export function resolveWorkOperatorName(
  operatorName?: string | null,
  fallback?: string | null
): string {
  return operatorName?.trim() || fallback?.trim() || "野田";
}

export function resolveOperatorToken(
  _operatorKey?: string
): string | undefined {
  return undefined;
}
