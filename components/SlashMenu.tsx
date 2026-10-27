'use client';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * 斜杠菜单:在段落里输入 "/" 触发,过滤、上下键、回车。
 * 不依赖 @tiptap/suggestion:监听 transaction,看光标前的文本是否匹配 /^\/(\S*)$/,位置用 view.coordsAtPos。
 * 对应 GeoGPT 输入框的 "#" 技能唤起菜单。
 */
export type SlashItem = { label: string; hint: string; run: (editor: Editor) => void };

export const SLASH_ITEMS: SlashItem[] = [
  { label: '标题', hint: 'H2', run: e => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: '列表', hint: '无序', run: e => e.chain().focus().toggleBulletList().run() },
  { label: '编号', hint: '有序', run: e => e.chain().focus().toggleOrderedList().run() },
  { label: '代码块', hint: '```', run: e => e.chain().focus().setCodeBlock().run() },
  { label: '表格', hint: '结构化块 · table', run: e => e.chain().focus().insertStructuredBlock('table', { columns: ['指标', '值'], rows: [['R²', 0.8965], ['样本', 1200]] }).run() },
  { label: '图表', hint: '结构化块 · chart', run: e => e.chain().focus().insertStructuredBlock('chart', { title: '月度产量', data: [{ label: '1月', value: 12 }, { label: '2月', value: 18 }, { label: '3月', value: 9 }] }).run() },
  { label: '未知块', hint: '演示降级渲染', run: e => e.chain().focus().insertStructuredBlock('timeline', { events: ['a', 'b'] }).run() },
  { label: '引用', hint: '[n] 来源角标', run: e => e.chain().focus().insertCitation({ n: 1, docId: 'doc-shale-2019', title: 'Shale gas production forecasting', page: 7, bbox: '120,340,480,392', quote: '…the proppant mass is the dominant predictor…' }).run() },
  { label: 'AI 块', hint: '插入后用“AI 续写”', run: e => e.chain().focus().insertAiBlock({ id: `ai-${Date.now().toString(36)}`, prompt: '', status: 'idle' }).run() },
];

export default function SlashMenu({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<{ query: string; from: number; to: number; x: number; y: number } | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parent.type.name !== 'paragraph') return setState(null);
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const m = /^\/(\S*)$/.exec(before);
      if (!m) return setState(null);
      const coords = editor.view.coordsAtPos($from.pos);
      setState({ query: m[1], from: $from.pos - m[0].length, to: $from.pos, x: coords.left, y: coords.bottom });
      setIdx(0);
    };
    editor.on('transaction', check);
    return () => { editor.off('transaction', check); };
  }, [editor]);

  const items = state ? SLASH_ITEMS.filter(it => it.label.includes(state.query) || it.hint.toLowerCase().includes(state.query.toLowerCase())) : [];

  useEffect(() => {
    if (!editor || !state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => (i + 1) % Math.max(1, items.length)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => (i - 1 + items.length) % Math.max(1, items.length)); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[idx]); }
      else if (e.key === 'Escape') setState(null);
    };
    const dom = editor.view.dom; dom.addEventListener('keydown', onKey, true);
    return () => dom.removeEventListener('keydown', onKey, true);
  });

  const choose = (it?: SlashItem) => {
    if (!editor || !state || !it) return;
    editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();   // 先删掉 "/query"
    it.run(editor); setState(null);
  };

  if (!state || items.length === 0) return null;
  return (
    <div className="slash" style={{ left: state.x, top: state.y + 4 }}>
      {items.map((it, i) => (
        <div key={it.label} className={`slash-item ${i === idx ? 'on' : ''}`} onMouseDown={e => { e.preventDefault(); choose(it); }}>
          <span>{it.label}</span><small>{it.hint}</small>
        </div>
      ))}
    </div>
  );
}
