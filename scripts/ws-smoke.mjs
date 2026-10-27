import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
const mk = (token) => { const doc = new Y.Doc(); const p = new WebsocketProvider('ws://localhost:1234', 'smoke', doc, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true }); return { doc, p }; };
const A = mk('w-alice'), B = mk('w-bob'), G = mk('r-guest');
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(600);
A.doc.getText('t').insert(0, 'hello ');
B.doc.getText('t').insert(0, 'world ');            // 并发
G.doc.getText('t').insert(0, 'GUEST ');            // 只读身份,应被服务端丢弃
await wait(800);
console.log('A:', JSON.stringify(A.doc.getText('t').toString()));
console.log('B:', JSON.stringify(B.doc.getText('t').toString()));
console.log('G:', JSON.stringify(G.doc.getText('t').toString()), '(本地有 GUEST,但不会同步给别人)');
console.log('A==B:', A.doc.getText('t').toString() === B.doc.getText('t').toString(), '| 含 GUEST?', A.doc.getText('t').toString().includes('GUEST'));
// 新客户端晚加入,只靠 step1/step2 补齐
const C = mk('w-alice'); await wait(800);
console.log('C(后加入):', JSON.stringify(C.doc.getText('t').toString()));
console.log('awareness peers seen by A:', A.p.awareness.getStates().size);
[A, B, G, C].forEach(x => x.p.destroy()); process.exit(0);
