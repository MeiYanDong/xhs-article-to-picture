import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

const PROXY_PATH = "/__zheye/image";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:4173", "http://localhost:4173"]);

type Next = () => void;

function sendError(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ error: message }));
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBenchmarkProxyAddress(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 198 && (b === 18 || b === 19);
}

export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIpv4(address);
  if (kind !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只允许下载 HTTP 或 HTTPS 图片");
  }
  if (url.username || url.password) throw new Error("图片地址不能包含账号或密码");
  if (url.hostname.toLowerCase() === "localhost") throw new Error("不允许访问本机地址");

  const hostnameIsLiteralIp = isIP(url.hostname) !== 0;
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  const hasBlockedRecord = records.some((record) => {
    if (!hostnameIsLiteralIp && isBenchmarkProxyAddress(record.address)) {
      // Clash and several local secure-network layers use 198.18.0.0/15 as a
      // synthetic public-DNS range. The original hostname is still fetched;
      // literal access to this reserved range remains blocked below.
      return false;
    }
    return isBlockedAddress(record.address);
  });
  if (!records.length || hasBlockedRecord) {
    throw new Error("图片地址指向内网或不可公开访问的地址");
  }
}

export function sniffRasterImageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  return null;
}

async function fetchImage(initialUrl: URL): Promise<{ bytes: Uint8Array; type: string }> {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2",
        "User-Agent": "Zheye-Local-Image-Exporter/0.2",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("图床返回了无效跳转");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`图床返回 ${response.status}`);

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("图片超过 25 MB 限制");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("图片超过 25 MB 限制");

    const type = sniffRasterImageType(bytes);
    if (!type) {
      const declaredType = response.headers.get("content-type")?.split(";", 1)[0];
      if (declaredType === "image/svg+xml") {
        throw new Error("远程 SVG 暂不直接导出，请先转换为 PNG");
      }
      throw new Error("链接返回的内容不是受支持的图片");
    }
    return { bytes, type };
  }
  throw new Error("图床跳转次数过多");
}

async function handleProxy(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    sendError(response, 403, "只允许折页本地页面调用图片下载器");
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1:4173");
    const raw = requestUrl.searchParams.get("url");
    if (!raw) throw new Error("缺少图片地址");
    const image = await fetchImage(new URL(raw));
    response.statusCode = 200;
    response.setHeader("Content-Type", image.type);
    response.setHeader("Content-Length", String(image.bytes.byteLength));
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(image.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片下载失败";
    sendError(response, 422, message);
  }
}

export function createLocalImageProxyMiddleware() {
  return (request: IncomingMessage, response: ServerResponse, next: Next) => {
    const pathname = new URL(request.url ?? "", "http://127.0.0.1:4173").pathname;
    if (pathname !== PROXY_PATH) {
      next();
      return;
    }
    if (request.method !== "GET") {
      sendError(response, 405, "只支持 GET 请求");
      return;
    }
    void handleProxy(request, response);
  };
}
