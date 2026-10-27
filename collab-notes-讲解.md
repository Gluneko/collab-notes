# collab-notes 讲解:怎么在面试里讲"协同编辑 + 富文本 + AI 流式写入"

> 代码:`collab-notes/`。Next.js + TipTap(ProseMirror)+ Yjs;同步服务端、最小 CRDT、三类自定义节点、斜杠菜单、Markdown 转换是自己写的。
> 跑:`pnpm server` + `pnpm dev`,开两个 tab 选不同身份;`pnpm crdt-demo` 看原理演示。

## 一、归属口径

> "GeoGPT 的研究笔记(协同编辑)是我负责的:Yjs CRDT 配 TipTap,同步服务端、持久化与版本、读写鉴权、离线合并、三类自定义节点、斜杠菜单和 AI 流式写入都是我设计实现的;它和对话的多 tab 单活连接、SSE 流式协议、20 多种结构化块协议是同一条线。选型阶段我手写了一个最小序列 CRDT 验证并发合并的原理,然后才定了 Yjs。"

## 二、一句话定位

> "文档的唯一真相源是一个 Y.Doc;编辑器只是它的视图;同步服务端只转发 update 和存日志,不理解文档内容;AI 写入和人类编辑是同一种事务,所以能并发合并。"

## 三、架构

```
浏览器 A ──┐                                 ┌── 浏览器 B
TipTap ⇄ Y.Doc ⇄ IndexedDB(离线)            │
   │ awareness(光标 / 在线)                   │
   ▼ WebSocket(y-websocket 协议)              ▼
            自写同步服务端(server/sync-server.mjs)
            ├─ 房间:docId → 内存 Y.Doc
            ├─ 握手:sync step1(我有什么)/ step2(补你缺的)/ update(增量广播)
            ├─ 鉴权:token → read / write;只读连接的 step2 与 update 直接丢弃
            ├─ 持久化:append-only update 日志(长度前缀)+ 周期快照;启动时快照 + 重放
            ├─ 版本:手动 / 定时快照落 versions/,HTTP 列出与下载
            └─ /ai:mock 模型 SSE 逐 token
```

节点层(ProseMirror schema):`aiBlock`(状态机 idle → streaming → done / error / cancelled,content 为 inline,AI 的 token 插在节点内)、`citation`(inline atom,docId / 页码 / 坐标 / 摘录,点击侧栏展开)、`structuredBlock`(block atom,按 type 分发渲染,未知 type 降级为 JSON)。

## 四、五个设计决策

### 1. 为什么 CRDT 不是 OT?
OT 要中心服务器按序变换每个操作,服务端有状态、实现复杂、离线难做;CRDT 的操作可交换,任意顺序合并都收敛,离线和多端是天然的。代价是元数据(每个字符的 id、墓碑)会膨胀,靠快照和 GC 控制。现在协作产品普遍选 CRDT 的原因就是离线和多端是刚需。

### 2. 为什么自己写同步服务端,而不是直接用 y-websocket 的 server?
不是为了造轮子,是为了把三件服务端才有的事做出来:**鉴权**(只读 token 的写入必须在服务端丢,客户端挡不住)、**持久化**(日志 + 快照,不存"内容")、**版本**(快照即版本)。协议本身很小:两个消息类型、三个同步子类型,实现了一遍才知道 step1/step2 为什么是 state vector 交换、为什么只补缺的 update。

### 3. 为什么存 update 日志而不是存文档内容?
内容是 update 的函数,存 update 能回放到任意时刻、能做版本、能在客户端重连时只补缺的部分。append-only 写入快、崩溃安全(尾部半条直接丢);日志长了就合并成快照,快照本身就是一条大 update。

### 4. 撤销为什么只撤自己的?
`Y.UndoManager` 按事务 origin 追踪,本地事务进栈、远端事务不进。协同场景下"撤销"如果把别人刚写的撤掉,是事故。这也是 TipTap 要关掉自带 history 的原因。

### 5. AI 写入为什么走事务而不是最后一次性插入?
逐 token 以事务追加到 `aiBlock` 内,协作者能实时看到 AI 在写,人类同时编辑同一段也能合并,取消时状态机标 cancelled 不再追加。这就是 GeoGPT 流式协议的协同版:SSE 的 seq / abort 对应这里的事务顺序 / AbortController。

## 五、最小 CRDT(server/mini-crdt.mjs)讲什么

RGA 思路:每个字符带 `(client, clock)` 唯一 id 和 `origin`(插入时的左邻);并发在同一个 origin 后插入时按 id 排序,所有副本得到同一顺序;删除打墓碑;缺前驱的操作排队等前驱到了再应用。演示里两端离线各改、乱序到达,都收敛。面试里能讲这一段,"用过 Yjs"就变成了"理解 CRDT"。

## 六、面试 Q&A

**Q:两个人同时在同一位置打字会怎样?**
> 都保留,顺序由 CRDT 的 id 决定,所有端一致。不会丢字,也不会弹冲突框。

**Q:离线一小时再上线呢?**
> IndexedDB 存着本地所有 update,上线后和服务端交换 state vector,双方各补缺的部分。两边改了同一句话,字符级合并,语义冲突靠人看。

**Q:文档很大怎么办?**
> 服务端周期快照把日志合并,GC 掉墓碑;客户端首次加载拿快照不拿全量日志;超大文档按章节拆成多个 Y.Doc。

**Q:权限怎么做?**
> token 决定 read / write;只读连接的写入在服务端丢弃。生产里再细到段落级要在 schema 上加锁定标记并在服务端校验 update 触碰的范围。

**Q:版本历史怎么实现?**
> 快照即版本。预览是把版本的 update 灌进一个临时 Y.Doc,转成 ProseMirror JSON 用只读编辑器渲染,和正文同一套节点,所以 AI 块、引用块、结构化块在历史里也长一样。

**Q:斜杠菜单和结构化块与 GeoGPT 的关系?**
> 斜杠菜单就是输入框里 `#` 唤起技能;结构化块按 type 分发、未知类型降级,就是 20 多种组件渲染协议搬到了文档节点里。

## 七、演示脚本(4 分钟)

```bash
pnpm server && pnpm dev            # 两个终端
# tab1 选 alice,tab2 选 bob
# 1. 两边同时打字,看光标与合并(30s)
# 2. tab1 点"模拟断网",两边各改同一段,再"重连",看合并结果(60s)
# 3. 输入 / 插入图表、表格、未知块(降级)、引用(点击角标看侧栏)(60s)
# 4. "AI 续写",在 tab2 看 AI 逐字出现;中途"停止"看状态变 cancelled(45s)
# 5. "打快照" → "版本" → 点一个版本在侧栏只读渲染(30s)
# 6. 选 guest 只读身份打字,服务端日志出现 [drop],其他 tab 看不到(15s)
pnpm crdt-demo                     # 原理演示:离线并发 + 乱序收敛
```
