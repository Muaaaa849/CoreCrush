// 箱キャラ試作（M1〜M2）: 人間 対 ボット、またはオンライン対戦（WebRTC・受け手権威）。sim を固定 60Hz で回し、描画は補間。
import { loadBalance } from '../data/loadBalance';
import { botInput, createBot, type Bot, type BotProfile } from '../bot/simpleBot';
import { forwardZ } from '../sim/court';
import { createWorld, stepWorld } from '../sim/world';
import { stepRecoverTicks } from '../sim/balance';
import { NO_INPUT, type PlayerInput, type Side, type SimEvent, type World } from '../sim/types';
import { OnlineSession } from '../net/session';
import { connect, type ConnectStatus, type WebRtcTransport } from '../net/webrtc';
import { KeyboardMouse } from '../input/keyboardMouse';
import { CameraRig, DEFAULT_CAMERA, type CameraSettings } from '../render/cameraRig';
import { ProtoView, faceStage } from '../render/protoView';

const TICK_MS = 1000 / 60;
/** オンラインで相手から何も届かないとき、警告を出すまでの秒数（表示のみ） */
const SILENCE_WARN_SEC = 3;
/** ビルド時の定数。false（Artifact 版）ではオンライン対戦のコードを含めない */
declare const __ONLINE__: boolean;
const ONLINE_ENABLED = typeof __ONLINE__ === 'undefined' ? true : __ONLINE__;

const BOTS: Record<string, BotProfile> = {
  easy: { holdMinTicks: 60, holdMaxTicks: 240, fakeChance: 0.1, catchChance: 0.15, parryChance: 0.15, stepChance: 0.05 },
  normal: { holdMinTicks: 30, holdMaxTicks: 180, fakeChance: 0.25, catchChance: 0.35, parryChance: 0.35, stepChance: 0.1 },
  hard: { holdMinTicks: 15, holdMaxTicks: 120, fakeChance: 0.35, catchChance: 0.3, parryChance: 0.6, stepChance: 0.05 },
  dummy: { holdMinTicks: 240, holdMaxTicks: 360, fakeChance: 0, catchChance: 0, parryChance: 0, stepChance: 0 },
};

const FACE_LABEL = { smile: 'SMILE', nervous: 'NERVOUS', angry: 'ANGRY', blink: 'ANGRY · 点滅', crack: 'CRACK' } as const;
const FACE_COLOR = { smile: '#35f2ff', nervous: '#ffd23f', angry: '#ff3b3b', blink: '#ff3b3b', crack: '#ffffff' } as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 保存できない環境 */
  }
}

async function main(): Promise<void> {
  const balance = loadBalance();
  const settings: CameraSettings = { ...DEFAULT_CAMERA, ...store<Partial<CameraSettings>>('cc.camera', {}) };
  let botLevel = store<string>('cc.bot', 'normal');
  let showFrames = false;

  let world!: World;
  let bot!: Bot;
  // 自分の側（ボット戦は 0。オンラインは部屋での役割）
  let ME: Side = 0;
  let FOE: Side = 1;
  let online: { session: OnlineSession; transport: WebRtcTransport } | null = null;
  let silenceShown = false;
  const foeName = () => (online ? '相手' : 'ボット');
  const rig = new CameraRig();
  const newMatch = () => {
    if (online) return; // オンラインの再戦は未対応（ページを再読み込み）
    ME = 0;
    FOE = 1;
    const seed = (performance.now() * 1000) >>> 0;
    world = createWorld(balance, { seed, stats: [{ attack: 5, defense: 5, agility: 5 }, { attack: 5, defense: 5, agility: 5 }] });
    bot = createBot(FOE, seed ^ 0x5bd1e995, BOTS[botLevel] ?? BOTS.normal!);
    rig.reset(ME);
    $('banner').textContent = '';
  };
  newMatch();

  const stage = $('stage');
  let view: ProtoView;
  try {
    view = await ProtoView.create(stage, balance);
  } catch (e) {
    const s = document.createElement('span');
    s.className = 'error';
    s.textContent = `描画を開始できませんでした: ${String(e)}`;
    $('status').replaceChildren(s);
    return;
  }
  const resize = () => view.resize(stage.clientWidth, stage.clientHeight);
  resize();
  window.addEventListener('resize', resize);

  const input = new KeyboardMouse(view.renderer.domElement);

  // --- メニュー ---
  const sens = $<HTMLInputElement>('sens');
  const fov = $<HTMLInputElement>('fov');
  const botSel = $<HTMLSelectElement>('bot');
  const syncSettings = () => {
    sens.value = String(settings.sensitivity);
    $('sensOut').textContent = settings.sensitivity.toFixed(1);
    fov.value = String(settings.fovTps);
    $('fovOut').textContent = String(settings.fovTps);
    botSel.value = botLevel;
  };
  syncSettings();
  rig.fov = settings.fovTps;
  sens.addEventListener('input', () => {
    settings.sensitivity = Number(sens.value);
    save('cc.camera', settings);
    syncSettings();
  });
  fov.addEventListener('input', () => {
    settings.fovTps = settings.fovFps = Number(fov.value);
    rig.fov = settings.fovTps;
    save('cc.camera', settings);
    syncSettings();
  });
  botSel.addEventListener('change', () => {
    botLevel = botSel.value;
    save('cc.bot', botLevel);
    bot.profile = BOTS[botLevel] ?? BOTS.normal!;
  });
  const start = async () => {
    try {
      await input.lock();
    } catch {
      $('status').textContent = 'マウスをロックできませんでした。もう一度クリックしてください。';
    }
  };
  $('play').addEventListener('click', () => void start());
  $('restart').addEventListener('click', () => {
    newMatch();
    void start();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = input.locked;
    $('menu').hidden = locked;
    $('hud').hidden = !locked && world.tick === 0;
    $('play').textContent = world.tick === 0 ? 'クリックで開始' : '再開';
  });
  input.onKey = (code) => {
    if (code === 'F3') {
      showFrames = !showFrames;
      $('frames').hidden = !showFrames;
    }
    if (code === 'KeyR' && world.phase === 'matchOver') {
      if (online) online.session.requestRematch();
      else newMatch();
    }
  };
  $('status').textContent = `描画: ${view.backend}　準備完了`;

  // --- 1 tick ぶんの人間の入力 ---
  const humanInput = (): PlayerInput => {
    const b = input.bindings;
    const kr = input.axis(b.left, b.right);
    const kf = input.axis(b.back, b.forward);
    // カメラ基準の移動 → ワールド → コート基準
    const fwd = rig.forward({ x: 0, y: 0, z: 0 });
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const rt = rig.right({ x: 0, y: 0, z: 0 });
    let wx = rt.x * kr + (fwd.x / fl) * kf;
    let wz = rt.z * kr + (fwd.z / fl) * kf;
    const l = Math.hypot(wx, wz);
    if (l > 1) {
      wx /= l;
      wz /= l;
    }
    const fz = forwardZ(ME);
    const e = input.takeEdges();
    return {
      moveRight: -wx * fz,
      moveForward: wz * fz,
      keyRight: kr,
      keyForward: kf,
      primary: e.primary,
      secondary: e.secondary,
      secondaryHeld: input.secondaryHeld,
      fake: e.fake,
      step: e.step,
      aimDir: rig.forward({ x: 0, y: 0, z: 0 }),
    };
  };

  // --- HUD ---
  const toast = (text: string, color: string) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.color = color;
    $('toasts').append(el);
    setTimeout(() => el.remove(), 900);
  };
  const who = (side: number) => (side === ME ? 'あなた' : foeName());
  const onEvent = (e: SimEvent) => {
    switch (e.kind) {
      case 'justCatch':
        toast(e.side === ME ? 'JUST CATCH!' : `${foeName()} ジャスト`, e.side === ME ? '#35f2ff' : '#ff2bd6');
        break;
      case 'catch':
        toast(e.side === ME ? 'CATCH' : `${foeName()} キャッチ`, e.side === ME ? '#35f2ff' : '#ff2bd6');
        break;
      case 'parry':
        toast(`${e.side === ME ? 'PARRY' : `${foeName()} 跳ね返し`} ${e.label} ${e.value.toFixed(1)} m/s`, '#ffe066');
        break;
      case 'whiffCatch':
        toast(`${who(e.side)} キャッチ空振り`, '#8f9ab2');
        break;
      case 'whiffParry':
        toast(`${who(e.side)} 跳ね返し空振り`, '#8f9ab2');
        break;
      case 'hit':
        toast(`${who(e.side)} 被弾 −${e.value.toFixed(0)}`, '#ff3b3b');
        break;
      case 'explosion':
        toast(`${who(e.side)} 爆発 −${e.value.toFixed(0)}`, '#ffffff');
        break;
      case 'homingCancelled':
        toast(e.side === ME ? '回避！' : `${foeName()} 回避`, '#e3e9f5');
        break;
      case 'roundEnd':
        $('banner').textContent = e.side === -1 ? '相打ち' : e.side === ME ? 'ROUND WIN' : 'ROUND LOSE';
        setTimeout(() => {
          if (world.phase !== 'matchOver') $('banner').textContent = '';
        }, 1800);
        break;
      case 'matchEnd':
        $('banner').textContent = e.side === ME ? 'YOU WIN — R でもう一度' : 'YOU LOSE — R でもう一度';
        break;
      default:
        break;
    }
  };
  const bar = (id: string, v: number) => ($(id).style.width = `${Math.max(0, Math.min(1, v)) * 100}%`);
  const updateHud = () => {
    const b = world.balance;
    const me = world.players[ME];
    const foe = world.players[FOE];
    const sec = world.ball.countTicks / b.tickHz;
    const st = faceStage(b, sec);
    const count = $('count');
    count.textContent = world.ball.freezeTicks > 0 ? '—' : sec.toFixed(1);
    count.style.color = FACE_COLOR[st];
    $('face').textContent = FACE_LABEL[st];
    $('face').style.color = FACE_COLOR[st];
    $('side').textContent = world.ball.side === ME ? '自陣にボール' : '相手コートにボール';
    $('winsMe').textContent = String(me.wins);
    $('winsFoe').textContent = String(foe.wins);
    bar('hpMe', me.hp / me.maxHp);
    bar('hpFoe', foe.hp / foe.maxHp);
    bar('meterMe', me.meter / b.meter.max);
    $('hpMeText').textContent = `HP ${Math.max(0, Math.ceil(me.hp))}`;
    $('hpFoeText').textContent = `HP ${Math.max(0, Math.ceil(foe.hp))}`;
    $('meterMeText').textContent = me.meter.toFixed(2);
    $('meterFoeText').textContent = foe.meter.toFixed(2);
    $('pip0').classList.toggle('on', me.stepPoints >= 1);
    $('pip1').classList.toggle('on', me.stepPoints >= 2);
    bar('recoverBar', me.stepRecoverProgress / stepRecoverTicks(b, me.stats.agility));
    // 相手コートにボールがあるときだけ光って進む（6.3）
    $('recover').classList.toggle('live', world.ball.side !== ME && me.stepPoints < b.step.maxPoints);
    if (showFrames) {
      const ball = world.ball;
      $('frames').textContent =
        `あなた  ${me.action} ${me.actionTick}/${me.actionLength || '-'}\n` +
        `${foeName()}  ${foe.action} ${foe.actionTick}/${foe.actionLength || '-'}\n` +
        `ボール  ${ball.mode} ${ball.kind} ${ball.speedMps.toFixed(1)}m/s 追尾:${ball.homing ? 'on' : 'off'} ラリー:${ball.rally}\n` +
        `カウント ${ball.countTicks}F 停止 ${ball.freezeTicks}F　描画 ${view.backend}` +
        (online?.session.peer ? `\n通信  往復 ${online.session.peer.rttMs < 0 ? '—' : `${Math.round(online.session.peer.rttMs)}ms`}` : '');
    }
  };

  // --- オンライン ---
  /** 1 tick 進める。試合がまだ始まっていなければ false */
  const stepOnline = (a: PlayerInput): boolean => {
    if (!online) return false;
    const s = online.session;
    s.pump();
    if (s.peer && s.peer.w !== world) {
      // 新しい試合（最初の試合・再戦）
      world = s.peer.w;
      rig.reset(ME);
      view.snapshot(world);
      view.snapshot(world);
      $('banner').textContent = '';
      $('onlineStatus').textContent = `対戦中（第${s.match + 1}試合・あなたは ${ME === 0 ? 'シアン' : 'マゼンタ'}）`;
    }
    const peer = s.peer;
    if (!peer) return false;
    peer.step(a);
    for (let i = 0; i < world.eventCount; i++) onEvent(world.events[i]!);
    view.snapshot(world);
    // 相手から一定時間なにも届かない（切断を検出できない経路もあるので時間でも見る）
    const silentSec = (world.tick - peer.lastHeardTick) / world.balance.tickHz;
    if (!online.transport.closed && world.tick > 3 * world.balance.tickHz && silentSec > SILENCE_WARN_SEC) {
      $('banner').textContent = `相手の応答がありません（${Math.floor(silentSec)}秒）`;
      silenceShown = true;
    } else if (silenceShown && silentSec <= SILENCE_WARN_SEC) {
      $('banner').textContent = '';
      silenceShown = false;
    }
    if (world.phase === 'matchOver' && s.localWants >= 0) {
      $('banner').textContent = s.remoteWants === s.localWants ? '再戦を開始します…' : '再戦を希望しました — 相手を待っています';
    } else if (world.phase === 'matchOver' && s.remoteWants >= 0) {
      $('banner').textContent = '相手が再戦を希望しています — R で再戦';
    }
    return true;
  };
  const STATUS_TEXT: Record<ConnectStatus, string> = {
    ice: '接続情報を取得中…', signaling: 'シグナリングに接続中…', waiting: '相手を待っています…', negotiating: '相手と接続中…', open: '接続しました',
  };
  if (!ONLINE_ENABLED) $('onlineBox').hidden = true;
  const serverIn = $<HTMLInputElement>('server');
  const roomIn = $<HTMLInputElement>('room');
  const q = new URLSearchParams(location.search);
  // Worker から配られたページ（workers.dev・ローカル）は同じオリジンがシグナリングサーバー
  const sameOrigin = /(\.workers\.dev|^localhost|^127\.0\.0\.1)$/.test(location.hostname) ? location.origin : '';
  serverIn.value = q.get('server') ?? store<string>('cc.server', sameOrigin);
  roomIn.value = q.get('room') ?? '';
  const joinOnline = async (room: string) => {
    if (!ONLINE_ENABLED) return;
    const server = serverIn.value.trim();
    if (!server) {
      $('onlineStatus').textContent = 'シグナリングサーバーの URL を入れてください';
      return;
    }
    save('cc.server', server);
    roomIn.value = room;
    $('join').setAttribute('disabled', '');
    $('create').setAttribute('disabled', '');
    try {
      const { transport, role } = await connect({ serverUrl: server, room, onStatus: (st) => ($('onlineStatus').textContent = `部屋 ${room}: ${STATUS_TEXT[st]}`) });
      ME = role;
      FOE = role === 0 ? 1 : 0;
      rig.reset(ME);
      online = { transport, session: new OnlineSession(transport, { balance, role, stats: [{ attack: 5, defense: 5, agility: 5 }, { attack: 5, defense: 5, agility: 5 }] }) };
      transport.onClose = () => {
        $('banner').textContent = '相手との接続が切れました — ページを再読み込みしてください';
      };
      $('onlineStatus').textContent = `部屋 ${room}: 接続しました。クリックで開始`;
      botSel.disabled = true;
      $('foeName').textContent = 'RIVAL';
      // 役割 1 はマゼンタ側。HUD の自分／相手の色を入れ替える
      if (role === 1) document.documentElement.classList.add('swapSides');
      $('restart').hidden = true;
    } catch (e) {
      $('onlineStatus').textContent = `接続できませんでした: ${e instanceof Error ? e.message : String(e)}`;
      $('join').removeAttribute('disabled');
      $('create').removeAttribute('disabled');
    }
  };
  $('create').addEventListener('click', () => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint8Array(5));
    void joinOnline(Array.from(r, (v) => abc[v % abc.length]).join(''));
  });
  $('join').addEventListener('click', () => {
    const room = roomIn.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(room)) {
      $('onlineStatus').textContent = '部屋コードは英数字4〜12文字です';
      return;
    }
    void joinOnline(room);
  });

  // --- ループ（固定 60Hz） ---
  const foePos = { x: 0, z: 0 };
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    if (input.locked) {
      const [dx, dy] = input.takeMouse();
      rig.look(dx, dy, settings);
      acc += dt;
      let steps = 0;
      while (acc >= TICK_MS && steps < 5) {
        const a = humanInput();
        if (online) {
          if (!stepOnline(a)) break;
        } else {
          const bIn = { ...botInput(world, bot) };
          stepWorld(world, [a, bIn]);
        }
        for (let i = 0; i < world.eventCount; i++) onEvent(world.events[i]!);
        view.snapshot(world);
        acc -= TICK_MS;
        steps++;
      }
      if (steps === 5) acc = 0;
    } else {
      input.takeMouse();
      // オンラインは一時停止できない（ロックが外れていても無入力で進める）
      if (online) {
        acc += dt;
        let steps = 0;
        while (acc >= TICK_MS && steps < 5) {
          if (!stepOnline({ ...NO_INPUT })) break;
          acc -= TICK_MS;
          steps++;
        }
        if (steps === 5) acc = 0;
      } else acc = 0;
    }
    const onlinePeer = online?.session.peer ?? null;
    const alpha = input.locked || onlinePeer ? acc / TICK_MS : 1;
    const me = world.players[ME];
    const pos = view.playerPos(ME, alpha);
    rig.update(dt, pos, CameraRig.wantsFps(me), input.secondaryHeld && me.holding, settings, balance);
    const foeDisplay = onlinePeer && onlinePeer.remoteDisplayPos(alpha, foePos) ? foePos : null;
    view.render(world, alpha, rig, ME, now, foeDisplay);
    updateHud();
    requestAnimationFrame(frame);
  };
  view.snapshot(world);
  view.snapshot(world);
  requestAnimationFrame(frame);
}

main().catch((e: unknown) => {
  const s = document.getElementById('status');
  if (s) s.textContent = `起動に失敗しました: ${String(e)}`;
});
