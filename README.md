# collab-notes — 协同笔记(Yjs CRDT + TipTap + 自写同步服务端)

## 跑起来
```bash
cd ~/Downloads/collab-notes
pnpm install          # 或 npm install
pnpm server           # 终端 1:同步服务端 ws://localhost:1234(含 /ai /versions /snapshot)
pnpm dev              # 终端 2:Next.js http://localhost:3100
pnpm crdt-demo        # 最小 CRDT 原理演示(零依赖)
```
打开两个 tab,一个选 alice 一个选 bob,同时打字看光标;选 guest 体验只读;点“模拟断网”继续编辑再“重连”看合并;“AI 续写”看 AI 的 token 实时出现在另一个 tab。

## 已完成(Day 1 核心)
- [x] 自写同步服务端:sync step1/step2/update、awareness、鉴权(read/write)、append-only update 日志 + 快照、版本列表与下载、mock AI SSE
- [x] 编辑器:TipTap + Collaboration + 协作者光标 + IndexedDB 离线 + 按 origin 的撤销重做
- [x] AI 块自定义节点(状态机 idle/streaming/done/error/cancelled),AI token 以事务写入
- [x] 最小序列 CRDT(RGA)+ 并发与乱序收敛演示

## 已完成(Day 2–4)
- [x] 引用块 citation(docId / 页码 / 坐标,点击展开来源)
- [x] 结构化块 structuredBlock(按 type 分发,未知类型降级)
- [x] 斜杠菜单 `/`(标题 / 列表 / 代码 / 表格 / AI 块 / 引用块)
- [x] Markdown 粘贴转节点、导出 Markdown
- [x] 版本预览:侧栏只读渲染(与正文同一套节点)
- [x] 讲解文档 collab-notes-讲解.md

## 目录
```
server/sync-server.mjs   自写同步服务端(协议 / 房间 / 鉴权 / 持久化 / 版本 / AI SSE)
server/mini-crdt.mjs     最小 RGA CRDT + 演示
server/tokens.json       token → read/write
server/data/<room>/      updates.ylog + snapshot.bin + versions/*.bin
components/Editor.tsx    编辑器与两个 provider
extensions/AiBlock.ts    AI 块节点与三个命令
lib/ai-stream.ts         SSE 客户端
```
