import { createSignal, onMount, onCleanup } from "solid-js";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-solid";
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer(p: { url: string }) {
  let canvas!: HTMLCanvasElement;
  let pdf: PDFDocumentProxy | undefined;
  let renderTask: any;
  let stopped = false;
  const [page, setPage] = createSignal(1),
    [count, setCount] = createSignal(0),
    [zoom, setZoom] = createSignal(1),
    [error, setError] = createSignal("");
  async function draw() {
    if (!pdf || stopped) return;
    renderTask?.cancel();
    const pg = await pdf.getPage(page());
    if (stopped) return;
    const view = pg.getViewport({ scale: zoom() * devicePixelRatio });
    canvas.width = view.width;
    canvas.height = view.height;
    canvas.style.width = view.width / devicePixelRatio + "px";
    canvas.style.height = view.height / devicePixelRatio + "px";
    renderTask = pg.render({
      canvas,
      canvasContext: canvas.getContext("2d")!,
      viewport: view,
    });
    try {
      await renderTask.promise;
    } catch (e: any) {
      if (e.name !== "RenderingCancelledException")
        setError("PDF を表示できません");
    }
  }
  onMount(async () => {
    try {
      pdf = await getDocument({ url: p.url, enableXfa: false }).promise;
      setCount(pdf.numPages);
      await draw();
    } catch {
      setError("PDF を表示できません");
    }
  });
  onCleanup(() => {
    stopped = true;
    renderTask?.cancel();
    pdf?.loadingTask.destroy();
  });
  return (
    <div class="pdf-viewer">
      <div class="pdf-toolbar">
        <button
          aria-label="前のページ"
          disabled={page() <= 1}
          onClick={() => {
            setPage(page() - 1);
            draw();
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {page()} / {count()}
        </span>
        <button
          aria-label="次のページ"
          disabled={page() >= count()}
          onClick={() => {
            setPage(page() + 1);
            draw();
          }}
        >
          <ChevronRight size={16} />
        </button>
        <button
          aria-label="縮小"
          onClick={() => {
            setZoom(Math.max(0.25, zoom() - 0.25));
            draw();
          }}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom() * 100)}%</span>
        <button
          aria-label="拡大"
          onClick={() => {
            setZoom(Math.min(3, zoom() + 0.25));
            draw();
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <span class="danger">{error()}</span>
      <canvas ref={canvas} aria-label={"PDF ページ " + page()} />
    </div>
  );
}
