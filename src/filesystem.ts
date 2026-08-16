import type {
  ConflictState,
  DocumentSession,
  IndexedFileEntry,
  VaultFileEntry,
  VaultIndex,
} from "./domain";
import { basename, normalizePath } from "./assets";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

const SKIPPED_DIRECTORIES = new Set([".git", ".trash", "node_modules"]);

export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window &&
    "showOpenFilePicker" in window
  );
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function classifyFile(name: string): IndexedFileEntry["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md") return "markdown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

async function walkDirectory(
  directory: FileSystemDirectoryHandle,
  currentPath: string,
  files: IndexedFileEntry[],
): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    const path = normalizePath(currentPath ? `${currentPath}/${name}` : name);
    if (handle.kind === "directory") {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      if (path.startsWith(".obsidian/plugins")) continue;
      await walkDirectory(handle, path, files);
      continue;
    }

    files.push({
      path,
      name,
      handle,
      kind: classifyFile(name),
    });
  }
}

async function readAttachmentFolderPath(
  root: FileSystemDirectoryHandle,
): Promise<string | undefined> {
  try {
    const obsidian = await root.getDirectoryHandle(".obsidian");
    const appHandle = await obsidian.getFileHandle("app.json");
    const file = await appHandle.getFile();
    const json = JSON.parse(await file.text()) as {
      attachmentFolderPath?: unknown;
    };
    return typeof json.attachmentFolderPath === "string"
      ? normalizePath(json.attachmentFolderPath)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function indexVault(root: FileSystemDirectoryHandle): Promise<VaultIndex> {
  const files: IndexedFileEntry[] = [];
  await walkDirectory(root, "", files);

  const filesByPath = new Map<string, IndexedFileEntry>();
  const filesByBasename = new Map<string, IndexedFileEntry[]>();
  for (const entry of files) {
    filesByPath.set(entry.path, entry);
    const key = basename(entry.path);
    const siblings = filesByBasename.get(key) ?? [];
    siblings.push(entry);
    filesByBasename.set(key, siblings);
  }

  const markdownFiles: VaultFileEntry[] = files
    .filter((entry) => entry.kind === "markdown")
    .map((entry) => ({
      path: entry.path,
      name: entry.name,
      handle: entry.handle,
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));

  return {
    id: `vault:${root.name}`,
    name: root.name,
    root,
    markdownFiles,
    filesByPath,
    filesByBasename,
    attachmentFolderPath: await readAttachmentFolderPath(root),
  };
}

export async function requestVault(): Promise<VaultIndex> {
  if (!supportsFileSystemAccess()) {
    throw new Error("当前浏览器不支持本地目录读写，请使用最新版 Chrome。");
  }
  const root = await window.showDirectoryPicker({
    id: "xhs-preview-vault",
    mode: "readwrite",
  });
  return indexVault(root);
}

export async function requestMarkdownHandle(): Promise<FileSystemFileHandle> {
  if (!("showOpenFilePicker" in window)) {
    throw new Error("当前浏览器不支持可写文件选择，请使用拖拽导入或最新版 Chrome。");
  }
  const [handle] = await window.showOpenFilePicker({
    id: "xhs-preview-markdown",
    multiple: false,
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md", ".markdown"] },
      },
    ],
  });
  return handle;
}

async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    const state = await handle.queryPermission({ mode: "readwrite" });
    if (state === "granted") return true;
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

export async function sessionFromHandle(
  handle: FileSystemFileHandle,
  path = handle.name,
  mode: DocumentSession["mode"] = "file",
  vault?: VaultIndex,
): Promise<DocumentSession> {
  const file = await handle.getFile();
  const text = await file.text();
  return {
    id: `${mode}:${vault?.name ?? "single"}:${path}`,
    mode,
    label: handle.name.replace(/\.(?:md|markdown)$/i, ""),
    path,
    text,
    baseText: text,
    baseHash: await hashText(text),
    lastModified: file.lastModified,
    writable: await canWrite(handle),
    fileHandle: handle,
    vault,
  };
}

export async function sessionFromImportedFile(file: File): Promise<DocumentSession> {
  const text = await file.text();
  return {
    id: `import:${file.name}:${file.lastModified}`,
    mode: "import",
    label: file.name.replace(/\.(?:md|markdown)$/i, ""),
    path: file.name,
    text,
    baseText: text,
    baseHash: await hashText(text),
    lastModified: file.lastModified,
    writable: false,
  };
}

export type SaveResult =
  | { status: "saved"; session: DocumentSession }
  | { status: "conflict"; conflict: ConflictState }
  | { status: "readonly" };

export async function saveDocument(
  session: DocumentSession,
  nextText: string,
  force = false,
): Promise<SaveResult> {
  if (!session.fileHandle || !session.writable) return { status: "readonly" };

  const diskFile = await session.fileHandle.getFile();
  const diskText = await diskFile.text();
  const diskHash = await hashText(diskText);
  if (!force && diskHash !== session.baseHash) {
    return {
      status: "conflict",
      conflict: {
        diskText,
        diskHash,
        diskLastModified: diskFile.lastModified,
      },
    };
  }

  const writer = await session.fileHandle.createWritable();
  await writer.write(nextText);
  await writer.close();
  const savedFile = await session.fileHandle.getFile();
  const savedText = await savedFile.text();
  return {
    status: "saved",
    session: {
      ...session,
      text: savedText,
      baseText: savedText,
      baseHash: await hashText(savedText),
      lastModified: savedFile.lastModified,
    },
  };
}

export async function saveAsMarkdown(
  suggestedName: string,
  text: string,
): Promise<DocumentSession | null> {
  if (!("showSaveFilePicker" in window)) return null;
  const handle = await window.showSaveFilePicker({
    suggestedName: suggestedName.endsWith(".md") ? suggestedName : `${suggestedName}.md`,
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md"] },
      },
    ],
  });
  const writer = await handle.createWritable();
  await writer.write(text);
  await writer.close();
  return sessionFromHandle(handle);
}

export async function chooseImageOverride(): Promise<{
  path: string;
  handle: FileSystemFileHandle;
} | null> {
  if (!("showOpenFilePicker" in window)) return null;
  const [handle] = await window.showOpenFilePicker({
    id: "xhs-preview-image",
    multiple: false,
    types: [
      {
        description: "图片",
        accept: {
          "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"],
        },
      },
    ],
  });
  return { path: handle.name, handle };
}
