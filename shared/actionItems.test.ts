import { describe, expect, it } from "vitest";
import { ACTION_ITEM_ASSIGNEE_ORDER, ACTION_ITEM_REVIEWERS, compareActionItemAssignees, parseActionItemReviewerChecks } from "./actionItems";
import { getCheckReviewers } from "../client/src/inventory/pages/action-items/presentation";

describe("やることの共用規則", () => {
  it("初期担当を先頭に固定し、追加担当は日本語順に並べる", () => {
    const names = ["出荷担当", "い担当", "全員", "あ担当", "荷受担当", "仕入れ担当"];
    expect([...names].sort(compareActionItemAssignees)).toEqual([...ACTION_ITEM_ASSIGNEE_ORDER, "あ担当", "い担当"]);
    expect(compareActionItemAssignees("全員", "全員")).toBe(0);
    expect(compareActionItemAssignees("あ担当", "あ担当")).toBe(0);
  });

  it("不正JSON・配列・nullは空として読み、既存の値と空キーの扱いを保つ", () => {
    for (const input of [undefined, null, "", "{bad", "[]", "null", "1", '"value"']) expect(parseActionItemReviewerChecks(input)).toEqual({});
    expect(parseActionItemReviewerChecks('{"":1,"村上さん":false,"鈴木さん":"false","藤本さん":0}')).toEqual({ "": true, "村上さん": false, "鈴木さん": true, "藤本さん": false });
  });

  it("全員宛は記入者本人を除外し、出荷担当は従来の2名だけを表示する", () => {
    expect(getCheckReviewers({ assignee: "全員", createdBy: " 村 上さん " })).toEqual(ACTION_ITEM_REVIEWERS.filter(name => name !== "村上さん"));
    expect(getCheckReviewers({ assignee: "出荷担当", createdBy: "鈴木さん" })).toEqual(["鈴木さん", "藤本さん"]);
    expect(getCheckReviewers({ assignee: "荷受担当" })).toEqual([]);
  });
});
