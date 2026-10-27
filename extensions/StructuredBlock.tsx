import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

/**
 * 结构化块(block atom):按 type 分发渲染,payload 是 JSON 字符串。
 * 已知 type:chart / table / code;未知 type 降级为 JSON 文本 —— 协议演进不炸旧客户端。
 * 对应 GeoGPT 的 20+ 种结构化组件渲染协议。
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    structuredBlock: { insertStructuredBlock: (type: string, payload: unknown) => ReturnType };
  }
}

export const StructuredBlock = Node.create({
  name: 'structuredBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      type: { default: 'unknown', parseHTML: (el: HTMLElement) => el.getAttribute('data-type'), renderHTML: (a: Record<string, any>) => ({ 'data-type': a.type }) },
      payload: { default: '{}', parseHTML: (el: HTMLElement) => el.getAttribute('data-payload'), renderHTML: (a: Record<string, any>) => ({ 'data-payload': a.payload }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-structured-block]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-structured-block': '' })]; },
  addNodeView() { return ReactNodeViewRenderer(StructuredView); },
  addCommands() {
    return {
      insertStructuredBlock: (type, payload) => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs: { type, payload: JSON.stringify(payload) } }).run(),
    };
  },
});

// ---------- 渲染分发表:加一种类型 = 加一个渲染器 ----------
const RENDERERS: Record<string, (p: any) => JSX.Element> = {
  chart: p => <BarChart title={p.title} data={p.data ?? []} />,
  table: p => (
    <table className="sb-table"><thead><tr>{(p.columns ?? []).map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{(p.rows ?? []).map((r: any[], i: number) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody></table>
  ),
  code: p => <pre className="sb-code"><code>{p.code ?? ''}</code></pre>,
};

function StructuredView({ node }: NodeViewProps) {
  const type = node.attrs.type as string;
  let payload: any = {}; try { payload = JSON.parse(node.attrs.payload); } catch { /* 坏 payload 也走降级 */ }
  const render = RENDERERS[type] as ((p: any) => JSX.Element) | undefined;
  return (
    <NodeViewWrapper className="sb" data-type={type}>
      <div className="sb-head">{type}{render ? '' : ' · 未知类型,已降级'}</div>
      {render ? render(payload) : <pre className="sb-code"><code>{JSON.stringify(payload, null, 2)}</code></pre>}
    </NodeViewWrapper>
  );
}

function BarChart({ title, data }: { title?: string; data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const w = 320, h = 120, bw = w / Math.max(1, data.length);
  return (
    <div>
      {title && <div className="sb-title">{title}</div>}
      <svg width={w} height={h + 18} className="sb-chart">
        {data.map((d, i) => {
          const bh = (d.value / max) * h;
          return <g key={i}><rect x={i * bw + 4} y={h - bh} width={bw - 8} height={bh} rx={3} /><text x={i * bw + bw / 2} y={h + 13} textAnchor="middle">{d.label}</text></g>;
        })}
      </svg>
    </div>
  );
}
