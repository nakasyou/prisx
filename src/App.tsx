import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
  lazy,
} from "solid-js";
import {
  Search,
  Plus,
  Hash,
  Network,
  FileText,
  PanelLeftClose,
  PanelRightClose,
  ChevronDown,
  ChevronRight,
  Command,
  Settings,
  Upload,
  Sun,
  Moon,
  ArrowUpRight,
  MoreHorizontal,
  X,
  Check,
  Link2,
  History,
  Braces,
  Columns2,
  Eye,
  Code2,
  Download,
  ExternalLink,
  Paperclip,
  ShieldCheck,
  Star,
  Circle,
  Trash2,
  RotateCcw,
  LogOut,
  ChevronsUpDown,
  Layers,
  Bookmark,
  AlignLeft,
  ArrowLeft,
  Maximize2,
} from "lucide-solid";
const Editor = lazy(() => import("./editor"));
import {
  saveDraft,
  readDraft,
  removeDraft,
  clearDrafts,
  draftKey,
} from "./drafts";
import Graph from "./Graph";
const PdfViewer = lazy(() => import("./PdfViewer"));
import {
  displayValue,
  fromJSON,
  parseQuery,
  type Entity,
  type Statement,
  type Value,
} from "./domain";
async function request(path: string, init: RequestInit = {}) {
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(b.error || r.statusText);
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text();
}
const IconButton = (p: any) => (
  <button
    class={"icon-button " + (p.active ? "active" : "")}
    aria-label={p.label}
    title={p.label}
    onClick={p.onClick}
  >
    {p.children}
  </button>
);
const entityIcon = (kind: string) =>
  kind === "tag" ? (
    <Hash size={15} />
  ) : kind === "class" ? (
    <Layers size={15} />
  ) : kind === "property" ? (
    <Braces size={15} />
  ) : (
    <FileText size={15} />
  );
export default function App() {
  const [user, setUser] = createSignal<any>(),
    [authReady, setAuthReady] = createSignal(false),
    [workspace, setWorkspace] = createSignal(""),
    [workspaces, setWorkspaces] = createSignal<any[]>([]),
    [entities, setEntities] = createSignal<Entity[]>([]),
    [results, setResults] = createSignal<Entity[]>([]),
    [query, setQuery] = createSignal(""),
    [views, setViews] = createSignal<any[]>([]),
    [tabs, setTabs] = createSignal<string[]>([]),
    [active, setActive] = createSignal(""),
    [detail, setDetail] = createSignal<any>(),
    [body, setBody] = createSignal(""),
    [status, setStatus] = createSignal("保存済み"),
    [mode, setMode] = createSignal("rich"),
    [right, setRight] = createSignal(true),
    [left, setLeft] = createSignal(true),
    [section, setSection] = createSignal("all"),
    [graph, setGraph] = createSignal<any>({ nodes: [], edges: [] }),
    [selected, setSelected] = createSignal<Statement>(),
    [history, setHistory] = createSignal<any[]>([]),
    [rightTab, setRightTab] = createSignal("links"),
    [modal, setModal] = createSignal(""),
    [error, setError] = createSignal(""),
    [theme, setTheme] = createSignal(
      localStorage.getItem("prisx-theme") || "dark",
    ),
    [collapsed, setCollapsed] = createSignal(false),
    [paletteQuery, setPaletteQuery] = createSignal(""),
    [closed, setClosed] = createSignal<string[]>([]),
    [isComposing, setComposing] = createSignal(false),
    [dirty, setDirty] = createSignal(false),
    [sourceData, setSourceData] = createSignal(false),
    [tableView, setTableView] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let upload!: HTMLInputElement;
  let savePromise: Promise<void> | undefined;
  let generation = 0;
  let baseRevision = 0;
  let importInput!: HTMLInputElement;
  const names = createMemo(() =>
      Object.fromEntries(entities().map((e) => [e.id, e.name])),
    ),
    tags = createMemo(() => entities().filter((e) => e.kind === "tag")),
    current = createMemo(() => detail()?.entity as Entity | undefined),
    statements = createMemo(() => (detail()?.statements as Statement[]) || []),
    currentTags = createMemo(() => {
      const ids = new Set([
        ...(detail()?.derived?.tags || []).map((t: any) => t.entityId),
        ...statements()
          .filter(
            (s) =>
              names()[s.propertyId] === "core:tag" &&
              s.rank !== "deprecated" &&
              s.value.kind === "entity-ref",
          )
          .map((s) => (s.value as any).entityId),
      ]);
      return entities().filter((e) => ids.has(e.id));
    });
  const api = (path: string, init?: RequestInit) =>
    request(`/api/w/${workspace()}${path}`, init);
  const fail = (e: any) => {
    setError(e.message || String(e));
  };
  async function refresh() {
    if (!workspace()) return;
    const [all, found, vs, g] = await Promise.all([
      api("/entities"),
      api("/entities?q=" + encodeURIComponent(query())),
      api("/views"),
      api("/graph"),
    ]);
    setEntities(all);
    setResults(found);
    setViews(vs);
    setGraph(g);
  }
  async function boot() {
    try {
      const me = await request("/api/me");
      setUser(me.user);
      setWorkspaces(me.workspaces);
      setWorkspace(me.workspaces[0]?.id || "");
      await refresh();
      const linked = location.hash.slice(1);
      if (linked && entities().some((e) => e.id === linked))
        await openEntity(linked);
    } catch {
      setUser(null);
    } finally {
      setAuthReady(true);
    }
  }
  onMount(boot);
  createEffect(() => {
    document.documentElement.dataset.theme = theme();
    localStorage.setItem("prisx-theme", theme());
  });
  async function openEntity(id: string) {
    if (dirty()) await save();
    if (dirty()) return;
    clearTimeout(timer);
    const token = ++generation;
    setActive(id);
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setSelected(undefined);
    setDetail(undefined);
    setStatus("読み込み中");
    try {
      const d = await api("/entities/" + id);
      let text = "";
      if (
        d.content &&
        (d.content.effectiveContentType.startsWith("text/") ||
          d.content.effectiveContentType === "application/json")
      ) {
        const r = await fetch(`/api/w/${workspace()}/entities/${id}/content`);
        if (!r.ok) throw new Error("本文の取得に失敗");
        text = await r.text();
      }
      if (token !== generation) return;
      baseRevision = d.content?.revision || 0;
      const draft = await readDraft(draftKey(user().id, workspace(), id));
      if (token !== generation) return;
      setBody(draft?.body ?? text);
      setDetail(d);
      setDirty(!!draft && draft.body !== text);
      if (draft && draft.body !== text) {
        baseRevision = draft.expectedRevision;
        setStatus(
          baseRevision === (d.content?.revision || 0) ? "下書き復旧" : "競合",
        );
      } else setStatus("保存済み");
      const h = await api(`/entities/${id}/history`);
      setHistory(h);
    } catch (e) {
      fail(e);
      setStatus("失敗");
    }
  }
  async function save() {
    clearTimeout(timer);
    if (savePromise) {
      await savePromise;
      if (dirty()) return save();
      return;
    }
    if (!dirty() || !current() || isComposing()) return;
    const id = active(),
      text = body(),
      d = detail();
    setStatus("保存中");
    savePromise = (async () => {
      try {
        const c = await api(`/entities/${id}/content`, {
          method: "PUT",
          headers: {
            "Content-Type": d.content?.effectiveContentType || "text/markdown",
            "X-Filename": encodeURIComponent(
              d.content?.originalFilename || d.entity.name + ".md",
            ),
            "X-Expected-Revision": String(baseRevision),
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: text,
        });
        if (active() === id) {
          const next = await api("/entities/" + id);
          setDetail(next);
          baseRevision = c.revision;
          setDirty(body() !== text);
          if (body() === text)
            await removeDraft(draftKey(user().id, workspace(), id));
          else persistDraft();
          setStatus(body() === text ? "保存済み" : "未保存");
        }
        await refresh();
      } catch (e: any) {
        setStatus(e.message.includes("競合") ? "競合" : "失敗");
        fail(e);
      } finally {
        savePromise = undefined;
      }
    })();
    await savePromise;
  }
  function persistDraft() {
    if (!current()) return;
    saveDraft({
      id: draftKey(user().id, workspace(), active()),
      userId: user().id,
      workspaceId: workspace(),
      entityId: active(),
      body: body(),
      expectedRevision: baseRevision,
      updatedAt: Date.now(),
    }).catch(fail);
  }
  function edit(text: string) {
    setBody(text);
    persistDraft();
    setDirty(true);
    setStatus("未保存");
    clearTimeout(timer);
    if (!isComposing()) timer = setTimeout(() => save(), 800);
  }
  function composition(v: boolean) {
    setComposing(v);
    if (!v && dirty()) {
      clearTimeout(timer);
      timer = setTimeout(() => save(), 800);
    }
  }
  function search(value: string) {
    setQuery(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(
      () =>
        api("/entities?q=" + encodeURIComponent(value))
          .then(setResults)
          .catch(fail),
      180,
    );
  }
  async function removeStatement(s: Statement) {
    try {
      await api("/entities/" + active() + "/statements/" + s.id, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: s.revision }),
      });
      setSelected(undefined);
      await reloadDetail();
    } catch (e) {
      fail(e);
    }
  }
  async function reloadDetail() {
    if (!active()) return;
    setError("");
    const d = await api("/entities/" + active());
    setDetail(d);
    if (selected())
      setSelected(d.statements.find((s: Statement) => s.id === selected()!.id));
    setHistory(await api("/entities/" + active() + "/history"));
    await refresh();
  }
  async function create(name: string, kind = "item", text?: string) {
    const e = await api("/entities", {
      method: "POST",
      body: JSON.stringify({ name, kind }),
    });
    if (text !== undefined)
      await api(`/entities/${e.id}/content`, {
        method: "PUT",
        headers: {
          "Content-Type": "text/markdown",
          "X-Filename": encodeURIComponent(name + ".md"),
          "X-Expected-Revision": "0",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: text,
      });
    await refresh();
    setModal("");
    await openEntity(e.id);
  }
  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const e = await api("/entities", {
        method: "POST",
        body: JSON.stringify({ name: file.name, kind: "item" }),
      });
      await api(`/entities/${e.id}/content`, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
          "X-Expected-Revision": "0",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: file,
      });
      await refresh();
      await openEntity(e.id);
    }
  }
  function closeTab(id: string) {
    if (id === active() && dirty()) {
      save().then(() => {
        if (!dirty()) closeTab(id);
      });
      return;
    }
    setClosed((v) => [...v, id]);
    setTabs((v) => v.filter((x) => x !== id));
    if (active() === id) {
      setActive("");
      setDetail(undefined);
      if (tabs().length) openEntity(tabs()[tabs().length - 1]);
    }
  }
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setModal("");
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || !document.hasFocus()) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      save();
    }
    if (key === "p" || key === "o") {
      e.preventDefault();
      setPaletteQuery("");
      setModal(key === "p" ? "commands" : "open");
    }
    if (key === "w" && active()) {
      e.preventDefault();
      closeTab(active());
    }
    if (key === "t" && e.shiftKey) {
      e.preventDefault();
      const id = closed().at(-1);
      if (id) {
        setClosed((v) => v.slice(0, -1));
        openEntity(id);
      }
    }
  };
  const unload = (e: BeforeUnloadEvent) => {
    if (dirty()) {
      persistDraft();
      e.preventDefault();
      e.returnValue = "";
    }
  };
  onMount(() => {
    window.addEventListener("keydown", keyboard);
    window.addEventListener("beforeunload", unload);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", keyboard);
    window.removeEventListener("beforeunload", unload);
    clearTimeout(timer);
    clearTimeout(searchTimer);
  });
  const localGraph = createMemo(() => {
    if (!current()) return { nodes: [], edges: [] };
    const edges = graph().edges.filter(
      (e: any) => e.source === active() || e.target === active(),
    );
    const ids = new Set([
      active(),
      ...edges.flatMap((e: any) => [e.source, e.target]),
    ]);
    return { nodes: graph().nodes.filter((n: any) => ids.has(n.id)), edges };
  });
  const backlinks = createMemo(() =>
    graph().edges.filter((e: any) => e.target === active()),
  );
  return (
    <Show when={authReady()} fallback={<div class="loading">Prisx</div>}>
      <Show when={user()} fallback={<Auth onDone={boot} />}>
        <div
          class="app"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            uploadFiles(e.dataTransfer?.files || null).catch(fail);
          }}
        >
          <nav class="ribbon">
            <button
              class="brand"
              aria-label="Prisx"
              onClick={() => {
                setSection("all");
                search("");
              }}
            >
              p<span>·</span>
            </button>
            <div class="ribbon-group">
              <IconButton label="検索 · Mod+O" onClick={() => setModal("open")}>
                <Search />
              </IconButton>
              <IconButton
                label="新規エンティティ"
                onClick={() => setModal("new")}
              >
                <Plus />
              </IconButton>
              <IconButton
                label="グラフ"
                active={section() === "graph"}
                onClick={() =>
                  setSection(section() === "graph" ? "all" : "graph")
                }
              >
                <Network />
              </IconButton>
              <IconButton label="アップロード" onClick={() => upload.click()}>
                <Upload />
              </IconButton>
              <IconButton
                label="コマンド · Mod+P"
                onClick={() => setModal("commands")}
              >
                <Command />
              </IconButton>
            </div>
            <div class="ribbon-bottom">
              <IconButton
                label="テーマ"
                onClick={() => setTheme(theme() === "dark" ? "light" : "dark")}
              >
                {theme() === "dark" ? <Sun /> : <Moon />}
              </IconButton>
              <IconButton label="設定" onClick={() => setModal("settings")}>
                <Settings />
              </IconButton>
              <button
                class="avatar"
                aria-label="アカウント"
                onClick={() => setModal("settings")}
              >
                {user().name?.slice(0, 1).toUpperCase()}
              </button>
            </div>
          </nav>
          <Show when={left()}>
            <aside class="left-sidebar">
              <button
                class="workspace-picker"
                onClick={() => setModal("workspaces")}
              >
                <span class="workspace-icon">
                  <Layers size={17} />
                </span>
                <span>
                  {workspaces().find((w) => w.id === workspace())?.name}
                </span>
                <ChevronsUpDown size={14} />
              </button>
              <div class="search-input">
                <Search size={14} />
                <input
                  aria-label="ナレッジを検索"
                  placeholder="検索"
                  value={query()}
                  onInput={(e) => search(e.currentTarget.value)}
                />
                <kbd>⌘ O</kbd>
              </div>
              <div class="navigation">
                <button
                  class={section() === "all" && !query() ? "selected" : ""}
                  onClick={() => {
                    setSection("all");
                    search("");
                  }}
                >
                  <Layers size={15} />
                  すべてのエンティティ
                  <span>
                    {entities().filter((e) => e.kind === "item").length}
                  </span>
                </button>
                <button
                  class={section() === "graph" ? "selected" : ""}
                  onClick={() => setSection("graph")}
                >
                  <Network size={15} />
                  グラフビュー
                </button>
              </div>
              <div class="sidebar-heading">
                <span>タグ</span>
                <IconButton
                  label="タグを作成"
                  onClick={() => setModal("new-tag")}
                >
                  <Plus size={14} />
                </IconButton>
              </div>
              <div class="tag-list">
                <For each={tags()}>
                  {(tag) => (
                    <button
                      class={query() === "tag:" + tag.name ? "selected" : ""}
                      onClick={() => {
                        setSection("all");
                        search("tag:" + tag.name);
                      }}
                    >
                      <Hash size={14} />
                      <span>{tag.name}</span>
                      <small>
                        {
                          entities().filter((e) => e.tags?.includes(tag.id))
                            .length
                        }
                      </small>
                    </button>
                  )}
                </For>
              </div>
              <div class="sidebar-heading">
                <span>保存済みビュー</span>
                <IconButton
                  label="検索を保存"
                  onClick={() => setModal("save-view")}
                >
                  <Plus size={14} />
                </IconButton>
              </div>
              <div class="view-list">
                <For each={views()}>
                  {(v) => (
                    <button
                      onClick={() => {
                        search(v.queryText ?? v.query);
                        setSection("all");
                      }}
                    >
                      <Bookmark size={14} />
                      {v.name}
                    </button>
                  )}
                </For>
              </div>
              <div class="sidebar-heading">
                <span>{query() ? "検索結果" : "エンティティ"}</span>
                <div>
                  <IconButton
                    label="一覧・テーブル"
                    onClick={() => setTableView(!tableView())}
                  >
                    <AlignLeft size={13} />
                  </IconButton>
                  <IconButton label="追加" onClick={() => setModal("new")}>
                    <Plus size={14} />
                  </IconButton>
                </div>
              </div>
              <div class="entity-list">
                <For
                  each={results().filter((e) => query() || e.kind === "item")}
                >
                  {(e) => (
                    <button
                      class={e.id === active() ? "selected" : ""}
                      onClick={() => {
                        setSection("all");
                        openEntity(e.id);
                      }}
                    >
                      {entityIcon(e.kind)}
                      <span>{e.name}</span>
                      {tableView() && (
                        <small>
                          {e.contentType?.split("/").at(-1) || e.kind}
                        </small>
                      )}
                    </button>
                  )}
                </For>
              </div>
              <div class="sidebar-footer">
                <span class="connection-dot" /> ローカルストレージ{" "}
                <span>SQLite</span>
              </div>
            </aside>
          </Show>
          <main class="workspace-main">
            <header class="tab-bar">
              <IconButton label="左サイドバー" onClick={() => setLeft(!left())}>
                <PanelLeftClose size={16} />
              </IconButton>
              <div class="tabs">
                <For each={tabs()}>
                  {(id) => (
                    <div class={"tab " + (id === active() ? "active" : "")}>
                      <button
                        onClick={() => {
                          setSection("all");
                          openEntity(id);
                        }}
                      >
                        {entityIcon(
                          entities().find((e) => e.id === id)?.kind || "item",
                        )}
                        <span>{names()[id] || "…"}</span>
                      </button>
                      <IconButton
                        label="タブを閉じる"
                        onClick={() => closeTab(id)}
                      >
                        <X size={12} />
                      </IconButton>
                    </div>
                  )}
                </For>
                <IconButton label="新規タブ" onClick={() => setModal("new")}>
                  <Plus size={15} />
                </IconButton>
              </div>
              <IconButton
                label="右サイドバー"
                onClick={() => setRight(!right())}
              >
                <PanelRightClose size={16} />
              </IconButton>
            </header>
            <Show
              when={section() === "graph"}
              fallback={
                <Show
                  when={detail()}
                  fallback={
                    <div class="empty-workspace">
                      <div class="empty-mark">
                        p<span>·</span>
                      </div>
                      <div class="empty-actions">
                        <button onClick={() => setModal("new")}>
                          <Plus size={16} />
                          新規エンティティ
                        </button>
                        <button onClick={() => upload.click()}>
                          <Upload size={16} />
                          アップロード
                        </button>
                        <button onClick={() => setModal("open")}>
                          <Search size={16} />
                          検索
                        </button>
                      </div>
                    </div>
                  }
                >
                  <div class="entity-toolbar">
                    <div class="breadcrumb">
                      {entityIcon(current()!.kind)}
                      <span>
                        {current()!.kind === "item"
                          ? "エンティティ"
                          : current()!.kind === "tag"
                            ? "タグ"
                            : current()!.kind === "class"
                              ? "クラス"
                              : "キー"}
                      </span>
                      <ChevronRight size={12} />
                      <span>{current()!.name}</span>
                    </div>
                    <div class="toolbar-actions">
                      <button
                        onClick={() => {
                          if (status() === "競合") setModal("conflict");
                        }}
                        class={
                          "save-state " +
                          (status() === "失敗" || status() === "競合"
                            ? "danger"
                            : "")
                        }
                      >
                        <Show
                          when={status() === "保存済み"}
                          fallback={<Circle size={10} />}
                        >
                          <Check size={12} />
                        </Show>
                        {status()}
                      </button>
                      <IconButton
                        label="履歴"
                        onClick={() => {
                          setRight(true);
                          setRightTab("history");
                        }}
                      >
                        <History size={16} />
                      </IconButton>
                      <IconButton
                        label="エンティティ操作"
                        onClick={() => setModal("entity-menu")}
                      >
                        <MoreHorizontal size={18} />
                      </IconButton>
                    </div>
                  </div>
                  <div class="entity-heading">
                    <input
                      class="title-input"
                      aria-label="表示名"
                      value={current()!.name}
                      onBlur={async (e) => {
                        if (e.currentTarget.value !== current()!.name)
                          try {
                            await api("/entities/" + active(), {
                              method: "PATCH",
                              body: JSON.stringify({
                                name: e.currentTarget.value,
                                expectedRevision: current()!.revision,
                              }),
                            });
                            await reloadDetail();
                          } catch (err) {
                            fail(err);
                          }
                      }}
                    />
                    <div class="entity-subtitle">
                      <For each={currentTags()}>
                        {(t) => (
                          <span class="tag-chip">
                            <button onClick={() => search("tag:" + t.name)}>
                              <Hash size={11} />
                              {t.name}
                            </button>
                            <Show
                              when={statements().find(
                                (s) =>
                                  names()[s.propertyId] === "core:tag" &&
                                  s.value.kind === "entity-ref" &&
                                  s.value.entityId === t.id,
                              )}
                            >
                              {(s) => (
                                <button
                                  aria-label={t.name + " の明示タグを外す"}
                                  onClick={() => removeStatement(s())}
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </Show>
                          </span>
                        )}
                      </For>
                      <button
                        class="add-tag"
                        onClick={() => setModal("add-tag")}
                      >
                        <Plus size={12} />
                        タグ
                      </button>
                      <span class="content-type">
                        {detail().content?.effectiveContentType || "コンセプト"}
                      </span>
                    </div>
                  </div>
                  <section class="properties">
                    <div class="section-bar">
                      <button
                        class="section-toggle"
                        onClick={() => setCollapsed(!collapsed())}
                      >
                        {collapsed() ? (
                          <ChevronRight size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                        <Braces size={14} />
                        データ<span class="count">{statements().length}</span>
                      </button>
                      <div>
                        <IconButton
                          label="構造化ソース"
                          active={sourceData()}
                          onClick={() => setSourceData(!sourceData())}
                        >
                          <Code2 size={14} />
                        </IconButton>
                        <IconButton
                          label="主張を追加"
                          onClick={() => {
                            setSelected(undefined);
                            setModal("statement");
                          }}
                        >
                          <Plus size={14} />
                        </IconButton>
                      </div>
                    </div>
                    <Show when={!collapsed()}>
                      <Show
                        when={!sourceData()}
                        fallback={
                          <StructuredSource
                            statements={statements()}
                            onApply={async (data) => {
                              await api(
                                "/entities/" + active() + "/statements/batch",
                                {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    expected: statements().map((s) => ({
                                      id: s.id,
                                      revision: s.revision,
                                    })),
                                    statements: data,
                                  }),
                                },
                              );
                              await reloadDetail();
                            }}
                          />
                        }
                      >
                        <div class="property-table">
                          <div class="property-row table-head">
                            <span>キー</span>
                            <span>値</span>
                            <span>期間</span>
                            <span>ランク</span>
                            <span>証拠</span>
                            <span>評価</span>
                            <span />
                          </div>
                          <For each={statements()}>
                            {(s) => (
                              <div
                                class={
                                  "property-row " +
                                  (selected()?.id === s.id ? "selected" : "")
                                }
                                onClick={() => {
                                  setSelected(s);
                                  setRight(true);
                                  setRightTab("statement");
                                }}
                              >
                                <button
                                  class="property-key"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEntity(s.propertyId);
                                  }}
                                >
                                  <Hash size={12} />
                                  {(names()[s.propertyId] || "").replace(
                                    "core:",
                                    "",
                                  )}
                                </button>
                                <button
                                  class="value-button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelected(s);
                                    setModal("statement");
                                  }}
                                >
                                  <ValueView
                                    value={s.value}
                                    names={names()}
                                    onOpen={openEntity}
                                  />
                                </button>
                                <span class="time-cell">
                                  {s.validTime.kind === "interval"
                                    ? `${"value" in s.validTime.start ? s.validTime.start.value : "?"} → ${"value" in s.validTime.end ? s.validTime.end.value : "?"}`
                                    : s.validTime.kind === "point"
                                      ? s.validTime.point.value
                                      : s.validTime.kind === "timeless"
                                        ? "時点なし"
                                        : "未指定"}
                                </span>
                                <span class={"rank " + s.rank}>
                                  {s.rank === "preferred" ? (
                                    <Star size={10} />
                                  ) : (
                                    <Circle size={8} />
                                  )}
                                  {
                                    {
                                      preferred: "推奨",
                                      normal: "通常",
                                      deprecated: "非推奨",
                                    }[s.rank]
                                  }
                                </span>
                                <span class="evidence-count">
                                  {s.evidence?.filter(
                                    (e) => e.relation === "supports",
                                  ).length || 0}
                                  <span> / </span>
                                  {s.evidence?.filter(
                                    (e) => e.relation === "opposes",
                                  ).length || 0}
                                </span>
                                <span class="assessment-badge">
                                  {s.assessments?.length
                                    ? {
                                        high: "高",
                                        medium: "中",
                                        low: "低",
                                        unrated: "未評価",
                                      }[s.assessments.at(-1)!.value]
                                    : "未評価"}
                                </span>
                                <IconButton
                                  label="同じキーに値を追加"
                                  onClick={(e: any) => {
                                    setSelected({
                                      ...s,
                                      id: "",
                                      revision: 0,
                                      value: { kind: "scalar", value: "" },
                                    });
                                    setModal("statement");
                                  }}
                                >
                                  <Plus size={13} />
                                </IconButton>
                              </div>
                            )}
                          </For>
                          <button
                            class="add-property"
                            onClick={() => {
                              setSelected(undefined);
                              setModal("statement");
                            }}
                          >
                            <Plus size={14} />
                            キーを追加
                          </button>
                        </div>
                      </Show>
                    </Show>
                  </section>
                  <section class="content-section">
                    <div class="content-bar">
                      <div>
                        <FileText size={14} />
                        <span>
                          {detail().content?.originalFilename || "Markdown"}
                        </span>
                      </div>
                      <div class="editor-modes">
                        <Show
                          when={
                            !detail().content ||
                            detail().content.effectiveContentType ===
                              "text/markdown"
                          }
                        >
                          <IconButton
                            label="ライブプレビュー"
                            active={mode() === "rich"}
                            onClick={() => setMode("rich")}
                          >
                            <Braces size={14} />
                          </IconButton>
                        </Show>
                        <IconButton
                          label="ソース"
                          active={mode() === "source"}
                          onClick={() => setMode("source")}
                        >
                          <Code2 size={14} />
                        </IconButton>
                        <Show when={detail().content}>
                          <a
                            class="icon-button"
                            aria-label="ダウンロード"
                            href={`/api/w/${workspace()}/entities/${active()}/content?download=1`}
                          >
                            <Download size={14} />
                          </a>
                        </Show>
                      </div>
                    </div>
                    <Show
                      when={
                        !detail().content ||
                        detail().content.effectiveContentType.startsWith(
                          "text/",
                        ) ||
                        detail().content.effectiveContentType ===
                          "application/json"
                      }
                      fallback={
                        <div class="file-viewer">
                          <Show
                            when={
                              detail().content.effectiveContentType ===
                              "application/pdf"
                            }
                          >
                            <PdfViewer
                              url={`/api/w/${workspace()}/entities/${active()}/content`}
                            />
                          </Show>
                          <Show
                            when={detail().content.effectiveContentType.startsWith(
                              "image/",
                            )}
                          >
                            <img
                              src={`/api/w/${workspace()}/entities/${active()}/content`}
                              alt={current()!.name}
                            />
                          </Show>
                          <Show
                            when={detail().content.effectiveContentType.startsWith(
                              "audio/",
                            )}
                          >
                            <audio
                              controls
                              src={`/api/w/${workspace()}/entities/${active()}/content`}
                            />
                          </Show>
                          <Show
                            when={detail().content.effectiveContentType.startsWith(
                              "video/",
                            )}
                          >
                            <video
                              controls
                              src={`/api/w/${workspace()}/entities/${active()}/content`}
                            />
                          </Show>
                          <div class="file-info">
                            <Paperclip />
                            <strong>{detail().content.originalFilename}</strong>
                            <span>
                              {(detail().content.size / 1024).toFixed(1)} KB
                            </span>
                            <a
                              class="button"
                              href={`/api/w/${workspace()}/entities/${active()}/content?download=1`}
                            >
                              <Download size={14} />
                              ダウンロード
                            </a>
                          </div>
                        </div>
                      }
                    >
                      <Show when={active()} keyed>
                        {(id) => (
                          <Editor
                            contentType={
                              detail()?.content?.effectiveContentType ||
                              "text/markdown"
                            }
                            rich={mode() !== "source"}
                            value={body()}
                            onChange={edit}
                            onSave={save}
                            entities={entities}
                            onComposition={composition}
                          />
                        )}
                      </Show>
                    </Show>
                  </section>
                </Show>
              }
            >
              <div class="graph-header">
                <h2>グラフビュー</h2>
                <span>
                  {graph().nodes.length} ノード · {graph().edges.length} リンク
                </span>
                <button class="button" onClick={refresh}>
                  <RotateCcw size={13} />
                  更新
                </button>
              </div>
              <div class="full-graph">
                <Graph
                  data={graph()}
                  active={active()}
                  onOpen={(id) => {
                    setSection("all");
                    openEntity(id);
                  }}
                />
              </div>
              <Show when={graph().truncated}>
                <div class="graph-limit">表示上限に達しました</div>
              </Show>
            </Show>
            <footer class="status-bar">
              <span>
                <span class="connection-dot" />{" "}
                {workspaces().find((w) => w.id === workspace())?.name}
              </span>
              <div>
                <Show when={current()}>
                  <span>{statements().length} 主張</span>
                  <span>{body().length.toLocaleString()} 文字</span>
                  <span>UTF-8</span>
                  <span>
                    rev {detail()?.content?.revision || current()?.revision}
                  </span>
                </Show>
              </div>
            </footer>
          </main>
          <Show when={right()}>
            <aside class="right-sidebar">
              <div class="right-tabs">
                <IconButton
                  label="リンク"
                  active={rightTab() === "links"}
                  onClick={() => setRightTab("links")}
                >
                  <Link2 size={16} />
                </IconButton>
                <IconButton
                  label="主張の詳細"
                  active={rightTab() === "statement"}
                  onClick={() => setRightTab("statement")}
                >
                  <Braces size={16} />
                </IconButton>
                <IconButton
                  label="履歴"
                  active={rightTab() === "history"}
                  onClick={() => setRightTab("history")}
                >
                  <History size={16} />
                </IconButton>
              </div>
              <Show when={rightTab() === "links"}>
                <div class="right-heading">
                  <ChevronDown size={13} />
                  ローカルグラフ
                  <IconButton
                    label="グラフを拡大"
                    onClick={() => setSection("graph")}
                  >
                    <Maximize2 size={13} />
                  </IconButton>
                </div>
                <div class="local-graph">
                  <Graph
                    data={localGraph()}
                    active={active()}
                    onOpen={openEntity}
                    small
                  />
                </div>
                <div class="right-heading">
                  <ChevronDown size={13} />
                  バックリンク<span>{backlinks().length}</span>
                </div>
                <For each={backlinks()}>
                  {(edge) => (
                    <button
                      class="backlink"
                      onClick={() => openEntity(edge.source)}
                    >
                      <FileText size={14} />
                      <span>
                        {names()[edge.source]}
                        <small>{edge.type.replace("core:", "")}</small>
                      </span>
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </For>
                <div class="right-heading">
                  <ChevronDown size={13} />
                  エンティティ情報
                </div>
                <Show when={current()}>
                  <dl class="entity-info">
                    <dt>種別</dt>
                    <dd>{current()!.kind}</dd>
                    <dt>作成日</dt>
                    <dd>
                      {new Date(current()!.createdAt).toLocaleDateString(
                        "ja-JP",
                      )}
                    </dd>
                    <dt>リビジョン</dt>
                    <dd>{current()!.revision}</dd>
                    <dt>ID</dt>
                    <dd class="mono">{current()!.id}</dd>
                    <dt>別名</dt>
                    <dd>{current()!.aliases.join("、") || "—"}</dd>
                  </dl>
                </Show>
              </Show>
              <Show when={rightTab() === "history"}>
                <div class="right-heading">
                  履歴<span>{history().length}</span>
                </div>
                <For each={history()}>
                  {(h) => (
                    <div class="history-item">
                      <span class="history-dot" />
                      <div>
                        <strong>
                          {{
                            entity: "エンティティ",
                            statement: "主張",
                            content: "コンテンツ",
                            evidence: "証拠",
                            assessment: "評価",
                          }[h.type as string] || h.type}
                        </strong>
                        <small>
                          {new Date(h.createdAt).toLocaleString("ja-JP")}
                        </small>
                        <Show when={h.type === "content"}>
                          <button
                            onClick={async () => {
                              if (dirty()) await save();
                              if (dirty()) return;
                              const r = await fetch(
                                `/api/w/${workspace()}/entities/${active()}/content?revision=${h.data.id}`,
                              );
                              if (!r.ok) {
                                fail(new Error("復元に失敗"));
                                return;
                              }
                              const text = await r.text();
                              setBody(text);
                              setDirty(true);
                              await save();
                              await openEntity(active());
                            }}
                          >
                            この版を復元
                          </button>
                        </Show>
                        <Show when={h.type === "statement"}>
                          <span>{displayValue(h.data.value, names())}</span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={rightTab() === "statement"}>
                <Show
                  when={selected()}
                  fallback={<div class="right-heading">主張の詳細</div>}
                >
                  <div class="right-heading">
                    {names()[selected()!.propertyId]}
                    <IconButton
                      label="主張を編集"
                      onClick={() => setModal("statement")}
                    >
                      <Braces size={14} />
                    </IconButton>
                  </div>
                  <div class="statement-detail">
                    <button
                      class="delete-statement"
                      onClick={() => removeStatement(selected()!)}
                    >
                      <Trash2 size={12} />
                      主張を削除
                    </button>
                    <ValueView
                      value={selected()!.value}
                      names={names()}
                      onOpen={openEntity}
                    />
                    <dl>
                      <dt>ランク</dt>
                      <dd>
                        {
                          {
                            preferred: "推奨",
                            normal: "通常",
                            deprecated: "非推奨",
                          }[selected()!.rank]
                        }
                      </dd>
                      <dt>理由</dt>
                      <dd>{selected()!.rankReason || "—"}</dd>
                      <dt>限定条件</dt>
                      <dd>
                        <For each={selected()!.qualifiers}>
                          {(q) => (
                            <div>
                              {names()[q.propertyId]}:{" "}
                              {displayValue(q.value, names())}
                            </div>
                          )}
                        </For>
                      </dd>
                    </dl>
                  </div>
                  <div class="right-heading">
                    証拠<span>{selected()!.evidence?.length || 0}</span>
                    <IconButton
                      label="証拠を追加"
                      onClick={() => setModal("evidence")}
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                  <For each={selected()!.evidence}>
                    {(ev) => (
                      <div class="evidence-card">
                        <span class={"evidence-label " + ev.relation}>
                          {
                            {
                              supports: "支持",
                              opposes: "反証",
                              context: "文脈",
                            }[ev.relation]
                          }
                        </span>
                        <button
                          onClick={() => openEntity(ev.reference.sourceId)}
                        >
                          <FileText size={13} />
                          {names()[ev.reference.sourceId]}
                        </button>
                        <small>{JSON.stringify(ev.reference.locator)}</small>
                        <p>{ev.explanation}</p>
                      </div>
                    )}
                  </For>
                  <div class="right-heading">
                    確からしさ
                    <IconButton
                      label="評価を追加"
                      onClick={() => setModal("assessment")}
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                  <For each={selected()!.assessments}>
                    {(a) => (
                      <div class="evidence-card">
                        <span class="assessment-badge">
                          {
                            {
                              high: "高",
                              medium: "中",
                              low: "低",
                              unrated: "未評価",
                            }[a.value]
                          }
                        </span>
                        <p>{a.rationale}</p>
                        <small>
                          {new Date(a.createdAt).toLocaleDateString("ja-JP")}
                        </small>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </aside>
          </Show>
          <input
            ref={importInput}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              try {
                await api("/import", {
                  method: "POST",
                  body: await file.text(),
                });
                await refresh();
                setModal("");
              } catch (e) {
                fail(e);
              }
            }}
          />
          <input
            ref={upload}
            type="file"
            multiple
            hidden
            onChange={(e) => uploadFiles(e.currentTarget.files).catch(fail)}
          />
          <Show when={error()}>
            <div class="toast" role="alert">
              <span>{error()}</span>
              <IconButton label="閉じる" onClick={() => setError("")}>
                <X size={14} />
              </IconButton>
            </div>
          </Show>
          <Show when={modal()}>
            <div
              class="modal-backdrop"
              onClick={(e) => {
                if (e.target === e.currentTarget) setModal("");
              }}
            >
              <div
                class={
                  "modal " +
                  (["open", "commands"].includes(modal()) ? "palette" : "")
                }
                role="dialog"
                aria-modal="true"
                aria-label="操作"
              >
                <div class="modal-heading">
                  <strong>
                    {
                      {
                        new: "新規エンティティ",
                        "new-tag": "新規タグ",
                        "add-tag": "タグを追加",
                        statement: "主張を編集",
                        evidence: "証拠を追加",
                        assessment: "評価を追加",
                        "save-view": "検索を保存",
                        settings: "設定",
                        workspaces: "ワークスペース",
                        conflict: "競合を解決",
                        wikidata: "Wikidata 取り込み",
                        schema: "スキーマ定義",
                        "entity-menu": "エンティティ操作",
                        open: "クイックオープン",
                        commands: "コマンドパレット",
                      }[modal()]
                    }
                  </strong>
                  <IconButton label="閉じる" onClick={() => setModal("")}>
                    <X size={16} />
                  </IconButton>
                </div>
                <Show when={modal() === "new" || modal() === "new-tag"}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      create(
                        String(f.get("name")),
                        modal() === "new-tag" ? "tag" : String(f.get("kind")),
                        f.get("content") === "markdown" ? "" : undefined,
                      ).catch(fail);
                    }}
                  >
                    <label>
                      表示名
                      <input
                        name="name"
                        autofocus
                        required
                        autocomplete="off"
                      />
                    </label>
                    <Show when={modal() === "new"}>
                      <div class="form-row">
                        <label>
                          種別
                          <select name="kind">
                            <option value="item">エンティティ</option>
                            <option value="class">クラス</option>
                            <option value="property">キー</option>
                            <option value="tag">タグ</option>
                          </select>
                        </label>
                        <label>
                          コンテンツ
                          <select name="content">
                            <option value="markdown">Markdown</option>
                            <option value="none">なし</option>
                          </select>
                        </label>
                      </div>
                    </Show>
                    <button class="primary" type="submit">
                      <Plus size={14} />
                      作成
                    </button>
                  </form>
                </Show>
                <Show when={modal() === "statement"}>
                  <StatementForm
                    statement={selected()}
                    entities={entities()}
                    onSubmit={async (input) => {
                      let propertyId = input.propertyId;
                      if (!propertyId) {
                        const p = await api("/entities", {
                          method: "POST",
                          body: JSON.stringify({
                            name: input.propertyName,
                            kind: "property",
                          }),
                        });
                        propertyId = p.id;
                      }
                      const definition = await api(
                        "/entities/" + propertyId + "/schema",
                      );
                      if (definition.enforcement === "strict") {
                        const { validateProperty } =
                          await import("./constraints");
                        const errors = validateProperty(
                          input.value,
                          definition,
                        );
                        if (errors.length) throw new Error(errors.join("、"));
                      }
                      await api("/entities/" + active() + "/statements", {
                        method: "POST",
                        body: JSON.stringify({ ...input, propertyId }),
                      });
                      await reloadDetail();
                      setModal("");
                    }}
                    onError={fail}
                  />
                </Show>
                <Show when={modal() === "add-tag"}>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const f = new FormData(e.currentTarget),
                          label = String(f.get("tag"));
                        const tag =
                          tags().find((t) => t.name === label) ||
                          (await api("/entities", {
                            method: "POST",
                            body: JSON.stringify({ name: label, kind: "tag" }),
                          }));
                        await api("/entities/" + active() + "/statements", {
                          method: "POST",
                          body: JSON.stringify({
                            propertyId: entities().find(
                              (e) => e.name === "core:tag",
                            )!.id,
                            value: { kind: "entity-ref", entityId: tag.id },
                            qualifiers: [],
                            validTime: { kind: "unspecified" },
                            rank: "normal",
                          }),
                        });
                        await reloadDetail();
                        setModal("");
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      タグ
                      <input name="tag" list="tags" required autofocus />
                      <datalist id="tags">
                        <For each={tags()}>
                          {(t) => <option>{t.name}</option>}
                        </For>
                      </datalist>
                    </label>
                    <button class="primary">追加</button>
                  </form>
                </Show>
                <Show when={modal() === "evidence"}>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const b = Object.fromEntries(
                          new FormData(e.currentTarget),
                        );
                        const source = await api("/entities/" + b.sourceId);
                        await api("/entities/" + active() + "/evidence", {
                          method: "POST",
                          body: JSON.stringify({
                            ...b,
                            statementId: selected()!.id,
                            expectedRevision: selected()!.revision,
                            sourceContentRevisionId: source.content?.id,
                            locator: b.page
                              ? { kind: "page", page: Number(b.page) }
                              : {},
                          }),
                        });
                        await reloadDetail();
                        setModal("");
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      出典
                      <select name="sourceId" required>
                        <For each={entities().filter((e) => e.kind === "item")}>
                          {(e) => <option value={e.id}>{e.name}</option>}
                        </For>
                      </select>
                    </label>
                    <div class="form-row">
                      <label>
                        関係
                        <select name="relation">
                          <option value="supports">支持</option>
                          <option value="opposes">反証</option>
                          <option value="context">文脈</option>
                        </select>
                      </label>
                      <label>
                        ページ
                        <input name="page" type="number" min="1" />
                      </label>
                    </div>
                    <div class="form-row">
                      <label>
                        直接性
                        <select name="directness">
                          <option value="unspecified">未指定</option>
                          <option value="direct">直接</option>
                          <option value="indirect">間接</option>
                        </select>
                      </label>
                      <label>
                        種類
                        <select name="basis">
                          <option value="document">資料</option>
                          <option value="observation">観測</option>
                          <option value="measurement">測定</option>
                          <option value="testimony">証言</option>
                          <option value="inference">推論</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      説明
                      <textarea name="explanation" rows="3" />
                    </label>
                    <button class="primary">追加</button>
                  </form>
                </Show>
                <Show when={modal() === "assessment"}>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await api("/entities/" + active() + "/assessments", {
                          method: "POST",
                          body: JSON.stringify({
                            ...Object.fromEntries(
                              new FormData(e.currentTarget),
                            ),
                            statementId: selected()!.id,
                            expectedRevision: selected()!.revision,
                          }),
                        });
                        await reloadDetail();
                        setModal("");
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      確からしさ
                      <select name="value">
                        <option value="unrated">未評価</option>
                        <option value="high">高</option>
                        <option value="medium">中</option>
                        <option value="low">低</option>
                      </select>
                    </label>
                    <label>
                      根拠
                      <textarea name="rationale" rows="3" />
                    </label>
                    <label>
                      適用範囲
                      <input name="scope" />
                    </label>
                    <button class="primary">評価を保存</button>
                  </form>
                </Show>
                <Show when={modal() === "save-view"}>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await api("/views", {
                          method: "POST",
                          body: JSON.stringify({
                            name: new FormData(e.currentTarget).get("name"),
                            query: query(),
                          }),
                        });
                        await refresh();
                        setModal("");
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      名前
                      <input name="name" required autofocus />
                    </label>
                    <label>
                      検索条件
                      <input readOnly value={query()} />
                    </label>
                    <button class="primary">保存</button>
                  </form>
                </Show>
                <Show when={modal() === "open" || modal() === "commands"}>
                  <div class="palette-input">
                    <Search size={17} />
                    <input
                      autofocus
                      aria-label="コマンド・エンティティを検索"
                      placeholder="検索…"
                      value={paletteQuery()}
                      onInput={(e) => setPaletteQuery(e.currentTarget.value)}
                    />
                    <kbd>ESC</kbd>
                  </div>
                  <div class="palette-results">
                    <Show when={modal() === "commands"}>
                      <For
                        each={
                          [
                            ["新規エンティティ", () => setModal("new")],
                            [
                              "グラフビュー",
                              () => {
                                setSection("graph");
                                setModal("");
                              },
                            ],
                            [
                              "保存",
                              () => {
                                save();
                                setModal("");
                              },
                            ],
                            [
                              "アップロード",
                              () => {
                                upload.click();
                                setModal("");
                              },
                            ],
                            [
                              "閉じたタブを復元",
                              () => {
                                const id = closed().at(-1);
                                if (id) openEntity(id);
                                setModal("");
                              },
                            ],
                            [
                              "テーマを切り替え",
                              () => {
                                setTheme(theme() === "dark" ? "light" : "dark");
                                setModal("");
                              },
                            ],
                          ] as [string, () => void][]
                        }
                      >
                        {([name, fn]) => (
                          <Show when={name.includes(paletteQuery())}>
                            <button onClick={fn}>
                              <Command size={15} />
                              {name}
                            </button>
                          </Show>
                        )}
                      </For>
                    </Show>
                    <For
                      each={entities()
                        .filter((e) =>
                          e.name
                            .toLowerCase()
                            .includes(paletteQuery().toLowerCase()),
                        )
                        .slice(0, 30)}
                    >
                      {(e) => (
                        <button
                          onClick={() => {
                            setModal("");
                            setSection("all");
                            openEntity(e.id);
                          }}
                        >
                          {entityIcon(e.kind)}
                          <span>{e.name}</span>
                          <small>{e.kind}</small>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={modal() === "settings"}>
                  <div class="settings-list">
                    <button
                      onClick={() =>
                        setTheme(theme() === "dark" ? "light" : "dark")
                      }
                    >
                      <Sun size={16} />
                      テーマ
                      <span>{theme() === "dark" ? "ダーク" : "ライト"}</span>
                    </button>
                    <a
                      href={`/api/w/${workspace()}/export`}
                      download="prisx-export.json"
                    >
                      <Download size={16} />
                      完全エクスポート
                    </a>
                    <button onClick={() => setModal("wikidata")}>
                      <ExternalLink size={16} />
                      Wikidata 取り込み
                    </button>
                    <button onClick={() => importInput.click()}>
                      <Upload size={16} />
                      再インポート
                    </button>
                    <button
                      onClick={async () => {
                        if (dirty()) await save();
                        if (dirty()) return;
                        await request("/api/auth/sign-out", {
                          method: "POST",
                          body: "{}",
                        });
                        await clearDrafts(user().id);
                        setUser(null);
                        setModal("");
                        setBody("");
                        setDetail(undefined);
                        setEntities([]);
                      }}
                    >
                      <LogOut size={16} />
                      ログアウト
                    </button>
                  </div>
                </Show>
                <Show when={modal() === "workspaces"}>
                  <div class="settings-list">
                    <For each={workspaces()}>
                      {(w) => (
                        <button
                          onClick={async () => {
                            if (dirty()) await save();
                            if (dirty()) return;
                            setWorkspace(w.id);
                            setTabs([]);
                            setActive("");
                            setDetail(undefined);
                            setQuery("");
                            await refresh();
                            setModal("");
                          }}
                        >
                          <Layers size={15} />
                          {w.name}
                          {w.id === workspace() && <Check size={14} />}
                        </button>
                      )}
                    </For>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await request("/api/workspaces", {
                          method: "POST",
                          body: JSON.stringify({
                            name: new FormData(e.currentTarget).get("name"),
                          }),
                        });
                        await boot();
                        setModal("");
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      新規ワークスペース
                      <input name="name" required />
                    </label>
                    <button class="primary">作成</button>
                  </form>
                </Show>
                <Show when={modal() === "conflict"}>
                  <ConflictForm
                    local={body()}
                    load={async () => {
                      const d = await api("/entities/" + active());
                      const r = await fetch(
                        `/api/w/${workspace()}/entities/${active()}/content`,
                      );
                      if (!r.ok) throw new Error("取得に失敗");
                      return {
                        text: await r.text(),
                        revision: d.content?.revision || 0,
                      };
                    }}
                    merge={async (text, revision) => {
                      setBody(text);
                      baseRevision = revision;
                      setDirty(true);
                      await save();
                      if (!dirty()) setModal("");
                    }}
                    onError={fail}
                  />
                </Show>
                <Show when={modal() === "wikidata"}>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const result = await api("/wikidata", {
                          method: "POST",
                          body: JSON.stringify({
                            id: new FormData(e.currentTarget).get("id"),
                          }),
                        });
                        await refresh();
                        setModal("");
                        await openEntity(result.entity.id);
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    <label>
                      Wikidata ID
                      <input
                        name="id"
                        placeholder="Q42"
                        pattern="Q[1-9][0-9]*"
                        required
                      />
                    </label>
                    <button class="primary">取り込み</button>
                  </form>
                </Show>
                <Show when={modal() === "schema"}>
                  <SchemaForm
                    load={() => api("/entities/" + active() + "/schema")}
                    save={async (value) => {
                      await api("/entities/" + active() + "/schema", {
                        method: "PUT",
                        body: JSON.stringify(value),
                      });
                      setModal("");
                    }}
                    onError={fail}
                  />
                </Show>
                <Show when={modal() === "entity-menu"}>
                  <div class="settings-list">
                    <Show
                      when={
                        current()?.kind === "property" ||
                        current()?.kind === "class"
                      }
                    >
                      <button onClick={() => setModal("schema")}>
                        <Braces size={16} />
                        スキーマ定義
                      </button>
                    </Show>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          location.origin + "/#" + active(),
                        );
                        setModal("");
                      }}
                    >
                      <Link2 size={16} />
                      リンクをコピー
                    </button>
                    <button
                      onClick={() => {
                        setModal("");
                        setRight(true);
                        setRightTab("history");
                      }}
                    >
                      <History size={16} />
                      履歴
                    </button>
                    <button
                      class="danger"
                      onClick={async () => {
                        try {
                          if (dirty()) await save();
                          if (dirty()) return;
                          await api("/entities/" + active(), {
                            method: "PATCH",
                            body: JSON.stringify({
                              deleted: true,
                              expectedRevision: current()!.revision,
                            }),
                          });
                          closeTab(active());
                          await refresh();
                          setModal("");
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      <Trash2 size={16} />
                      削除
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
function ValueView(p: {
  value: Value;
  names: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  return (
    <Show
      when={p.value.kind === "object" || p.value.kind === "array"}
      fallback={
        <span
          class={p.value.kind === "entity-ref" ? "ref-chip" : ""}
          onClick={(e) => {
            if (p.value.kind === "entity-ref") {
              e.stopPropagation();
              p.onOpen(p.value.entityId);
            }
          }}
        >
          {p.value.kind === "entity-ref" && <Link2 size={11} />}{" "}
          {displayValue(p.value, p.names)}
        </span>
      }
    >
      <details onClick={(e) => e.stopPropagation()}>
        <summary>
          {p.value.kind === "object" ? "辞書" : "配列"}{" "}
          <span class="muted">
            {p.value.kind === "object"
              ? Object.keys(p.value.fields).length
              : p.value.kind === "array"
                ? p.value.items.length
                : 0}
          </span>
        </summary>
        <div class="nested-value">
          <For
            each={
              p.value.kind === "object"
                ? Object.entries(p.value.fields)
                : p.value.kind === "array"
                  ? p.value.items.map(
                      (v, i) => [String(i), v] as [string, Value],
                    )
                  : []
            }
          >
            {([k, v]) => (
              <div>
                <span class="muted">{k}: </span>
                <ValueView value={v} names={p.names} onOpen={p.onOpen} />
              </div>
            )}
          </For>
        </div>
      </details>
    </Show>
  );
}
function StatementForm(p: {
  statement?: Statement;
  entities: Entity[];
  onSubmit: (v: any) => Promise<void>;
  onError: (e: any) => void;
}) {
  const s = p.statement;
  const [kind, setKind] = createSignal(s?.value.kind || "scalar"),
    [scalarType, setScalarType] = createSignal(
      s?.value.kind === "scalar"
        ? s.value.value === null
          ? "null"
          : typeof s.value.value
        : "string",
    ),
    [rank, setRank] = createSignal(s?.rank || "normal"),
    [timeKind, setTimeKind] = createSignal(s?.validTime.kind || "unspecified"),
    [busy, setBusy] = createSignal(false);
  const val = s?.value;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const f = new FormData(e.currentTarget),
            raw = String(f.get("value") || "");
          let value: Value;
          switch (kind()) {
            case "scalar":
              value = {
                kind: "scalar",
                value:
                  scalarType() === "null"
                    ? null
                    : scalarType() === "boolean"
                      ? raw === "true"
                      : scalarType() === "number"
                        ? Number(raw)
                        : raw,
              };
              break;
            case "entity-ref":
              value = { kind: "entity-ref", entityId: raw };
              break;
            case "statement-ref":
              value = { kind: "statement-ref", statementId: raw };
              break;
            case "array":
            case "object":
              {
                const parsed = JSON.parse(raw);
                value = parsed?.kind === kind() ? parsed : fromJSON(parsed);
              }
              if (value.kind !== kind())
                throw new Error("値の型が一致しません");
              break;
            case "time":
              value = {
                kind: "time",
                value: raw,
                precision: f.get("precision") as any,
              };
              break;
            case "quantity":
              value = {
                kind: "quantity",
                amount: raw,
                ...(f.get("unitId") ? { unitId: String(f.get("unitId")) } : {}),
              };
              break;
            case "unknown":
            case "no-value":
              value = { kind: kind() as "unknown" };
              break;
            default:
              throw new Error("読み取り専用");
          }
          let validTime: any = { kind: timeKind() };
          if (timeKind() === "interval")
            validTime = {
              kind: "interval",
              start: f.get("start")
                ? { value: f.get("start"), precision: "day" }
                : { kind: "unknown" },
              end: f.get("end")
                ? { value: f.get("end"), precision: "day" }
                : { kind: "unknown" },
              timezone: "Asia/Tokyo",
            };
          if (timeKind() === "point")
            validTime = {
              kind: "point",
              point: { value: f.get("point"), precision: "day" },
              timezone: "Asia/Tokyo",
            };
          const qualifiers = JSON.parse(String(f.get("qualifiers") || "[]"));
          await p.onSubmit({
            id: s?.id || undefined,
            expectedRevision: s?.revision,
            propertyId: f.get("propertyId"),
            propertyName: f.get("propertyName"),
            value,
            qualifiers,
            validTime,
            rank: rank(),
            rankReason: f.get("rankReason"),
          });
        } catch (e) {
          p.onError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div class="form-row">
        <label>
          キー
          <select name="propertyId" value={s?.propertyId || ""}>
            <option value="">新しいキー</option>
            <For each={p.entities.filter((e) => e.kind === "property")}>
              {(e) => <option value={e.id}>{e.name}</option>}
            </For>
          </select>
        </label>
        <label>
          新しいキー名
          <input name="propertyName" />
        </label>
      </div>
      <div class="form-row">
        <label>
          値の型
          <select
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as any)}
          >
            <For
              each={[
                ["scalar", "単一値"],
                ["entity-ref", "エンティティ参照"],
                ["object", "辞書"],
                ["array", "配列"],
                ["time", "日時"],
                ["quantity", "数量"],
                ["statement-ref", "主張参照"],
                ["unknown", "不明"],
                ["no-value", "値なし"],
              ]}
            >
              {([k, l]) => <option value={k}>{l}</option>}
            </For>
          </select>
        </label>
        <Show when={kind() === "scalar"}>
          <label>
            型
            <select
              value={scalarType()}
              onChange={(e) => setScalarType(e.currentTarget.value)}
            >
              <option value="string">文字列</option>
              <option value="number">数値</option>
              <option value="boolean">真偽値</option>
              <option value="null">null</option>
            </select>
          </label>
        </Show>
        <Show when={kind() === "time"}>
          <label>
            精度
            <select
              name="precision"
              value={val?.kind === "time" ? val.precision : "day"}
            >
              <option value="day">日</option>
              <option value="month">月</option>
              <option value="year">年</option>
              <option value="second">秒</option>
            </select>
          </label>
        </Show>
      </div>
      <Show when={!["unknown", "no-value"].includes(kind())}>
        <label>
          値{kind() === "object" || kind() === "array" ? " · 構造化 JSON" : ""}
          <Show
            when={kind() === "entity-ref"}
            fallback={
              <Show
                when={kind() === "object" || kind() === "array"}
                fallback={
                  <Show
                    when={kind() === "scalar" && scalarType() === "boolean"}
                    fallback={
                      <input
                        name="value"
                        value={
                          val?.kind === "quantity"
                            ? val.amount
                            : val
                              ? displayValue(val)
                              : ""
                        }
                        required={scalarType() !== "null"}
                      />
                    }
                  >
                    <select
                      name="value"
                      value={
                        val?.kind === "scalar" ? String(val.value) : "true"
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </Show>
                }
              >
                <textarea
                  name="value"
                  rows="5"
                  class="mono"
                  value={
                    val && (val.kind === "object" || val.kind === "array")
                      ? JSON.stringify(val, null, 2)
                      : kind() === "object"
                        ? "{}"
                        : "[]"
                  }
                />
              </Show>
            }
          >
            <select
              name="value"
              value={val?.kind === "entity-ref" ? val.entityId : ""}
              required
            >
              <option value="">選択</option>
              <For each={p.entities}>
                {(e) => (
                  <option value={e.id}>
                    {e.name} · {e.kind}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </label>
      </Show>
      <Show when={kind() === "quantity"}>
        <label>
          単位
          <select
            name="unitId"
            value={val?.kind === "quantity" ? val.unitId : ""}
          >
            <option value="">なし</option>
            <For each={p.entities}>
              {(e) => <option value={e.id}>{e.name}</option>}
            </For>
          </select>
        </label>
      </Show>
      <div class="form-row">
        <label>
          ランク
          <select
            value={rank()}
            onChange={(e) => setRank(e.currentTarget.value as any)}
          >
            <option value="normal">通常</option>
            <option value="preferred">推奨</option>
            <option value="deprecated">非推奨</option>
          </select>
        </label>
        <label>
          有効時間
          <select
            value={timeKind()}
            onChange={(e) => setTimeKind(e.currentTarget.value as any)}
          >
            <option value="unspecified">未指定</option>
            <option value="timeless">時点なし</option>
            <option value="point">時点</option>
            <option value="interval">期間 [開始, 終了)</option>
          </select>
        </label>
      </div>
      <Show when={rank() !== "normal"}>
        <label>
          ランク理由
          <input name="rankReason" required value={s?.rankReason || ""} />
        </label>
      </Show>
      <Show when={timeKind() === "interval"}>
        <div class="form-row">
          <label>
            開始
            <input
              name="start"
              type="date"
              value={
                s?.validTime.kind === "interval" && "value" in s.validTime.start
                  ? s.validTime.start.value
                  : ""
              }
            />
          </label>
          <label>
            終了（含まない）
            <input
              name="end"
              type="date"
              value={
                s?.validTime.kind === "interval" && "value" in s.validTime.end
                  ? s.validTime.end.value
                  : ""
              }
            />
          </label>
        </div>
      </Show>
      <Show when={timeKind() === "point"}>
        <label>
          時点
          <input
            name="point"
            type="date"
            required
            value={s?.validTime.kind === "point" ? s.validTime.point.value : ""}
          />
        </label>
      </Show>
      <details>
        <summary>限定条件 · JSON</summary>
        <textarea
          class="mono"
          name="qualifiers"
          rows="3"
          value={JSON.stringify(s?.qualifiers || [], null, 2)}
        />
      </details>
      <button class="primary" disabled={busy() || kind() === "opaque"}>
        <Check size={14} />
        {busy() ? "保存中" : "保存"}
      </button>
    </form>
  );
}
function unbox(v: Value): any {
  return v.kind === "scalar"
    ? v.value
    : v.kind === "array"
      ? v.items.map(unbox)
      : v.kind === "object"
        ? Object.fromEntries(
            Object.entries(v.fields).map(([k, v]) => [k, unbox(v)]),
          )
        : v;
}
function StructuredSource(p: {
  statements: Statement[];
  onApply: (v: Statement[]) => Promise<void>;
}) {
  const [error, setError] = createSignal("");
  let area!: HTMLTextAreaElement;
  return (
    <div class="structured-source">
      <textarea
        ref={area}
        value={JSON.stringify(p.statements, null, 2)}
        aria-label="主張 JSON"
      />
      <div>
        <span class="danger">{error()}</span>
        <button
          class="button"
          onClick={async () => {
            try {
              const data = JSON.parse(area.value);
              if (!Array.isArray(data)) throw new Error("配列が必要");
              await p.onApply(data);
              setError("");
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          検証して適用
        </button>
      </div>
    </div>
  );
}
function Auth(p: { onDone: () => void }) {
  const [signup, setSignup] = createSignal(false),
    [error, setError] = createSignal(""),
    [busy, setBusy] = createSignal(false);
  return (
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand">
          p<span>·</span>
        </div>
        <h1>Prisx</h1>
        <div class="auth-tabs">
          <button
            class={!signup() ? "active" : ""}
            onClick={() => setSignup(false)}
          >
            ログイン
          </button>
          <button
            class={signup() ? "active" : ""}
            onClick={() => setSignup(true)}
          >
            アカウント作成
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = Object.fromEntries(new FormData(e.currentTarget));
              await request(
                "/api/auth/" + (signup() ? "sign-up/email" : "sign-in/email"),
                { method: "POST", body: JSON.stringify(data) },
              );
              p.onDone();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Show when={signup()}>
            <label>
              名前
              <input name="name" required autocomplete="name" />
            </label>
          </Show>
          <label>
            メールアドレス
            <input name="email" type="email" required autocomplete="email" />
          </label>
          <label>
            パスワード
            <input
              name="password"
              type="password"
              minLength="8"
              required
              autocomplete={signup() ? "new-password" : "current-password"}
            />
          </label>
          <Show when={error()}>
            <p class="danger" role="alert">
              {error()}
            </p>
          </Show>
          <button class="primary" disabled={busy()}>
            {busy() ? "処理中" : signup() ? "アカウント作成" : "ログイン"}
            <ArrowUpRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

function SchemaForm(p: {
  load: () => Promise<any>;
  save: (v: any) => Promise<void>;
  onError: (e: any) => void;
}) {
  const [def, setDef] = createSignal<any>();
  let area!: HTMLTextAreaElement;
  onMount(() => p.load().then(setDef).catch(p.onError));
  return (
    <Show when={def()}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await p.save({
              expectedRevision: def().revision,
              definition: JSON.parse(area.value),
            });
          } catch (e) {
            p.onError(e);
          }
        }}
      >
        <label>
          JSON Schema 2020-12
          <textarea
            ref={area}
            class="mono"
            rows="14"
            value={JSON.stringify(def(), null, 2)}
          />
        </label>
        <button class="primary">影響を検証して適用</button>
      </form>
    </Show>
  );
}

function ConflictForm(p: {
  local: string;
  load: () => Promise<{ text: string; revision: number }>;
  merge: (text: string, revision: number) => Promise<void>;
  onError: (e: any) => void;
}) {
  const [remote, setRemote] = createSignal<{
    text: string;
    revision: number;
  }>();
  let area!: HTMLTextAreaElement;
  onMount(() => p.load().then(setRemote).catch(p.onError));
  return (
    <Show when={remote()}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await p.merge(area.value, remote()!.revision);
          } catch (e) {
            p.onError(e);
          }
        }}
      >
        <label>
          サーバーの最新本文 · rev {remote()!.revision}
          <textarea rows="7" readOnly value={remote()!.text} />
        </label>
        <label>
          保存する本文
          <textarea ref={area} rows="9" value={p.local} />
        </label>
        <button class="primary">編集内容を新しい版として保存</button>
      </form>
    </Show>
  );
}
