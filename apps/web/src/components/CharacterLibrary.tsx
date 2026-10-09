import React, { useState } from "react";
import { ArrowRight, UserRound, BookOpen } from "lucide-react";
import type {
  CharacterTemplate,
  CharacterTemplateCatalog,
  SavedCharacter,
} from "../../../../packages/contracts/index";
import {
  attributeLabels,
  skillLabels,
} from "../../../../packages/contracts/character-labels";
import { CharacterCard } from "./CharacterCard";
import { DiceRoller, DiceWorkbench, diceStorageKey } from "./DiceRoller";
import { Modal } from "./Modal";
export function CharacterLibrary({
  catalog,
  characters,
  onCreate,
  busy,
  error,
  owner,
  reduced,
}: {
  catalog: CharacterTemplateCatalog;
  characters: SavedCharacter[];
  onCreate: (id: string, name: string, luckRollId: string) => Promise<void>;
  busy: boolean;
  error: string;
  owner: string;
  reduced: boolean;
}) {
  const [selected, setSelected] = useState<CharacterTemplate | null>(null);
  const [luckRollId, setLuckRollId] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !luckRollId) return;
    const name = new FormData(event.currentTarget).get("name") as string;
    try {
      await onCreate(selected.id, name, luckRollId);
      sessionStorage.removeItem(
        diceStorageKey(`${owner}:template:${selected.id}`),
      );
      setLuckRollId("");
      setSelected(null);
    } catch {
      /* Parent exposes the API error in this dialog. */
    }
  }
  return (
    <>
      <section className="template-section">
        <h2>剧本角色模板</h2>
        <p className="page-description">
          以官方预设为起点，创建属于你的调查员。每个角色独立保存。
        </p>
        {catalog.groups.map((group) => (
          <div className="template-group" key={group.storyId}>
            <div className="template-group-heading">
              <h3>{group.title}</h3>
              <span>
                {group.status === "official-pregenerated"
                  ? "官方预设"
                  : "随剧情建卡"}
              </span>
            </div>
            <p>{group.description}</p>
            {group.status === "guided-creation" && (
              <div className="guided-note">
                <BookOpen size={17} />
                <span>此剧本使用空白调查员表，角色由剧情引导创建。</span>
              </div>
            )}
            <div className="template-grid">
              {catalog.templates
                .filter((t) => t.sourceStoryId === group.storyId)
                .map((t) => (
                  <article className="template-card" key={t.id}>
                    <div className="template-name">
                      <UserRound size={22} />
                      <div>
                        <h3>
                          {t.label} <small>{t.defaultName}</small>
                        </h3>
                        <span>{t.occupation}</span>
                      </div>
                    </div>
                    <p>{t.description}</p>
                    <div className="template-stats">
                      <span>生命 {t.hp}</span>
                      <span>理智 {t.sanity}</span>
                      <span>魔法 {t.mp}</span>
                    </div>
                    <div className="template-key-skills">
                      {["spotHidden", "listen", "firstAid"].map((k) => (
                        <span key={k}>
                          {skillLabels[k]} <strong>{t.skills[k]}</strong>
                        </span>
                      ))}
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setLuckRollId("");
                        setSelected(t);
                      }}
                    >
                      基于{t.label}创建 <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
            </div>
            <a
              className="template-source-link"
              href={group.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看官方来源 ↗
            </a>
          </div>
        ))}
      </section>
      <section className="saved-characters">
        <h2>
          我的调查员 <span>{characters.length}</span>
        </h2>
        {characters.length ? (
          <div className="character-grid">
            {characters.map((t) => (
              <CharacterCard key={t.id} character={t.character} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            选择上方模板创建角色，或在开始调查时创建示例角色。
          </div>
        )}
      </section>
      <DiceWorkbench owner={owner} reduced={reduced} />
      {selected && (
        <Modal
          title={`基于${selected.label}创建调查员`}
          onClose={() => setSelected(null)}
        >
          <p className="modal-intro">
            职业与数值继承模板，请亲自掷出幸运值。创建后可在示例剧本中选择这位调查员。
          </p>
          <div className="attribute-grid template-attributes">
            {Object.entries(selected.attributes).map(([k, v]) => (
              <div key={k}>
                <span>{attributeLabels[k]}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => void submit(e)}>
            <label>
              调查员姓名
              <input
                name="name"
                defaultValue={selected.defaultName}
                required
                maxLength={24}
              />
            </label>
            <DiceRoller
              key={selected.id}
              scope={`${owner}:template:${selected.id}`}
              reduced={reduced}
              onReady={(r) => setLuckRollId(r.id)}
            />
            <p className="setup-note">
              来源：{selected.sourceStoryTitle} · {selected.source.publisher} ·
              模板 {selected.version}
              <br />
              幸运：3D6 × 5；角色创建后保存，不会在开局时重掷。
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button full"
              disabled={busy || !luckRollId}
            >
              {busy ? "正在创建…" : "创建调查员"}
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
