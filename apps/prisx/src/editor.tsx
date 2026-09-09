import { onMount, onCleanup, createEffect, For, Show } from "solid-js";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import { GFM } from "@lezer/markdown";
import { undo, redo } from "@codemirror/commands";
import {
  Bold,
  Italic,
  List,
  Quote,
  Code2,
  Undo2,
  Redo2,
  Link2,
  ListTodo,
} from "lucide-solid";
import { livePreview } from "./live-preview";
export default function Editor(props: {
  contentType: string;
  rich?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  entities: () => { id: string; name: string; kind: string }[];
  onComposition: (v: boolean) => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView;
  const presentation = new Compartment();
  const rich = () => !!props.rich && props.contentType === "text/markdown";
  createEffect(() => {
    const extensions = rich()
      ? [
          livePreview,
          EditorView.editorAttributes.of({ class: "cm-live-preview" }),
        ]
      : [];
    if (view) view.dispatch({ effects: presentation.reconfigure(extensions) });
  });
  function wrap(before: string, after = before) {
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to) || "テキスト";
    const already =
      view.state.sliceDoc(
        Math.max(0, range.from - before.length),
        range.from,
      ) === before &&
      view.state.sliceDoc(range.to, range.to + after.length) === after;
    if (already)
      view.dispatch({
        changes: [
          { from: range.from - before.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + after.length, insert: "" },
        ],
        selection: {
          anchor: range.from - before.length,
          head: range.to - before.length,
        },
        userEvent: "input",
      });
    else
      view.dispatch({
        changes: {
          from: range.from,
          to: range.to,
          insert: before + selected + after,
        },
        selection: {
          anchor: range.from + before.length,
          head: range.from + before.length + selected.length,
        },
        userEvent: "input",
      });
    view.focus();
  }
  function prefix(value: string) {
    const range = view.state.selection.main;
    const first = view.state.doc.lineAt(range.from).number,
      last = view.state.doc.lineAt(range.to).number;
    const changes = [];
    for (let i = first; i <= last; i++) {
      const line = view.state.doc.line(i);
      const old =
        /^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|> )/.exec(line.text)?.[0] || "";
      changes.push({
        from: line.from,
        to: line.from + old.length,
        insert: old === value ? "" : value,
      });
    }
    view.dispatch({ changes, userEvent: "input" });
    view.focus();
  }
  const actions = [
    { label: "太字", icon: Bold, run: () => wrap("**") },
    { label: "斜体", icon: Italic, run: () => wrap("*") },
    { label: "箇条書き", icon: List, run: () => prefix("- ") },
    { label: "チェックリスト", icon: ListTodo, run: () => prefix("- [ ] ") },
    { label: "引用", icon: Quote, run: () => prefix("> ") },
    { label: "コード", icon: Code2, run: () => wrap("`") },
    { label: "リンク", icon: Link2, run: () => wrap("[", "](https://)") },
    {
      label: "元に戻す",
      icon: Undo2,
      run: () => {
        undo(view);
        view.focus();
      },
    },
    {
      label: "やり直す",
      icon: Redo2,
      run: () => {
        redo(view);
        view.focus();
      },
    },
  ];
  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          presentation.of(
            rich()
              ? [
                  livePreview,
                  EditorView.editorAttributes.of({ class: "cm-live-preview" }),
                ]
              : [],
          ),
          EditorView.contentAttributes.of({ "aria-label": "本文を編集" }),
          ...(props.contentType === "text/markdown"
            ? [markdown({ extensions: [GFM] })]
            : []),
          EditorView.lineWrapping,
          autocompletion({
            override: [
              (ctx) => {
                const link = ctx.matchBefore(/\[\[[^\]]*/);
                const tag = ctx.matchBefore(/#[\p{L}\p{N}_\-/]*/u);
                if (!link && !tag) return null;
                const match = link || tag!;
                return {
                  from: match.from + (link ? 2 : 1),
                  options: props
                    .entities()
                    .filter((e) => link || e.kind === "tag")
                    .map((e) => ({
                      label: e.name,
                      type: e.kind === "tag" ? "keyword" : "variable",
                      apply: link ? `id:${e.id}|${e.name}]]` : e.name,
                    })),
                };
              },
            ],
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                props.onSave();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) props.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            compositionstart: () => {
              props.onComposition(true);
            },
            compositionend: () => {
              props.onComposition(false);
            },
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
              background: "transparent",
              color: "var(--text)",
            },
            ".cm-scroller": {
              fontFamily:
                '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
              lineHeight: "1.85",
            },
            ".cm-content": { padding: "24px 12px" },
            ".cm-gutters": {
              background: "transparent",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine,.cm-activeLineGutter": {
              background: "var(--hover)",
            },
            ".cm-cursor": { borderLeftColor: "#b7a4ff" },
            ".cm-selectionBackground": { background: "#65558c66 !important" },
            ".cm-tooltip": {
              background: "var(--panel)",
              border: "1px solid var(--line)",
            },
            ".cm-search": { background: "var(--panel)" },
          }),
        ],
      }),
    });
  });
  onCleanup(() => view?.destroy());
  return (
    <div class="cm-editor-shell">
      <Show when={rich()}>
        <div class="rich-toolbar" role="toolbar" aria-label="本文の書式">
          <select
            aria-label="段落のスタイル"
            onChange={(e) => {
              prefix(e.currentTarget.value);
              e.currentTarget.value = "";
            }}
          >
            <option value="">本文</option>
            <option value="# ">見出し 1</option>
            <option value="## ">見出し 2</option>
            <option value="### ">見出し 3</option>
          </select>
          <For each={actions}>
            {(action) => (
              <button
                type="button"
                class="icon-button"
                aria-label={action.label}
                title={action.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={action.run}
              >
                <action.icon size={15} />
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="codemirror" ref={host} />
    </div>
  );
}
