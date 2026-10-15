import type { CharacterLibraryEntry } from "../../../../packages/character-library/index";
import { CharacterProfileForm } from "./CharacterProfileForm";
import React, { useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import type {
  CharacterTemplate,
  CharacterTemplateCatalog,
  CharacterProfile,
  StorySummary,
} from "../../../../packages/contracts/index";
import {
  attributeLabels,
  skillLabels,
} from "../../../../packages/contracts/character-labels";
import { CharacterCard } from "./CharacterCard";
import { DiceRoller, DiceWorkbench, diceStorageKey } from "./DiceRoller";
import { Modal } from "./Modal";
import { characterCreationDescription } from "../character-creation";
export function CharacterLibrary({
  catalog,
  stories,
  isStoryUnlocked,
  onStartStory,
  onResume,
  characters,
  onCreate,
  onEdit,
  busy,
  error,
  owner,
  reduced,
}: {
  catalog: CharacterTemplateCatalog;
  stories: StorySummary[];
  isStoryUnlocked: (id: string) => boolean;
  onStartStory: (story: StorySummary, presetId: string) => void;
  onResume: (id: string) => void;
  characters: CharacterLibraryEntry[];
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
  const [editing, setEditing] = useState<CharacterLibraryEntry | null>(null);
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
        <h2>按剧本创建调查员</h2>
        <p>
          角色创建方式由各剧本决定。随剧情建卡的角色会在开始调查后保存，并在完成分配后更新。
        </p>
        {stories.map((story) => {
          const group = catalog.groups.find((g) => g.storyId === story.id);
          const templates = catalog.templates.filter(
            (t) =>
              t.sourceStoryId === story.id &&
              story.presets.some((p) => p.templateId === t.id),
          );
          const unlocked = isStoryUnlocked(story.id);
          return (
            <div className="template-group" key={story.id}>
              <div className="template-group-heading">
                <h3>{story.title}</h3>
                <span>
                  {story.creationPolicy === "fixed" ? "固定角色" : "随剧情建卡"}
                </span>
              </div>
              <p>{characterCreationDescription(story)}</p>
              <div className="template-grid">
                {story.presets
                  .filter((p) => !templates.some((t) => t.id === p.templateId))
                  .map((preset) => (
                    <article className="template-card" key={preset.id}>
                      <h3>{preset.label}</h3>
                      {story.id !== "alone-against-frost" && (
                        <p>{preset.description}</p>
                      )}
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => onStartStory(story, preset.id)}
                      >
                        {unlocked
                          ? `使用${preset.label}开始调查`
                          : `前往解锁${story.title}`}{" "}
                        <ArrowRight size={15} />
                      </button>
                    </article>
                  ))}
                {templates.map((t) => (
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
                      disabled={busy}
                      onClick={() =>
                        onStartStory(
                          story,
                          story.presets.find((p) => p.templateId === t.id)!.id,
                        )
                      }
                    >
                      {unlocked
                        ? `使用${t.label}开始调查`
                        : `前往解锁${story.title}`}{" "}
                      <ArrowRight size={15} />
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
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
              {group && (
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
              )}
            </div>
          );
        })}
      </section>
      <section className="saved-characters">
        <h2>
          我的调查员 <span>{characters.length}</span>
        </h2>
        <p>
          这里保存建卡结果与个人资料；调查中的生命、理智与装备请在关联调查中查看。
        </p>
        {characters.length ? (
          <div className="character-grid">
            {characters.map((t) => (
              <div key={t.id} className="saved-character-entry">
                {t.origin && (
                  <div className="saved-character-origin">
                    <p>
                      {t.origin.storyTitle} · 剧本版本 {t.origin.storyVersion}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => onResume(t.origin!.runId)}
                    >
                      {t.origin.status === "active"
                        ? "继续关联调查"
                        : "查看关联调查"}
                    </button>
                  </div>
                )}
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
