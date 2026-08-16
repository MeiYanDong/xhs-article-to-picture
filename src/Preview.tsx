import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Grid2X2,
  Image as ImageIcon,
  LoaderCircle,
  ScanText,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArticleFlow } from "./ArticleContent";
import type { AuthorProfile, ContentBlock, PageStyle, ResolvedAsset } from "./domain";
import {
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  PUBLISH_ROOT_PATH,
  prepareAssetsForExport,
  renderPageToPng,
  sanitizeTopicName,
  writePngFiles,
} from "./exporter";
import { getPublishRoot, rememberPublishRoot } from "./storage";

const PAGE_WIDTH = 1080;
const PAGE_HEIGHT = 1440;
const CONTENT_WIDTH = 904;
const CONTENT_HEIGHT = 1296;
const COLUMN_GAP = 176;
const COLUMN_SPAN = CONTENT_WIDTH + COLUMN_GAP;

type PreviewMode = "single" | "grid" | "cover";

interface PreviewProps {
  blocks: ContentBlock[];
  assets: Map<string, ResolvedAsset>;
  author: AuthorProfile;
  style: PageStyle;
  exportTopicSource: string;
  onPageCountChange?: (count: number) => void;
  onAssetSettled?: () => void;
  onRemoteError?: (raw: string) => void;
}

interface FullPageImagePlacement {
  pageIndex: number;
  raw: string;
  alt: string;
}

function pageEntries(count: number): Array<{ index: number; key: string }> {
  return Array.from({ length: count }, (_, index) => ({
    index,
    key: `page-${index + 1}`,
  }));
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

interface PageCardProps extends Omit<PreviewProps, "exportTopicSource"> {
  pageIndex: number;
  pageCount: number;
  scale: number;
  quiet?: boolean;
  capture?: boolean;
  artboardRef?: (node: HTMLElement | null) => void;
  fullPageImages: Map<number, FullPageImagePlacement>;
}

function PageCard({
  pageIndex,
  pageCount,
  scale,
  quiet = false,
  capture = false,
  artboardRef,
  fullPageImages,
  blocks,
  assets,
  author,
  style,
  onAssetSettled,
  onRemoteError,
}: PageCardProps) {
  const clipRef = useRef<HTMLDivElement>(null);
  const fullPageImage = fullPageImages.get(pageIndex);
  const fullPageAsset = fullPageImage ? assets.get(fullPageImage.raw) : undefined;
  const rendersFullPageImage = Boolean(
    fullPageImage && fullPageAsset?.url && ["resolved", "remote"].includes(fullPageAsset.status),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: content and style changes must restore the active column scroll position.
  useLayoutEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    clip.scrollLeft = capture ? 0 : pageIndex * COLUMN_SPAN;
  }, [pageIndex, blocks, assets, style, capture]);

  const articleFlow = (
    <ArticleFlow
      blocks={blocks}
      assets={assets}
      author={author}
      style={style}
      onAssetSettled={capture ? undefined : onAssetSettled}
      onRemoteError={capture ? undefined : onRemoteError}
    />
  );

  return (
    <div
      className={`page-scale-box ${quiet ? "is-quiet" : ""} ${capture ? "is-export" : ""}`}
      style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}
      data-page-index={pageIndex}
    >
      <article
        ref={artboardRef}
        className={`page-artboard ${rendersFullPageImage ? "is-full-page-image" : ""}`}
        style={{ transform: `scale(${scale})` }}
        aria-label={`第 ${pageIndex + 1} 页`}
      >
        <div className="page-reading-progress" aria-hidden="true">
          <div
            className="page-reading-progress-fill"
            style={{ width: `${((pageIndex + 1) / Math.max(1, pageCount)) * 100}%` }}
          />
        </div>
        {rendersFullPageImage ? (
          <img
            className="page-full-bleed-image"
            src={fullPageAsset?.url}
            alt={fullPageImage?.alt ?? "整页图片"}
            onError={() => {
              if (fullPageAsset?.status === "remote" && fullPageImage) {
                onRemoteError?.(fullPageImage.raw);
              }
            }}
          />
        ) : (
          <>
            <div
              ref={clipRef}
              className="page-content-clip"
              style={{
                left: style.horizontalPadding,
                top: style.verticalPadding,
                width: PAGE_WIDTH - style.horizontalPadding * 2,
                height: PAGE_HEIGHT - style.verticalPadding * 2,
              }}
            >
              {capture ? (
                <div
                  className="export-column-shift"
                  style={{ transform: `translateX(-${pageIndex * COLUMN_SPAN}px)` }}
                >
                  {articleFlow}
                </div>
              ) : (
                articleFlow
              )}
            </div>
            <div className="page-folio">{String(pageIndex + 1).padStart(2, "0")}</div>
          </>
        )}
      </article>
    </div>
  );
}

interface ExportJob {
  blocks: ContentBlock[];
  assets: Map<string, ResolvedAsset>;
  author: AuthorProfile;
  style: PageStyle;
  pageCount: number;
}

type ExportNotice =
  | { kind: "success"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string };

function waitForExportPages(refs: Map<number, HTMLElement>, pageCount: number): Promise<void> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Array.from({ length: pageCount }, (_, index) => refs.has(index)).every(Boolean)) {
        resolve();
        return;
      }
      if (performance.now() - started > 8_000) {
        reject(new Error("导出画布准备超时"));
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export function Preview({
  blocks,
  assets,
  author,
  style,
  exportTopicSource,
  onPageCountChange,
  onAssetSettled,
  onRemoteError,
}: PreviewProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);
  const [fullPageImagePlacements, setFullPageImagePlacements] = useState<FullPageImagePlacement[]>(
    [],
  );
  const [currentPage, setCurrentPage] = useState(0);
  const [mode, setMode] = useState<PreviewMode>("single");
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportLabel, setExportLabel] = useState("");
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);
  const [publishRoot, setPublishRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const exportPageRefs = useRef(new Map<number, HTMLElement>());
  const exporting = Boolean(exportLabel);
  const exportTopicName = useMemo(() => sanitizeTopicName(exportTopicSource), [exportTopicSource]);
  const fullPageImages = useMemo(
    () => new Map(fullPageImagePlacements.map((placement) => [placement.pageIndex, placement])),
    [fullPageImagePlacements],
  );
  const {
    ref: stageRef,
    width: stageWidth,
    height: stageHeight,
  } = useElementSize<HTMLDivElement>();

  const contentKey = useMemo(
    () =>
      `${blocks.map((block) => block.id).join("|")}:${style.bodySize}:${style.lineHeight}:${
        style.paragraphGap
      }:${assets.size}`,
    [assets.size, blocks, style.bodySize, style.lineHeight, style.paragraphGap],
  );

  useEffect(() => {
    let active = true;
    void getPublishRoot().then((handle) => {
      if (active) setPublishRoot(handle);
    });
    return () => {
      active = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey intentionally retriggers pagination measurement after content changes.
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const update = () => {
      const scrollWidth = measure.scrollWidth;
      const next = Math.max(1, Math.min(40, Math.ceil((scrollWidth + COLUMN_GAP) / COLUMN_SPAN)));
      const flow = measure.querySelector<HTMLElement>(".article-flow");
      const flowLeft = flow?.getBoundingClientRect().left ?? measure.getBoundingClientRect().left;
      const placements = [...measure.querySelectorAll<HTMLElement>("[data-full-page-image]")]
        .map((node) => {
          const raw = node.dataset.fullPageImage;
          if (!raw) return null;
          const pageIndex = Math.max(
            0,
            Math.round((node.getBoundingClientRect().left - flowLeft) / COLUMN_SPAN),
          );
          return {
            pageIndex,
            raw,
            alt: node.dataset.fullPageAlt ?? "整页图片",
          };
        })
        .filter((placement): placement is FullPageImagePlacement => Boolean(placement));
      const placementKey = (items: FullPageImagePlacement[]) =>
        items.map((item) => `${item.pageIndex}:${item.raw}`).join("|");
      setFullPageImagePlacements((current) =>
        placementKey(current) === placementKey(placements) ? current : placements,
      );
      setPageCount(next);
      onPageCountChange?.(next);
      setCurrentPage((page) => Math.min(page, next - 1));
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(update));
    const observer = new ResizeObserver(update);
    observer.observe(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentKey, onPageCountChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setCurrentPage((page) => Math.max(0, page - 1));
      if (event.key === "ArrowRight") {
        setCurrentPage((page) => Math.min(pageCount - 1, page + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount]);

  useEffect(() => {
    if (!exportNotice) return;
    const timer = window.setTimeout(() => setExportNotice(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [exportNotice]);

  const getWritablePublishRoot = async (): Promise<FileSystemDirectoryHandle> => {
    if (publishRoot) {
      try {
        const current = await publishRoot.queryPermission({ mode: "readwrite" });
        if (current === "granted") return publishRoot;
        if (
          current === "prompt" &&
          (await publishRoot.requestPermission({ mode: "readwrite" })) === "granted"
        ) {
          return publishRoot;
        }
      } catch {
        // A stale structured-cloned handle falls back to a fresh directory picker.
      }
    }

    setExportLabel("请选择 Documents/publish");
    const selected = await window.showDirectoryPicker({
      id: "zheye-publish-root",
      mode: "readwrite",
      startIn: "documents",
    });
    if (selected.name !== "publish") {
      throw new Error(`请选择 ${PUBLISH_ROOT_PATH} 文件夹`);
    }
    await rememberPublishRoot(selected);
    setPublishRoot(selected);
    return selected;
  };

  const exportAllPages = async () => {
    const unready = [...assets.values()].filter(
      (asset) => !asset.url || !["resolved", "remote"].includes(asset.status),
    );
    if (unready.length) {
      setExportNotice({
        kind: "error",
        title: `还有 ${unready.length} 张图片未就绪`,
        detail: "请先在“图片”面板修复，再导出发布图。",
      });
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      setExportNotice({
        kind: "error",
        title: "当前浏览器不能写入导出文件夹",
        detail: "请使用最新版 Chrome 打开折页。",
      });
      return;
    }

    const snapshot = {
      blocks,
      assets,
      author: { ...author },
      style: { ...style },
      pageCount,
    };

    try {
      const parent = await getWritablePublishRoot();
      setExportNotice(null);
      setExportLabel(assets.size ? `准备图片 0/${assets.size}` : "准备画布");
      const preparedAssets = await prepareAssetsForExport(snapshot.assets, (completed, total) =>
        setExportLabel(`准备图片 ${completed}/${total}`),
      );
      exportPageRefs.current.clear();
      setExportJob({ ...snapshot, assets: preparedAssets });
      setExportLabel("准备 1:1 画布");
      await waitForExportPages(exportPageRefs.current, snapshot.pageCount);

      const pages: Blob[] = [];
      for (let index = 0; index < snapshot.pageCount; index += 1) {
        const node = exportPageRefs.current.get(index);
        if (!node) throw new Error(`第 ${index + 1} 页画布不存在`);
        setExportLabel(`生成 PNG ${index + 1}/${snapshot.pageCount}`);
        pages.push(await renderPageToPng(node));
      }

      setExportLabel("写入本地文件夹");
      const receipt = await writePngFiles(parent, exportTopicSource, pages);
      setExportNotice({
        kind: "success",
        title: `${pages.length} 张发布图已保存`,
        detail: `${PUBLISH_ROOT_PATH}/${receipt.folderName} · ${EXPORT_WIDTH}×${EXPORT_HEIGHT} PNG`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExportNotice({
        kind: "error",
        title: "导出没有完成",
        detail: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setExportLabel("");
      setExportJob(null);
      exportPageRefs.current.clear();
    }
  };

  const singleScale = Math.max(
    0.18,
    Math.min(0.48, (stageWidth - 104) / PAGE_WIDTH, (stageHeight - 56 - 88) / PAGE_HEIGHT),
  );
  const gridScale = Math.max(0.15, Math.min(0.24, (stageWidth - 96) / (PAGE_WIDTH * 2)));

  return (
    <section className="preview-panel" ref={stageRef}>
      <div className="preview-toolbar">
        <div>
          <span className="eyebrow">LIVE PROOF</span>
          <div className="preview-topic-line">
            <strong>{pageCount} 页</strong>
            <small title={`导出主题：${exportTopicName}`}>主题 · {exportTopicName}</small>
          </div>
        </div>
        <div className="preview-toolbar-actions">
          <button
            type="button"
            className="export-button"
            onClick={() => void exportAllPages()}
            disabled={exporting}
            aria-label={`导出全部 ${pageCount} 页 PNG`}
            title={`导出主题：${exportTopicName} · 归档到 ${PUBLISH_ROOT_PATH}`}
          >
            {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            <span>{exporting ? exportLabel : `导出 ${pageCount} 张`}</span>
          </button>
          <div className="view-switch" role="toolbar" aria-label="预览方式">
            <button
              type="button"
              className={mode === "single" ? "is-active" : ""}
              onClick={() => setMode("single")}
              aria-label="单页预览"
            >
              <ScanText size={16} />
            </button>
            <button
              type="button"
              className={mode === "grid" ? "is-active" : ""}
              onClick={() => setMode("grid")}
              aria-label="缩略图预览"
            >
              <Grid2X2 size={16} />
            </button>
            <button
              type="button"
              className={mode === "cover" ? "is-active" : ""}
              onClick={() => {
                setMode("cover");
                setCurrentPage(0);
              }}
              aria-label="首图信息流预览"
            >
              <ImageIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="pagination-measure" aria-hidden>
        <div ref={measureRef} style={{ width: CONTENT_WIDTH, height: CONTENT_HEIGHT }}>
          <ArticleFlow
            blocks={blocks}
            assets={assets}
            author={author}
            style={style}
            measurement
            onAssetSettled={onAssetSettled}
            onRemoteError={onRemoteError}
          />
        </div>
      </div>

      {mode === "grid" ? (
        <div className="preview-grid">
          {pageEntries(pageCount).map(({ index, key }) => (
            <button
              type="button"
              className={`grid-page ${currentPage === index ? "is-current" : ""}`}
              key={key}
              onClick={() => {
                setCurrentPage(index);
                setMode("single");
              }}
            >
              <PageCard
                pageIndex={index}
                pageCount={pageCount}
                scale={gridScale}
                quiet
                fullPageImages={fullPageImages}
                blocks={blocks}
                assets={assets}
                author={author}
                style={style}
                onAssetSettled={onAssetSettled}
                onRemoteError={onRemoteError}
              />
              <span>{String(index + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
      ) : mode === "cover" ? (
        <div className="feed-preview">
          <div className="feed-card">
            <PageCard
              pageIndex={0}
              pageCount={pageCount}
              scale={Math.min(singleScale, 0.34)}
              fullPageImages={fullPageImages}
              blocks={blocks}
              assets={assets}
              author={author}
              style={style}
              onAssetSettled={onAssetSettled}
              onRemoteError={onRemoteError}
            />
            <div className="feed-copy">
              <strong>
                {blocks.find((block) => block.type === "heading") ? "文章首图预览" : "原生长文"}
              </strong>
              <span>{author.name}</span>
            </div>
          </div>
          <p>这是信息流缩略尺寸。首屏正文在这里仍能辨认，才算真正可读。</p>
        </div>
      ) : (
        <div className="single-preview-stage">
          <button
            type="button"
            className="page-arrow left"
            onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
            disabled={currentPage === 0}
            aria-label="上一页"
          >
            <ChevronLeft />
          </button>
          <PageCard
            pageIndex={currentPage}
            pageCount={pageCount}
            scale={singleScale}
            fullPageImages={fullPageImages}
            blocks={blocks}
            assets={assets}
            author={author}
            style={style}
            onAssetSettled={onAssetSettled}
            onRemoteError={onRemoteError}
          />
          <button
            type="button"
            className="page-arrow right"
            onClick={() => setCurrentPage((page) => Math.min(pageCount - 1, page + 1))}
            disabled={currentPage === pageCount - 1}
            aria-label="下一页"
          >
            <ChevronRight />
          </button>
          <div
            className="page-dots"
            role="toolbar"
            aria-label={`第 ${currentPage + 1} 页，共 ${pageCount} 页`}
          >
            {pageEntries(pageCount).map(({ index, key }) => (
              <button
                type="button"
                key={key}
                className={index === currentPage ? "is-active" : ""}
                onClick={() => setCurrentPage(index)}
                aria-label={`第 ${index + 1} 页`}
              />
            ))}
          </div>
        </div>
      )}

      {exportJob ? (
        <div className="export-capture-stage" aria-hidden="true">
          {pageEntries(exportJob.pageCount).map(({ index, key }) => (
            <PageCard
              key={key}
              pageIndex={index}
              pageCount={exportJob.pageCount}
              scale={1}
              capture
              fullPageImages={fullPageImages}
              blocks={exportJob.blocks}
              assets={exportJob.assets}
              author={exportJob.author}
              style={exportJob.style}
              artboardRef={(node) => {
                if (node) exportPageRefs.current.set(index, node);
                else exportPageRefs.current.delete(index);
              }}
            />
          ))}
        </div>
      ) : null}

      {exportNotice ? (
        <div className={`export-notice is-${exportNotice.kind}`} role="status">
          <span>{exportNotice.kind === "success" ? <Check /> : <AlertTriangle />}</span>
          <div>
            <strong>{exportNotice.title}</strong>
            <small>{exportNotice.detail}</small>
          </div>
          <button type="button" onClick={() => setExportNotice(null)} aria-label="关闭导出提示">
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}
