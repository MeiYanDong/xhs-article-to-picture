import type {
  Blockquote,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
  AuthorProfile,
  ContentBlock,
  PageStyle,
  ResolvedAsset,
} from "./domain";
import { formatAuthorMeta, normalizeWordmark } from "./author";
import { stripCalloutMarker } from "./markdown";

interface InlineRendererProps {
  nodes: PhrasingContent[];
}

function safeLink(url: string): string {
  return /^(?:https?:|mailto:)/i.test(url) ? url : "#";
}

function InlineRenderer({ nodes }: InlineRendererProps) {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
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

function renderListItem(item: ListItem, index: number): ReactNode {
  return (
    <li key={`list-item-${index}`}>
      {item.checked !== null && item.checked !== undefined ? (
        <span className={`task-check ${item.checked ? "is-checked" : ""}`} aria-hidden>
          {item.checked ? "✓" : ""}
        </span>
      ) : null}
      {item.children.map((child, childIndex) => {
        if (child.type === "paragraph") {
          return (
            <span key={`paragraph-${childIndex}`} className="list-paragraph">
              <InlineRenderer nodes={child.children} />
            </span>
          );
        }
        if (child.type === "list") {
          return <ListRenderer key={`list-${childIndex}`} node={child} />;
        }
        return (
          <span key={`fallback-${childIndex}`} className="list-paragraph">
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
      {node.children.map((child, index) => {
        if (child.type === "paragraph") {
          const paragraph = callout && index === 0 ? stripCalloutMarker(child) : child;
          if (!paragraph.children.some((part) => part.type !== "text" || part.value.trim())) {
            return null;
          }
          return (
            <p key={`quote-${index}`}>
              <InlineRenderer nodes={paragraph.children} />
            </p>
          );
        }
        if (child.type === "list") return <ListRenderer key={`quote-list-${index}`} node={child} />;
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
          {node.children.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.children.map((cell, cellIndex) => {
                const Tag = rowIndex === 0 ? "th" : "td";
                return (
                  <Tag key={`cell-${cellIndex}`}>
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
      <figure className="article-image is-missing">
        <div className="image-fallback-mark">⌁</div>
        <strong>{asset?.status === "ambiguous" ? "图片需要确认" : "图片暂未加载"}</strong>
        <span>{asset?.message ?? raw}</span>
      </figure>
    );
  }

  return (
    <figure
      className={`article-image ${standalone ? "is-standalone" : ""}`}
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

      {blocks.map((block, blockIndex) => {
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(block.depth, 3)}` as "h1" | "h2" | "h3";
            return (
              <Tag key={block.id} className={`article-heading depth-${block.depth}`}>
                <InlineRenderer nodes={block.inline.nodes} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={block.id} className="article-paragraph">
                <InlineRenderer nodes={block.inline.nodes} />
              </p>
            );
          case "image":
            return (
              <ArticleImage
                key={block.id}
                raw={block.image.raw}
                alt={block.image.alt}
                requestedWidth={block.image.requestedWidth}
                standalone={
                  blocks[blockIndex - 1]?.type === "pageBreak" &&
                  blocks[blockIndex + 1]?.type === "pageBreak"
                }
                asset={assets.get(block.image.raw)}
                onSettled={onAssetSettled}
                onRemoteError={onRemoteError}
              />
            );
          case "list":
            return (
              <div key={block.id} className="article-list">
                <ListRenderer node={block.node} />
              </div>
            );
          case "blockquote":
            return (
              <BlockquoteRenderer key={block.id} node={block.node} callout={block.callout} />
            );
          case "code":
            return (
              <pre key={block.id} className="article-code" data-language={block.language || "TEXT"}>
                <code>{block.value}</code>
              </pre>
            );
          case "table":
            return <TableRenderer key={block.id} node={block.node} />;
          case "rule":
            return <hr key={block.id} />;
          case "pageBreak":
            return <div key={block.id} className="article-page-break" aria-hidden />;
          case "unsupported":
            return (
              <div key={block.id} className="article-unsupported">
                <strong>{block.label}</strong>
                <span>{block.detail}</span>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export function RootContentRenderer({ nodes }: { nodes: RootContent[] }) {
  return nodes.map((node, index) => renderNestedContent(node, `${node.type}-${index}`));
}
