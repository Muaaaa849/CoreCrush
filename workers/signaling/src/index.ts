// CORE-CRUSH シグナリング Worker（GDD 11.1、netcode 規則）
// - GET  /room/:code  WebSocket。部屋コード1つ＝Durable Object 1つ。2人までの中継だけ（SDP/ICE の中身は見ない）
// - POST /ice         短命の TURN 資格情報つき ICE サーバー一覧。TURN のトークンは Worker の secret のみ
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const ROOM_CODE = /^[A-Z0-9]{4,12}$/;
const STUN_ONLY = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] };
/** TURN 資格情報の有効期間（1試合より十分長く） */
const TURN_TTL_SEC = 4 * 60 * 60;
/** 1メッセージの上限（SDP は数 KB） */
const MAX_MESSAGE_BYTES = 64 * 1024;

function allowOrigin(env: Env, origin: string | null): string | null {
  if (!origin) return null;
  const list = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (list.includes('*')) return origin;
  return list.includes(origin) ? origin : null;
}

function cors(env: Env, req: Request, res: Response): Response {
  const o = allowOrigin(env, req.headers.get('Origin'));
  if (!o) return res;
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', o);
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

async function iceServers(env: Env): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return Response.json(STUN_ONLY);
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TURN_TTL_SEC }),
  });
  if (!r.ok) return Response.json(STUN_ONLY); // TURN が使えなくても STUN だけで試せるようにする
  const body = (await r.json()) as { iceServers: { urls: string | string[] }[] };
  // ポート 53 はブラウザで塞がれていてタイムアウトの原因になる（Cloudflare の注意書き）
  for (const s of body.iceServers) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    s.urls = urls.filter((u) => !/:53(\?|$)/.test(u));
  }
  return Response.json(body);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return cors(env, req, new Response(null, { status: 204 }));
    if (url.pathname === '/ice' && req.method === 'POST') return cors(env, req, await iceServers(env));
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const code = decodeURIComponent(m[1]!).toUpperCase();
      if (!ROOM_CODE.test(code)) return new Response('bad room code', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (req.headers.get('Origin') && !allowOrigin(env, req.headers.get('Origin'))) return new Response('forbidden origin', { status: 403 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (url.pathname === '/') return new Response('core-crush signaling');
    return new Response('not found', { status: 404 });
  },
};

/**
 * 部屋。WebSocket Hibernation API で待機中の課金を抑える。
 * 送るもの: {type:'joined', role} / {type:'peer-joined'} / {type:'peer-left'} / {type:'full'}、それ以外は相手へそのまま中継
 */
export class Room extends DurableObject<Env> {
  async fetch(_req: Request): Promise<Response> {
    const sockets = this.ctx.getWebSockets();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (sockets.length >= 2) {
      server.accept();
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4001, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const used = new Set(sockets.map((s) => (s.deserializeAttachment() as { role: number }).role));
    const role = used.has(0) ? 1 : 0;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role });
    server.send(JSON.stringify({ type: 'joined', role, peers: sockets.length }));
    for (const s of sockets) s.send(JSON.stringify({ type: 'peer-joined' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) return;
    for (const s of this.ctx.getWebSockets()) if (s !== ws) s.send(message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    for (const s of this.ctx.getWebSockets()) if (s !== ws) s.send(JSON.stringify({ type: 'peer-left' }));
  }
}
