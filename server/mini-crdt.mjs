/**
 * 最小序列 CRDT(RGA 思路,~120 行,零依赖)。用来讲清楚“并发插入为什么能收敛”。
 *
 * 模型:
 *  - 每个字符是一个 item:{ id: [client, clock], origin: 左邻 item 的 id(插入时的左边), ch, deleted }
 *  - 插入:在 origin 右边找位置;若已有其他 item 也以同一个 origin 为左邻(并发插入),按 id 大小排序 → 所有副本得到同一顺序
 *  - 删除:打墓碑(deleted = true),不真删,保证别人的 origin 还能找到
 *  - 合并:把对方的操作按因果顺序应用(这里用简单的“缺前驱就排队重试”)
 *
 * 运行:node server/mini-crdt.mjs
 */
const idKey = id => `${id[0]}:${id[1]}`;
const cmpId = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);

export class RGA {
  constructor(client) { this.client = client; this.clock = 0; this.items = []; this.ops = []; this.pending = []; }

  text() { return this.items.filter(i => !i.deleted).map(i => i.ch).join(''); }
  // 可见位置 → items 索引(跳过墓碑)
  visibleToIndex(pos) { let seen = 0; for (let i = 0; i < this.items.length; i++) { if (this.items[i].deleted) continue; if (seen === pos) return i; seen++; } return this.items.length; }

  insert(pos, str) {
    let originIdx = pos === 0 ? -1 : this.visibleToIndex(pos - 1);
    for (const ch of str) {
      const origin = originIdx < 0 ? null : this.items[originIdx].id;
      const op = { type: 'ins', id: [this.client, ++this.clock], origin, ch };
      this._applyInsert(op); this.ops.push(op);
      originIdx = this.items.findIndex(i => idKey(i.id) === idKey(op.id));
    }
  }
  delete(pos, len = 1) {
    for (let k = 0; k < len; k++) {
      const idx = this.visibleToIndex(pos); if (idx >= this.items.length) return;
      const op = { type: 'del', target: this.items[idx].id };
      this._applyDelete(op); this.ops.push(op);
    }
  }

  // 核心:并发插入的确定性排位
  _applyInsert(op) {
    if (this.items.some(i => idKey(i.id) === idKey(op.id))) return true;            // 幂等
    let idx = 0;
    if (op.origin) { idx = this.items.findIndex(i => idKey(i.id) === idKey(op.origin)); if (idx < 0) return false; idx++; } // 前驱未到,稍后重试
    // 从 origin 右边开始,跳过所有“同样挂在这个 origin 上、且 id 更大”的并发 item(以及它们的子树)
    while (idx < this.items.length) {
      const cur = this.items[idx];
      const curOriginKey = cur.origin ? idKey(cur.origin) : null;
      const opOriginKey = op.origin ? idKey(op.origin) : null;
      const sibling = curOriginKey === opOriginKey;                               // 同一个 origin 的并发兄弟
      if (sibling && cmpId(cur.id, op.id) < 0) break;                             // 兄弟 id 更小 → 我排它前面
      if (!sibling && !this._isDescendantOfOriginAfter(cur, op)) break;          // 不属于前面兄弟的子树 → 停
      idx++;
    }
    this.items.splice(idx, 0, { id: op.id, origin: op.origin, ch: op.ch, deleted: false });
    return true;
  }
  // 简化版子树判断:cur 的 origin 链能否追溯到 op.origin 之后的某个兄弟
  _isDescendantOfOriginAfter(cur, op) {
    let o = cur.origin; const target = op.origin ? idKey(op.origin) : null; let guard = 0;
    while (o && guard++ < 10000) {
      const k = idKey(o); if (k === target) return true;
      const parent = this.items.find(i => idKey(i.id) === k); if (!parent) return false; o = parent.origin;
    }
    return target === null; // origin 为 null(文首)的子树
  }
  _applyDelete(op) { const it = this.items.find(i => idKey(i.id) === idKey(op.target)); if (!it) return false; it.deleted = true; return true; }

  // 合并远端操作:缺前驱的排队,直到没有进展为止
  merge(ops) {
    let queue = [...this.pending, ...ops]; this.pending = [];
    let progress = true;
    while (progress && queue.length) {
      progress = false; const rest = [];
      for (const op of queue) { const ok = op.type === 'ins' ? this._applyInsert(op) : this._applyDelete(op); if (ok) progress = true; else rest.push(op); }
      queue = rest;
    }
    this.pending = queue;
  }
}

// ---------- 演示:两端离线并发编辑后交换操作,文本收敛 ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = new RGA(1), b = new RGA(2);
  a.insert(0, 'CRDT'); b.merge(a.ops);                    // 同步起点
  console.log('起点   A:', a.text(), '| B:', b.text());
  a.insert(4, ' 很好');                                   // A 在末尾追加
  b.insert(4, ' 真妙');                                   // B 同时也在末尾追加(并发,同一个 origin = 'T')
  b.delete(0, 1);                                         // B 删掉 'C'
  console.log('离线   A:', a.text(), '| B:', b.text());
  const aOps = a.ops.slice(), bOps = b.ops.slice();
  a.merge(bOps); b.merge(aOps);
  console.log('合并   A:', a.text(), '| B:', b.text(), '| 收敛:', a.text() === b.text());
  // 乱序到达也收敛:把 A 的操作倒序喂给一个新副本
  const c = new RGA(3); c.merge([...aOps].reverse()); c.merge(bOps);
  console.log('乱序   C:', c.text(), '| 与 A 一致:', c.text() === a.text());
}
