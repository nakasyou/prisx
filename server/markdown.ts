import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { normalizeTag, validTag } from "../src/domain";
export function extractMarkdown(source: string) {
  const tree = fromMarkdown(source, {
    extensions: [frontmatter(["yaml", "toml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml", "toml"])],
  });
  const tags: { label: string; normalized: string; offset: number }[] = [],
    links: { target: string; label: string; offset: number; embed: boolean }[] =
      [];
  function walk(node: any, inLink = false) {
    if (["code", "inlineCode", "html", "yaml", "toml"].includes(node.type))
      return;
    if (node.type === "text" && !inLink) {
      const start = node.position.start.offset;
      const raw = source.slice(start, node.position.end.offset);
      for (const m of raw.matchAll(
        /(^|[\s（(「、。])#([\p{L}\p{M}\p{N}_\-/]+)/gu,
      )) {
        if (validTag(m[2]))
          tags.push({
            label: m[2],
            normalized: normalizeTag(m[2]),
            offset: start + m.index! + m[1].length,
          });
      }
      for (const m of raw.matchAll(
        /(?<!\\)(!)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      ))
        links.push({
          target: m[2],
          label: m[3] || m[2],
          offset: start + m.index!,
          embed: !!m[1],
        });
    }
    node.children?.forEach((c: any) =>
      walk(c, inLink || node.type === "link" || node.type === "image"),
    );
  }
  walk(tree);
  return { tags, links };
}
