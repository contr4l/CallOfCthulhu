import React, { useState, useEffect } from "react";
import type { SceneInput } from "../../../../packages/contracts/program";
export function SceneInputForm({
  input,
  draftKey,
  busy,
  onSubmit,
}: {
  input: SceneInput;
  draftKey?: string;
  busy: boolean;
  onSubmit: (action: string, input: Record<string, number | string>) => void;
}) {
  const a = input.kind === "allocation" ? input.allocation : undefined;
  const allowed =
    input.kind === "allocation"
      ? input.skills.filter(
          (s) =>
            s.key !== "cthulhuMythos" &&
            (s.key !== "creditRating" || a?.includeCredit),
        )
      : [];
  const initialKeys =
    a?.kind === "attributes"
      ? allowed.map((s) => s.key)
      : a?.kind === "occupation"
        ? [
            ...(a.required ?? []),
            ...(a.includeCredit ? ["creditRating"] : []),
            ...(a.optional?.length ? [a.optional[0]] : []),
            ...(a.groups ?? []).map((g) => g[0]),
            ...allowed
              .filter(
                (s) =>
                  s.key !== "creditRating" &&
                  !(a.required ?? []).includes(s.key) &&
                  !(a.optional ?? []).includes(s.key) &&
                  !(a.groups ?? []).flat().includes(s.key),
              )
              .slice(0, a.extra ?? 0)
              .map((s) => s.key),
          ]
        : a?.kind === "bonus"
          ? allowed.map((s) => s.key)
          : allowed.slice(0, a?.count ?? 4).map((s) => s.key);
  let draft: {
    keys?: string[];
    values?: number[];
    amount?: number;
    specialties?: Record<string, string>;
  } = {};
  try {
    draft = JSON.parse(sessionStorage.getItem(draftKey ?? "") ?? "{}");
    if (!draft || typeof draft !== "object") draft = {};
  } catch {
    /* Ignore an invalid local draft. */
  }
  const validDraftKeys =
    Array.isArray(draft.keys) &&
    draft.keys.length === initialKeys.length &&
    draft.keys.every((k) => allowed.some((s) => s.key === k));
  const [keys, setKeys] = useState(validDraftKeys ? draft.keys! : initialKeys);
  const [values, setValues] = useState(
    Array.isArray(draft.values) &&
      draft.values.length === initialKeys.length &&
      draft.values.every((v) => typeof v === "number")
      ? draft.values
      : (a?.values ??
          Array(initialKeys.length).fill(a?.kind === "interests" ? 20 : 0)),
  );
  const [specialties, setSpecialties] = useState<Record<string, string>>(
    draft.specialties && typeof draft.specialties === "object"
      ? draft.specialties
      : {},
  );
  const [amount, setAmount] = useState(
    typeof draft.amount === "number"
      ? draft.amount
      : input.kind === "number"
        ? input.min
        : 0,
  );
  useEffect(() => {
    if (draftKey)
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ keys, values, amount, specialties }),
      );
  }, [draftKey, keys, values, amount, specialties]);
  const remaining = (a?.values ?? []).reduce(
    (counts, v) => {
      counts[v] = (counts[v] ?? 0) + 1;
      return counts;
    },
    {} as Record<number, number>,
  );
  for (const v of values) remaining[v] = (remaining[v] ?? 0) - 1;
  const points = Object.entries(remaining)
    .filter(([, count]) => count > 0)
    .map(([v, count]) => `${v} × ${count}`)
    .join("、");
  return (
    <form
      className="rule-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          input.kind === "number" ? "confirm" : "allocate",
          input.kind === "number"
            ? { value: amount }
            : {
                ...Object.fromEntries(keys.map((k, i) => [k, values[i]])),
                ...Object.fromEntries(
                  Object.entries(a?.specializations ?? {})
                    .filter(([k]) => keys.includes(k))
                    .map(([k, rule]) => [
                      "specialty." + k,
                      rule.fixed ?? specialties[k] ?? "",
                    ]),
                ),
              },
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
          {a!.kind === "occupation" && (
            <p className="setup-note">
              职业：{a!.occupation}
              {a!.credit !== undefined
                ? ` · 信用评级 ${a!.credit}`
                : " · 信用评级参与点值分配"}
              。先分配必选技能，再选择社交技能与个人专长。
            </p>
          )}
          <p>
            {a!.kind === "attributes"
              ? "将 40、50、50、50、60、60、70、80 分配给八项属性。"
              : a!.kind === "occupation"
                ? `分配 ${a!.values?.join("、")}；每项技能只能选择一次。`
                : a!.kind === "bonus"
                  ? `分配 ${a!.pool} 点技能加值，可分配给已有技能。`
                  : `选择 ${a!.count ?? 4} 项${a!.allowOccupation ? "" : "非职业"}技能，每项增加 20。`}
          </p>
          <p className="allocation-progress" role="status">
            {a!.kind === "interests"
              ? `兴趣技能：${new Set(keys).size} / ${a!.count ?? 4}`
              : a!.kind === "bonus"
                ? `已分配 ${values.reduce((s, v) => s + v, 0)} / ${a!.pool}`
                : points
                  ? `待分配点值：${points}`
                  : "点值已分配。"}
          </p>
          {a!.kind === "attributes" && (
            <p className="setup-note">
              普通值用于一般检定；困难值为一半，极难值为五分之一。
            </p>
          )}
          {keys.map((key, i) => (
            <div className="allocation-row" key={i}>
              {a!.kind === "attributes" ? (
                <label htmlFor={`allocation-${i}`}>
                  {allowed.find((s) => s.key === key)?.label}
                  <small>
                    {
                      (
                        {
                          str: "肌肉力量，影响近战伤害",
                          con: "身体耐力，影响生命",
                          siz: "体重与体型，影响生命和伤害",
                          dex: "反应与协调，影响闪避和行动顺序",
                          app: "外表与气质",
                          pow: "精神意志，决定起始理智与魔法",
                          int: "理解、推理和记忆能力",
                          edu: "学习与知识，影响母语",
                        } as Record<string, string>
                      )[key]
                    }
                  </small>
                </label>
              ) : (
                <select
                  aria-label={`技能 ${i + 1}`}
                  value={key}
                  disabled={
                    a!.kind === "occupation" &&
                    i < (a!.required?.length ?? 0) + (a!.includeCredit ? 1 : 0)
                  }
                  onChange={(e) =>
                    setKeys(keys.map((k, j) => (j === i ? e.target.value : k)))
                  }
                >
                  {allowed
                    .filter((s) => {
                      const groupIndex =
                        i -
                        (a!.required?.length ?? 0) -
                        (a!.includeCredit ? 1 : 0) -
                        (a!.optional?.length ? 1 : 0);
                      const group = a!.groups?.[groupIndex];
                      return (
                        a!.kind !== "occupation" ||
                        !group ||
                        group.includes(s.key)
                      );
                    })
                    .filter(
                      (s) =>
                        a!.kind !== "occupation" ||
                        i !==
                          (a!.required?.length ?? 0) +
                            (a!.includeCredit ? 1 : 0) ||
                        !a!.optional?.length ||
                        a!.optional.includes(s.key),
                    )
                    .map((s) => (
                      <option
                        key={s.key}
                        value={s.key}
                        disabled={s.key !== key && keys.includes(s.key)}
                      >
                        {s.label}（当前 {s.value}）
                      </option>
                    ))}
                </select>
              )}
              {a!.kind === "occupation" && i < (a!.required?.length ?? 0) && (
                <small>职业必选</small>
              )}
              {a!.kind === "bonus" ? (
                <input
                  type="number"
                  aria-label={`加值 ${i + 1}`}
                  min={0}
                  max={99 - (allowed.find((s) => s.key === key)?.value ?? 0)}
                  value={values[i]}
                  onChange={(e) =>
                    setValues(
                      values.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    )
                  }
                />
              ) : (
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
              )}
              <small className="allocation-preview">
                普通{" "}
                {a!.kind === "interests" || a!.kind === "bonus"
                  ? (allowed.find((s) => s.key === key)?.value ?? 0) +
                    (values[i] ?? 20)
                  : values[i]}{" "}
                / 困难{" "}
                {Math.floor(
                  (a!.kind === "interests" || a!.kind === "bonus"
                    ? (allowed.find((s) => s.key === key)?.value ?? 0) +
                      (values[i] ?? 20)
                    : values[i]) / 2,
                )}{" "}
                / 极难{" "}
                {Math.floor(
                  (a!.kind === "interests" || a!.kind === "bonus"
                    ? (allowed.find((s) => s.key === key)?.value ?? 0) +
                      (values[i] ?? 20)
                    : values[i]) / 5,
                )}
              </small>
            </div>
          ))}
          {a!.kind === "occupation" &&
            Object.entries(a!.specializations ?? {})
              .filter(([k]) => keys.includes(k))
              .map(([k, rule]) => (
                <label className="specialty-input" key={k}>
                  {rule.label}
                  <input
                    maxLength={40}
                    required
                    value={rule.fixed ?? specialties[k] ?? ""}
                    readOnly={!!rule.fixed}
                    placeholder={
                      k === "artCraft"
                        ? "例如：摄影、绘画、木工"
                        : "例如：法语、德语"
                    }
                    onChange={(e) =>
                      setSpecialties({ ...specialties, [k]: e.target.value })
                    }
                  />
                  {rule.fixed && <small>此职业的专长已确定。</small>}
                </label>
              ))}
        </>
      )}
      {input.kind === "number" && input.resources && (
        <p className="allocation-progress" role="status">
          可用魔法 {input.resources.mp} · 当前生命 {input.resources.hp}
          。本次消耗：魔法 {Math.min(amount, input.resources.mp)}，生命{" "}
          {Math.max(0, amount - input.resources.mp)}。
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {input.kind === "number" ? "确认投入" : "确认分配"}
      </button>
    </form>
  );
}
