import { useEffect, useState } from "react";
import type { SceneInput } from "../../../../packages/contracts/program";
type Distribution = Extract<SceneInput, { kind: "distribution" }>;
export function DistributionInputForm({ input, draftKey, busy, onSubmit }: {
  input: Distribution; draftKey?: string; busy: boolean;
  onSubmit: (action: string, input: Record<string, number | string>) => void;
}) {
  const storageKey = draftKey ? `${draftKey}:${input.label}:${input.resource}:${input.total}` : undefined;
  const [values, setValues] = useState<Record<string, number>>(() => {
    let saved: Record<string, number> | undefined;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey ?? "") ?? "null"); } catch { /* Discard invalid local drafts. */ }
    if (saved && Object.keys(saved).length === input.entries.length && input.entries.every(entry => Number.isSafeInteger(saved![entry.key]) && saved![entry.key] >= (input.minimums?.[entry.key] ?? 0) && saved![entry.key] <= input.total)) return saved;
    return Object.fromEntries(input.entries.map((entry, index) => [entry.key, Math.floor(input.total / input.entries.length) + (index < input.total % input.entries.length ? 1 : 0)]));
  });
  useEffect(() => { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(values)); }, [storageKey, values]);
  const allocated = Object.values(values).reduce((sum, value) => sum + value, 0);
  const valid = input.entries.every(entry => Number.isSafeInteger(values[entry.key]) && values[entry.key] >= (input.minimums?.[entry.key] ?? 0) && values[entry.key] <= input.total);
  return <form className="rule-input" onSubmit={event => { event.preventDefault(); onSubmit("distribute", values); }}>
    <p>{input.label} · 总计 {input.total}</p>
    {input.resource === "damage" && <p className="setup-note">伤害应尽可能平均分担{input.protected?.length ? "，你可以额外承受伤害以保护学生" : ""}。</p>}
    {input.entries.map(entry => <label key={entry.key}>
      {entry.label} · {input.resource === "damage" ? "当前生命" : "现有数量"} {entry.value}
      <input type="number" min={input.minimums?.[entry.key] ?? 0} max={input.total} step={1} required value={values[entry.key] ?? 0}
        onChange={event => setValues(previous => ({ ...previous, [entry.key]: Number(event.target.value) }))} />
    </label>)}
    <p>已分配 {allocated}/{input.total}</p>
    <button className="primary-button full" type="submit" disabled={busy || allocated !== input.total || !valid}>确认分配</button>
  </form>;
}
