import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
const allowed = new Set(["127.0.0.1", "localhost", "::1"]);
const check = host => {
  if (!allowed.has(host))
    throw new Error(`[local-only] External connection blocked: ${host}`);
};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = values[0];
  if (options && typeof options === "object") {
    if (options.path)
      throw new Error("[local-only] Unix socket connections are disabled");
    check(options.host ?? "localhost");
  } else {
    if (typeof options !== "number")
      throw new Error("[local-only] Unsupported socket connection");
    check(typeof values[1] === "string" ? values[1] : "localhost");
  }
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url
  );
  check(url.hostname);
  return originalFetch(input, init);
};
syncBuiltinESMExports();
