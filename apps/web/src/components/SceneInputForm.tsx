import React, { useState } from "react";
import type { SceneInput } from "../../../../packages/contracts/program";
export function SceneInputForm({
  input,
  busy,
  onSubmit,
}: {
  input: SceneInput;
  busy: boolean;
  onSubmit: (action: string, input: Record<string, number | string>) => void;
}) {
  const a = input.kind === "allocation" ? input.allocation : undefined;
  const allowed =
    input.kind === "allocation"
      ? input.skills.filter(
          (s) => !["cthulhuMythos", "creditRating"].includes(s.key),
        )
      : [];
  const initialKeys =
    a?.kind === "attributes"
      ? allowed.map((s) => s.key)
      : a?.kind === "occupation"
        ? [
            ...(a.required ?? []),
            ...(a.optional?.length ? [a.optional[0]] : []),
            ...allowed
              .filter(
                (s) =>
                  !(a.required ?? []).includes(s.key) &&
                  !(a.optional ?? []).includes(s.key),
              )
              .slice(0, a.extra ?? 0)
              .map((s) => s.key),
          ]
        : allowed.slice(0, 4).map((s) => s.key);
  const [keys, setKeys] = useState(initialKeys);
  const [values, setValues] = useState(
    a?.values ?? (a?.kind === "interests" ? [20, 20, 20, 20] : []),
  );
  const [amount, setAmount] = useState(input.kind === "number" ? input.min : 0);
  return (
    <form
      className="rule-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          input.kind === "number" ? "confirm" : "allocate",
          input.kind === "number"
            ? { value: amount }
            : Object.fromEntries(keys.map((k, i) => [k, values[i]])),
        );
      }}
    >
      {input.kind === "number" ? (
        <label>
          {input.label}
          <input
            type="number"
            min={input.min}
            max={input.max}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </label>
      ) : (
        <>
          <p>
            {a!.kind === "attributes"
              ? "将 40、50、50、50、60、60、70、80 分配给八项属性。"
              : a!.kind === "occupation"
                ? "分配 70、60、60、50、50、50、40、40；每项技能只能选择一次。"
                : "选择四项非职业技能，每项增加 20。"}
          </p>
          {keys.map((key, i) => (
            <div className="allocation-row" key={i}>
              {a!.kind === "attributes" ? (
                <label htmlFor={`allocation-${i}`}>
                  {allowed.find((s) => s.key === key)?.label}
                </label>
              ) : (
                <select
                  aria-label={`技能 ${i + 1}`}
                  value={key}
                  onChange={(e) =>
                    setKeys(keys.map((k, j) => (j === i ? e.target.value : k)))
                  }
                >
                  {allowed.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}（当前 {s.value}）
                    </option>
                  ))}
                </select>
              )}
              <select
                id={`allocation-${i}`}
                aria-label={`点值 ${i + 1}`}
                value={values[i]}
                disabled={a!.kind === "interests"}
                onChange={(e) =>
                  setValues(
                    values.map((v, j) =>
                      j === i ? Number(e.target.value) : v,
                    ),
                  )
                }
              >
                {[...new Set(a!.values ?? [20])].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </>
      )}
      <button className="primary-button" disabled={busy}>
        确认分配
      </button>
    </form>
  );
}
