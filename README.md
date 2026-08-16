# 折页 V0.2：小红书原生长文预览与导出器

一个 Chrome 优先、本地优先的 Markdown 工作台：打开 Obsidian Vault 或单篇 Markdown，编辑原文，实时查看 1080×1440 的连续图文分页，并一键保存为可上传小红书的 PNG 图片。

## 启动

最简单的方式：双击 [`启动折页.command`](启动折页.command)，终端会启动本地服务并打开 Chrome。

也可在终端执行：

```bash
cd "/Users/myandong/Projects/公众号图文写作系统/apps/xhs-preview"
npm install
npm run dev
```

然后打开 `http://127.0.0.1:4173`。不要直接双击 `index.html`：源码需要由 Vite 本地服务编译，而且目录读写需要 Chrome 的安全上下文。

## 已实现

- 打开 Vault、可搜索文件树、切换 Markdown。
- 打开单个 Markdown，或拖入只读副本后另存为。
- Markdown / GFM / Obsidian 图片、Callout 与手动分页标记。
- 原生有序列表支持跨页裁切，单个和两位数序号会保留在页面安全区内。
- Vault 附件目录、相对路径、同名图和缺图诊断。
- 1080×1440 真实字体排版，单页、缩略图和信息流预览。
- 默认使用“浅杏纸页 + 雾粉标注 + 暖灰文字”配色；工作台、预览画布与导出 PNG 共用同一套浅色语义 token。
- 整页成品图：位于文档开头/结尾，或被 `<!-- xhs-page-break -->` 单独隔开的图片，会直接接管 1080×1440 画布；不再套作者头、正文边距、图注或页码。文首整页图视为封面，不会在第二页重复作者头。
- 作者头部可自定义：上传图片头像或使用 1–2 字字标，并独立修改作者名、日期与栏目名。配置仅保存在当前浏览器，会进入预览与导出 PNG，不会改写 Markdown。
- 一键批量导出全部页面；归档到 `/Users/myandong/Documents/publish/YYYYMMDD_主题名/`，图片依次命名为 `主题名_01.png`、`主题名_02.png`。
- 本地图片、图床图片都会在导出前转成可独立保存的像素数据；缺图时停止导出并指出问题。
- 显式保存 / `Cmd+S`，保存前哈希校验，外部修改冲突处理。
- IndexedDB 本地快照，每篇最多 20 份。
- 内容不上传服务器；本地 SVG 会先去除脚本与外链，再在浏览器内栅格化。

## 验证

首次运行浏览器测试需要安装 Chromium：

```bash
npm ci
npx playwright install chromium
npm run check
```

`npm run check` 会依次执行全仓格式检查、recommended lint、TypeScript 类型检查、单元测试、生产构建和真实 Chromium 回归。当前自动化覆盖 Markdown 编译、图片寻址、安全写回、冲突拦截、导出命名和文件夹写入，并验证有序列表在第二页裁切边界内完整显示、默认浅色主题具备足够正文对比度。生产构建还会阻断任何超过 500 KiB 的 JavaScript chunk；完整通过项、浏览器流程和视觉证据见 [`VERIFICATION.md`](VERIFICATION.md)。

仓库内的 [`.github/workflows/quality.yml`](.github/workflows/quality.yml) 会在 pull request 与 `main` push 上运行同一门禁。远端 Actions 回执与 `main` 分支保护的当前状态以 [`VERIFICATION.md`](VERIFICATION.md) 的读回记录为准；本地配置文件本身不被当作远端已生效的证据。

## 自定义作者头部

1. 打开一篇文章，点击右上角“样式”。
2. 在“作者头部”中选择“上传头像”，或保留文字字标。头像支持 PNG、JPG 和 WebP，会在本机居中裁成正方形。
3. 分别填写字标、作者名、日期和栏目名；日期或栏目留空时，预览会自动去掉多余分隔符。
4. 配置会自动保存在当前 Chrome 中，打开其他文章或刷新后继续使用。如需回到初始品牌，点击“恢复默认作者头部”。

这是一组“当前浏览器的全局品牌设置”，不是写入单篇 Markdown 的 frontmatter；因此更换设置后，所有新打开文章都会使用新的作者头部。

## 导出发布图

1. 打开文章并确认底部显示“图片 n/n”。
2. 在预览区点击“导出 n 张”。
3. 第一次使用时，在系统目录选择器中选中 `/Users/myandong/Documents/publish`；折页会记住这个授权。
4. 等待“n 张发布图已保存”，再按文件名顺序上传小红书。

导出主题按 `export_title` → `title` → 文章一级标题 → Markdown 文件名的顺序取值。预览栏会在导出前显示最终主题；去除标点后最多保留 10 个字符。需要为系列文章指定简短且不撞名的导出名时，在 frontmatter 中写：

```yaml
---
title: 读者看到的完整标题
export_title: 简短导出主题
---
```

输出固定为 1080×1440 PNG。导出使用单独的 1:1 隐藏画布，不会把轮播按钮、页码圆点或编辑界面截进图片。

同一天、同主题再次导出会复用原文件夹并替换旧分页 PNG，避免页数减少后残留旧图；`copywriting.md` 和其他非分页文件不会被删除。

## 当前边界

- Chrome / Chromium 优先，Safari 和 Firefox 不提供完整目录写回能力。
- 本版不调用 AI 改写，不登录或自动发布小红书；发布动作仍由用户手动完成。
- 远程 PNG、JPEG、GIF、WebP、AVIF 可以导出；远程 SVG 因外链与脚本风险会被拒绝，本地 SVG 仍会先清理再栅格化。
- 暂不递归展开嵌入笔记、PDF、音频和视频。
