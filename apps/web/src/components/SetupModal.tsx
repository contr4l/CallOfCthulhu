import React, { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type {
  StorySummary,
  SavedCharacter,
} from "../../../../packages/contracts/index";
import { DiceRoller } from "./DiceRoller";
import { Modal } from "./Modal";
const skillLabels: Record<string, string> = {
  spotHidden: "侦查",
  listen: "聆听",
  persuade: "说服",
  stealth: "潜行",
};
export function SetupModal({
  story,
  onClose,
  onSubmit,
  busy,
  error,
  characters,
  diceScope,
  reduced,
}: {
  story: StorySummary;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  error: string;
  characters: SavedCharacter[];
  diceScope: string;
  reduced: boolean;
}) {
  const eligibleCharacters = characters.filter(
    (c) =>
      story.creationPolicy !== "fixed" ||
      story.presets.some((p) => p.templateId === c.character.templateId),
  );
  const [mode, setMode] = useState("preset"),
    [preset, setPreset] = useState(story.presets[0].id),
    [characterId, setCharacterId] = useState(eligibleCharacters[0]?.id ?? ""),
    [name, setName] = useState(""),
    [values, setValues] = useState<Record<string, number>>({
      spotHidden: 50,
      listen: 50,
      persuade: 50,
      stealth: 50,
    });
  const [luckRollId, setLuckRollId] = useState("");
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  return (
    <Modal title={`进入「${story.title}」`} onClose={onClose}>
      <p className="modal-intro">
        {story.creationPolicy === "guided"
          ? story.id === "alone-against-tide"
            ? "选择自建调查员或伍兹博士。属性、技能加值及幸运将在剧情中确定。"
            : "本模组会在剧情中引导你分配属性和技能；先确定姓名。"
          : story.creationPolicy === "fixed"
            ? story.id === "alone-against-static"
              ? "选择亚历克斯或查理，两人的视角与故事分支不同。"
              : "选择一位调查员。"
            : "先为这段故事，选择一位调查员。"}
      </p>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>
          调查员姓名
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入姓名"
            required
            maxLength={24}
          />
        </label>
        {story.id === "alone-against-flames" &&
          story.creationPolicy === "guided" && (
            <label>
              年龄（可选）
              <input
                name="age"
                type="number"
                min={23}
                max={36}
                placeholder="23–36"
              />
              <small>本冒险建议 23–36 岁，属性与职业将在剧情里确定。</small>
            </label>
          )}
        <div className="mode-tabs">
          <button
            type="button"
            className={mode === "preset" ? "selected" : ""}
            onClick={() => setMode("preset")}
          >
            预设角色
          </button>
          {!story.creationPolicy && (
            <button
              type="button"
              className={mode === "custom" ? "selected" : ""}
              onClick={() => setMode("custom")}
            >
              自定义技能
            </button>
          )}
          {eligibleCharacters.length > 0 &&
            story.creationPolicy !== "guided" && (
              <button
                type="button"
                className={mode === "saved" ? "selected" : ""}
                onClick={() => {
                  setMode("saved");
                  const c = eligibleCharacters.find(
                    (c) => c.id === characterId,
                  );
                  if (c) setName(c.character.name);
                }}
              >
                已有调查员
              </button>
            )}
        </div>
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="preset" value={preset} />
        <input type="hidden" name="characterId" value={characterId} />
        {mode === "saved" ? (
          <div className="preset-options">
            {eligibleCharacters.map((c) => (
              <button
                type="button"
                key={c.id}
                className={characterId === c.id ? "selected" : ""}
                onClick={() => {
                  setCharacterId(c.id);
                  setName(c.character.name);
                }}
              >
                <span>
                  <strong>
                    {c.character.name} · {c.character.occupation}
                  </strong>
                  <small>
                    {c.character.sourceStoryTitle ?? "示例角色"} · 幸运{" "}
                    {c.character.luck} · 生命 {c.character.hp}
                  </small>
                </span>
                {characterId === c.id && <Check size={17} />}
              </button>
            ))}
          </div>
        ) : (
          <div className="preset-options">
            {story.presets.map((p) => (
              <button
                type="button"
                key={p.id}
                className={preset === p.id ? "selected" : ""}
                onClick={() => setPreset(p.id)}
              >
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.description}</small>
                </span>
                {preset === p.id && <Check size={17} />}
              </button>
            ))}
          </div>
        )}
        {mode === "custom" && (
          <div className="custom-skills">
            <p>
              分配 200 点技能，每项 20–75。
              <strong className={total !== 200 ? "invalid" : ""}>
                {total} / 200
              </strong>
            </p>
            {Object.keys(values).map((k) => (
              <label key={k}>
                {skillLabels[k]}
                <input
                  name={k}
                  type="number"
                  min={20}
                  max={75}
                  value={values[k]}
                  onChange={(e) =>
                    setValues({ ...values, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        )}
        {mode !== "saved" && story.creationPolicy !== "guided" && (
          <DiceRoller
            scope={diceScope}
            reduced={reduced}
            onReady={(r) => setLuckRollId(r.id)}
          />
        )}
        <input type="hidden" name="luckRollId" value={luckRollId} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="primary-button full"
          disabled={
            busy ||
            (mode === "saved" &&
              !eligibleCharacters.some((c) => c.id === characterId)) ||
            (mode !== "saved" &&
              story.creationPolicy !== "guided" &&
              !luckRollId) ||
            (mode === "custom" && total !== 200)
          }
        >
          {busy ? "正在建立档案…" : "确认角色，开始调查"}
          <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
