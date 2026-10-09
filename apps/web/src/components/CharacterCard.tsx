import { UserRound } from "lucide-react";
import { useState } from "react";
import type { Character } from "../../../../packages/contracts/index";
import {
  skillLabels,
  attributeLabels,
} from "../../../../packages/contracts/character-labels";
export function CharacterCard({ character: c }: { character: Character }) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(c.skills);
  const featured =
    keys.length <= 6
      ? keys
      : [
          "spotHidden",
          "listen",
          "persuade",
          "stealth",
          "firstAid",
          "dodge",
        ].filter((k) => k in c.skills);
  return (
    <div className="character-card">
      <div className="character-emblem">
        <img src="/media/card-back.webp" alt="调查员档案卡背" />
        <span>
          <UserRound size={30} />
        </span>
      </div>
      <span className="section-eyebrow">INVESTIGATOR</span>
      <h2>{c.name}</h2>
      <p>{c.occupation}</p>
      {c.sourceStoryTitle && (
        <p className="character-source">
          来源：{c.sourceStoryTitle} · 模板 {c.templateVersion}
        </p>
      )}
      <div className="character-stats">
        <div>
          <span>生命</span>
          <strong>
            {c.hp}
            <small>/{c.maxHp}</small>
          </strong>
        </div>
        <div>
          <span>理智</span>
          <strong>{c.sanity}</strong>
        </div>
        <div>
          <span>幸运</span>
          <strong>{c.luck}</strong>
        </div>
      </div>
      {c.attributes && (
        <div className="attribute-grid">
          {Object.entries(c.attributes).map(([key, value]) => (
            <div key={key}>
              <span>{attributeLabels[key] ?? key}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      {c.mp !== undefined && (
        <div className="derived-stats">
          <span>魔法 {c.mp}</span>
          <span>伤害加值 {c.damageBonus}</span>
          <span>
            体格 {c.build} · 移动 {c.movement}
          </span>
        </div>
      )}
      <div className="skills">
        {(expanded ? keys : featured).map((key) => (
          <div key={key}>
            <span>{skillLabels[key] ?? key}</span>
            <span className="skill-bar">
              <i style={{ width: `${c.skills[key]}%` }} />
            </span>
            <strong>{c.skills[key]}</strong>
          </div>
        ))}
      </div>
      {keys.length > 6 && (
        <button
          className="text-button expand-skills"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起技能" : `查看全部 ${keys.length} 项技能`}
        </button>
      )}
    </div>
  );
}
