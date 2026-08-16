import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../fixtures/ordered-list.md", import.meta.url));

test("ordered-list markers stay inside the clipped second page", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles(fixturePath);

  const secondPageButton = page.getByRole("button", { name: "第 2 页", exact: true });
  await expect(secondPageButton).toBeVisible();
  await secondPageButton.click();

  const artboard = page.getByRole("article", { name: "第 2 页", exact: true });
  await expect(artboard).toBeVisible();
  const lists = artboard.locator("ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0)).toHaveAttribute("start", "1");
  await expect(lists.nth(1)).toHaveAttribute("start", "9");
  await expect(artboard.locator("ol > li")).toHaveCount(8);

  const layout = await artboard.evaluate((source) => {
    const sourceClip = source.querySelector<HTMLElement>(".page-content-clip");
    if (!sourceClip) throw new Error("缺少分页裁切容器");

    const clone = source.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.inset = "0 auto auto 0";
    clone.style.zIndex = "-1";
    clone.style.transform = "none";
    clone.style.visibility = "hidden";
    document.body.append(clone);

    try {
      const clip = clone.querySelector<HTMLElement>(".page-content-clip");
      const orderedLists = Array.from(clone.querySelectorAll<HTMLOListElement>("ol"));
      if (!clip || orderedLists.length !== 2) throw new Error("缺少列表或分页裁切容器");

      clip.scrollLeft = sourceClip.scrollLeft;
      const clipLeft = clip.getBoundingClientRect().left;
      const markers = orderedLists.flatMap((list) =>
        Array.from(list.children).map((item) => {
          const listItem = item as HTMLLIElement;
          const markerWidth = Number.parseFloat(getComputedStyle(listItem, "::marker").width);
          if (!Number.isFinite(markerWidth)) throw new Error("无法读取列表序号宽度");
          const itemLeft = listItem.getBoundingClientRect().left;
          return {
            markerWidth,
            itemLeft,
            safeDelta: itemLeft - markerWidth - clipLeft,
          };
        }),
      );

      return {
        artboardWidth: clone.offsetWidth,
        artboardHeight: clone.offsetHeight,
        clipOverflow: getComputedStyle(clip).overflow,
        markers,
        starts: orderedLists.map((list) => list.start),
      };
    } finally {
      clone.remove();
    }
  });

  expect(layout).toMatchObject({
    artboardWidth: 1080,
    artboardHeight: 1440,
    clipOverflow: "hidden",
    starts: [1, 9],
  });
  expect(layout.markers).toHaveLength(8);
  for (const marker of layout.markers) {
    expect(marker.safeDelta, JSON.stringify(marker)).toBeGreaterThanOrEqual(1);
  }
});
