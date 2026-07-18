import type {
  Blockquote,
  Image,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ContentBlock, ImageSpec } from "./domain";

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"]);

interface ObsidianToken {
  type: "text" | "embed";
  value: string;
}

function splitObsidianEmbeds(value: string): ObsidianToken[] {
  const tokens: ObsidianToken[] = [];
  const pattern = /!\[\[([^\]]+)\]\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) {
      tokens.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    tokens.push({ type: "embed", value: match[1] });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    tokens.push({ type: "text", value: value.slice(cursor) });
  }

  return tokens.length ? tokens : [{ type: "text", value }];
}

function parseObsidianImage(value: string): ImageSpec | null {
  const [targetWithAnchor, widthPart] = value.split("|");
  const target = targetWithAnchor.split("#")[0].trim();
  const extension = target.split(".").pop()?.toLowerCase();
  if (!extension || !IMAGE_EXTENSIONS.has(extension)) return null;

  const widthMatch = widthPart?.match(/^(\d+)(?:x\d+)?$/);
  return {
    raw: target,
    alt: target.replace(/\.[^.]+$/, ""),
    requestedWidth: widthMatch ? Number(widthMatch[1]) : undefined,
    source: "obsidian",
  };
}

function isSingleMarkdownImage(paragraph: Paragraph): Image | null {
  if (paragraph.children.length !== 1) return null;
  const only = paragraph.children[0];
  return only.type === "image" ? only : null;
}

function paragraphToBlocks(paragraph: Paragraph, baseId: string): ContentBlock[] {
  const markdownImage = isSingleMarkdownImage(paragraph);
  if (markdownImage) {
    return [
      {
        id: baseId,
        type: "image",
        image: {
          raw: markdownImage.url,
          alt: markdownImage.alt ?? "文章图片",
          source: "markdown",
        },
      },
    ];
  }

  const htmlNodes = paragraph.children.filter((child) => child.type === "html");
  const hasVisibleNonHtml = paragraph.children.some(
    (child) => child.type !== "html" && (child.type !== "text" || child.value.trim()),
  );
  if (htmlNodes.length && !hasVisibleNonHtml) {
    const detail = htmlNodes
      .map((node) => node.value.replace(/<[^>]+>/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    return [
      {
        id: baseId,
        type: "unsupported",
        label: "HTML 已安全降级",
        detail: detail || "HTML 内容",
      },
    ];
  }

  const blocks: ContentBlock[] = [];
  let inline: PhrasingContent[] = [];
  let sequence = 0;

  const flushInline = () => {
    const hasVisibleContent = inline.some(
      (node) => node.type !== "text" || node.value.trim().length > 0,
    );
    if (hasVisibleContent) {
      blocks.push({
        id: `${baseId}-text-${sequence++}`,
        type: "paragraph",
        inline: { nodes: inline },
      });
    }
    inline = [];
  };

  for (const child of paragraph.children) {
    if (child.type === "html") {
      flushInline();
      blocks.push({
        id: `${baseId}-unsupported-${sequence++}`,
        type: "unsupported",
        label: "HTML 已安全降级",
        detail: child.value.replace(/<[^>]+>/g, " ").trim() || "HTML 内容",
      });
      continue;
    }

    if (child.type === "image") {
      flushInline();
      blocks.push({
        id: `${baseId}-image-${sequence++}`,
        type: "image",
        image: {
          raw: child.url,
          alt: child.alt ?? "文章图片",
          source: "markdown",
        },
      });
      continue;
    }

    if (child.type === "text" && child.value.includes("![[")) {
      const tokens = splitObsidianEmbeds(child.value);
      for (const token of tokens) {
        if (token.type === "text") {
          if (token.value) inline.push({ type: "text", value: token.value });
          continue;
        }

        flushInline();
        const image = parseObsidianImage(token.value);
        if (image) {
          blocks.push({
            id: `${baseId}-embed-${sequence++}`,
            type: "image",
            image,
          });
        } else {
          blocks.push({
            id: `${baseId}-unsupported-${sequence++}`,
            type: "unsupported",
            label: "暂不展开嵌入笔记",
            detail: `![[${token.value}]]`,
          });
        }
      }
      continue;
    }

    inline.push(child);
  }

  flushInline();
  return blocks;
}

function detectCallout(node: Blockquote): { kind: string; title: string } | undefined {
  const first = node.children[0];
  if (!first || first.type !== "paragraph") return undefined;
  const plain = toString(first).trim();
  const match = plain.match(/^\[!([A-Za-z-]+)\][+-]?[^\S\n]*([^\n]*)/);
  if (!match) return undefined;
  return {
    kind: match[1].toLowerCase(),
    title: match[2] || match[1],
  };
}

export function parseMarkdown(markdown: string): ContentBlock[] {
  const root = parser.parse(markdown) as Root;
  const blocks: ContentBlock[] = [];

  root.children.forEach((node: RootContent, index) => {
    const id = `block-${index}`;
    switch (node.type) {
      case "yaml":
      case "definition":
        return;
      case "heading":
        blocks.push({
          id,
          type: "heading",
          depth: node.depth,
          inline: { nodes: node.children },
        });
        return;
      case "paragraph":
        blocks.push(...paragraphToBlocks(node, id));
        return;
      case "list":
        blocks.push({
          id,
          type: "list",
          ordered: Boolean(node.ordered),
          start: node.start ?? undefined,
          node,
        });
        return;
      case "blockquote":
        blocks.push({
          id,
          type: "blockquote",
          node,
          callout: detectCallout(node),
        });
        return;
      case "code":
        blocks.push({
          id,
          type: "code",
          value: node.value,
          language: node.lang ?? undefined,
        });
        return;
      case "table":
        blocks.push({ id, type: "table", node });
        return;
      case "thematicBreak":
        blocks.push({ id, type: "rule" });
        return;
      case "html":
        if (/^\s*<!--\s*xhs-page-break\s*-->\s*$/i.test(node.value)) {
          blocks.push({ id, type: "pageBreak" });
        } else {
          blocks.push({
            id,
            type: "unsupported",
            label: "HTML 已安全降级",
            detail: node.value.replace(/<[^>]+>/g, " ").trim() || "HTML 内容",
          });
        }
        return;
      default:
        blocks.push({
          id,
          type: "unsupported",
          label: "暂不支持的 Markdown 内容",
          detail: node.type,
        });
    }
  });

  return blocks;
}

export function collectImages(blocks: ContentBlock[]): Array<{
  blockId: string;
  image: ImageSpec;
}> {
  return blocks.flatMap((block) =>
    block.type === "image" ? [{ blockId: block.id, image: block.image }] : [],
  );
}

export function inlinePlainText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inlineCode") return node.value;
      if ("children" in node) return inlinePlainText(node.children as PhrasingContent[]);
      return "";
    })
    .join("");
}

export function stripCalloutMarker(node: Paragraph): Paragraph {
  const clone = structuredClone(node);
  const first = clone.children[0];
  if (first?.type === "text") {
    // The first callout line is metadata (`[!tip] Title`), not body copy.
    first.value = first.value.replace(/^\[![A-Za-z-]+\][+-]?[^\n]*(?:\n|$)/, "");
  }
  return clone;
}

export function textNode(value: string): Text {
  return { type: "text", value };
}
