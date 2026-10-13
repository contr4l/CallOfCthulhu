import { useEffect, useRef, useState } from "react";
import { Coins, ShoppingBag } from "lucide-react";
import type {
  ShopState,
  ShopItemId,
} from "../../../../packages/contracts/shop";
import { api, ApiError } from "../api";
import { createUuid } from "../uuid";
import { useReading } from "../reading";
export function ShopLibrary({
  owner,
  onChange,
  resumeRun,
  onResume,
}: {
  owner: string;
  onChange: (state: ShopState) => void;
  resumeRun?: string | null;
  onResume: (id: string) => void;
}) {
  const { convert } = useReading();
  const [state, setState] = useState<ShopState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const key = `shop-purchase:${owner}`;
  const [pending, setPending] = useState<{
    requestId: string;
    itemId: ShopItemId | "unlock-static";
  } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  });
  async function refresh() {
    const next = await api<ShopState>("/shop");
    setState(next);
    onChange(next);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [owner]);
  async function buy(itemId: ShopItemId | "unlock-static") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const body = pending ?? { requestId: createUuid(), itemId };
    setPending(body);
    sessionStorage.setItem(key, JSON.stringify(body));
    try {
      const next = await api<ShopState>(
        body.itemId === "unlock-static" ? "/shop/unlocks" : "/shop/purchases",
        body.itemId === "unlock-static"
          ? { requestId: body.requestId, storyId: "alone-against-static" }
          : body,
      );
      setState(next);
      onChange(next);
      setPending(null);
      sessionStorage.removeItem(key);
      setNotice(
        body.itemId === "unlock-static"
          ? "《静躁独行》已永久解锁，可从剧本库开始。"
          : "购买成功，道具已存入账户。",
      );
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        sessionStorage.removeItem(key);
        await refresh().catch(() => {});
      }
      setError(e instanceof Error ? e.message : "购买失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="shop-library" aria-label={convert("余烬商店")}>
      <div className="shop-heading">
        <div>
          <h2>
            <ShoppingBag size={24} />
            {convert("余烬商店")}
          </h2>
          <p>{convert("余烬点可在成就页领取。")}</p>
        </div>
        <strong className="point-balance">
          <Coins size={22} />
          {convert(`余烬点 ${state?.balance ?? 0}`)}
        </strong>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {convert(error)}
        </p>
      )}
      {notice && <p role="status">{convert(notice)}</p>}
      {!state && !error && <p role="status">{convert("正在打开商店…")}</p>}
      {pending && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void buy(pending.itemId)}
        >
          {convert("重试上次购买")}
        </button>
      )}
      {state && (
        <article className="shop-item" aria-label={convert("解锁静躁独行")}>
          <h3>{convert("静躁独行 · 永久解锁")}</h3>
          <p>
            {convert(
              `向火独行不同结局 ${state.storyUnlock.completedEndings} / ${state.storyUnlock.requiredEndings} · 解锁 ${state.storyUnlock.price} 点`,
            )}
          </p>
          <button
            className="primary-button"
            disabled={
              busy ||
              !!pending ||
              state.storyUnlock.unlocked ||
              state.storyUnlock.completedEndings <
                state.storyUnlock.requiredEndings ||
              state.balance < state.storyUnlock.price
            }
            onClick={() => void buy("unlock-static")}
          >
            {convert(state.storyUnlock.unlocked ? "已解锁" : "解锁静躁独行")}
          </button>
        </article>
      )}
      <div className="shop-grid">
        {state?.items.map((item) => (
          <article className="shop-item" key={item.id}>
            <h3>{convert(item.title)}</h3>
            <p>{convert(item.description)}</p>
            <p>
              {convert(
                `持有 ${state.inventory[item.id]} · 售价 ${item.price} 点`,
              )}
            </p>
            <button
              className="primary-button"
              disabled={busy || !!pending || state.balance < item.price}
              onClick={() => void buy(item.id)}
            >
              {convert(`购买${item.title}`)}
            </button>
          </article>
        ))}
      </div>
      <p className="setup-note">
        {convert(
          "重掷：确认结果前使用。命运助力：掷骰前使用。仅适用于普通 D100 检定。",
        )}
      </p>
      {resumeRun && (
        <button
          className="secondary-button"
          onClick={() => onResume(resumeRun)}
        >
          {convert("返回待确认的检定")}
        </button>
      )}
    </section>
  );
}
