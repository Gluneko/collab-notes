'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { AiBlock } from '@/extensions/AiBlock';
import { Citation, type CitationAttrs } from '@/extensions/Citation';
import { StructuredBlock } from '@/extensions/StructuredBlock';
import { streamAi } from '@/lib/ai-stream';
import { jsonToMarkdown, looksLikeMarkdown, markdownToJSON } from '@/lib/markdown';
import SlashMenu from './SlashMenu';
import VersionPanel from './VersionPanel';

const WS_URL = process.env.NEXT_PUBLIC_SYNC_WS ?? 'ws://localhost:1234';
const HTTP_URL = process.env.NEXT_PUBLIC_SYNC_HTTP ?? 'http://localhost:1234';

type Props = { room: string; token: string; user: { name: string; color: string } };

/**
 * 协同编辑器:三层
 *  1. Y.Doc 是唯一真相源;TipTap 通过 Collaboration 扩展把 ProseMirror 文档映射到 Y.XmlFragment
 *  2. 两个 provider 同时挂:IndexedDB(离线本地持久化)+ WebSocket(多端同步)。断网照常编辑,恢复后自动合并
 *  3. 撤销走 Y.UndoManager(Collaboration 内置),只追踪本地 origin → 不会撤掉别人的改动
 */
export default function Editor({ room, token, user }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const provider = useMemo(() => new WebsocketProvider(WS_URL, room, ydoc, { params: { token } }), [ydoc, room, token]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [synced, setSynced] = useState(false);
  const readonly = token.startsWith('r-');
  const [peers, setPeers] = useState(0);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState<{ ts: string; json: any } | null>(null);
  const [citation, setCitation] = useState<CitationAttrs | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const idb = new IndexeddbPersistence(`collab-notes:${room}`, ydoc);
    idb.whenSynced.then(() => setSynced(true));
    provider.on('status', (e: { status: typeof status }) => setStatus(e.status));
    const onAwareness = () => setPeers(provider.awareness.getStates().size);
    provider.awareness.on('change', onAwareness);
    return () => { provider.awareness.off('change', onAwareness); provider.destroy(); idb.destroy(); ydoc.destroy(); };
  }, [provider, ydoc, room]);

  const editor = useEditor({
    editable: !readonly,
    extensions: [
      StarterKit.configure({ history: false }),      // 本地 history 关掉,交给 Yjs UndoManager
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({ provider, user }),
      Placeholder.configure({ placeholder: '输入 / 唤起菜单;粘贴 Markdown 会自动转成节点' }),
      AiBlock, Citation, StructuredBlock,
    ],
    editorProps: {
      // 粘贴:像 Markdown 就转成节点,否则走默认
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (!text || !looksLikeMarkdown(text)) return false;
        editor?.chain().focus().insertContent(markdownToJSON(text).content as any).run();
        return true;
      },
      // 点击引用角标 → 侧栏展开来源
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === 'citation') { setCitation(node.attrs as CitationAttrs); return true; }
        return false;
      },
    },
  });

  // ---- AI 续写:SSE 逐 token 以 Yjs 事务写入 aiBlock,其他端实时看到 ----
  const runAi = async () => {
    if (!editor) return;
    const prompt = window.prompt('让 AI 续写什么?', '用三句话解释 CRDT'); if (!prompt) return;
    const id = `ai-${Date.now().toString(36)}`;
    editor.chain().focus().insertAiBlock({ id, prompt, status: 'streaming' }).run();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      for await (const tok of streamAi(`${HTTP_URL}/ai`, { prompt }, ctrl.signal)) editor.commands.appendToAiBlock(id, tok);
      editor.commands.setAiBlockStatus(id, 'done');
    } catch (e: any) { editor.commands.setAiBlockStatus(id, e?.name === 'AbortError' ? 'cancelled' : 'error'); }
    finally { abortRef.current = null; }
  };

  // ---- 版本:服务端 update 日志 + 快照;预览用临时 Y.Doc 转成 JSON 只读渲染 ----
  const loadVersions = async () => setVersions(await (await fetch(`${HTTP_URL}/versions?room=${encodeURIComponent(room)}`)).json());
  const takeSnapshot = async () => { await fetch(`${HTTP_URL}/snapshot?room=${encodeURIComponent(room)}&token=${token}`, { method: 'POST' }); loadVersions(); };
  const previewVersion = async (ts: string) => {
    const buf = new Uint8Array(await (await fetch(`${HTTP_URL}/version?room=${encodeURIComponent(room)}&ts=${ts}`)).arrayBuffer());
    const tmp = new Y.Doc(); Y.applyUpdate(tmp, buf);
    setVersion({ ts, json: yXmlFragmentToProsemirrorJSON(tmp.getXmlFragment('default')) });
  };
  const exportMd = () => {
    if (!editor) return;
    const md = jsonToMarkdown(editor.getJSON() as any);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `${room}.md`; a.click();
  };

  return (
    <div className={`layout ${version || citation ? 'with-side' : ''}`}>
      <div>
        <div className="bar">
          <span className={`dot ${status === 'connected' ? 'on' : 'off'}`} /> {status}
          <span>· 本地 {synced ? '已恢复' : '恢复中'}</span>
          <span>· 在线 {peers}</span>
          <span>· 你是 <b style={{ color: user.color }}>{user.name}</b>{readonly ? '(只读)' : ''}</span>
          <span style={{ marginLeft: 'auto' }} />
          <button onClick={() => editor?.chain().focus().undo().run()} disabled={readonly}>撤销(只撤自己)</button>
          <button onClick={() => editor?.chain().focus().redo().run()} disabled={readonly}>重做</button>
          <button onClick={runAi} disabled={readonly}>AI 续写</button>
          <button onClick={() => abortRef.current?.abort()}>停止</button>
          <button onClick={takeSnapshot} disabled={readonly}>打快照</button>
          <button onClick={loadVersions}>版本</button>
          <button onClick={exportMd}>导出 Markdown</button>
          <button onClick={() => (provider.shouldConnect ? provider.disconnect() : provider.connect())}>{status === 'connected' ? '模拟断网' : '重连'}</button>
        </div>
        {readonly && <div className="readonly-banner">只读身份:服务端会丢弃你发出的更新,你仍能实时看到别人的编辑。</div>}
        <div className="paper"><EditorContent editor={editor} /><SlashMenu editor={editor} /></div>
        {versions.length > 0 && (
          <div className="versions">版本:{versions.map(v => <button key={v} onClick={() => previewVersion(v)}>{new Date(Number(v)).toLocaleTimeString()}</button>)}</div>
        )}
      </div>
      {version && <VersionPanel json={version.json} ts={version.ts} onClose={() => setVersion(null)} />}
      {citation && !version && (
        <aside className="side">
          <div className="side-head"><b>来源 [{citation.n}]</b><button onClick={() => setCitation(null)}>关闭</button></div>
          <div className="side-body">
            <p><b>{citation.title || citation.docId}</b></p>
            <p className="muted">docId {citation.docId} · 第 {citation.page} 页{citation.bbox ? ` · 坐标 ${citation.bbox}` : ''}</p>
            <blockquote>{citation.quote || '(无摘录)'}</blockquote>
            <p className="muted">生产里这里会打开 PDF 并按坐标高亮原文。</p>
          </div>
        </aside>
      )}
    </div>
  );
}
