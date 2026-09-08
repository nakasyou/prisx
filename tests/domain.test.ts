import { describe, test, expect } from "bun:test";
import {
  validateValue,
  fromJSON,
  normalizeTag,
  validTag,
  representatives,
  contentFingerprint,
  timeMatch,
  type Statement,
} from "../src/domain";
import { extractMarkdown } from "../server/markdown";
const statement = (overrides: any = {}): Statement => ({
  id: "s",
  subjectId: "e",
  propertyId: "p",
  value: { kind: "scalar", value: "A" },
  qualifiers: [],
  validTime: { kind: "unspecified" },
  rank: "normal",
  revision: 1,
  revisionId: "r",
  fingerprint: "",
  origin: "manual",
  createdAt: "",
  createdBy: "",
  ...overrides,
});
describe("型付き値", () => {
  test("予約語を含む辞書は参照にならない", () =>
    expect(fromJSON({ kind: "entity-ref", entityId: "e" }).kind).toBe(
      "object",
    ));
  test("危険な数値を拒否する", () => {
    for (const n of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(validateValue({ kind: "scalar", value: n })).not.toHaveLength(0);
    expect(
      validateValue({
        kind: "quantity",
        amount: "900719925474099312345.0123456789",
      }),
    ).toHaveLength(0);
  });
  test("null、不明、値なしは異なる", () =>
    expect(
      new Set([
        JSON.stringify(fromJSON(null)),
        JSON.stringify({ kind: "unknown" }),
        JSON.stringify({ kind: "no-value" }),
      ]).size,
    ).toBe(3));
  test("32段を超える値を拒否する", () => {
    let v: any = { kind: "scalar", value: 1 };
    for (let i = 0; i < 35; i++) v = { kind: "array", items: [v] };
    expect(validateValue(v).length).toBeGreaterThan(0);
  });
});
describe("Markdown の構文とタグ", () => {
  test("除外構文と日本語", () => {
    const text =
      "---\ntags: #front\n---\n# 見出し\n#研究 #AI #技術/機械学習 #123\n`#inline`\n```\n#code\n```\nhttps://example.com/#fragment\n\\#escape\n<!-- #comment -->\n> #引用\n";
    expect(extractMarkdown(text).tags.map((t) => t.label)).toEqual([
      "研究",
      "AI",
      "技術/機械学習",
      "引用",
    ]);
  });
  test("正規化と区切り", () => {
    expect(normalizeTag("AI")).toBe("ai");
    expect(normalizeTag("e\u0301")).toBe("é");
    for (const label of ["", "123", "foo//bar", "foo/", "/foo"])
      expect(validTag(label)).toBe(false);
    expect(validTag("技術/機械学習")).toBe(true);
  });
  test("リンクの ID と未解決状態の入力", () =>
    expect(
      extractMarkdown("[[id:abc|資料]] と [[未解決]]").links.map(
        (l) => l.target,
      ),
    ).toEqual(["id:abc", "未解決"]));
});
describe("期間、ランク、評価対象", () => {
  test("時間を絞ってから推奨を選ぶ", () => {
    const old = statement({
        id: "old",
        rank: "preferred",
        validTime: {
          kind: "interval",
          start: { value: "2020-01-01", precision: "day" },
          end: { value: "2021-01-01", precision: "day" },
          timezone: "Asia/Tokyo",
        },
      }),
      current = statement({ id: "current", validTime: { kind: "timeless" } });
    expect(
      representatives([old, current], "2026-01-01").map((s) => s.id),
    ).toEqual(["current"]);
  });
  test("非推奨だけを採用しない", () =>
    expect(representatives([statement({ rank: "deprecated" })])).toHaveLength(
      0,
    ));
  test("終了境界を含まない", () =>
    expect(
      timeMatch(
        {
          kind: "interval",
          start: { kind: "unbounded" },
          end: { value: "2026-01-01", precision: "day" },
          timezone: "Asia/Tokyo",
        },
        "2026-01-01",
      ),
    ).toBe("no-match"));
  test("未指定は現在有効ではない", () =>
    expect(timeMatch({ kind: "unspecified" }, "2026-01-01")).toBe(
      "indeterminate",
    ));
  test("ランク変更は fingerprint を変えない", () =>
    expect(contentFingerprint(statement())).toBe(
      contentFingerprint(
        statement({ rank: "preferred", rankReason: "表示優先" }),
      ),
    ));
  test("値変更は fingerprint を変える", () =>
    expect(contentFingerprint(statement())).not.toBe(
      contentFingerprint(statement({ value: { kind: "scalar", value: "B" } })),
    ));
});

test("日付の境界は保存タイムゾーンで解釈する", () => {
  const t: any = {
    kind: "interval",
    start: { value: "2026-04-01", precision: "day" },
    end: { value: "2026-04-02", precision: "day" },
    timezone: "Asia/Tokyo",
  };
  expect(timeMatch(t, "2026-03-31T15:00:00Z")).toBe("match");
  expect(timeMatch(t, "2026-03-31T14:59:59Z")).toBe("no-match");
});
test("月精度の不確かな境界は indeterminate", () =>
  expect(
    timeMatch(
      {
        kind: "interval",
        start: { value: "2026-04", precision: "month" },
        end: { kind: "unbounded" },
        timezone: "Asia/Tokyo",
      },
      "2026-04-15",
    ),
  ).toBe("indeterminate"));
test("存在しない日付を拒否する", () =>
  expect(
    validateValue({ kind: "time", value: "2026-02-30", precision: "day" }),
  ).not.toHaveLength(0));
