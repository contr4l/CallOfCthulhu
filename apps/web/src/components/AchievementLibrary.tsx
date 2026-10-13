import type { ShopState } from "../../../../packages/contracts/shop";
import { useEffect, useState, useRef } from "react";
import { Trophy, LockKeyhole, ArrowRight } from "lucide-react";
import {
  endingAchievementId,
  type Achievement,
} from "../../../../packages/contracts/achievements";
import type { SceneView } from "../../../../packages/contracts/index";
import { api } from "../api";
import { useReading } from "../reading";

export function AchievementLibrary({
  owner,
  onViewEnding,
  balance,
  onShopChange,
  onOpenShop,
}: {
  balance: number;
  onShopChange: (state: ShopState) => void;
  onOpenShop: () => void;
  owner: string;
  onViewEnding: (id: string) => void;
}) {
  const { convert } = useReading();
  const [entries, setEntries] = useState<Achievement[]>([]);
  const [storyId, setStoryId] = useState("alone-against-flames");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [claiming, setClaiming] = useState(""),
    [claimError, setClaimError] = useState("");
  const claimLock = useRef(false);
  async function claim(id: string) {
    if (claimLock.current) return;
    claimLock.current = true;
    setClaiming(id);
    setClaimError("");
    try {
      const next = await api<ShopState>(
        `/achievements/${encodeURIComponent(id)}/claim`,
        {},
      );
      onShopChange(next);
      setAttempt((value) => value + 1);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "领取失败，请重试。");
    } finally {
      claimLock.current = false;
      setClaiming("");
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Achievement[]>("/achievements")
      .then((entries) => {
        if (!active) return;
        setEntries(entries);
        setStoryId((selected) =>
          entries.some((entry) => entry.storyId === selected)
            ? selected
            : (entries[0]?.storyId ?? ""),
        );
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner, attempt]);
  const stories = [
    ...new Map(
      entries.map((entry) => [entry.storyId, entry.storyTitle]),
    ).entries(),
  ];
  const shown = entries
    .filter((entry) => entry.storyId === storyId)
    .sort(
      (a, b) =>
        Number(!!b.unlockedAt) - Number(!!a.unlockedAt) ||
        (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""),
    );
  const unlocked = shown.filter((entry) => entry.unlockedAt).length;
  return (
    <section className="achievement-library" aria-label={convert("结局成就")}>
      {loading ? (
        <p role="status">{convert("正在整理成就…")}</p>
      ) : error ? (
        <div role="alert" className="form-error">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setAttempt(attempt + 1)}
          >
            {convert("重新加载")}
          </button>
        </div>
      ) : (
        <>
          <div className="achievement-heading">
            <div>
              <h2>{convert("结局成就")}</h2>
              <p>{convert(`已解锁 ${unlocked} / ${shown.length}`)}</p>
            </div>
            <label>
              {convert("选择剧本")}
              <select
                value={storyId}
                onChange={(event) => setStoryId(event.target.value)}
              >
                {stories.map(([id, title]) => (
                  <option key={id} value={id}>
                    {convert(title)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="reward-summary">
            <strong>{convert(`余烬点 ${balance}`)}</strong>
            <button className="secondary-button" onClick={onOpenShop}>
              {convert("前往商店")}
            </button>
          </div>
          {claimError && (
            <p role="alert" className="form-error">
              {convert(claimError)}
            </p>
          )}
          <progress
            value={unlocked}
            max={Math.max(1, shown.length)}
            aria-label={convert("成就完成度")}
          />
          <div className="achievement-grid">
            {shown.map((entry) => (
              <article
                key={entry.id}
                className={`achievement-card ${entry.unlockedAt ? "is-unlocked" : "is-locked"}`}
              >
                <span className="achievement-medal" aria-hidden="true">
                  {entry.unlockedAt ? (
                    <Trophy size={28} />
                  ) : (
                    <LockKeyhole size={26} />
                  )}
                </span>
                <div className="achievement-content">
                  <span className="achievement-status">
                    {convert(entry.unlockedAt ? "已解锁" : "未解锁")} ·{" "}
                    {convert(
                      `结局 ${String(entry.endingNumber).padStart(2, "0")}`,
                    )}
                  </span>
                  <h3>{convert(entry.title)}</h3>
                  <p>{convert(entry.description)}</p>
                  {entry.unlockedAt && (
                    <time dateTime={entry.unlockedAt}>
                      {convert("解锁于")} ·{" "}
                      {new Date(entry.unlockedAt).toLocaleDateString("zh-CN")}
                    </time>
                  )}
                  {entry.unlockedAt && (
                    <div className="achievement-reward">
                      <span>
                        {convert(`结局奖励 ${entry.rewardPoints ?? 1} 点`)}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={!!entry.claimedAt || !!claiming}
                        onClick={() => void claim(entry.id)}
                      >
                        {convert(
                          entry.claimedAt
                            ? "已领取"
                            : claiming === entry.id
                              ? "正在领取…"
                              : "领取点数",
                        )}
                      </button>
                    </div>
                  )}
                  {entry.runId && (
                    <button
                      className="text-button"
                      onClick={() => onViewEnding(entry.runId!)}
                    >
                      {convert("查看结局")}
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!shown.length && (
            <p className="empty-state">
              {convert("暂时没有可收集的结局成就。")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function EndingAchievement({
  scene,
  onViewAchievements,
}: {
  scene: SceneView;
  onViewAchievements: () => void;
}) {
  const { convert } = useReading();
  const [entry, setEntry] = useState<Achievement | null>(null);
  useEffect(() => {
    let active = true;
    setEntry(null);
    void api<Achievement[]>("/achievements")
      .then((entries) => {
        if (!active) return;
        const id =
          scene.collection?.endingId &&
          endingAchievementId(scene.storyId, scene.collection.endingId);
        setEntry(
          entries.find(
            (entry) =>
              entry.unlockedAt &&
              (id
                ? entry.id === id
                : entry.storyId === scene.storyId &&
                  entry.title === scene.ending),
          ) ?? null,
        );
      })
      .catch(() => {
        /* The achievement remains available in the account library. */
      });
    return () => {
      active = false;
    };
  }, [scene.runId, scene.storyId, scene.collection?.endingId, scene.ending]);
  if (!entry) return null;
  return (
    <aside className="ending-achievement" role="status" aria-live="polite">
      <Trophy size={18} aria-hidden="true" />
      <div>
        <span>
          {convert(entry.runId === scene.runId ? "成就解锁" : "已解锁成就")} ·{" "}
          {convert(`结局 ${String(entry.endingNumber).padStart(2, "0")}`)}
        </span>
      </div>
      <button className="text-button" onClick={onViewAchievements}>
        {convert("查看成就")}
        <ArrowRight size={14} />
      </button>
    </aside>
  );
}
