import { test, expect } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { richDecorations } from "../src/live-preview";
function decorations(text: string, anchor = text.length) {
  const state = EditorState.create({
    doc: text,
    selection: { anchor },
    extensions: [markdown({ extensions: [GFM] })],
  });
  const ranges: {
    from: number;
    to: number;
    className?: string;
    widget?: boolean;
  }[] = [];
  richDecorations(state).between(
    0,
    text.length,
    (from, to, value) =>
      void ranges.push({
        from,
        to,
        className: value.spec.class,
        widget: !!value.spec.widget,
      }),
  );
  return { state, ranges };
}
test("表示の装飾で Markdown、タグ、リンクを変更しない", () => {
  const text = "# 見出し\n\n**太字** #研究 [[id:abc|資料]]\n\n末尾";
  const { state, ranges } = decorations(text);
  expect(state.doc.toString()).toBe(text);
  expect(ranges.some((r) => r.className === "cm-rich-h1")).toBe(true);
  expect(ranges.some((r) => r.className === "cm-rich-bold")).toBe(true);
  expect(ranges.some((r) => r.from === 0 && r.to === 1)).toBe(true);
});
test("編集行では記号を表示し、非編集行では隠す", () => {
  const text = "**太字**\n\n末尾";
  expect(
    decorations(text, 3).ranges.filter((r) => !r.className && !r.widget),
  ).toHaveLength(0);
  expect(
    decorations(text).ranges.filter((r) => !r.className && !r.widget),
  ).toHaveLength(2);
});
test("コードブロックの記号と内容を装飾で置き換えない", () => {
  const { ranges } = decorations("```md\n# code **literal**\n```\n\n末尾");
  expect(ranges.some((r) => r.to > r.from)).toBe(false);
  expect(
    ranges.filter((r) => r.className === "cm-rich-codeblock"),
  ).toHaveLength(3);
});
test("非編集行のタスクをチェックボックスで表示する", () =>
  expect(decorations("- [ ] 作業\n\n末尾").ranges.some((r) => r.widget)).toBe(
    true,
  ));

test("内部リンクの角括弧を通常のリンク記号として隠さない", () => {
  const text = "[[id:example|資料]]\n\n末尾";
  expect(decorations(text).ranges.filter((r) => r.to > r.from)).toHaveLength(0);
});
