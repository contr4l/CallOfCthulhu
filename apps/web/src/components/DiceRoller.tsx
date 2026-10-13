import { createUuid } from "../uuid";
import { useEffect, useId, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { api } from "../api";
import type { DiceRoll } from "../../../../packages/contracts/index";

export function DiceAnimation({
  sides,
  results,
  rolling,
  reduced = false,
  onComplete,
}: {
  sides: number;
  results: number[];
  rolling: boolean;
  reduced?: boolean;
  onComplete?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const id = `dice-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ready = useRef(onComplete);
  ready.current = onComplete;
  const [state, setState] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const supported =
    [4, 6, 8, 10, 12, 20, 100].includes(sides) &&
    results.length * (sides === 100 ? 2 : 1) <= 20;
  const signature = results.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const animate = rolling && !reduced && !media.matches;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const complete = () => {
      if (!controller.signal.aborted && rolling) ready.current?.();
    };
    setState("loading");
    if (!results.every((value) => value > 0)) return;
    if (!supported) {
      setState("fallback");
      timer = setTimeout(complete, animate ? 1200 : 0);
    } else {
      void import("./DiceScene")
        .then(({ createDiceScene }) => {
          if (controller.signal.aborted || !host.current) return;
          return createDiceScene(
            host.current,
            sides,
            results,
            animate,
            () => {
              setState("ready");
              complete();
            },
            controller.signal,
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState("fallback");
            complete();
          }
        });
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // A roll's scene stays mounted when its parent reveals the result.
    // New receipts (including the pending zero values) start a new scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides, signature, reduced, supported]);
  return (
    <div
      className={`dice-tray ${rolling ? "is-rolling" : ""}`}
      aria-label={`${results.length} 颗 D${sides}`}
      data-renderer={state}
    >
      {supported && (
        <div className="dice-scene" ref={host} id={id} aria-hidden="true" />
      )}
      {state === "loading" && (
        <span className="dice-scene-note">
          {rolling ? "骰子正在落入骰盘…" : "正在摆放骰子…"}
        </span>
      )}
      <div className="dice-values">
        {results.map((value, i) => (
          <div className="poly-die" key={i}>
            <strong style={{ fontSize: value > 99999 ? 12 : undefined }}>
              {rolling ? "…" : value}
            </strong>
            <small>D{sides}</small>
          </div>
        ))}
      </div>
      {sides === 100 && supported && (
        <small className="dice-percentile-note">
          十位骰 + 个位骰 · 00 与 0 合计为 100
        </small>
      )}
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
      receipt && purpose === "free" ? createUuid() : pending || createUuid();
    if (purpose === "free") setReceipt(null);
    sessionStorage.setItem(key, id);
    setPending(id);
    try {
      const result = await api<DiceRoll>("/dice/rolls", {
        id,
        purpose,
        sides,
        count,
      });
      if (alive.current) {
        setReceipt(result);
      }
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "掷骰未完成，请重试。");
        setRolling(false);
      }
    } finally {
      locked.current = false;
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
        <span>{rolling ? "掷骰中…" : ""}</span>
      </div>
      {(rolling || receipt) && (
        <DiceAnimation
          sides={shown.sides}
          results={shown.results}
          rolling={rolling}
          reduced={reduced}
          onComplete={() => {
            setRolling(false);
            if (receipt) ready.current?.(receipt);
          }}
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
