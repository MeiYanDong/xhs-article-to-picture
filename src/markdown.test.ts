import { describe, expect, it } from "vitest";
import {
  collectImages,
  inlinePlainText,
  parseMarkdown,
  readFrontmatterFields,
  resolveExportTopicSource,
  stripCalloutMarker,
} from "./markdown";

describe("parseMarkdown", () => {
  it("compiles the supported Obsidian and GFM surface into semantic blocks", () => {
    const blocks = parseMarkdown(`---
title: ignored metadata
---

# AI 小白教程

正文前半段 ![[assets/flow.png|600]] 正文后半段。

> [!tip] 第一步
> 先让 AI 翻译成人话。

![标准图片](../images/check.png)

| 阶段 | 动作 |
| --- | --- |
| 1 | 复述 |

<!-- xhs-page-break -->

<video src="unsafe.mp4"></video>
`);

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "image",
      "paragraph",
      "blockquote",
      "image",
      "table",
      "pageBreak",
      "unsupported",
    ]);

    const heading = blocks[0];
    expect(heading.type).toBe("heading");
    if (heading.type === "heading") {
      expect(inlinePlainText(heading.inline.nodes)).toBe("AI 小白教程");
    }

    const images = collectImages(blocks);
    expect(images).toHaveLength(2);
    expect(images[0].image).toMatchObject({
      raw: "assets/flow.png",
      requestedWidth: 600,
      source: "obsidian",
    });
    expect(images[1].image).toMatchObject({
      raw: "../images/check.png",
      alt: "标准图片",
      source: "markdown",
    });

    const callout = blocks.find((block) => block.type === "blockquote");
    expect(callout?.type === "blockquote" ? callout.callout : undefined).toEqual({
      kind: "tip",
      title: "第一步",
    });
    if (callout?.type === "blockquote") {
      const firstParagraph = callout.node.children[0];
      expect(firstParagraph.type).toBe("paragraph");
      if (firstParagraph.type === "paragraph") {
        expect(inlinePlainText(stripCalloutMarker(firstParagraph).children)).toBe(
          "先让 AI 翻译成人话。",
        );
      }
    }
  });

  it("marks non-image Obsidian embeds instead of silently dropping them", () => {
    const blocks = parseMarkdown("前文 ![[另一篇笔记]] 后文");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "unsupported", "paragraph"]);
    const unsupported = blocks[1];
    expect(unsupported.type === "unsupported" ? unsupported.detail : "").toBe("![[另一篇笔记]]");
  });

  it("preserves ordered-list semantics and an explicit starting number", () => {
    const blocks = parseMarkdown(`9. 第九项
10. 第十项
11. 第十一项
12. 第十二项`);
    const list = blocks.find((block) => block.type === "list");

    expect(list).toMatchObject({
      type: "list",
      ordered: true,
      start: 9,
    });
    expect(list?.type === "list" ? list.node.children : []).toHaveLength(4);
  });

  it("treats an isolated 3:4 asset as a page instead of nesting it in the article shell", () => {
    const blocks = parseMarkdown(`![上篇封面](cover.png)

<!-- xhs-page-break -->

正文开始。

<!-- xhs-page-break -->

![数据总结](numbers.png)

<!-- xhs-page-break -->

继续正文。`);

    const images = collectImages(blocks);
    expect(images).toHaveLength(2);
    expect(images[0].image.layout).toBe("full-page");
    expect(images[1].image.layout).toBe("full-page");
  });

  it("keeps an image inside surrounding prose as an inline article image", () => {
    const blocks = parseMarkdown(`前文。

![网页证据](evidence.png)

后文。`);
    expect(collectImages(blocks)[0].image.layout).not.toBe("full-page");
  });

  it("uses an explicit frontmatter export title before the article title and heading", () => {
    const markdown = `---
title: 长文章标题
export_title: Codex用法上篇
---

# 正文一级标题`;
    const blocks = parseMarkdown(markdown);
    expect(readFrontmatterFields(markdown)).toMatchObject({
      title: "长文章标题",
      export_title: "Codex用法上篇",
    });
    expect(resolveExportTopicSource(markdown, blocks, "article-part-1")).toBe("Codex用法上篇");
  });

  it("falls back through title, first heading, and filename in that order", () => {
    const titled = `---\ntitle: '文章主题'\n---\n\n# 一级标题`;
    const headed = "# 一级标题";
    expect(resolveExportTopicSource(titled, parseMarkdown(titled), "draft")).toBe("文章主题");
    expect(resolveExportTopicSource(headed, parseMarkdown(headed), "draft")).toBe("一级标题");
    expect(resolveExportTopicSource("正文", parseMarkdown("正文"), "article-part-2")).toBe(
      "article-part-2",
    );
  });
});
