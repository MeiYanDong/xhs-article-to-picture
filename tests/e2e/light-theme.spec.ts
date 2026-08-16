import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../fixtures/ordered-list.md", import.meta.url));

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string) {
  const channels = color
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels?.length !== 3) throw new Error(`无法解析颜色：${color}`);
  const [red, green, blue] = channels.map(channelToLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test("default article and workspace use the verified light palette", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles(fixturePath);
  await expect(page.getByRole("article", { name: "第 1 页", exact: true })).toBeVisible();

  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const artboard = document.querySelector<HTMLElement>(".page-artboard");
    const article = document.querySelector<HTMLElement>(".article-flow");
    const statusbar = document.querySelector<HTMLElement>(".workspace-statusbar");
    if (!artboard || !article || !statusbar) throw new Error("浅色主题验收节点缺失");

    return {
      paper: getComputedStyle(artboard).backgroundColor,
      articleInk: getComputedStyle(article).color,
      accent: root.getPropertyValue("--red").trim(),
      statusbarBackground: getComputedStyle(statusbar).backgroundColor,
      statusbarInk: getComputedStyle(statusbar).color,
    };
  });

  expect(colors).toEqual({
    paper: "rgb(255, 253, 249)",
    articleInk: "rgb(74, 72, 67)",
    accent: "#e8a095",
    statusbarBackground: "rgb(238, 232, 225)",
    statusbarInk: "rgb(109, 102, 95)",
  });
  expect(contrast(colors.articleInk, colors.paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.statusbarInk, colors.statusbarBackground)).toBeGreaterThanOrEqual(4.5);
});
