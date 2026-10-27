import { Node, mergeAttributes } from '@tiptap/core';

/**
 * AI 块:一个带状态机的自定义节点。
 *  attrs: id(定位用)、prompt、status(idle | streaming | done | error | cancelled)
 *  content: inline*  → AI 的 token 以普通文本插入节点内部,所以它和人类编辑是同一种 Yjs 事务,能并发合并
 * 对应 GeoGPT:结构化块里的“AI 生成中”中间态;这里把它做成了文档里的一等节点
 */
export type AiStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiBlock: {
      insertAiBlock: (attrs: { id: string; prompt: string; status?: AiStatus }) => ReturnType;
      appendToAiBlock: (id: string, text: string) => ReturnType;
      setAiBlockStatus: (id: string, status: AiStatus) => ReturnType;
    };
  }
}

export const AiBlock = Node.create({
  name: 'aiBlock',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-id'), renderHTML: a => ({ 'data-id': a.id }) },
      prompt: { default: '', parseHTML: el => el.getAttribute('data-prompt'), renderHTML: a => ({ 'data-prompt': a.prompt }) },
      status: { default: 'idle', parseHTML: el => el.getAttribute('data-status'), renderHTML: a => ({ 'data-status': a.status }) },
    };
  },

  parseHTML() { return [{ tag: 'div[data-ai-block]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ai-block': '', class: 'ai-block' }), 0];
  },

  addCommands() {
    return {
      insertAiBlock: attrs => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs: { status: 'streaming', ...attrs } }).run(),

      // 按 id 找节点(协作者可能同时在上方插入内容,位置会变,所以每次重新定位,不缓存 pos)
      appendToAiBlock: (id, text) => ({ tr, state, dispatch }) => {
        let found: { pos: number; size: number } | null = null;
        state.doc.descendants((node, pos) => {
          if (node.type.name === this.name && node.attrs.id === id) { found = { pos, size: node.nodeSize }; return false; }
          return true;
        });
        if (!found) return false;
        const { pos, size } = found as { pos: number; size: number };
        const endInside = pos + size - 1; // 节点闭合标签前
        if (dispatch) tr.insertText(text, endInside);
        return true;
      },

      setAiBlockStatus: (id, status) => ({ tr, state, dispatch }) => {
        let ok = false;
        state.doc.descendants((node, pos) => {
          if (node.type.name === this.name && node.attrs.id === id) {
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, status });
            ok = true; return false;
          }
          return true;
        });
        return ok;
      },
    };
  },
});
