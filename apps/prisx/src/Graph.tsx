import { createEffect, onMount, onCleanup } from "solid-js";
export default function Graph(props: {
  data: { nodes: any[]; edges: any[] };
  active?: string;
  onOpen: (id: string) => void;
  small?: boolean;
}) {
  let canvas!: HTMLCanvasElement;
  let points: any[] = [];
  let worker: Worker;
  let observer: ResizeObserver;
  let zoom = 1;
  let offset = { x: 0, y: 0 };
  function draw() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      dpr = devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const c = canvas.getContext("2d")!;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, rect.width, rect.height);
    const map = new Map(points.map((p) => [p.id, p]));
    const px = (p: any) => rect.width / 2 + p.x * zoom + offset.x,
      py = (p: any) => rect.height / 2 + p.y * zoom + offset.y;
    c.lineWidth = 1;
    for (const edge of props.data.edges) {
      const a = map.get(edge.source),
        b = map.get(edge.target);
      if (!a || !b) continue;
      c.strokeStyle =
        edge.type === "core:tag" || edge.type === "tag-derived"
          ? "#69548a55"
          : "#83818c44";
      c.setLineDash(edge.type === "body-link" ? [3, 4] : []);
      c.beginPath();
      c.moveTo(px(a), py(a));
      c.lineTo(px(b), py(b));
      c.stroke();
    }
    c.setLineDash([]);
    for (const p of points) {
      const n = props.data.nodes.find((n) => n.id === p.id);
      if (!n) continue;
      c.fillStyle =
        p.id === props.active
          ? "#bdabff"
          : n.kind === "tag"
            ? "#a58bdf"
            : n.kind === "class"
              ? "#739c98"
              : "#aaa7b5";
      c.beginPath();
      c.arc(px(p), py(p), p.id === props.active ? 7 : 4, 0, Math.PI * 2);
      c.fill();
      if (!props.small || p.id === props.active || points.length < 15) {
        c.font = "11px system-ui";
        c.fillStyle = "#94909e";
        c.textAlign = "center";
        c.fillText(n.name, px(p), py(p) + 19);
      }
    }
  }
  onMount(() => {
    worker = new Worker(new URL("./graph.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      points = e.data;
      zoom = props.small ? 0.55 : 0.85;
      draw();
    };
    worker.postMessage(props.data);
    observer = new ResizeObserver(draw);
    observer.observe(canvas);
  });
  createEffect(() => {
    const data = props.data;
    if (worker) worker.postMessage(data);
  });
  onCleanup(() => {
    worker?.terminate();
    observer?.disconnect();
  });
  return (
    <canvas
      class="graph-canvas"
      aria-label="ナレッジグラフ"
      ref={canvas}
      onWheel={(e) => {
        e.preventDefault();
        zoom = Math.max(0.1, Math.min(4, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        draw();
      }}
      onClick={(e) => {
        const r = canvas.getBoundingClientRect();
        const found = points.find(
          (p) =>
            Math.hypot(
              r.width / 2 + p.x * zoom + offset.x - (e.clientX - r.left),
              r.height / 2 + p.y * zoom + offset.y - (e.clientY - r.top),
            ) < 14,
        );
        if (found) props.onOpen(found.id);
      }}
    />
  );
}
