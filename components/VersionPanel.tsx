'use client';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { AiBlock } from '@/extensions/AiBlock';
import { Citation } from '@/extensions/Citation';
import { StructuredBlock } from '@/extensions/StructuredBlock';

/** 只读渲染某个历史版本:把版本的 ProseMirror JSON 喂给一个不可编辑的编辑器实例,和正文同一套节点 */
export default function VersionPanel({ json, ts, onClose }: { json: any; ts: string; onClose: () => void }) {
  const editor = useEditor({ editable: false, extensions: [StarterKit, AiBlock, Citation, StructuredBlock], content: json }, [json]);
  return (
    <aside className="side">
      <div className="side-head"><b>版本 {new Date(Number(ts)).toLocaleString()}</b><button onClick={onClose}>关闭</button></div>
      <div className="side-body"><EditorContent editor={editor} /></div>
    </aside>
  );
}
