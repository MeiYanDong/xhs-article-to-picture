import type { Blockquote, List, ListItem, PhrasingContent, RootContent, Table } from "mdast";
import type { ReactNode } from "react";
import { Fragment, useState } from "react";
import type { AuthorProfile, ContentBlock, PageStyle, ResolvedAsset } from "./domain";
import { formatAuthorMeta, normalizeWordmark } from "./author";
import { stripCalloutMarker } from "./markdown";

interface InlineRendererProps {
  nodes: PhrasingContent[];
}

interface PositionedNode {
  type: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
}

function sourceNodeKey(node: PositionedNode, prefix: string): string {
  const start =
    node.position?.start.offset ?? `${node.position?.start.line}:${node.position?.start.column}`;
  const end =
    node.position?.end.offset ?? `${node.position?.end.line}:${node.position?.end.column}`;
  return `${prefix}-${node.type}-${start}-${end}`;
}

function safeLink(url: string): string {
  return /^(?:https?:|mailto:)/i.test(url) ? url : "#";
}

function InlineRenderer({ nodes }: InlineRendererProps) {
  return nodes.map((node) => {
    const key = sourceNodeKey(node, "inline");
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <strong key={key}>
            <InlineRenderer nodes={node.children} />
          </strong>
        );
      case "emphasis":
        return (
          <em key={key}>
            <InlineRenderer nodes={node.children} />
          </em>
        );
      case "delete":
        return (
          <del key={key}>
            <InlineRenderer nodes={node.children} />
          </del>
        );
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "link":
        return (
          <a key={key} href={safeLink(node.url)} target="_blank" rel="noreferrer">
            <InlineRenderer nodes={node.children} />
          </a>
        );
      case "break":
        return <br key={key} />;
      case "image":
        return <span key={key}>〔图片：{node.alt || node.url}〕</span>;
      case "linkReference":
        return (
          <span key={key}>
            <InlineRenderer nodes={node.children} />
          </span>
        );
      default:
        if ("children" in node) {
          return (
            <span key={key}>
              <InlineRenderer nodes={node.children as PhrasingContent[]} />
            </span>
          );
        }
        return null;
    }
  });
}

function renderListItem(item: ListItem): ReactNode {
  return (
    <li key={sourceNodeKey(item, "list-item")}>
      {item.checked !== null && item.checked !== undefined ? (
        <span className={`task-check ${item.checked ? "is-checked" : ""}`} aria-hidden>
          {item.checked ? "✓" : ""}
        </span>
      ) : null}
      {item.children.map((child) => {
        if (child.type === "paragraph") {
          return (
            <span key={sourceNodeKey(child, "paragraph")} className="list-paragraph">
              <InlineRenderer nodes={child.children} />
            </span>
          );
        }
        if (child.type === "list") {
          return <ListRenderer key={sourceNodeKey(child, "list")} node={child} />;
        }
        return (
          <span key={sourceNodeKey(child, "fallback")} className="list-paragraph">
            {"value" in child && typeof child.value === "string" ? child.value : ""}
          </span>
        );
      })}
    </li>
  );
}

function ListRenderer({ node }: { node: List }) {
  const Tag = node.ordered ? "ol" : "ul";
  return (
    <Tag start={node.ordered ? (node.start ?? undefined) : undefined}>
      {node.children.map(renderListItem)}
    </Tag>
  );
}

function BlockquoteRenderer({
  node,
  callout,
}: {
  node: Blockquote;
  callout?: { kind: string; title: string };
}) {
  return (
    <blockquote className={callout ? "article-callout" : undefined}>
      {callout ? (
        <div className="callout-title">
          <span>{callout.kind === "tip" ? "TIP" : callout.kind.toUpperCase()}</span>
          {callout.title}
        </div>
      ) : null}
      {node.children.map((child) => {
        if (child.type === "paragraph") {
          const paragraph =
            callout && child === node.children[0] ? stripCalloutMarker(child) : child;
          if (!paragraph.children.some((part) => part.type !== "text" || part.value.trim())) {
            return null;
          }
          return (
            <p key={sourceNodeKey(child, "quote")}>
              <InlineRenderer nodes={paragraph.children} />
            </p>
          );
        }
        if (child.type === "list") {
          return <ListRenderer key={sourceNodeKey(child, "quote-list")} node={child} />;
        }
        return null;
      })}
    </blockquote>
  );
}

function TableRenderer({ node }: { node: Table }) {
  return (
    <div className="article-table-wrap">
      <table>
        <tbody>
          {node.children.map((row) => (
            <tr key={sourceNodeKey(row, "row")}>
              {row.children.map((cell) => {
                const Tag = row === node.children[0] ? "th" : "td";
                return (
                  <Tag key={sourceNodeKey(cell, "cell")}>
                    <InlineRenderer nodes={cell.children} />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ArticleImageProps {
  raw: string;
  alt: string;
  requestedWidth?: number;
  standalone?: boolean;
  asset?: ResolvedAsset;
  onSettled?: () => void;
  onRemoteError?: (raw: string) => void;
}

function ArticleImage({
  raw,
  alt,
  requestedWidth,
  standalone = false,
  asset,
  onSettled,
  onRemoteError,
}: ArticleImageProps) {
  const [failed, setFailed] = useState(false);
  const url = asset?.url;
  const isBroken = failed || !url || ["missing", "ambiguous", "unsupported"].includes(asset.status);

  if (isBroken) {
    return (
      <figure
        className={`article-image is-missing ${standalone ? "is-standalone" : ""}`}
        data-full-page-image={standalone ? raw : undefined}
        data-full-page-alt={standalone ? alt : undefined}
      >
        <div className="image-fallback-mark">⌁</div>
        <strong>{asset?.status === "ambiguous" ? "图片需要确认" : "图片暂未加载"}</strong>
        <span>{asset?.message ?? raw}</span>
      </figure>
    );
  }

  return (
    <figure
      className={`article-image ${standalone ? "is-standalone" : ""}`}
      data-full-page-image={standalone ? raw : undefined}
      data-full-page-alt={standalone ? alt : undefined}
      style={requestedWidth ? { width: `${Math.min(requestedWidth, 904)}px` } : undefined}
    >
      <img
        src={url}
        alt={alt}
        onLoad={onSettled}
        onError={() => {
          setFailed(true);
          onSettled?.();
          if (asset?.status === "remote") onRemoteError?.(raw);
        }}
      />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}

interface ArticleFlowProps {
  blocks: ContentBlock[];
  assets: Map<string, ResolvedAsset>;
  author: AuthorProfile;
  style: PageStyle;
  measurement?: boolean;
  onAssetSettled?: () => void;
  onRemoteError?: (raw: string) => void;
}

function renderNestedContent(node: RootContent, key: string): ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key}>
          <InlineRenderer nodes={node.children} />
        </p>
      );
    case "list":
      return <ListRenderer key={key} node={node} />;
    case "blockquote":
      return <BlockquoteRenderer key={key} node={node} />;
    default:
      return null;
  }
}

export function ArticleFlow({
  blocks,
  assets,
  author,
  style,
  measurement = false,
  onAssetSettled,
  onRemoteError,
}: ArticleFlowProps) {
  const authorMeta = formatAuthorMeta(author);
  const startsWithFullPageCover =
    blocks[0]?.type === "image" && blocks[0].image.layout === "full-page";
  const firstArticleBlockIndex = startsWithFullPageCover
    ? -1
    : blocks.findIndex(
        (block) =>
          block.type !== "pageBreak" &&
          !(block.type === "image" && block.image.layout === "full-page"),
      );
  const authorHeader = (
    <header className="article-author">
      <div className={`article-avatar ${author.avatarDataUrl ? "has-image" : ""}`}>
        {author.avatarDataUrl ? (
          <img src={author.avatarDataUrl} alt="" aria-hidden />
        ) : (
          normalizeWordmark(author.wordmark)
        )}
      </div>
      <div>
        <div className="article-author-name">{author.name || "未命名作者"}</div>
        {authorMeta ? <div className="article-author-meta">{authorMeta}</div> : null}
      </div>
      <div className="article-more" aria-hidden>
        •••
      </div>
    </header>
  );
  return (
    <div
      className={`article-flow ${measurement ? "is-measurement" : ""}`}
      style={
        {
          "--article-body-size": `${style.bodySize}px`,
          "--article-line-height": style.lineHeight,
          "--article-paragraph-gap": `${style.paragraphGap}px`,
        } as React.CSSProperties
      }
    >
      {blocks.map((block, blockIndex) => {
        let rendered: ReactNode;
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(block.depth, 3)}` as "h1" | "h2" | "h3";
            rendered = (
              <Tag className={`article-heading depth-${block.depth}`}>
                <InlineRenderer nodes={block.inline.nodes} />
              </Tag>
            );
            break;
          }
          case "paragraph":
            rendered = (
              <p className="article-paragraph">
                <InlineRenderer nodes={block.inline.nodes} />
              </p>
            );
            break;
          case "image":
            rendered = (
              <ArticleImage
                raw={block.image.raw}
                alt={block.image.alt}
                requestedWidth={block.image.requestedWidth}
                standalone={block.image.layout === "full-page"}
                asset={assets.get(block.image.raw)}
                onSettled={onAssetSettled}
                onRemoteError={onRemoteError}
              />
            );
            break;
          case "list":
            rendered = (
              <div className="article-list">
                <ListRenderer node={block.node} />
              </div>
            );
            break;
          case "blockquote":
            rendered = <BlockquoteRenderer node={block.node} callout={block.callout} />;
            break;
          case "code":
            rendered = (
              <pre className="article-code" data-language={block.language || "TEXT"}>
                <code>{block.value}</code>
              </pre>
            );
            break;
          case "table":
            rendered = <TableRenderer node={block.node} />;
            break;
          case "rule":
            rendered = <hr />;
            break;
          case "pageBreak":
            rendered = <div className="article-page-break" aria-hidden />;
            break;
          case "unsupported":
            rendered = (
              <div className="article-unsupported">
                <strong>{block.label}</strong>
                <span>{block.detail}</span>
              </div>
            );
            break;
          default:
            rendered = null;
        }
        return (
          <Fragment key={block.id}>
            {blockIndex === firstArticleBlockIndex ? authorHeader : null}
            {rendered}
          </Fragment>
        );
      })}
    </div>
  );
}

export function RootContentRenderer({ nodes }: { nodes: RootContent[] }) {
  return nodes.map((node, index) => renderNestedContent(node, `${node.type}-${index}`));
}
