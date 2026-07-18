# 折页 V0.2 验收记录

验收日期：2026-07-18

结论：本地可运行版本通过自动化、Chromium 编辑链路和 PNG 导出链路验收，可以进入用户真实 Obsidian Vault 与真实保存目录验收。

## 自动化检查

| 检查 | 结果 | 覆盖范围 |
| --- | --- | --- |
| `npm test` | 通过：6 个测试文件，16 个场景 | Markdown / Callout、Obsidian 图片、路径解析、安全写回、冲突拦截、PNG 命名与目录写入、图床代理安全边界、作者头部归一化与旧配置迁移 |
| `npm run build` | 通过 | TypeScript 与 Vite 生产构建 |
| `zsh -n 启动折页.command` | 通过 | 一键启动脚本语法 |
| 启动脚本权限 | 通过 | 文件可执行 |

生产构建目前有一个非阻断提示：主 JavaScript 包约 1,007 kB，后续可通过延迟加载编辑器与导出引擎做拆包；它不影响 V0.2 的本地使用与数据安全。

## Chromium 主链路

以下流程已在真实 Chromium 渲染环境验证：

1. 开始页进入示例，正文、Callout、两张文章图片与 3:4 页面正常呈现。
2. 单页、全部缩略图和首图信息流三种预览可切换；高分屏截图没有跨页绘制或裁切残影。
3. 修改字号会触发真实重排与页数变化，恢复默认值后页数复原。
4. 缺图不会静默消失，会出现页面占位与图片诊断修复入口。
5. 模拟 Vault 可索引两篇 Markdown、读取 `.obsidian/app.json` 附件目录并解析 `![[cover.png]]`。
6. 编辑不会自动写盘；显式保存后，磁盘文本与编辑器文本逐字一致。
7. Obsidian 在干净状态修改文件后，窗口重新获得焦点会自动载入磁盘版本。
8. Obsidian 与编辑器同时修改时，本地文本保持不变，顶栏显示“外部已更新”，保存进入差异与合并界面。
9. 页面存在未保存内容时，浏览器离开保护事件会阻止静默退出。
10. 打开、编辑、图片解析、分页、保存和冲突流程中，浏览器控制台错误为 0。
11. 7008 字、23 页的真实长文可在 Markdown 编辑区独立滚动到底；编辑器视口高 546px、内容高 9350px，最终滚动位置到达最大值 8804px，页面本身没有被正文撑长。
12. 四页示例文章可一次导出四个独立 PNG；每张均为 1080×1440 RGBA，文件名按 `01` 到 `04` 排序，四张哈希均不同。
13. 导出图只包含 3:4 文章画布，轮播箭头、圆点、工具栏和缩放变换不会进入成品；跨页正文、图片和页码位置与预览一致。
14. 公网图床图片可经本机代理读取并嵌入导出 PNG；验证图片在最终 1080×1440 成品中可见。
15. 图床代理拒绝 `127.0.0.1`、私网地址和直接提供的 `198.18.0.0/15` 地址；缺图时导出在文件夹选择前停止，文件选择器调用次数为 0。
16. 完整导出流程中，浏览器控制台错误为 0。
17. `publish` 根目录首次选择后可通过 IndexedDB 持久化 File System 句柄；刷新页面再次导出时目录选择器调用次数为 0。
18. 归档目录遵循 `YYYYMMDD_十字内主题`，分页文件遵循 `主题_01.png`；重复导出会清除该主题的旧分页图，同时保留 `copywriting.md`，浏览器控制台错误为 0。
19. 旧版 `{ name, meta, initials }` 作者配置会自动迁移为作者名、日期、栏目名和字标四个独立字段，不丢失原有显示内容。
20. 作者头部可实时修改字标、作者名、日期和栏目名；图片头像会在本机裁切为 384×384 WebP，也可一键切回文字字标。
21. 自定义作者配置刷新后仍存在，本地存储中不再残留旧版 `meta` 和 `initials` 字段；配置不改写 Markdown。
22. 自定义图片头像、作者名“芽东 AI 实验室”、日期“2026年7月18日”和栏目“非技术 AI 教程”已进入首页导出成品；4 张图全部写入归档，首图为 1080×1440 RGBA，浏览器控制台错误为 0。

Vault 流程使用内存实现的 File System Access 句柄；归档授权与复用流程使用 Chromium 的可结构化克隆目录句柄进行自动化。两者覆盖相同接口和状态机，但不冒充用户真实 Vault 或真实 `Documents/publish` 验收。

## 视觉证据

- [开始页](output/playwright/start-screen.png)
- [真实比例单页](output/playwright/workbench-page-1-fixed.png)
- [全部缩略图与图片](output/playwright/grid-view-png.png)
- [缺图诊断](output/playwright/missing-image-diagnostic.png)
- [模拟 Vault 与 Obsidian 图片](output/playwright/mock-vault-loaded.png)
- [写回冲突](output/playwright/write-conflict.png)
- [外部更新保护](output/playwright/external-update-guard.png)
- [长文章编辑区滚动到底](output/playwright/long-article-editor-scroll.png)
- [导出成功回执](output/playwright/png-export-success.png)
- [固定 publish 归档与成功回执](output/playwright/publish-archive-success.png)
- [四页导出：第 1 页](output/playwright/exported-demo/两遍%20AI%20对话学习法-01.png)
- [四页导出：第 2 页](output/playwright/exported-demo/两遍%20AI%20对话学习法-02.png)
- [四页导出：第 3 页](output/playwright/exported-demo/两遍%20AI%20对话学习法-03.png)
- [四页导出：第 4 页](output/playwright/exported-demo/两遍%20AI%20对话学习法-04.png)
- [图床图片导出成品](output/playwright/exported-remote/图床导出测试-01.png)
- [作者头部自定义面板](output/playwright/author-customizer-avatar.png)
- [自定义作者头部的导出成功回执](output/playwright/author-custom-export-success.png)
- [自定义头像与作者信息导出成品](output/playwright/exported-custom-author/两遍AI对话学习法_01.png)

## 用户真实 Vault 验收

1. 双击 `启动折页.command`，在 Chrome 中选择一个测试 Vault。
2. 打开一篇同时含标准 Markdown 图片与 `![[图片.png]]` 的文章，确认图片数量与位置。
3. 在折页中改一小段文字并显式保存，再回到 Obsidian 确认原文件已更新。
4. 分别在“无本地修改”和“有本地修改”时从 Obsidian 改同一篇文章，确认自动载入与冲突提示符合预期。
5. 打开“样式”，上传一张测试头像，再修改字标、作者名、日期和栏目名；切换“使用字标”并刷新页面，确认显示与持久化符合预期。
6. 点击“导出 n 张”，首次选择 `/Users/myandong/Documents/publish`，确认 `YYYYMMDD_主题名` 文件夹内的 PNG 数量、顺序、作者头部和正文画面与预览一致。
7. 刷新折页后再次导出，确认无需重新选择目录；如果文章页数减少，旧的多余分页图会消失，已有 `copywriting.md` 不受影响。

真实 Vault 验收前请先选一篇可回滚的测试文章。V0.2 不会后台自动保存、不会上传正文，也不会登录或自动发布小红书。
