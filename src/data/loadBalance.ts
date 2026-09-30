// data/balance.json を読み込む唯一の入口。テストでは overrides でフィクスチャを差し替える。
import raw from '../../data/balance.json';
import type { Balance } from '../sim/balance';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? merge(cur, v as never) : v;
  }
  return out as T;
}

/** 感度チェック（scripts/mutation-check.mjs）専用: テスト実行時に balance をわざと壊すためのパッチ */
function mutationPatch(): DeepPartial<Balance> | undefined {
  const g = globalThis as { __CORE_CRUSH_BALANCE_MUTATION__?: DeepPartial<Balance> };
  return g.__CORE_CRUSH_BALANCE_MUTATION__;
}

export function loadBalance(overrides?: DeepPartial<Balance>): Balance {
  const base = merge(structuredClone(raw) as unknown as Balance, mutationPatch());
  return merge(base, overrides);
}
