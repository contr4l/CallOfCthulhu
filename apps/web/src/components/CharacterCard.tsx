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
  const d6 = c.rulesVersion === "aaf-solo@1";
  const keys = Object.keys(c.skills);
  const label = (key: string) =>
    c.skillNames?.[key] ??
    (key === "languageOwn" && c.specializations?.[key]
      ? `母语（${c.specializations[key]}）`
      : c.specializations?.[key]
        ? `${skillLabels[key] ?? key}（${c.specializations[key]}）`
        : (skillLabels[key] ?? key));
  const featured = d6
    ? keys.filter((key) => c.skills[key] > 0).slice(0, 6)
    : keys.length <= 6
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
      <span className="section-eyebrow">
        {d6 ? "SURVIVOR" : "INVESTIGATOR"}
      </span>
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
          <strong>
            {c.sanity}
            {c.maxSanity !== undefined && <small>/{c.maxSanity}</small>}
          </strong>
        </div>
        {!d6 && (
          <div>
            <span>幸运</span>
            <strong>{c.luck}</strong>
          </div>
        )}
      </div>
      {c.attributes && !d6 && (
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
      {c.mp !== undefined && !d6 && (
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
            <caption>{d6 ? "技能掌握程度" : "技能检定值"}</caption>
            <thead>
              <tr>
                <th>技能</th>
                <th>{d6 ? "等级" : compact ? "当前" : "普通"}</th>
                {!compact && !d6 && (
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
                  <th>{label(key)}</th>
                  <td>
                    {d6
                      ? (["未掌握", "基础", "专家"][c.skills[key]] ??
                        c.skills[key])
                      : c.skills[key]}
                  </td>
                  {!compact && !d6 && (
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
              <span>{label(key)}</span>
              {!d6 && (
                <span className="skill-bar">
                  <i style={{ width: `${c.skills[key]}%` }} />
                </span>
              )}
              <strong>
                {d6
                  ? (["未掌握", "基础", "专家"][c.skills[key]] ?? c.skills[key])
                  : c.skills[key]}
              </strong>
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
