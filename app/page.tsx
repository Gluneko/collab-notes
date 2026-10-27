'use client';
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';

// 编辑器依赖 window(IndexedDB / WebSocket),只在客户端渲染
const Editor = dynamic(() => import('@/components/Editor'), { ssr: false });

const COLORS = ['#0a84ff', '#ff9f0a', '#34c759', '#ff2d55', '#af52de', '#5ac8fa'];

export default function Page() {
  const [room, setRoom] = useState('demo');
  const [token, setToken] = useState('w-alice');
  const user = useMemo(() => {
    const name = token.replace(/^[wr]-/, '') || 'anon';
    const color = COLORS[Math.abs(hash(name)) % COLORS.length];
    return { name, color };
  }, [token]);

  return (
    <div className="shell">
      <div className="bar">
        <strong style={{ color: '#1c1c1e' }}>Collab Notes</strong>
        <label>房间 <input value={room} onChange={e => setRoom(e.target.value)} style={{ width: 90 }} /></label>
        <label>身份
          <select value={token} onChange={e => setToken(e.target.value)}>
            <option value="w-alice">alice(写)</option>
            <option value="w-bob">bob(写)</option>
            <option value="r-guest">guest(只读)</option>
          </select>
        </label>
        <span style={{ marginLeft: 'auto' }}>开两个 tab,选不同身份,同时编辑</span>
      </div>
      {/* key 变化时整体重建编辑器与连接 */}
      <Editor key={`${room}:${token}`} room={room} token={token} user={user} />
    </div>
  );
}

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
