import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "./support/test-target.mjs";

describe("テストDBの接続先制限", () => {
  it("専用接続だけを受け入れ、ホスト・ポート・DB・ユーザー・方式の相違を拒否する", () => {
    const allowed =
      "mysql://invoice_test:dummy@127.0.0.1:33067/invoice_remake_test";
    expect(assertTestDatabase(allowed).pathname).toBe("/invoice_remake_test");
    for (const rejected of [
      allowed.replace("127.0.0.1", "production.invalid"),
      allowed.replace("33067", "3306"),
      allowed.replace("invoice_remake_test", "invoice_remake_dev"),
      allowed.replace("invoice_test:", "root:"),
      allowed.replace("mysql:", "https:"),
    ])
      expect(() => assertTestDatabase(rejected)).toThrow();
  });
});
