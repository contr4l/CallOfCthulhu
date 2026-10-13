import { UserRound } from "lucide-react";
import { useState } from "react";
import type { Character } from "../../../../packages/contracts/index";
import {
  skillLabels,
  attributeLabels,
} from "../../../../packages/contracts/character-labels";
export function CharacterCard({
  character: c,
  compact = false,
}: {
  character: Character;
  compact?: boolean;
}) {
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
      {!compact && c.sourceStoryTitle && (
        <details className="character-source">
          <summary>角色来源</summary>
          <p>
            {c.sourceStoryTitle} · 模板版本 {c.templateVersion}
          </p>
        </details>
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
              {!compact && (
                <small className="check-values">
                  困难 {Math.floor(value / 2)} · 极难 {Math.floor(value / 5)}
                </small>
              )}
            </div>
          ))}
        </div>
      )}
      {c.mp !== undefined && (
        <div className="derived-stats">
          <span>魔法 {c.mp}</span>
          <span>伤害加值 {c.damageBonus}</span>
          {c.build !== undefined && <span>体格 {c.build}</span>}
          {c.movement !== undefined && <span>移动 {c.movement}</span>}
        </div>
      )}
      {expanded ? (
        <div className="character-sheet-scroll">
          <table className="character-sheet">
            <caption>技能检定值</caption>
            <thead>
              <tr>
                <th>技能</th>
                <th>{compact ? "当前" : "普通"}</th>
                {!compact && (
                  <>
                    <th>困难</th>
                    <th>极难</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <th>
                    {c.specializations?.[key]
                      ? `${skillLabels[key] ?? key}（${c.specializations[key]}）`
                      : (skillLabels[key] ?? key)}
                  </th>
                  <td>{c.skills[key]}</td>
                  {!compact && (
                    <>
                      <td>{Math.floor(c.skills[key] / 2)}</td>
                      <td>{Math.floor(c.skills[key] / 5)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="skills">
          {featured.map((key) => (
            <div key={key}>
              <span>
                {c.specializations?.[key]
                  ? `${skillLabels[key] ?? key}（${c.specializations[key]}）`
                  : (skillLabels[key] ?? key)}
              </span>
              <span className="skill-bar">
                <i style={{ width: `${c.skills[key]}%` }} />
              </span>
              <strong>{c.skills[key]}</strong>
            </div>
          ))}
        </div>
      )}
      {keys.length > 6 && (
        <button
          className="text-button expand-skills"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起技能" : `查看全部 ${keys.length} 项技能`}
        </button>
      )}
      {c.profile && (
        <details className="character-profile">
          <summary>个人资料与笔记</summary>
          <dl>
            {Object.entries(c.profile)
              .filter(([, v]) => v !== undefined && v !== "")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>
                    {(
                      {
                        age: "年龄",
                        pronouns: "称谓",
                        birthplace: "出生地",
                        residence: "居住地",
                        appearance: "外貌描述",
                        ideology: "思想与信念",
                        importantPeople: "重要之人",
                        meaningfulPlaces: "意义非凡之地",
                        treasuredPossessions: "宝贵之物",
                        notes: "个人笔记",
                      } as Record<string, string>
                    )[k] ?? k}
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      <button
        className="text-button"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(c, null, 2)], {
              type: "application/json",
            }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "investigator.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        导出角色卡
      </button>
    </div>
  );
}
