import { useState } from "react";
import type {
  SavedCharacter,
  CharacterProfile,
} from "../../../../packages/contracts/index";
import { Modal } from "./Modal";
const labels: Record<keyof Omit<CharacterProfile, "age">, string> = {
  pronouns: "称谓",
  birthplace: "出生地",
  residence: "居住地",
  appearance: "外貌描述",
  ideology: "思想与信念",
  importantPeople: "重要之人",
  meaningfulPlaces: "意义非凡之地",
  treasuredPossessions: "宝贵之物",
  notes: "个人笔记",
};
export function CharacterProfileForm({
  saved,
  onSave,
  onClose,
}: {
  saved: SavedCharacter;
  onSave: (
    id: string,
    name: string,
    profile: CharacterProfile,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(saved.character.name),
    [profile, setProfile] = useState<CharacterProfile>(
      saved.character.profile ?? {},
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="填写角色卡" wide onClose={onClose}>
      <p className="setup-note">
        姓名会同步到关联的调查；其他资料保存在角色档案中。
      </p>
      <form
        className="profile-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave(saved.id, name, profile);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          调查员姓名
          <input
            value={name}
            required
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          年龄
          <input
            type="number"
            min={1}
            max={120}
            value={profile.age ?? ""}
            onChange={(e) =>
              setProfile({
                ...profile,
                age: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
        {(Object.entries(labels) as [keyof typeof labels, string][]).map(
          ([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                rows={key === "notes" ? 4 : 2}
                maxLength={key === "notes" ? 2000 : 400}
                value={profile[key] ?? ""}
                onChange={(e) =>
                  setProfile({ ...profile, [key]: e.target.value })
                }
              />
            </label>
          ),
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? "正在保存…" : "保存角色资料"}
        </button>
      </form>
    </Modal>
  );
}
