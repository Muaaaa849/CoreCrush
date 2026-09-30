// BALANCE_MUTATION 環境変数（JSON）があれば balance に上書きする（感度チェック専用）
const m = process.env.BALANCE_MUTATION;
if (m) (globalThis as { __CORE_CRUSH_BALANCE_MUTATION__?: unknown }).__CORE_CRUSH_BALANCE_MUTATION__ = JSON.parse(m);
