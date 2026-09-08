import { EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

class TaskCheckbox extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }
  eq(other: TaskCheckbox) {
    return this.checked === other.checked && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-task-checkbox";
    box.setAttribute(
      "aria-label",
      this.checked ? "タスクを未完了にする" : "タスクを完了にする",
    );
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.from,
          to: this.from + 3,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}
export function richDecorations(
  state: EditorState,
  focused = true,
): DecorationSet {
  const ranges: Range<Decoration>[] = [],
    lineClasses = new Map<number, Set<string>>();
  const active = (from: number, to: number) =>
    focused &&
    state.selection.ranges.some(
      (r) =>
        state.doc.lineAt(r.from).from <= to &&
        state.doc.lineAt(r.to).to >= from,
    );
  const lineClass = (pos: number, name: string) => {
    const from = state.doc.lineAt(pos).from;
    const list = lineClasses.get(from) || new Set<string>();
    list.add(name);
    lineClasses.set(from, list);
  };
  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node;
      if (name === "Link" && !node.node.getChild("URL")) return false;
      if (/^ATXHeading[1-6]$/.test(name)) {
        lineClass(from, "cm-rich-h" + name.at(-1));
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        for (
          let n = state.doc.lineAt(from).number;
          n <= state.doc.lineAt(to).number;
          n++
        )
          lineClass(state.doc.line(n).from, "cm-rich-codeblock");
        return false;
      }
      if (name === "Blockquote") {
        for (
          let n = state.doc.lineAt(from).number;
          n <= state.doc.lineAt(to).number;
          n++
        )
          lineClass(state.doc.line(n).from, "cm-rich-quote");
      }
      const cls: Record<string, string> = {
        StrongEmphasis: "cm-rich-bold",
        Emphasis: "cm-rich-italic",
        Strikethrough: "cm-rich-strike",
        InlineCode: "cm-rich-inline-code",
        Link: "cm-rich-link",
      };
      if (cls[name])
        ranges.push(Decoration.mark({ class: cls[name] }).range(from, to));
      if (active(from, to)) return;
      if (name === "TaskMarker") {
        ranges.push(
          Decoration.replace({
            widget: new TaskCheckbox(
              state.doc.sliceString(from, to).toLowerCase() === "[x]",
              from,
            ),
          }).range(from, to),
        );
      } else if (
        [
          "HeaderMark",
          "EmphasisMark",
          "StrikethroughMark",
          "CodeMark",
          "LinkMark",
          "QuoteMark",
        ].includes(name)
      )
        ranges.push(Decoration.replace({}).range(from, to));
      else if (name === "URL" && node.node.parent?.name === "Link")
        ranges.push(Decoration.replace({}).range(from, to));
      else if (
        name === "ListMark" &&
        state.doc.sliceString(from, to).match(/^[-+*]$/)
      )
        ranges.push(
          Decoration.mark({ class: "cm-rich-bullet" }).range(from, to),
        );
    },
  });
  for (const [from, classes] of lineClasses)
    ranges.push(Decoration.line({ class: [...classes].join(" ") }).range(from));
  return Decoration.set(ranges, true);
}
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = richDecorations(view.state, view.hasFocus);
    }
    update(update: ViewUpdate) {
      if (
        update.focusChanged ||
        update.docChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = richDecorations(update.state, update.view.hasFocus);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
