import { useState } from "react";
import type { FearProjected } from "../../../../packages/contracts/fear";
import type { SceneView } from "../../../../packages/contracts/index";

/** Selects an existing server-issued pair; it cannot construct a new game action. */
export function FearSkillChoice({ pending, actions, busy, onChoose }: {
  pending: NonNullable<FearProjected["pending"]>; actions: SceneView["actions"]; busy: boolean;
  onChoose: (id: string) => void;
}) {
  const pairs = pending.options.map((option, index) => {
    const keys = option.split("|");
    const labels = (pending.labels[option] ?? "").split(" + ");
    return { keys, labels, action: actions[index] };
  });
  const skills = new Map<string, string>();
  pairs.forEach(pair => pair.keys.forEach((key, index) => skills.set(key, pair.labels[index] || key)));
  const [first, setFirst] = useState(pairs[0]?.keys[0] ?? "");
  const [second, setSecond] = useState(pairs[0]?.keys[1] ?? "");
  const selected = pairs.find(pair => pair.keys.includes(first) && pair.keys.includes(second) && first !== second);
  return <form className="fear-skill-choice" onSubmit={event => { event.preventDefault(); if (selected?.action) onChoose(selected.action.id); }}>
    <p>选择两项不同的基础技能。</p>
    {([ [first, second, setFirst], [second, first, setSecond] ] as const).map(([value, other, set], index) => <label key={index}>第 {index + 1} 项技能
      <select value={value} disabled={busy} onChange={event => set(event.target.value)}>
        {[...skills].map(([key, label]) => <option key={key} value={key} disabled={key === other}>{label}</option>)}
      </select>
    </label>)}
    <button type="submit" disabled={busy || !selected?.action}>确认技能</button>
  </form>;
}
