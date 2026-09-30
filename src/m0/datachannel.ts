// M0: DataChannel の往復（同一ページ内の2つの RTCPeerConnection をループバック接続）
// state: 非信頼（ordered:false, maxRetransmits:0）/ event: 信頼（既定）。GDD 11.2
// 実ネットワーク越しの計測はシグナリングができる M2 で行う。ここでは API とチャネル設定の妥当性を確認する。
const SEND_HZ = 60;
const DURATION_MS = 5000;
const PAYLOAD_BYTES = 100;

function publish(result: unknown): void {
  (window as unknown as { __benchResult: unknown }).__benchResult = result;
  const pre = document.getElementById('result');
  if (pre) pre.textContent = JSON.stringify(result, null, 2);
}

function waitOpen(ch: RTCDataChannel): Promise<void> {
  return ch.readyState === 'open' ? Promise.resolve() : new Promise((r) => ch.addEventListener('open', () => r(), { once: true }));
}

async function measure(a: RTCDataChannel, b: RTCDataChannel, label: string) {
  // b 側はそのまま送り返す（エコー）
  b.onmessage = (e) => b.send(e.data as ArrayBuffer);
  const sentAt = new Map<number, number>();
  const rtts: number[] = [];
  a.onmessage = (e) => {
    const seq = new DataView(e.data as ArrayBuffer).getUint32(0);
    const t = sentAt.get(seq);
    if (t !== undefined) rtts.push(performance.now() - t);
  };
  const total = (DURATION_MS / 1000) * SEND_HZ;
  for (let seq = 0; seq < total; seq++) {
    const buf = new ArrayBuffer(PAYLOAD_BYTES);
    new DataView(buf).setUint32(0, seq);
    sentAt.set(seq, performance.now());
    a.send(buf);
    await new Promise((r) => setTimeout(r, 1000 / SEND_HZ));
  }
  await new Promise((r) => setTimeout(r, 500));
  rtts.sort((x, y) => x - y);
  const pick = (p: number) => +(rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))] ?? NaN).toFixed(3);
  return { channel: label, sent: total, received: rtts.length, rttMedianMs: pick(0.5), rttP95Ms: pick(0.95) };
}

async function main(): Promise<void> {
  const config: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
  const pa = new RTCPeerConnection(config);
  const pb = new RTCPeerConnection(config);
  pa.onicecandidate = (e) => e.candidate && void pb.addIceCandidate(e.candidate);
  pb.onicecandidate = (e) => e.candidate && void pa.addIceCandidate(e.candidate);

  // negotiated で id を固定し、両側で同じチャネルを作る
  const mk = (pc: RTCPeerConnection) => ({
    state: pc.createDataChannel('state', { ordered: false, maxRetransmits: 0, negotiated: true, id: 0 }),
    event: pc.createDataChannel('event', { negotiated: true, id: 1 }),
  });
  const ca = mk(pa);
  const cb = mk(pb);
  for (const ch of [ca.state, ca.event, cb.state, cb.event]) ch.binaryType = 'arraybuffer';

  await pa.setLocalDescription(await pa.createOffer());
  await pb.setRemoteDescription(pa.localDescription!);
  await pb.setLocalDescription(await pb.createAnswer());
  await pa.setRemoteDescription(pb.localDescription!);
  await Promise.all([ca.state, ca.event, cb.state, cb.event].map(waitOpen));

  const results = [await measure(ca.state, cb.state, 'state(unreliable)'), await measure(ca.event, cb.event, 'event(reliable)')];
  publish({ userAgent: navigator.userAgent, mode: 'loopback', sendHz: SEND_HZ, payloadBytes: PAYLOAD_BYTES, results });
  pa.close();
  pb.close();
}

main().catch((e: unknown) => publish({ error: String(e) }));
