import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexedFileEntry, VaultIndex } from "./domain";
import { buildCandidatePaths, normalizePath, resolveAsset } from "./assets";

function fileHandle(name: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => new File(["image"], name, { type: "image/png" }),
  } as FileSystemFileHandle;
}

function vaultWith(entries: Array<{ path: string; kind?: IndexedFileEntry["kind"] }>): VaultIndex {
  const indexed = entries.map(({ path, kind = "image" }) => ({
    path,
    name: path.split("/").pop() ?? path,
    kind,
    handle: fileHandle(path.split("/").pop() ?? path),
  })) satisfies IndexedFileEntry[];
  const byPath = new Map(indexed.map((entry) => [entry.path, entry]));
  const byBasename = new Map<string, IndexedFileEntry[]>();
  indexed.forEach((entry) => {
    const key = entry.name;
    byBasename.set(key, [...(byBasename.get(key) ?? []), entry]);
  });
  return {
    id: "vault:test",
    name: "test",
    root: { kind: "directory", name: "test" } as FileSystemDirectoryHandle,
    markdownFiles: [],
    filesByPath: byPath,
    filesByBasename: byBasename,
    attachmentFolderPath: "attachments",
  };
}

describe("asset path resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:resolved-image"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("normalizes encoded paths and parent segments safely", () => {
    expect(normalizePath("notes\\AI/../图片/%E6%B5%81%E7%A8%8B.png")).toBe("notes/图片/流程.png");
  });

  it("resolves ../ relative to the Markdown directory, not the Vault root", () => {
    expect(
      buildCandidatePaths("../images/check.png", "notes/lab/article.md", "attachments"),
    ).toEqual(["notes/images/check.png", "attachments/check.png", "images/check.png", "check.png"]);
  });

  it("prefers an exact relative match and reports duplicate basenames", async () => {
    const exactVault = vaultWith([
      { path: "notes/images/check.png" },
      { path: "archive/check.png" },
    ]);
    await expect(
      resolveAsset("../images/check.png", "notes/lab/article.md", exactVault),
    ).resolves.toMatchObject({
      status: "resolved",
      resolvedPath: "notes/images/check.png",
      url: "blob:resolved-image",
    });

    const ambiguousVault = vaultWith([{ path: "one/cover.png" }, { path: "two/cover.png" }]);
    await expect(
      resolveAsset("cover.png", "notes/article.md", ambiguousVault),
    ).resolves.toMatchObject({ status: "ambiguous" });
  });

  it("keeps remote images remote and makes missing local context explicit", async () => {
    await expect(
      resolveAsset("https://example.com/image.png", "article.md"),
    ).resolves.toMatchObject({ status: "remote" });
    await expect(resolveAsset("image.png", "article.md")).resolves.toMatchObject({
      status: "missing",
    });
  });
});
