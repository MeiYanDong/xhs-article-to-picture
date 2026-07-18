import { describe, expect, it } from "vitest";
import {
  exportPageFilename,
  formatArchiveDate,
  sanitizeTopicName,
  writePngFiles,
} from "./exporter";

class MemoryFileHandle {
  readonly kind = "file" as const;
  value: Blob | null = null;

  constructor(readonly name: string) {}

  async createWritable() {
    return {
      write: async (value: Blob) => {
        this.value = value;
      },
      close: async () => undefined,
    };
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const found = this.directories.get(name);
    if (found) return found;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const created = new MemoryDirectoryHandle(name);
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const found = this.files.get(name);
    if (found) return found;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const created = new MemoryFileHandle(name);
    this.files.set(name, created);
    return created;
  }

  async removeEntry(name: string) {
    this.files.delete(name);
    this.directories.delete(name);
  }

  async *entries() {
    for (const entry of this.directories) yield [entry[0], entry[1]] as const;
    for (const entry of this.files) yield [entry[0], entry[1]] as const;
  }
}

describe("PNG export naming and folder writes", () => {
  it("creates a safe ten-character topic and xhs-compatible page names", () => {
    expect(sanitizeTopicName(' AI 教程: "第一篇" / 草稿 ')).toBe("AI教程第一篇草稿");
    expect(sanitizeTopicName("这是一个超过十个字的主题名称")).toBe("这是一个超过十个字的");
    expect(exportPageFilename("两遍 AI 对话", 0, 12)).toBe("两遍AI对话_01.png");
    expect(exportPageFilename("两遍 AI 对话", 11, 12)).toBe("两遍AI对话_12.png");
    expect(formatArchiveDate(new Date(2026, 6, 17, 9, 8, 7))).toBe("20260717");
  });

  it("reuses the daily topic folder and replaces only its previous page PNGs", async () => {
    const root = new MemoryDirectoryHandle("exports");
    const date = new Date(2026, 6, 17, 9, 8, 7);
    const first = await writePngFiles(
      root as unknown as FileSystemDirectoryHandle,
      "教程",
      [new Blob(["one"]), new Blob(["two"])],
      date,
    );
    const folder = root.directories.get(first.folderName)!;
    folder.files.set("copywriting.md", new MemoryFileHandle("copywriting.md"));
    const second = await writePngFiles(
      root as unknown as FileSystemDirectoryHandle,
      "教程",
      [new Blob(["three"])],
      date,
    );

    expect(first.folderName).toBe("20260717_教程");
    expect(first.filenames).toEqual(["教程_01.png", "教程_02.png"]);
    expect(second.folderName).toBe(first.folderName);
    expect(second.filenames).toEqual(["教程_01.png"]);
    expect(second.replacedFiles).toBe(2);
    expect(folder.files.has("教程_02.png")).toBe(false);
    expect(folder.files.has("copywriting.md")).toBe(true);
  });
});
