import { Node, mergeAttributes } from '@tiptap/core';

/**
 * 引用块(inline atom):[n] 角标,带 docId / 页码 / 坐标 / 摘录。
 * 点击在侧栏展开来源(Editor 里用 handleClickOn 捕获)。对应 GeoGPT 的引用溯源:chunk 元数据 → 点击定位原文。
 */
export type CitationAttrs = { n: number; docId: string; page: number; bbox?: string; quote?: string; title?: string };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: { insertCitation: (attrs: CitationAttrs) => ReturnType };
  }
}

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    const attr = (name: string, def: any = null) => ({
      default: def,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
      renderHTML: (a: Record<string, any>) => (a[name] == null ? {} : { [`data-${name}`]: a[name] }),
    });
    return { n: attr('n', 1), docId: attr('docId', ''), page: attr('page', 1), bbox: attr('bbox'), quote: attr('quote', ''), title: attr('title', '') };
  },
  parseHTML() { return [{ tag: 'sup[data-citation]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-citation': '', class: 'citation', title: `${node.attrs.title || node.attrs.docId} · p.${node.attrs.page}` }), `[${node.attrs.n}]`];
  },
  addCommands() {
    return { insertCitation: attrs => ({ chain }) => chain().insertContent({ type: this.name, attrs }).insertContent(' ').run() };
  },
});
