import type { PhrasingContent, RootContent } from "mdast";

export type SourceMode = "demo" | "vault" | "file" | "import";

export interface VaultFileEntry {
  path: string;
  name: string;
  handle: FileSystemFileHandle;
}

export interface IndexedFileEntry {
  path: string;
  name: string;
  handle: FileSystemFileHandle;
  kind: "markdown" | "image" | "other";
}

export interface VaultIndex {
  id: string;
  name: string;
  root: FileSystemDirectoryHandle;
  markdownFiles: VaultFileEntry[];
  filesByPath: Map<string, IndexedFileEntry>;
  filesByBasename: Map<string, IndexedFileEntry[]>;
  attachmentFolderPath?: string;
}

export interface DocumentSession {
  id: string;
  mode: SourceMode;
  label: string;
  path: string;
  text: string;
  baseText: string;
  baseHash: string;
  lastModified: number;
  writable: boolean;
  fileHandle?: FileSystemFileHandle;
  vault?: VaultIndex;
}

export interface AuthorProfile {
  name: string;
  date: string;
  column: string;
  wordmark: string;
  avatarDataUrl?: string;
}

export interface PageStyle {
  bodySize: number;
  lineHeight: number;
  paragraphGap: number;
  horizontalPadding: number;
  verticalPadding: number;
}

export interface InlineContent {
  nodes: PhrasingContent[];
}

export interface ImageSpec {
  raw: string;
  alt: string;
  requestedWidth?: number;
  source: "markdown" | "obsidian";
}

export type ContentBlock =
  | {
      id: string;
      type: "heading";
      depth: number;
      inline: InlineContent;
    }
  | {
      id: string;
      type: "paragraph";
      inline: InlineContent;
    }
  | {
      id: string;
      type: "image";
      image: ImageSpec;
    }
  | {
      id: string;
      type: "list";
      ordered: boolean;
      start?: number;
      node: Extract<RootContent, { type: "list" }>;
    }
  | {
      id: string;
      type: "blockquote";
      node: Extract<RootContent, { type: "blockquote" }>;
      callout?: { kind: string; title: string };
    }
  | {
      id: string;
      type: "code";
      value: string;
      language?: string;
    }
  | {
      id: string;
      type: "table";
      node: Extract<RootContent, { type: "table" }>;
    }
  | {
      id: string;
      type: "rule";
    }
  | {
      id: string;
      type: "pageBreak";
    }
  | {
      id: string;
      type: "unsupported";
      label: string;
      detail: string;
    };

export type AssetStatus =
  | "resolved"
  | "remote"
  | "missing"
  | "ambiguous"
  | "unsupported"
  | "loading";

export interface AssetCandidate {
  path: string;
  handle: FileSystemFileHandle;
}

export interface ResolvedAsset {
  id: string;
  raw: string;
  status: AssetStatus;
  url?: string;
  message?: string;
  candidates?: AssetCandidate[];
  resolvedPath?: string;
}

export interface AssetDiagnostic extends ResolvedAsset {
  blockId: string;
  alt: string;
}

export interface SnapshotRecord {
  timestamp: number;
  text: string;
  hash: string;
  reason: "opened" | "before-save" | "before-overwrite";
}

export interface ConflictState {
  diskText: string;
  diskHash: string;
  diskLastModified: number;
}

export const DEFAULT_PAGE_STYLE: PageStyle = {
  bodySize: 40,
  lineHeight: 1.65,
  paragraphGap: 28,
  horizontalPadding: 88,
  verticalPadding: 72,
};
