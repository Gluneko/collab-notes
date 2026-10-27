/**
 * 最小 SSE 客户端:POST + ReadableStream 解析 `data:` 行,支持 AbortSignal。
 * 和 GeoGPT 的 fetchEventSource 用法同构:这里只处理 token 事件,断线续传(seq / uniqueId)留作扩展点。
 */
export async function* streamAi(url: string, body: unknown, signal: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new Error(`AI 接口 ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try { const j = JSON.parse(data); if (typeof j.token === 'string') yield j.token; } catch { /* 忽略坏帧 */ }
      }
    }
  }
}
