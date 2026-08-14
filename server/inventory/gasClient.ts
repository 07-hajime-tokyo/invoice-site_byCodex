type GasResult = { success: boolean; message?: string };

function parseGasResult(text: string): GasResult {
  try {
    const parsed = JSON.parse(text) as GasResult;
    return typeof parsed.success === "boolean"
      ? parsed
      : { success: false, message: text };
  } catch {
    return { success: false, message: text };
  }
}

export async function postGasAction(
  payload: Record<string, unknown>,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    gasUrl?: string;
    secret?: string;
  } = {}
): Promise<GasResult> {
  const gasUrl = options.gasUrl ?? process.env.GAS_WEBHOOK_URL ?? "";
  const secret = options.secret ?? process.env.GAS_WEBHOOK_SECRET ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  if (!gasUrl) return { success: false, message: "GAS_WEBHOOK_URLが未設定" };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, secret }),
        redirect: "manual",
      });
      let resultResponse = response;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw new Error(
            `GAS redirected without Location (${response.status})`
          );
        resultResponse = await fetchImpl(location, {
          method: "GET",
          redirect: "follow",
        });
      }
      const text = await resultResponse.text();
      if (!resultResponse.ok)
        throw new Error(`GAS returned HTTP ${resultResponse.status}: ${text}`);
      const result = parseGasResult(text);
      if (result.success) return result;
      throw new Error(result.message || "GAS returned success=false");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2) return { success: false, message };
      await sleep(2 ** attempt * 1_000);
    }
  }
  return { success: false, message: "GAS request failed" };
}
