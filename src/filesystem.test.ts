import { describe, expect, it } from "vitest";
import type { DocumentSession } from "./domain";
import { hashText, saveDocument } from "./filesystem";

class MemoryFileHandle {
  readonly kind = "file" as const;
  private value: string;
  private modified = 100;

  constructor(readonly name: string, value: string) {
    this.value = value;
  }

  async getFile() {
    const file = new File([this.value], this.name, { type: "text/markdown" });
    Object.defineProperty(file, "lastModified", { value: this.modified });
    return file;
  }

  async createWritable() {
    let pending = this.value;
    return {
      write: async (next: string) => {
        pending = next;
      },
      close: async () => {
        this.value = pending;
        this.modified += 1;
      },
    };
  }

  mutateFromObsidian(next: string) {
    this.value = next;
    this.modified += 1;
  }
}

async function sessionFor(handle: MemoryFileHandle): Promise<DocumentSession> {
  const text = await (await handle.getFile()).text();
  return {
    id: "vault:test:article.md",
    mode: "vault",
    label: "article",
    path: "article.md",
    text,
    baseText: text,
    baseHash: await hashText(text),
    lastModified: 100,
    writable: true,
    fileHandle: handle as unknown as FileSystemFileHandle,
  };
}

describe("safe Markdown write-back", () => {
  it("writes the exact editor text and advances the baseline", async () => {
    const handle = new MemoryFileHandle("article.md", "# 原文\n");
    const result = await saveDocument(await sessionFor(handle), "# 新文\n\n正文\n");
    expect(result.status).toBe("saved");
    if (result.status === "saved") {
      expect(result.session.baseText).toBe("# 新文\n\n正文\n");
      expect(result.session.baseHash).toBe(await hashText("# 新文\n\n正文\n"));
    }
    expect(await (await handle.getFile()).text()).toBe("# 新文\n\n正文\n");
  });

  it("does not overwrite an external Obsidian edit without a decision", async () => {
    const handle = new MemoryFileHandle("article.md", "# 基线\n");
    const session = await sessionFor(handle);
    handle.mutateFromObsidian("# Obsidian 外部修改\n");

    const result = await saveDocument(session, "# 工作台修改\n");
    expect(result.status).toBe("conflict");
    expect(await (await handle.getFile()).text()).toBe("# Obsidian 外部修改\n");
    if (result.status === "conflict") {
      expect(result.conflict.diskText).toBe("# Obsidian 外部修改\n");
    }
  });

  it("only overwrites after the force path is explicitly chosen", async () => {
    const handle = new MemoryFileHandle("article.md", "# 基线\n");
    const session = await sessionFor(handle);
    handle.mutateFromObsidian("# 外部修改\n");

    const result = await saveDocument(session, "# 已确认覆盖\n", true);
    expect(result.status).toBe("saved");
    expect(await (await handle.getFile()).text()).toBe("# 已确认覆盖\n");
  });
});
