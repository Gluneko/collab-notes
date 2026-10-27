/**
 * 最小 Markdown ⇄ TipTap JSON。覆盖:标题、段落、无序 / 有序列表、围栏代码、粗体 / 斜体 / 行内代码。
 * 不追求完整 CommonMark,目标是“粘贴一段 Markdown 变成节点、导出一份能读的 Markdown”。
 */
type J = { type: string; attrs?: Record<string, any>; content?: J[]; text?: string; marks?: { type: string }[] };

export function looksLikeMarkdown(text: string) {
  return /^(#{1,6}\s|[-*]\s|\d+\.\s|```)/m.test(text) || /\*\*[^*]+\*\*|`[^`]+`/.test(text);
}

export function markdownToJSON(md: string): J {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const content: J[] = [];
  let i = 0;
  const para: string[] = [];
  const flushPara = () => { if (para.length) { content.push({ type: 'paragraph', content: inline(para.join(' ')) }); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if ((m = /^```(\w*)\s*$/.exec(line))) {                                 // 围栏代码
      flushPara(); const buf: string[] = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; content.push({ type: 'codeBlock', attrs: { language: m[1] || null }, content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : [] }); continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); content.push({ type: 'heading', attrs: { level: m[1].length }, content: inline(m[2]) }); i++; continue; }
    if (/^[-*]\s+/.test(line)) {                                            // 无序列表
      flushPara(); const items: J[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(lines[i++].replace(/^[-*]\s+/, '')) }] });
      content.push({ type: 'bulletList', content: items }); continue;
    }
    if (/^\d+\.\s+/.test(line)) {                                           // 有序列表
      flushPara(); const items: J[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(lines[i++].replace(/^\d+\.\s+/, '')) }] });
      content.push({ type: 'orderedList', content: items }); continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushPara();
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** 行内:**bold**、*italic*、`code` */
function inline(text: string): J[] {
  const out: J[] = []; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const s = m[0];
    if (s.startsWith('**')) out.push({ type: 'text', text: s.slice(2, -2), marks: [{ type: 'bold' }] });
    else if (s.startsWith('`')) out.push({ type: 'text', text: s.slice(1, -1), marks: [{ type: 'code' }] });
    else out.push({ type: 'text', text: s.slice(1, -1), marks: [{ type: 'italic' }] });
    last = m.index + s.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter(n => n.text !== '');
}

export function jsonToMarkdown(doc: J): string {
  const blocks = (doc.content ?? []).map(n => block(n)).filter(Boolean);
  return blocks.join('\n\n') + '\n';
}
function block(n: J, depth = 0): string {
  const pad = '  '.repeat(depth);
  switch (n.type) {
    case 'heading': return `${'#'.repeat(n.attrs?.level ?? 1)} ${inl(n)}`;
    case 'paragraph': return pad + inl(n);
    case 'codeBlock': return `\`\`\`${n.attrs?.language ?? ''}\n${inl(n)}\n\`\`\``;
    case 'bulletList': return (n.content ?? []).map(li => `${pad}- ${li.content?.map(c => block(c, depth + 1).trimStart()).join('\n')}`).join('\n');
    case 'orderedList': return (n.content ?? []).map((li, i) => `${pad}${i + 1}. ${li.content?.map(c => block(c, depth + 1).trimStart()).join('\n')}`).join('\n');
    case 'blockquote': return (n.content ?? []).map(c => `> ${block(c)}`).join('\n');
    case 'aiBlock': return `> **AI(${n.attrs?.status})** ${inl(n)}`;
    case 'structuredBlock': return `\`\`\`json\n${JSON.stringify({ type: n.attrs?.type, ...safeJSON(n.attrs?.payload) }, null, 2)}\n\`\`\``;
    case 'horizontalRule': return '---';
    default: return inl(n);
  }
}
function inl(n: J): string {
  return (n.content ?? []).map(c => {
    if (c.type === 'text') { let t = c.text ?? ''; for (const m of c.marks ?? []) { if (m.type === 'bold') t = `**${t}**`; if (m.type === 'italic') t = `*${t}*`; if (m.type === 'code') t = `\`${t}\``; } return t; }
    if (c.type === 'citation') return `[${c.attrs?.n}]`;
    if (c.type === 'hardBreak') return '\n';
    return inl(c);
  }).join('');
}
const safeJSON = (s: any) => { try { return JSON.parse(s); } catch { return {}; } };
