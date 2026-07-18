import { describe, expect, it } from "vitest";
import {
  collectImages,
  inlinePlainText,
  parseMarkdown,
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
    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "unsupported",
      "paragraph",
    ]);
    const unsupported = blocks[1];
    expect(unsupported.type === "unsupported" ? unsupported.detail : "").toBe(
      "![[另一篇笔记]]",
    );
  });
});
