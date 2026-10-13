import { CharacterProfileForm } from "./CharacterProfileForm";
import React, { useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import type {
  CharacterTemplate,
  CharacterTemplateCatalog,
  SavedCharacter,
  CharacterProfile,
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
  onEdit,
  busy,
  error,
  owner,
  reduced,
}: {
  catalog: CharacterTemplateCatalog;
  characters: SavedCharacter[];
  onEdit: (
    id: string,
    name: string,
    profile: CharacterProfile,
  ) => Promise<void>;
  onCreate: (id: string, name: string, luckRollId: string) => Promise<void>;
  busy: boolean;
  error: string;
  owner: string;
  reduced: boolean;
}) {
  const [editing, setEditing] = useState<SavedCharacter | null>(null);
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
        <h2>预设调查员</h2>
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
            <details className="template-source">
              <summary>来源与角色说明</summary>
              <p>{group.description}</p>
              <a
                className="template-source-link"
                href={group.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                官方来源 ↗
              </a>
            </details>
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
              <div key={t.id} className="saved-character-entry">
                <CharacterCard character={t.character} />
                <button
                  className="secondary-button"
                  onClick={() => setEditing(t)}
                >
                  填写角色卡
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            选择一位预设调查员，或在剧本中建卡。
          </div>
        )}
      </section>
      <DiceWorkbench owner={owner} reduced={reduced} />
      {editing && (
        <CharacterProfileForm
          saved={editing}
          onSave={onEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {selected && (
        <Modal
          title={`基于${selected.label}创建调查员`}
          onClose={() => setSelected(null)}
        >
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
            <details className="template-source">
              <summary>角色来源</summary>
              <p>
                {selected.sourceStoryTitle} · {selected.source.publisher} ·
                模板版本 {selected.version}
              </p>
            </details>
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
