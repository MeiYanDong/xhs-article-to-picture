import type { AuthorProfile } from "./domain";

const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 384;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeWordmark(value: string, fallback = "折"): string {
  const cleaned = value.trim();
  return Array.from(cleaned || fallback)
    .slice(0, 2)
    .join("");
}

export function formatAuthorMeta(author: AuthorProfile): string {
  return [author.date.trim(), author.column.trim()].filter(Boolean).join(" · ");
}

export function normalizeAuthorProfile(value: unknown, fallback: AuthorProfile): AuthorProfile {
  const source = asRecord(value);
  const legacyMeta = stringValue(source.meta);
  const legacyParts = legacyMeta
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const name = stringValue(source.name, fallback.name).trim() || fallback.name;
  const avatar = stringValue(source.avatarDataUrl);

  return {
    name,
    date: stringValue(source.date, legacyParts[0] ?? fallback.date),
    column: stringValue(source.column, legacyParts.slice(1).join(" · ") || fallback.column),
    wordmark: normalizeWordmark(
      stringValue(source.wordmark, stringValue(source.initials, Array.from(name)[0])),
      fallback.wordmark,
    ),
    avatarDataUrl: /^data:image\/(?:jpeg|png|webp);base64,/i.test(avatar) ? avatar : undefined,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("头像图片无法读取"));
    image.src = url;
  });
}

export async function prepareAvatarDataUrl(file: File): Promise<string> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error("头像仅支持 PNG、JPG 或 WebP");
  }
  if (file.size > MAX_AVATAR_BYTES) throw new Error("头像原图不能超过 12 MB");

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (!sourceSize) throw new Error("头像图片尺寸无效");

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理头像");

    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE,
    );
    return canvas.toDataURL("image/webp", 0.88);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
