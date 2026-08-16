import type {
  AssetDiagnostic,
  ContentBlock,
  IndexedFileEntry,
  ResolvedAsset,
  VaultIndex,
} from "./domain";
import { collectImages } from "./markdown";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

export function normalizePath(value: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();

  const result: string[] = [];
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      result.pop();
      continue;
    }
    result.push(part);
  }
  return result.join("/");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function extension(path: string): string {
  const withoutQueryOrHash = path.split(/[?#]/, 1)[0];
  return basename(withoutQueryOrHash).split(".").pop()?.toLowerCase() ?? "";
}

export function isRemoteAsset(raw: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(raw);
}

export function buildCandidatePaths(
  raw: string,
  markdownPath: string,
  attachmentFolderPath?: string,
): string[] {
  const rawPath = raw.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  const cleaned = normalizePath(rawPath.replace(/^\/+/, ""));
  const currentDirectory = dirname(markdownPath);
  const candidates = new Set<string>();

  // Resolve ../ segments against the Markdown file before normalizing them.
  // Normalizing `raw` first would turn ../assets/a.png into assets/a.png and
  // accidentally search one directory too deep.
  if (currentDirectory) candidates.add(normalizePath(`${currentDirectory}/${rawPath}`));
  if (attachmentFolderPath) {
    candidates.add(normalizePath(`${attachmentFolderPath}/${basename(cleaned)}`));
  }
  candidates.add(cleaned);
  candidates.add(basename(cleaned));
  return [...candidates].filter(Boolean);
}

function lookupExact(index: VaultIndex, path: string): IndexedFileEntry | undefined {
  return index.filesByPath.get(normalizePath(path));
}

async function rasterizeLocalSvg(file: File): Promise<string> {
  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof DOMParser === "undefined"
  ) {
    return URL.createObjectURL(file);
  }

  let sanitizedUrl: string | undefined;
  try {
    const documentNode = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
    if (documentNode.querySelector("parsererror")) throw new Error("SVG 格式无效");
    documentNode
      .querySelectorAll("script, foreignObject, iframe, object, embed")
      .forEach((node) => {
        node.remove();
      });
    documentNode.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on")) node.removeAttribute(attribute.name);
        if (
          ["href", "xlink:href", "src"].includes(name) &&
          /^(?:https?:|\/\/|data:text\/html)/i.test(value)
        ) {
          node.removeAttribute(attribute.name);
        }
        if (name === "style" && /url\(\s*['"]?(?:https?:|\/\/)/i.test(value)) {
          node.removeAttribute(attribute.name);
        }
      }
    });
    documentNode.querySelectorAll("style").forEach((node) => {
      node.textContent = (node.textContent ?? "").replace(
        /url\(\s*(['"]?)(?:https?:|\/\/)[^)]+\)/gi,
        "none",
      );
    });

    const safeSvg = new XMLSerializer().serializeToString(documentNode.documentElement);
    sanitizedUrl = URL.createObjectURL(
      new Blob([safeSvg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    image.decoding = "async";
    image.src = sanitizedUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("SVG 解码失败"));
    });

    const sourceWidth = image.naturalWidth || 1200;
    const sourceHeight = image.naturalHeight || 900;
    const scale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return sanitizedUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return sanitizedUrl;
    URL.revokeObjectURL(sanitizedUrl);
    sanitizedUrl = undefined;
    return URL.createObjectURL(png);
  } catch {
    if (sanitizedUrl) return sanitizedUrl;
    const safeFallback = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
        <rect width="1200" height="720" fill="#f2eee5"/>
        <text x="600" y="350" text-anchor="middle" fill="#24241f" font-family="sans-serif" font-size="42">SVG 无法安全预览</text>
        <text x="600" y="410" text-anchor="middle" fill="#77736b" font-family="sans-serif" font-size="24">请转换为 PNG 后重试</text>
      </svg>`;
    return URL.createObjectURL(new Blob([safeFallback], { type: "image/svg+xml;charset=utf-8" }));
  }
}

async function handleToObjectUrl(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  if (file.type === "image/svg+xml" || handle.name.toLowerCase().endsWith(".svg")) {
    return rasterizeLocalSvg(file);
  }
  return URL.createObjectURL(file);
}

export async function resolveAsset(
  raw: string,
  markdownPath: string,
  vault?: VaultIndex,
): Promise<ResolvedAsset> {
  const id = `${markdownPath}::${raw}`;
  if (isRemoteAsset(raw)) {
    return { id, raw, status: "remote", url: raw };
  }

  if (!IMAGE_EXTENSIONS.has(extension(raw))) {
    return {
      id,
      raw,
      status: "unsupported",
      message: "该附件格式暂不作为图片渲染",
    };
  }

  if (!vault) {
    return {
      id,
      raw,
      status: "missing",
      message: "当前只打开了单个 Markdown，请补选 Vault 或资源目录",
    };
  }

  for (const candidatePath of buildCandidatePaths(raw, markdownPath, vault.attachmentFolderPath)) {
    const exact = lookupExact(vault, candidatePath);
    if (exact?.kind === "image") {
      return {
        id,
        raw,
        status: "resolved",
        url: await handleToObjectUrl(exact.handle),
        resolvedPath: exact.path,
      };
    }
  }

  const matches = vault.filesByBasename.get(basename(raw)) ?? [];
  const imageMatches = matches.filter((entry) => entry.kind === "image");
  if (imageMatches.length === 1) {
    const match = imageMatches[0];
    return {
      id,
      raw,
      status: "resolved",
      url: await handleToObjectUrl(match.handle),
      resolvedPath: match.path,
    };
  }
  if (imageMatches.length > 1) {
    return {
      id,
      raw,
      status: "ambiguous",
      message: `Vault 中发现 ${imageMatches.length} 个同名文件`,
      candidates: imageMatches.map((entry) => ({
        path: entry.path,
        handle: entry.handle,
      })),
    };
  }

  return {
    id,
    raw,
    status: "missing",
    message: "在已授权目录中没有找到这张图片",
  };
}

export async function resolveBlockAssets(
  blocks: ContentBlock[],
  markdownPath: string,
  vault?: VaultIndex,
  overrides: Map<string, ResolvedAsset> = new Map(),
): Promise<{
  assets: Map<string, ResolvedAsset>;
  diagnostics: AssetDiagnostic[];
}> {
  const assets = new Map<string, ResolvedAsset>();
  const diagnostics: AssetDiagnostic[] = [];

  for (const { blockId, image } of collectImages(blocks)) {
    const override = overrides.get(image.raw);
    const resolved = override ?? (await resolveAsset(image.raw, markdownPath, vault));
    assets.set(image.raw, resolved);
    diagnostics.push({
      ...resolved,
      blockId,
      alt: image.alt,
    });
  }

  return { assets, diagnostics };
}

export async function resolveCandidate(
  raw: string,
  candidate: { path: string; handle: FileSystemFileHandle },
): Promise<ResolvedAsset> {
  return {
    id: `override::${raw}`,
    raw,
    status: "resolved",
    url: await handleToObjectUrl(candidate.handle),
    resolvedPath: candidate.path,
  };
}

export function revokeAssetUrls(assets: Iterable<ResolvedAsset>): void {
  for (const asset of assets) {
    if (asset.status === "resolved" && asset.url?.startsWith("blob:")) {
      URL.revokeObjectURL(asset.url);
    }
  }
}
