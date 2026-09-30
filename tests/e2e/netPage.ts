// e2e: 実際の WebRTC（ローカルのシグナリング経由）で2ページがボット対戦し、確定イベントログを返す
import { DEFAULT_BOT, botInput, createBot } from '../../src/bot/simpleBot';
import { loadBalance } from '../../src/data/loadBalance';
import { OnlineSession } from '../../src/net/session';
import { connect } from '../../src/net/webrtc';
import { logKey, MEDIAN } from '../net/harness';

declare global {
  interface Window {
    __result?: { role: number; log: string; winner: number; rounds: string; ticks: number } | { error: string };
  }
}

const q = new URLSearchParams(location.search);
const server = q.get('server') ?? 'http://localhost:8787';
const room = q.get('room') ?? 'E2E';
const status = document.getElementById('status')!;

async function main(): Promise<void> {
try {
  const { transport, role } = await connect({ serverUrl: server, room, onStatus: (s) => (status.textContent = s) });
  const balance = loadBalance();
  const session = new OnlineSession(transport, { balance, role, stats: [MEDIAN, MEDIAN] });
  const bot = createBot(role, 100 + role, DEFAULT_BOT);
  let ticks = 0;
  let after = 0;
  const rounds: number[] = [];
  const timer = setInterval(() => {
    for (let k = 0; k < 4; k++) {
      session.pump();
      const peer = session.peer;
      if (!peer) return;
      peer.step(botInput(peer.w, bot));
      ticks++;
      for (let i = 0; i < peer.w.eventCount; i++) if (peer.w.events[i]!.kind === 'roundEnd') rounds.push(peer.w.events[i]!.side);
      if (peer.w.phase === 'matchOver' && ++after > 600) {
        clearInterval(timer);
        const w = peer.w;
        const winner = w.players[0].wins > w.players[1].wins ? 0 : 1;
        window.__result = { role, log: logKey(peer), winner, rounds: rounds.join(','), ticks };
        return;
      }
    }
  }, 16);
} catch (e) {
  window.__result = { error: String(e) };
}
}
void main();
