export type ContentHandler = {
  viewer:
    "markdown" | "text" | "image" | "pdf" | "audio" | "video" | "download";
  editor: boolean;
  textExtractor: boolean;
  thumbnailer: boolean;
};
export function resolveHandler(type: string): ContentHandler {
  if (type === "text/markdown")
    return {
      viewer: "markdown",
      editor: true,
      textExtractor: true,
      thumbnailer: false,
    };
  if (
    type.startsWith("text/") ||
    ["application/json", "application/javascript"].includes(type)
  )
    return {
      viewer: "text",
      editor: true,
      textExtractor: true,
      thumbnailer: false,
    };
  if (/^image\/(png|jpeg|webp|gif|avif)$/.test(type))
    return {
      viewer: "image",
      editor: false,
      textExtractor: false,
      thumbnailer: false,
    };
  if (type === "application/pdf")
    return {
      viewer: "pdf",
      editor: false,
      textExtractor: false,
      thumbnailer: false,
    };
  if (type.startsWith("audio/"))
    return {
      viewer: "audio",
      editor: false,
      textExtractor: false,
      thumbnailer: false,
    };
  if (type.startsWith("video/"))
    return {
      viewer: "video",
      editor: false,
      textExtractor: false,
      thumbnailer: false,
    };
  return {
    viewer: "download",
    editor: false,
    textExtractor: false,
    thumbnailer: false,
  };
}
