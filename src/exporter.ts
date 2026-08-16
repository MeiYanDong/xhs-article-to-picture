import { toBlob } from "html-to-image";
import type { ResolvedAsset } from "./domain";

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1440;
export const EXPORT_BACKGROUND_COLOR = "#ffffff";
export const PUBLISH_ROOT_PATH = "/Users/myandong/Documents/publish";
const IMAGE_PROXY_PATH = "/__zheye/image";

export function sanitizeTopicName(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return Array.from(cleaned).slice(0, 10).join("") || "未命名主题";
}

export function formatArchiveDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("");
}

export function exportPageFilename(topicName: string, index: number, pageCount: number): string {
  const digits = Math.max(2, String(pageCount).length);
  return `${sanitizeTopicName(topicName)}_${String(index + 1).padStart(digits, "0")}.png`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to the status text when a server returns non-JSON output.
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function fetchExportableImage(url: string): Promise<Blob> {
  const absolute = new URL(url, window.location.href);
  const requestUrl =
    absolute.origin === window.location.origin || ["blob:", "data:"].includes(absolute.protocol)
      ? absolute.href
      : `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(absolute.href)}`;
  const response = await fetch(requestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("返回内容不是图片");
  return blob;
}

export async function prepareAssetsForExport(
  assets: Map<string, ResolvedAsset>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, ResolvedAsset>> {
  const entries = [...assets.entries()];
  const unready = entries.filter(
    ([, asset]) => !asset.url || !["resolved", "remote"].includes(asset.status),
  );
  if (unready.length) {
    const names = unready
      .slice(0, 3)
      .map(([raw]) => raw)
      .join("、");
    throw new Error(`还有 ${unready.length} 张图片未就绪：${names}`);
  }

  if (!entries.length) return new Map();
  const prepared = new Map<string, ResolvedAsset>();
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const entryIndex = cursor;
      cursor += 1;
      const [raw, asset] = entries[entryIndex];
      try {
        const assetUrl = asset.url;
        if (!assetUrl) throw new Error("图片地址缺失");
        const dataUrl = assetUrl.startsWith("data:")
          ? assetUrl
          : await blobToDataUrl(await fetchExportableImage(assetUrl));
        prepared.set(raw, { ...asset, status: "resolved", url: dataUrl });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "图片读取失败";
        throw new Error(`${raw}：${detail}`);
      }
      completed += 1;
      onProgress?.(completed, entries.length);
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(3, entries.length) }, () => worker()),
  );
  const failure = workers.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return prepared;
}

async function waitForImages(node: HTMLElement): Promise<void> {
  const images = [...node.querySelectorAll("img")];
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve, reject) => {
          if (image.complete) {
            if (image.naturalWidth > 0) resolve();
            else reject(new Error(`图片无法绘制：${image.alt || "未命名图片"}`));
            return;
          }
          const timer = window.setTimeout(
            () => reject(new Error(`图片加载超时：${image.alt || "未命名图片"}`)),
            15_000,
          );
          image.addEventListener(
            "load",
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          image.addEventListener(
            "error",
            () => {
              window.clearTimeout(timer);
              reject(new Error(`图片无法绘制：${image.alt || "未命名图片"}`));
            },
            { once: true },
          );
        }),
    ),
  );
}

function afterTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function renderPageToPng(node: HTMLElement): Promise<Blob> {
  await document.fonts?.ready;
  await waitForImages(node);
  await afterTwoFrames();
  const blob = await toBlob(node, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    canvasWidth: EXPORT_WIDTH,
    canvasHeight: EXPORT_HEIGHT,
    pixelRatio: 1,
    backgroundColor: EXPORT_BACKGROUND_COLOR,
    cacheBust: false,
    includeQueryParams: true,
    skipFonts: true,
    style: {
      position: "relative",
      top: "0",
      left: "0",
      transform: "none",
    },
  });
  if (!blob) throw new Error("浏览器没有生成 PNG 数据");
  return blob;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function removePreviousPagePngs(
  directory: FileSystemDirectoryHandle,
  topicName: string,
): Promise<number> {
  const pattern = new RegExp(`^${escapeRegExp(topicName)}_\\d+\\.png$`, "i");
  let removed = 0;
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || !pattern.test(name)) continue;
    await directory.removeEntry(name);
    removed += 1;
  }
  return removed;
}

export async function writePngFiles(
  parent: FileSystemDirectoryHandle,
  topicSource: string,
  pages: Blob[],
  date = new Date(),
): Promise<{ folderName: string; filenames: string[]; replacedFiles: number }> {
  const topicName = sanitizeTopicName(topicSource);
  const folderName = `${formatArchiveDate(date)}_${topicName}`;
  const directory = await parent.getDirectoryHandle(folderName, { create: true });
  const replacedFiles = await removePreviousPagePngs(directory, topicName);
  const filenames: string[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const filename = exportPageFilename(topicName, index, pages.length);
    const handle = await directory.getFileHandle(filename, { create: true });
    const writer = await handle.createWritable();
    await writer.write(pages[index]);
    await writer.close();
    filenames.push(filename);
  }
  return { folderName, filenames, replacedFiles };
}
