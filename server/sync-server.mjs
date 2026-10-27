/**
 * 自写 Yjs 同步服务端(兼容 y-websocket 客户端协议)。
 *
 * 做了五件事,每件都是面试会问的:
 *  1. 房间:docId → 内存 Y.Doc;新连接进来先交换 state vector(sync step 1 / step 2),只补缺的 update
 *  2. 广播:任一端的 update 原样转发给房间内其他连接;awareness(光标 / 在线)单独一条消息通道
 *  3. 鉴权:?token= 查 tokens.json 得到 read / write;只读连接发来的 step2 / update 直接丢弃(不进 doc、不广播)
 *  4. 持久化:不存“文档内容”,存 update 日志(append-only,长度前缀)+ 周期快照;启动时 快照 + 重放日志 恢复
 *  5. 版本:手动 / 定时打快照,HTTP 列出并下载任一版本(客户端用临时 Y.Doc 渲染)
 * 另外挂了一个 mock 的 /ai SSE 接口,逐 token 返回,供“AI 续写”演示。
 *
 * 消息格式(与 y-websocket 一致):varUint messageType(0 sync | 1 awareness) + payload
 *  sync payload:varUint syncType(0 step1 | 1 step2 | 2 update)+ 数据
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 1234);
const DATA = path.join(__dirname, 'data');
const SNAPSHOT_EVERY = Number(process.env.SNAPSHOT_EVERY || 200);   // 每 N 条 update 合并一次快照
const AUTO_SNAPSHOT_MS = Number(process.env.AUTO_SNAPSHOT_MS || 5 * 60 * 1000);
const TOKENS = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'));
const MSG_SYNC = 0, MSG_AWARENESS = 1;
fs.mkdirSync(DATA, { recursive: true });

// ---------- 持久化:append-only 日志 + 快照 ----------
class Store {
  constructor(room) {
    this.dir = path.join(DATA, safe(room)); fs.mkdirSync(path.join(this.dir, 'versions'), { recursive: true });
    this.logPath = path.join(this.dir, 'updates.ylog');
    this.snapPath = path.join(this.dir, 'snapshot.bin');
    this.pending = 0;
  }
  load(doc) {
    if (fs.existsSync(this.snapPath)) Y.applyUpdate(doc, fs.readFileSync(this.snapPath), 'store');
    if (fs.existsSync(this.logPath)) {
      const buf = fs.readFileSync(this.logPath); let off = 0, n = 0;
      while (off + 4 <= buf.length) {
        const len = buf.readUInt32LE(off); off += 4;
        if (off + len > buf.length) break; // 尾部半条(写到一半崩了)直接丢
        Y.applyUpdate(doc, buf.subarray(off, off + len), 'store'); off += len; n++;
      }
      this.pending = n;
    }
  }
  append(update) {
    const head = Buffer.alloc(4); head.writeUInt32LE(update.length, 0);
    fs.appendFileSync(this.logPath, Buffer.concat([head, Buffer.from(update)]));
    this.pending++;
  }
  snapshot(doc, { version = false } = {}) {
    const full = Y.encodeStateAsUpdate(doc);
    fs.writeFileSync(this.snapPath, full);
    fs.writeFileSync(this.logPath, Buffer.alloc(0)); // 日志已合并进快照,清空
    this.pending = 0;
    if (version) fs.writeFileSync(path.join(this.dir, 'versions', `${Date.now()}.bin`), full);
  }
  versions() { return fs.readdirSync(path.join(this.dir, 'versions')).filter(f => f.endsWith('.bin')).map(f => f.slice(0, -4)).sort(); }
  version(ts) { const p = path.join(this.dir, 'versions', `${Number(ts)}.bin`); return fs.existsSync(p) ? fs.readFileSync(p) : null; }
}
const safe = s => String(s).replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_').slice(0, 64) || 'default';

// ---------- 房间 ----------
class Room {
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.conns = new Map();                 // ws → { role }
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);     // 服务端自己不占一个光标
    this.store = new Store(name);
    this.store.load(this.doc);
    this.doc.on('update', (update, origin) => {
      if (origin === 'store') return;
      this.store.append(update);
      if (this.store.pending >= SNAPSHOT_EVERY) this.store.snapshot(this.doc);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), origin);
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc), null);
    });
    this.timer = setInterval(() => { if (this.store.pending > 0) this.store.snapshot(this.doc, { version: true }); }, AUTO_SNAPSHOT_MS);
  }
  broadcast(buf, exceptOrigin) {
    for (const [ws] of this.conns) if (ws !== exceptOrigin && ws.readyState === ws.OPEN) ws.send(buf);
  }
  join(ws, role) {
    this.conns.set(ws, { role, clientIds: new Set() });
    // 1) 发 sync step 1:告诉客户端“我有什么”,客户端回 step 2 补我缺的;客户端同时也会发它的 step 1
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    ws.send(encoding.toUint8Array(enc));
    // 2) 把当前所有人的 awareness 发给新来的
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const e2 = encoding.createEncoder();
      encoding.writeVarUint(e2, MSG_AWARENESS);
      encoding.writeVarUint8Array(e2, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      ws.send(encoding.toUint8Array(e2));
    }
  }
  message(ws, data) {
    const meta = this.conns.get(ws); if (!meta) return;
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      // 只读连接:step2 / update 都会改 doc,直接丢弃;step1 允许(它只是请求数据)
      const syncType = decoding.peekVarUint(dec);
      if (meta.role !== 'write' && syncType !== syncProtocol.messageYjsSyncStep1) {
        // 只记日志不回文本帧:y-websocket 客户端只认二进制协议消息,文本帧会让它解码崩溃
        meta.dropped = (meta.dropped || 0) + 1;
        if (meta.dropped === 1) console.log(`[drop] room=${this.name} read-only client tried to write`);
        return;
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, enc, this.doc, ws); // origin = ws,广播时跳过发送者
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc)); // 对 step1 的回应(step2)
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      // 记录这个连接声明过哪些 clientId,断开时统一清理
      const d2 = decoding.createDecoder(update); const n = decoding.readVarUint(d2);
      for (let i = 0; i < n; i++) { meta.clientIds.add(decoding.readVarUint(d2)); decoding.readVarUint(d2); decoding.readVarString(d2); }
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
    }
  }
  leave(ws) {
    const meta = this.conns.get(ws); if (!meta) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...meta.clientIds], null);
  }
}
const rooms = new Map();
const getRoom = name => { if (!rooms.has(name)) rooms.set(name, new Room(name)); return rooms.get(name); };

// ---------- HTTP:版本接口 + mock AI(SSE) ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const room = url.searchParams.get('room');

  if (url.pathname === '/versions' && room) {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(getRoom(room).store.versions()));
  }
  if (url.pathname === '/version' && room) {
    const bin = getRoom(room).store.version(url.searchParams.get('ts'));
    if (!bin) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'application/octet-stream'); return res.end(bin);
  }
  if (url.pathname === '/snapshot' && room && req.method === 'POST') {
    if (TOKENS[url.searchParams.get('token')] !== 'write') { res.statusCode = 403; return res.end('write token required'); }
    const r = getRoom(room); r.store.snapshot(r.doc, { version: true }); return res.end('ok');
  }
  if (url.pathname === '/ai' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const { prompt = '' } = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const text = mockAnswer(prompt);
    let i = 0;
    const timer = setInterval(() => {
      if (i >= text.length || res.destroyed) { clearInterval(timer); if (!res.destroyed) { res.write('data: [DONE]\n\n'); res.end(); } return; }
      const chunk = text.slice(i, i + 2); i += 2;                       // 每 40ms 两个字,肉眼能看到“在写”
      res.write(`data: ${JSON.stringify({ token: chunk, seq: i })}\n\n`);
    }, 40);
    req.on('close', () => clearInterval(timer));                        // 客户端 abort → 服务端立即停,省算力
    return;
  }
  if (url.pathname === '/healthz') return res.end('ok');
  res.statusCode = 404; res.end();
});
const mockAnswer = p => `关于“${p}”:CRDT 让每个副本独立修改、任意顺序合并后仍然收敛到同一状态;它用唯一 id 和因果信息代替中心排序,所以离线编辑和多端同时写都不需要锁。代价是元数据会膨胀,要靠快照和垃圾回收控制。`;

// ---------- WebSocket:鉴权 + 入房 ----------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const roomName = decodeURIComponent(url.pathname.slice(1)) || 'default';
  const role = TOKENS[url.searchParams.get('token')];
  if (!role) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    const room = getRoom(roomName);
    room.join(ws, role);
    ws.on('message', data => room.message(ws, data));
    ws.on('close', () => room.leave(ws));
    ws.on('error', () => room.leave(ws));
    console.log(`[join] room=${roomName} role=${role} conns=${room.conns.size}`);
  });
});

server.listen(PORT, () => console.log(`sync server on ws://localhost:${PORT}  (http: /versions /version /snapshot /ai)`));
process.on('SIGINT', () => { for (const r of rooms.values()) { clearInterval(r.timer); r.store.snapshot(r.doc); } process.exit(0); });
