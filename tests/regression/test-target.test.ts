import { describe, expect, it } from "vitest";
import { assertTestDatabase, resolveTestTarget } from "./support/test-target.mjs";

describe("テストDBの接続先制限", () => {
  it("専用接続だけを受け入れ、ホスト・ポート・DB・ユーザー・方式の相違を拒否する", () => {
    const allowed =
      "mysql://invoice_test:dummy@127.0.0.1:33067/invoice_remake_test";
    expect(assertTestDatabase(allowed, "main").pathname).toBe("/invoice_remake_test");
    for (const rejected of [
      allowed.replace("127.0.0.1", "production.invalid"),
      allowed.replace("33067", "3306"),
      allowed.replace("invoice_remake_test", "invoice_remake_dev"),
      allowed.replace("invoice_test:", "root:"),
      allowed.replace("mysql:", "https:"),
    ])
      expect(() => assertTestDatabase(rejected, "main")).toThrow();
  });
  it("各担当は指定のDBと専用ユーザーの組合せだけを使える", () => {
    const keys = ["main", "registration", "invoices"];
    for (const key of keys) {
      const target = resolveTestTarget(key);
      const url = `mysql://${target.username}:dummy@127.0.0.1:33067/${target.database}`;
      expect(assertTestDatabase(url, key).pathname).toBe(`/${target.database}`);
      for (const other of keys.filter(other => other !== key)) {
        expect(() => assertTestDatabase(url, other)).toThrow();
        const otherTarget = resolveTestTarget(other);
        expect(() => assertTestDatabase(url.replace(target.username + ":", otherTarget.username + ":"), key)).toThrow();
      }
      expect(() => assertTestDatabase(url.replace("127.0.0.1", "production.invalid"), key)).toThrow();
      expect(() => assertTestDatabase(url.replace("33067", "3306"), key)).toThrow();
    }
  });
  it("任意の環境名・空名・継承プロパティを許可しない", () => {
    for (const key of ["production", "dev", "", "constructor", "__proto__"]) {
      expect(() => resolveTestTarget(key)).toThrow();
    }
  });
});
