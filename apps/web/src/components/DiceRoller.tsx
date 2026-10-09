import { useEffect, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { api } from "../api";
import type { DiceRoll } from "../../../../packages/contracts/index";

export function DiceAnimation({
  sides,
  results,
  rolling,
}: {
  sides: number;
  results: number[];
  rolling: boolean;
}) {
  const vertices =
    sides === 4
      ? 3
      : sides === 6
        ? 4
        : sides === 8
          ? 4
          : sides === 2
            ? 24
            : sides <= 12
              ? 5
              : 6;
  const points = Array.from({ length: vertices }, (_, i) => {
    const angle = (i * 2 * Math.PI) / vertices - Math.PI / 2;
    return `${50 + 43 * Math.cos(angle)},${50 + 43 * Math.sin(angle)}`;
  }).join(" ");
  return (
    <div
      className={`dice-tray ${rolling ? "is-rolling" : ""}`}
      aria-label={`${results.length} 颗 D${sides}`}
    >
      {results.map((value, i) => (
        <div
          className="poly-die"
          key={i}
          style={{ animationDelay: `${i * -0.09}s` }}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <polygon points={points} />
            <polygon
              className="die-inset"
              points={points}
              transform="translate(15 15) scale(.7)"
            />
          </svg>
          <strong style={{ fontSize: value > 99999 ? 12 : undefined }}>
            {rolling ? "…" : value}
          </strong>
          <small>D{sides}</small>
        </div>
      ))}
    </div>
  );
}
export function diceStorageKey(scope: string) {
  return `creation-dice:${scope}`;
}
export function DiceRoller({
  scope,
  purpose = "luck",
  sides = 6,
  count = 3,
  reduced = false,
  onReady,
}: {
  scope: string;
  purpose?: "luck" | "free";
  sides?: number;
  count?: number;
  reduced?: boolean;
  onReady?: (roll: DiceRoll) => void;
}) {
  const key = diceStorageKey(scope);
  const [receipt, setReceipt] = useState<DiceRoll | null>(null),
    [rolling, setRolling] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState(
    () => sessionStorage.getItem(key) ?? "",
  );
  const [restoring, setRestoring] = useState(!!pending);
  const alive = useRef(true),
    locked = useRef(false),
    ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const id = sessionStorage.getItem(key);
    if (id)
      void api<DiceRoll>(`/dice/rolls/${id}`)
        .then((r) => {
          if (!cancelled) {
            setReceipt(r);
            ready.current?.(r);
          }
        })
        .catch(() => {
          /* An unanswered request is retried with the same id on click. */
        })
        .finally(() => {
          if (!cancelled) setRestoring(false);
        });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [key]);
  async function roll() {
    if (restoring || locked.current || (receipt && purpose === "luck")) return;
    locked.current = true;
    setRolling(true);
    setError("");
    const id =
      receipt && purpose === "free"
        ? crypto.randomUUID()
        : pending || crypto.randomUUID();
    if (purpose === "free") setReceipt(null);
    sessionStorage.setItem(key, id);
    setPending(id);
    try {
      const [result] = await Promise.all([
        api<DiceRoll>("/dice/rolls", { id, purpose, sides, count }),
        new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 1000)),
      ]);
      if (alive.current) {
        setReceipt(result);
        ready.current?.(result);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "掷骰未完成，请重试。");
    } finally {
      locked.current = false;
      if (alive.current) setRolling(false);
    }
  }
  const shown = receipt ?? {
    sides,
    count,
    results: Array.from({ length: count }, () => 0),
    total: 0,
  };
  return (
    <section className="player-dice">
      <div className="player-dice-heading">
        <strong>
          {purpose === "luck" ? "幸运 · 3D6 × 5" : `${count}D${sides}`}
        </strong>
        <span>
          {rolling ? "骰子滚动中…" : receipt ? "结果已保存" : "由你掷出"}
        </span>
      </div>
      {(rolling || receipt) && (
        <DiceAnimation
          sides={shown.sides}
          results={shown.results}
          rolling={rolling}
        />
      )}
      <div role="status" aria-live="polite" className="roll-equation">
        {!rolling && receipt && (
          <>
            <span>
              {receipt.results.join(" + ")} = {receipt.total}
            </span>
            {purpose === "luck" && (
              <strong>
                幸运 {receipt.total} × 5 = {receipt.total * 5}
              </strong>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {(!receipt || purpose === "free") && (
        <button
          type="button"
          className="secondary-button full"
          disabled={rolling || restoring}
          onClick={() => void roll()}
        >
          <Dices size={18} />
          {restoring
            ? "读取已保存点数…"
            : rolling
              ? "正在掷骰…"
              : error || (pending && !receipt)
                ? "重试本次掷骰"
                : purpose === "luck"
                  ? "掷幸运骰"
                  : "掷骰子"}
        </button>
      )}
      {receipt && purpose === "luck" && (
        <small>本次点数已保存，确认角色时不会再次掷骰。</small>
      )}
    </section>
  );
}
export function DiceWorkbench({
  owner,
  reduced,
}: {
  owner: string;
  reduced: boolean;
}) {
  const [sides, setSides] = useState(20),
    [count, setCount] = useState(1),
    [spec, setSpec] = useState({ sides: 20, count: 1, sequence: 0 });
  return (
    <section className="dice-workbench">
      <h2>骰盘</h2>
      <p className="page-description">
        输入任意面数，查看每颗骰子的点数与总和。
      </p>
      <form
        className="dice-config"
        onSubmit={(e) => {
          e.preventDefault();
          setSpec({ sides, count, sequence: spec.sequence + 1 });
        }}
      >
        <label>
          骰子面数
          <input
            type="number"
            min={1}
            max={1_000_000_000}
            required
            value={sides}
            onChange={(e) => setSides(Number(e.target.value))}
          />
        </label>
        <label>
          骰子颗数
          <input
            type="number"
            min={1}
            max={100}
            required
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <button className="secondary-button">设置骰子</button>
      </form>
      <DiceRoller
        key={`${spec.sequence}`}
        scope={`${owner}:free:${spec.sides}:${spec.count}:${spec.sequence}`}
        purpose="free"
        sides={spec.sides}
        count={spec.count}
        reduced={reduced}
      />
    </section>
  );
}
