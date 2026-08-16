import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { diffLines } from "diff";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  ImageOff,
  Images,
  LoaderCircle,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { resolveBlockAssets, resolveCandidate, revokeAssetUrls } from "./assets";
import { normalizeAuthorProfile, normalizeWordmark, prepareAvatarDataUrl } from "./author";
import { DEMO_AUTHOR, createDemoSession } from "./demo";
import type {
  AssetDiagnostic,
  AuthorProfile,
  ConflictState,
  DocumentSession,
  PageStyle,
  ResolvedAsset,
  SnapshotRecord,
  VaultFileEntry,
  VaultIndex,
} from "./domain";
import { DEFAULT_PAGE_STYLE } from "./domain";
import {
  chooseImageOverride,
  hashText,
  indexVault,
  requestMarkdownHandle,
  requestVault,
  saveAsMarkdown,
  saveDocument,
  sessionFromHandle,
  sessionFromImportedFile,
  supportsFileSystemAccess,
} from "./filesystem";
import { parseMarkdown, resolveExportTopicSource } from "./markdown";
import { Preview } from "./Preview";
import {
  addSnapshot,
  getRecentVaults,
  getSnapshots,
  rememberVault,
  type RecentVaultRecord,
} from "./storage";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#fcf8f3",
    color: "#4a4641",
    fontSize: "15px",
  },
  ".cm-content": {
    caretColor: "#8e5b54",
    fontFamily: '"SFMono-Regular", "Cascadia Code", monospace',
    padding: "30px 28px 80px",
    lineHeight: "1.75",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-gutters": {
    backgroundColor: "#fcf8f3",
    color: "#a49b93",
    border: "none",
    paddingLeft: "10px",
  },
  ".cm-activeLine": { backgroundColor: "rgba(232, 160, 149, 0.12)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#8e5b54" },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(243, 215, 166, 0.48) !important",
  },
  ".cm-focused": { outline: "none" },
});

type Drawer = "assets" | "style" | null;

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
}

function readLocalSetting<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function sourceBadge(session: DocumentSession, dirty: boolean, externalChanged: boolean) {
  if (externalChanged) return { label: "外部已更新", className: "external" };
  if (dirty) return { label: "已修改", className: "dirty" };
  if (session.mode === "demo") return { label: "示例 · 未落盘", className: "demo" };
  if (!session.writable) return { label: "只读副本", className: "readonly" };
  return { label: "已保存", className: "saved" };
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function StartScreen({
  recentVaults,
  onOpenVault,
  onOpenFile,
  onOpenDemo,
  onImport,
  onOpenRecent,
  busy,
}: {
  recentVaults: RecentVaultRecord[];
  onOpenVault: () => void;
  onOpenFile: () => void;
  onOpenDemo: () => void;
  onImport: (file: File) => void;
  onOpenRecent: (record: RecentVaultRecord) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = [...event.dataTransfer.files].find((candidate) =>
      /\.(?:md|markdown)$/i.test(candidate.name),
    );
    if (file) onImport(file);
  };

  return (
    <main className="start-screen">
      <div className="start-orbit orbit-one" />
      <div className="start-orbit orbit-two" />
      <header className="start-topline">
        <div className="brand-mark">折页</div>
        <span>LOCAL EDITOR · V0.2</span>
        <div className="privacy-pill">
          <ShieldCheck size={14} /> 本机处理
        </div>
      </header>

      <section className="start-hero">
        <div className="hero-copy">
          <span className="hero-kicker">OBSIDIAN → 3:4</span>
          <h1>
            把一篇文章
            <br />
            <em>折成</em>可以滑动的页面
          </h1>
          <p>
            打开本地 Vault，保留正文与图片的位置。
            <br />
            边改原文，边看小红书连续长文的真实分页。
          </p>
          <button type="button" className="text-action" onClick={onOpenDemo}>
            <Sparkles size={17} /> 先用示例体验完整工作台 <ChevronRight size={17} />
          </button>
        </div>

        <div className="start-actions">
          <button type="button" className="primary-entry" onClick={onOpenVault} disabled={busy}>
            <span className="entry-number">01</span>
            <FolderOpen size={28} />
            <span>
              <strong>打开 Obsidian Vault</strong>
              <small>文章、图片、编辑与保存一次授权</small>
            </span>
            <ChevronRight />
          </button>
          <button type="button" className="secondary-entry" onClick={onOpenFile} disabled={busy}>
            <span className="entry-number">02</span>
            <FileText size={25} />
            <span>
              <strong>打开 Markdown</strong>
              <small>可写回原文件；本地图另选资源目录</small>
            </span>
            <ChevronRight />
          </button>
          <section
            className={`drop-entry ${dragging ? "is-dragging" : ""}`}
            aria-label="Markdown 文件拖放区"
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <Upload size={20} />
            <span>
              拖入 Markdown 临时预览
              <small>不会静默覆盖来源文件</small>
            </span>
            <button type="button" onClick={() => inputRef.current?.click()}>
              选择文件
            </button>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
                event.target.value = "";
              }}
            />
          </section>

          {recentVaults.length > 0 ? (
            <div className="recent-vaults">
              <span>最近打开</span>
              {recentVaults.map((record) => (
                <button
                  type="button"
                  key={`${record.id}-${record.openedAt}`}
                  onClick={() => onOpenRecent(record)}
                >
                  <FolderOpen size={15} />
                  <span>{record.name}</span>
                  <small>{formatTime(record.openedAt)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <footer className="start-footer">
        <span>WHITE PAPER / BLACK INK / REAL SCREENSHOTS</span>
        <span>
          {supportsFileSystemAccess() ? "Chrome 文件读写已就绪" : "当前浏览器仅支持导入副本"}
        </span>
      </footer>
    </main>
  );
}

function FileTree({
  vault,
  currentPath,
  onSelect,
  collapsed,
  onToggle,
}: {
  vault?: VaultIndex;
  currentPath: string;
  onSelect: (entry: VaultFileEntry) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [query, setQuery] = useState("");
  const files = useMemo(() => {
    if (!vault) return [];
    const normalized = query.trim().toLowerCase();
    return normalized
      ? vault.markdownFiles.filter((file) => file.path.toLowerCase().includes(normalized))
      : vault.markdownFiles;
  }, [query, vault]);

  if (collapsed) {
    return (
      <aside className="file-tree is-collapsed">
        <button type="button" onClick={onToggle} aria-label="展开文件树">
          <FolderOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="file-tree">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SOURCE</span>
          <strong>{vault?.name ?? "单篇文章"}</strong>
        </div>
        <button type="button" onClick={onToggle} aria-label="收起文件树">
          <PanelLeftClose size={17} />
        </button>
      </div>
      {vault ? (
        <>
          <label className="tree-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选文章"
            />
          </label>
          <div className="tree-files">
            {files.map((entry) => (
              <button
                type="button"
                key={entry.path}
                className={entry.path === currentPath ? "is-current" : ""}
                onClick={() => onSelect(entry)}
                title={entry.path}
              >
                <FileText size={15} />
                <span>{entry.name.replace(/\.md$/i, "")}</span>
                {entry.path === currentPath ? <i /> : null}
              </button>
            ))}
            {files.length === 0 ? <p>没有匹配的 Markdown</p> : null}
          </div>
          <div className="tree-footer">
            {vault.markdownFiles.length} 篇文章 · {vault.filesByPath.size} 个文件
          </div>
        </>
      ) : (
        <div className="single-file-note">
          <FileText size={22} />
          <strong>{currentPath}</strong>
          <span>单文件模式</span>
        </div>
      )}
    </aside>
  );
}

function AssetDrawer({
  diagnostics,
  onClose,
  onChooseDirectory,
  onChooseCandidate,
  onChooseFile,
  onRetry,
}: {
  diagnostics: AssetDiagnostic[];
  onClose: () => void;
  onChooseDirectory: () => void;
  onChooseCandidate: (diagnostic: AssetDiagnostic, candidateIndex: number) => void;
  onChooseFile: (diagnostic: AssetDiagnostic) => void;
  onRetry: () => void;
}) {
  const resolved = diagnostics.filter((item) =>
    ["resolved", "remote"].includes(item.status),
  ).length;
  const failures = diagnostics.filter((item) => !["resolved", "remote"].includes(item.status));

  return (
    <aside className="drawer-panel asset-drawer">
      <div className="drawer-head">
        <div>
          <span className="eyebrow">ASSET CHECK</span>
          <strong>
            图片诊断 {resolved}/{diagnostics.length}
          </strong>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭图片诊断">
          <X size={18} />
        </button>
      </div>
      <div className="asset-summary">
        <div className="asset-score">
          <span
            style={{
              width: `${diagnostics.length ? (resolved / diagnostics.length) * 100 : 100}%`,
            }}
          />
        </div>
        <p>
          {failures.length === 0
            ? "所有正文图片都已找到。"
            : `${failures.length} 张图片需要处理，失败不会被静默隐藏。`}
        </p>
      </div>
      <div className="asset-list">
        {diagnostics.map((diagnostic) => (
          <div
            className={`asset-row status-${diagnostic.status}`}
            key={`${diagnostic.blockId}-${diagnostic.raw}`}
          >
            <div className="asset-status-icon">
              {["resolved", "remote"].includes(diagnostic.status) ? (
                <Check size={16} />
              ) : (
                <ImageOff size={16} />
              )}
            </div>
            <div>
              <strong>{diagnostic.alt || diagnostic.raw}</strong>
              <code>{diagnostic.raw}</code>
              <span>
                {diagnostic.resolvedPath ??
                  diagnostic.message ??
                  (diagnostic.status === "remote" ? "网络图片" : "已解析")}
              </span>
              {diagnostic.status === "ambiguous" ? (
                <div className="asset-candidates">
                  {diagnostic.candidates?.map((candidate, index) => (
                    <button
                      type="button"
                      key={candidate.path}
                      onClick={() => onChooseCandidate(diagnostic, index)}
                    >
                      {candidate.path}
                    </button>
                  ))}
                </div>
              ) : null}
              {diagnostic.status === "missing" ? (
                <div className="asset-actions">
                  <button type="button" onClick={onChooseDirectory}>
                    选择资源目录
                  </button>
                  <button type="button" onClick={() => onChooseFile(diagnostic)}>
                    选择单张图片
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {diagnostics.length === 0 ? (
          <div className="empty-assets">
            <Images size={28} />
            <strong>这篇文章暂时没有图片</strong>
            <span>插入标准 Markdown 图片或 Obsidian 图片即可实时出现。</span>
          </div>
        ) : null}
      </div>
      <button type="button" className="drawer-footer-action" onClick={onRetry}>
        <RefreshCw size={15} /> 重新解析全部图片
      </button>
    </aside>
  );
}

function StyleDrawer({
  style,
  author,
  onStyle,
  onAuthor,
  onClose,
}: {
  style: PageStyle;
  author: AuthorProfile;
  onStyle: (style: PageStyle) => void;
  onAuthor: (author: AuthorProfile) => void;
  onClose: () => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError("");
    try {
      onAuthor({ ...author, avatarDataUrl: await prepareAvatarDataUrl(file) });
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "头像处理失败");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <aside className="drawer-panel style-drawer">
      <div className="drawer-head">
        <div>
          <span className="eyebrow">TYPE PROOF</span>
          <strong>原生长文参数</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭样式设置">
          <X size={18} />
        </button>
      </div>
      <div className="style-drawer-body">
        <div className="style-section author-customizer">
          <span>作者头部 / IDENTITY</span>
          <div className="author-identity-card">
            <div className={`author-avatar-preview ${author.avatarDataUrl ? "has-image" : ""}`}>
              {author.avatarDataUrl ? (
                <img src={author.avatarDataUrl} alt="当前头像预览" />
              ) : (
                normalizeWordmark(author.wordmark)
              )}
            </div>
            <div className="author-identity-copy">
              <strong>{author.avatarDataUrl ? "图片头像" : "文字字标"}</strong>
              <small>图片会裁成正方形，只保存在当前浏览器。</small>
              <div className="author-avatar-actions">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  <Upload size={13} /> {avatarBusy ? "处理中" : "上传头像"}
                </button>
                {author.avatarDataUrl ? (
                  <button
                    type="button"
                    onClick={() => onAuthor({ ...author, avatarDataUrl: undefined })}
                  >
                    使用字标
                  </button>
                ) : null}
              </div>
            </div>
            <input
              ref={avatarInputRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void chooseAvatar(event)}
            />
          </div>
          {avatarError ? <div className="author-field-error">{avatarError}</div> : null}

          <label>
            <span className="field-label-line">
              字标
              <button
                type="button"
                onClick={() =>
                  onAuthor({
                    ...author,
                    wordmark: normalizeWordmark(author.name, DEMO_AUTHOR.wordmark),
                  })
                }
              >
                取作者首字
              </button>
            </span>
            <input
              value={author.wordmark}
              maxLength={2}
              placeholder="折"
              onChange={(event) =>
                onAuthor({
                  ...author,
                  wordmark: Array.from(event.target.value).slice(0, 2).join(""),
                })
              }
            />
          </label>
          <label>
            作者名
            <input
              value={author.name}
              maxLength={30}
              placeholder="折页实验室"
              onChange={(event) => onAuthor({ ...author, name: event.target.value })}
            />
          </label>
          <div className="author-meta-fields">
            <label>
              日期
              <input
                value={author.date}
                maxLength={24}
                placeholder="2026年7月18日"
                onChange={(event) => onAuthor({ ...author, date: event.target.value })}
              />
            </label>
            <label>
              栏目名
              <input
                value={author.column}
                maxLength={28}
                placeholder="AI 小白教程"
                onChange={(event) => onAuthor({ ...author, column: event.target.value })}
              />
            </label>
          </div>
          <button
            className="author-reset-button"
            type="button"
            onClick={() => onAuthor(DEMO_AUTHOR)}
          >
            <RotateCcw size={13} /> 恢复默认作者头部
          </button>
        </div>
        <div className="style-section">
          <span>正文密度</span>
          <RangeControl
            label="字号"
            value={style.bodySize}
            min={32}
            max={48}
            suffix="px"
            onChange={(bodySize) => onStyle({ ...style, bodySize })}
          />
          <RangeControl
            label="行高"
            value={style.lineHeight}
            min={1.4}
            max={1.9}
            step={0.05}
            onChange={(lineHeight) => onStyle({ ...style, lineHeight })}
          />
          <RangeControl
            label="段间距"
            value={style.paragraphGap}
            min={16}
            max={48}
            suffix="px"
            onChange={(paragraphGap) => onStyle({ ...style, paragraphGap })}
          />
        </div>
        <div className="style-section compact-note">
          <CircleHelp size={17} />
          <p>作者头部与视觉参数只保存在本机，不会写入 Markdown。手动分页标记除外。</p>
        </div>
      </div>
      <button
        type="button"
        className="drawer-footer-action"
        onClick={() => onStyle(DEFAULT_PAGE_STYLE)}
      >
        <RotateCcw size={15} /> 恢复 Lab 初始参数
      </button>
    </aside>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span>
        {label}{" "}
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ConflictModal({
  session,
  localText,
  conflict,
  onCancel,
  onUseDisk,
  onOverwrite,
  onMerge,
}: {
  session: DocumentSession;
  localText: string;
  conflict: ConflictState;
  onCancel: () => void;
  onUseDisk: () => void;
  onOverwrite: () => void;
  onMerge: (text: string) => void;
}) {
  const [mergeText, setMergeText] = useState(localText);
  const changes = useMemo(
    () => diffLines(conflict.diskText, localText),
    [conflict.diskText, localText],
  );
  const changeSegments = useMemo(() => {
    let offset = 0;
    return changes.slice(0, 12).map((part) => {
      const segment = {
        ...part,
        key: `${offset}-${part.added ? "added" : part.removed ? "removed" : "same"}`,
      };
      offset += part.value.length;
      return segment;
    });
  }, [changes]);

  return (
    <div className="modal-backdrop">
      <section className="conflict-modal" role="dialog" aria-modal="true" aria-label="保存冲突">
        <div className="conflict-head">
          <div className="warning-mark">
            <AlertTriangle />
          </div>
          <div>
            <span className="eyebrow">WRITE CONFLICT</span>
            <h2>Obsidian 在你编辑时更新了这篇文章</h2>
            <p>{session.path}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="取消保存">
            <X />
          </button>
        </div>
        <div className="conflict-stats">
          <div>
            <span>你的编辑</span>
            <strong>{localText.split("\n").length} 行</strong>
          </div>
          <div>
            <span>磁盘版本</span>
            <strong>{conflict.diskText.split("\n").length} 行</strong>
          </div>
          <div>
            <span>磁盘更新时间</span>
            <strong>{formatTime(conflict.diskLastModified)}</strong>
          </div>
        </div>
        <div className="diff-strip" role="img" aria-label="文本差异摘要">
          {changeSegments.map((part) => (
            <span
              key={part.key}
              className={part.added ? "added" : part.removed ? "removed" : "same"}
            >
              {part.value.slice(0, 160)}
            </span>
          ))}
        </div>
        <label className="merge-editor">
          <span>合并结果</span>
          <textarea value={mergeText} onChange={(event) => setMergeText(event.target.value)} />
        </label>
        <div className="conflict-actions">
          <button type="button" onClick={onUseDisk}>
            载入 Obsidian 版本
          </button>
          <button type="button" className="danger" onClick={onOverwrite}>
            用当前版本覆盖
          </button>
          <button type="button" className="primary" onClick={() => onMerge(mergeText)}>
            应用合并内容
          </button>
        </div>
      </section>
    </div>
  );
}

function RecoveryModal({
  snapshots,
  onClose,
  onRestore,
}: {
  snapshots: SnapshotRecord[];
  onClose: () => void;
  onRestore: (snapshot: SnapshotRecord) => void;
}) {
  const labels: Record<SnapshotRecord["reason"], string> = {
    opened: "打开时基线",
    "before-save": "保存前",
    "before-overwrite": "覆盖前",
  };
  return (
    <div className="modal-backdrop">
      <section className="recovery-modal" role="dialog" aria-modal="true" aria-label="历史恢复">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">LOCAL HISTORY</span>
            <strong>恢复本地快照</strong>
          </div>
          <button type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p>恢复只会放进编辑器，仍需手动保存，不会立即覆盖原文。</p>
        <div className="snapshot-list">
          {snapshots.map((snapshot) => (
            <button
              type="button"
              key={`${snapshot.timestamp}-${snapshot.hash}`}
              onClick={() => onRestore(snapshot)}
            >
              <History size={18} />
              <span>
                <strong>{labels[snapshot.reason]}</strong>
                <small>
                  {formatTime(snapshot.timestamp)} · {snapshot.text.split("\n").length} 行
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          {snapshots.length === 0 ? <div className="empty-assets">还没有可恢复快照</div> : null}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState<AuthorProfile>(() =>
    normalizeAuthorProfile(
      readLocalSetting<unknown>("xhs-preview:author", DEMO_AUTHOR),
      DEMO_AUTHOR,
    ),
  );
  const [style, setStyle] = useState<PageStyle>(() =>
    readLocalSetting("xhs-preview:style", DEFAULT_PAGE_STYLE),
  );
  const [assets, setAssets] = useState<Map<string, ResolvedAsset>>(new Map());
  const [diagnostics, setDiagnostics] = useState<AssetDiagnostic[]>([]);
  const [overrides, setOverrides] = useState<Map<string, ResolvedAsset>>(new Map());
  const [assetPulse, setAssetPulse] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [externalChange, setExternalChange] = useState<ConflictState | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recentVaults, setRecentVaults] = useState<RecentVaultRecord[]>([]);
  const [lastMeasured, setLastMeasured] = useState(Date.now());
  const sessionRef = useRef<DocumentSession | null>(session);
  const textRef = useRef(text);

  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const exportTopicSource = useMemo(
    () => resolveExportTopicSource(text, blocks, session?.label ?? "未命名主题"),
    [blocks, session?.label, text],
  );
  const dirty = Boolean(session && text !== session.baseText);
  const badge = session ? sourceBadge(session, dirty, Boolean(externalChange)) : null;
  const resolvedCount = diagnostics.filter((item) =>
    ["resolved", "remote"].includes(item.status),
  ).length;
  const failedCount = diagnostics.length - resolvedCount;

  useEffect(() => {
    getRecentVaults().then(setRecentVaults);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    try {
      localStorage.setItem("xhs-preview:author", JSON.stringify(author));
    } catch {
      // Style persistence is optional; private browser modes may reject it.
    }
  }, [author]);

  useEffect(() => {
    try {
      localStorage.setItem("xhs-preview:style", JSON.stringify(style));
    } catch {
      // The editor remains fully usable without persistent preferences.
    }
  }, [style]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: assetPulse intentionally retries asset resolution on demand.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const demoOverrides = new Map(overrides);
    if (session.mode === "demo") {
      for (const raw of ["/demo/dialogue.png", "/demo/review.png"]) {
        demoOverrides.set(raw, {
          id: `demo:${raw}`,
          raw,
          status: "remote",
          url: raw,
        });
      }
    }

    resolveBlockAssets(blocks, session.path, session.vault, demoOverrides).then((result) => {
      if (cancelled) {
        revokeAssetUrls(result.assets.values());
        return;
      }
      setAssets((previous) => {
        revokeAssetUrls(previous.values());
        return result.assets;
      });
      setDiagnostics(result.diagnostics);
      setLastMeasured(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, [assetPulse, blocks, overrides, session]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activateSession = useCallback(async (next: DocumentSession) => {
    setSession(next);
    setText(next.text);
    setOverrides(new Map());
    setDrawer(null);
    setConflict(null);
    setExternalChange(null);
    const history = await addSnapshot(next.id, next.text, "opened");
    setSnapshots(history);
  }, []);

  const withBusy = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast({ kind: "error", message: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setBusy(false);
    }
  }, []);

  const openVault = () =>
    withBusy(async () => {
      const vault = await requestVault();
      try {
        await rememberVault(vault);
        setRecentVaults(await getRecentVaults());
      } catch {
        // Some Chromium profiles allow a handle for the current session but
        // refuse to clone it into IndexedDB. Opening the Vault must still work.
      }
      if (!vault.markdownFiles.length) throw new Error("这个目录里没有 Markdown 文件。 ");
      const first = vault.markdownFiles[0];
      await activateSession(await sessionFromHandle(first.handle, first.path, "vault", vault));
    });

  const openRecent = (record: RecentVaultRecord) =>
    withBusy(async () => {
      const permission = await record.handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") throw new Error("没有获得该 Vault 的读写权限。 ");
      const vault = await indexVault(record.handle);
      try {
        await rememberVault(vault);
      } catch {
        // The active handle remains usable even when recent-history storage is
        // unavailable in this browser profile.
      }
      if (!vault.markdownFiles.length) throw new Error("这个目录里没有 Markdown 文件。 ");
      const first = vault.markdownFiles[0];
      await activateSession(await sessionFromHandle(first.handle, first.path, "vault", vault));
    });

  const openFile = () =>
    withBusy(async () => {
      const handle = await requestMarkdownHandle();
      await activateSession(await sessionFromHandle(handle));
    });

  const importFile = (file: File) =>
    withBusy(async () => activateSession(await sessionFromImportedFile(file)));

  const openDemo = () => withBusy(async () => activateSession(await createDemoSession()));

  const selectVaultFile = (entry: VaultFileEntry) => {
    if (!session?.vault || entry.path === session.path) return;
    const proceed = !dirty || window.confirm("当前文章有未保存修改，确定切换文章吗？");
    if (!proceed) return;
    withBusy(async () => {
      await activateSession(
        await sessionFromHandle(entry.handle, entry.path, "vault", session.vault),
      );
    });
  };

  const performSave = useCallback(
    async (force = false) => {
      if (!session) return;
      if (!session.writable || !session.fileHandle) {
        const saved = await saveAsMarkdown(session.label, text);
        if (saved) {
          await activateSession(saved);
          setToast({ kind: "success", message: "已另存为新的 Markdown 文件。" });
        } else {
          setToast({ kind: "info", message: "当前来源是临时副本，请使用支持另存为的 Chrome。" });
        }
        return;
      }

      setBusy(true);
      try {
        const diskText = (await session.fileHandle.getFile()).text();
        setSnapshots(
          await addSnapshot(session.id, await diskText, force ? "before-overwrite" : "before-save"),
        );
        const result = await saveDocument(session, text, force);
        if (result.status === "conflict") {
          setConflict(result.conflict);
          setExternalChange(result.conflict);
          return;
        }
        if (result.status === "saved") {
          setSession(result.session);
          setText(result.session.text);
          setConflict(null);
          setExternalChange(null);
          setToast({ kind: "success", message: "原始 Markdown 已安全保存。" });
        }
      } catch (error) {
        setToast({
          kind: "error",
          message: error instanceof Error ? error.message : "保存失败，未保存内容仍在编辑器中。",
        });
      } finally {
        setBusy(false);
      }
    },
    [activateSession, session, text],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void performSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [performSave]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  useEffect(() => {
    if (!session?.fileHandle || !session.writable) return;
    let checking = false;

    const checkExternalChange = async () => {
      if (checking) return;
      checking = true;
      try {
        const diskFile = await session.fileHandle?.getFile();
        if (!diskFile) return;
        const diskText = await diskFile.text();
        const diskHash = await hashText(diskText);
        const currentSession = sessionRef.current;
        if (!currentSession || currentSession.id !== session.id) return;
        if (diskHash === currentSession.baseHash) {
          setExternalChange(null);
          return;
        }

        const detected: ConflictState = {
          diskText,
          diskHash,
          diskLastModified: diskFile.lastModified,
        };
        if (textRef.current === currentSession.baseText) {
          setSession((current) =>
            current?.id === session.id
              ? {
                  ...current,
                  text: diskText,
                  baseText: diskText,
                  baseHash: diskHash,
                  lastModified: diskFile.lastModified,
                }
              : current,
          );
          setText(diskText);
          setExternalChange(null);
          setToast({ kind: "info", message: "检测到 Obsidian 更新，已自动载入磁盘版本。" });
        } else {
          setExternalChange(detected);
        }
      } catch {
        // A focus check is advisory. Explicit save still performs the required
        // hash check and reports a concrete error if the handle is unavailable.
      } finally {
        checking = false;
      }
    };

    window.addEventListener("focus", checkExternalChange);
    return () => window.removeEventListener("focus", checkExternalChange);
  }, [session]);

  const chooseResourceDirectory = () =>
    withBusy(async () => {
      const root = await window.showDirectoryPicker({ mode: "read" });
      const vault = await indexVault(root);
      if (!session) return;
      setSession({ ...session, vault });
      setAssetPulse((value) => value + 1);
    });

  const chooseCandidate = (diagnostic: AssetDiagnostic, candidateIndex: number) =>
    withBusy(async () => {
      const candidate = diagnostic.candidates?.[candidateIndex];
      if (!candidate) return;
      const resolved = await resolveCandidate(diagnostic.raw, candidate);
      setOverrides((current) => new Map(current).set(diagnostic.raw, resolved));
    });

  const chooseSingleImage = (diagnostic: AssetDiagnostic) =>
    withBusy(async () => {
      const selected = await chooseImageOverride();
      if (!selected) return;
      const resolved = await resolveCandidate(diagnostic.raw, selected);
      setOverrides((current) => new Map(current).set(diagnostic.raw, resolved));
    });

  const remoteError = (raw: string) => {
    setOverrides((current) =>
      new Map(current).set(raw, {
        id: `remote-error:${raw}`,
        raw,
        status: "missing",
        message: "网络图片加载失败，请检查链接或将图片下载到本地",
      }),
    );
  };

  const applyMerge = async (mergedText: string) => {
    if (!session || !conflict) return;
    setSession({
      ...session,
      baseText: conflict.diskText,
      baseHash: conflict.diskHash,
      lastModified: conflict.diskLastModified,
    });
    setText(mergedText);
    setConflict(null);
    setExternalChange(null);
    setToast({ kind: "info", message: "合并结果已放入编辑器，请确认后保存。" });
  };

  const useDiskVersion = () => {
    if (!session || !conflict) return;
    const next = {
      ...session,
      text: conflict.diskText,
      baseText: conflict.diskText,
      baseHash: conflict.diskHash,
      lastModified: conflict.diskLastModified,
    };
    setSession(next);
    setText(conflict.diskText);
    setConflict(null);
    setExternalChange(null);
    setToast({ kind: "info", message: "已载入 Obsidian 的磁盘版本。" });
  };

  const openRecovery = async () => {
    if (!session) return;
    setSnapshots(await getSnapshots(session.id));
    setShowRecovery(true);
  };

  if (!session) {
    return (
      <>
        <StartScreen
          recentVaults={recentVaults}
          onOpenVault={openVault}
          onOpenFile={openFile}
          onOpenDemo={openDemo}
          onImport={importFile}
          onOpenRecent={openRecent}
          busy={busy}
        />
        {busy ? (
          <div className="global-busy">
            <LoaderCircle className="spin" /> 正在读取本地文件…
          </div>
        ) : null}
        {toast ? <Toast toast={toast} /> : null}
      </>
    );
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm("当前文章有未保存修改，确定返回吗？")) setSession(null);
            }}
            aria-label="返回开始页"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="brand-mark small">折页</div>
          <div>
            <strong>{session.label}</strong>
            <span>{session.path}</span>
          </div>
        </div>
        <div className="workspace-actions">
          <span className={`save-state ${badge?.className}`}>
            <i />
            {badge?.label}
          </span>
          <button type="button" onClick={openRecovery} title="恢复快照">
            <History size={17} /> 恢复
          </button>
          <button
            type="button"
            className={drawer === "assets" ? "is-active" : ""}
            onClick={() => setDrawer((value) => (value === "assets" ? null : "assets"))}
          >
            <Images size={17} /> 图片
            {failedCount > 0 ? <b>{failedCount}</b> : null}
          </button>
          <button
            type="button"
            className={drawer === "style" ? "is-active" : ""}
            onClick={() => setDrawer((value) => (value === "style" ? null : "style"))}
          >
            <Settings2 size={17} /> 样式
          </button>
          <button
            type="button"
            className="save-button"
            onClick={() => void performSave()}
            disabled={busy || (!dirty && session.writable)}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {session.writable ? "保存" : "另存为"}
            <kbd>⌘S</kbd>
          </button>
        </div>
      </header>

      <div className={`workspace-body ${drawer ? "has-drawer" : ""}`}>
        <FileTree
          vault={session.vault}
          currentPath={session.path}
          onSelect={selectVaultFile}
          collapsed={treeCollapsed}
          onToggle={() => setTreeCollapsed((value) => !value)}
        />
        <section className="editor-panel">
          <div className="panel-heading editor-heading">
            <div>
              <span className="eyebrow">MARKDOWN</span>
              <strong>原文编辑</strong>
            </div>
            <span>{text.length.toLocaleString("zh-CN")} 字符</span>
          </div>
          <div className="editor-stage">
            <CodeMirror
              value={text}
              height="100%"
              extensions={[markdown(), EditorView.lineWrapping, editorTheme]}
              onChange={setText}
              basicSetup={{
                foldGutter: false,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                autocompletion: false,
              }}
            />
          </div>
          <div className="editor-footer">
            <span>
              <FilePlus2 size={14} /> 插入分页：<code>&lt;!-- xhs-page-break --&gt;</code>
            </span>
            <button
              type="button"
              onClick={() =>
                setText(
                  (current) => `${current.replace(/\s*$/, "")}\n\n<!-- xhs-page-break -->\n\n`,
                )
              }
            >
              在文末插入
            </button>
          </div>
        </section>

        <Preview
          blocks={blocks}
          assets={assets}
          author={author}
          style={style}
          exportTopicSource={exportTopicSource}
          onPageCountChange={setPageCount}
          onAssetSettled={() => setLastMeasured(Date.now())}
          onRemoteError={remoteError}
        />

        {drawer === "assets" ? (
          <AssetDrawer
            diagnostics={diagnostics}
            onClose={() => setDrawer(null)}
            onChooseDirectory={chooseResourceDirectory}
            onChooseCandidate={chooseCandidate}
            onChooseFile={chooseSingleImage}
            onRetry={() => setAssetPulse((value) => value + 1)}
          />
        ) : null}
        {drawer === "style" ? (
          <StyleDrawer
            style={style}
            author={author}
            onStyle={setStyle}
            onAuthor={setAuthor}
            onClose={() => setDrawer(null)}
          />
        ) : null}
      </div>

      <footer className="workspace-statusbar">
        <span className={failedCount ? "has-error" : "is-good"}>
          {failedCount ? <AlertTriangle size={14} /> : <Check size={14} />}
          图片 {resolvedCount}/{diagnostics.length || 0}
        </span>
        <span>
          <ScanTextIcon /> {pageCount} 页
        </span>
        <span>无服务器上传</span>
        <span>最后排版 {formatTime(lastMeasured).split(" ").pop()}</span>
        <button type="button" onClick={() => setDrawer(null)} className={drawer ? "" : "is-hidden"}>
          <PanelRightClose size={14} /> 收起面板
        </button>
      </footer>

      {conflict ? (
        <ConflictModal
          session={session}
          localText={text}
          conflict={conflict}
          onCancel={() => setConflict(null)}
          onUseDisk={useDiskVersion}
          onOverwrite={() => void performSave(true)}
          onMerge={(merged) => void applyMerge(merged)}
        />
      ) : null}
      {showRecovery ? (
        <RecoveryModal
          snapshots={snapshots}
          onClose={() => setShowRecovery(false)}
          onRestore={(snapshot) => {
            setText(snapshot.text);
            setShowRecovery(false);
            setToast({ kind: "info", message: "快照已放入编辑器，请确认后保存。" });
          }}
        />
      ) : null}
      {toast ? <Toast toast={toast} /> : null}
    </main>
  );
}

function ScanTextIcon() {
  return <span className="folio-icon">3:4</span>;
}

function Toast({ toast }: { toast: ToastState }) {
  return (
    <div className={`toast toast-${toast.kind}`}>
      {toast.kind === "success" ? (
        <Check size={17} />
      ) : toast.kind === "error" ? (
        <AlertTriangle size={17} />
      ) : (
        <CircleHelp size={17} />
      )}
      {toast.message}
    </div>
  );
}
