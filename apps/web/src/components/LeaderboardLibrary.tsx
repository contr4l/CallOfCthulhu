import { useEffect, useState } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardSort,
} from "../../../../packages/community/leaderboard";
import { api } from "../api";
import { useReading } from "../reading";

export function LeaderboardLibrary({ owner }: { owner: string }) {
  const { convert } = useReading();
  const [sort, setSort] = useState<LeaderboardSort>("endings");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    api<Leaderboard>(`/leaderboard?sort=${sort}&page=${page}&limit=20`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error ? error.message : "排行榜暂时无法加载。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner, sort, page, attempt]);
  const metrics = (entry: LeaderboardEntry) =>
    [
      ["结局收集", entry.collectedEndings],
      ["通关剧本", entry.completedStories],
      ["完成局数", entry.completedRuns],
      ["开始局数", entry.startedRuns],
      ["累计成就点", entry.earnedPoints],
    ] as const;
  return (
    <section
      className="leaderboard-library"
      aria-label={convert("全体调查员排行榜")}
      aria-busy={loading}
    >
      <div className="leaderboard-toolbar">
        <label>
          {convert("排名依据")}
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as LeaderboardSort);
              setPage(1);
            }}
          >
            <option value="endings">{convert("结局收集数")}</option>
            <option value="stories">{convert("通关剧本数")}</option>
            <option value="runs">{convert("完成局数")}</option>
            <option value="points">{convert("累计成就点数")}</option>
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={16} />
          {convert("刷新统计")}
        </button>
      </div>
      {loading && <p role="status">{convert("正在整理调查记录…")}</p>}
      {error && (
        <div className="form-error" role="alert">
          <p>{convert(error)}</p>
          <button
            className="secondary-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {convert("重试加载")}
          </button>
        </div>
      )}
      {data && (
        <>
          <dl className="leaderboard-summary">
            {(
              [
                ["注册调查员", data.summary.registeredUsers],
                ["已开始调查", data.summary.startedUsers],
                ["完成调查总局数", data.summary.completedRuns],
                ["结局收集总数", data.summary.collectedEndings],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{convert(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {data.currentUser && (
            <aside
              className="leaderboard-self"
              aria-label={convert("我的排名")}
            >
              <Trophy size={22} />
              <div>
                <strong>{convert(`我的排名 #${data.currentUser.rank}`)}</strong>
                <p>
                  {convert(
                    `已收集 ${data.currentUser.collectedEndings} 个结局 · 通关 ${data.currentUser.completedStories} 部剧本 · 累计 ${data.currentUser.earnedPoints} 成就点`,
                  )}
                </p>
              </div>
            </aside>
          )}
          <ol className="leaderboard-list" aria-label={convert("调查员排名")}>
            {data.entries.map((entry) => (
              <li
                className={`leaderboard-row${entry.isCurrentUser ? " is-self" : ""}`}
                key={entry.username}
              >
                <span
                  className="leaderboard-rank"
                  aria-label={convert(`第${entry.rank}名`)}
                >
                  #{entry.rank}
                </span>
                <div className="leaderboard-name">
                  <strong>{entry.username}</strong>
                  {entry.isCurrentUser && <span>{convert("我")}</span>}
                </div>
                <dl>
                  {metrics(entry).map(([label, value]) => (
                    <div key={label}>
                      <dt>{convert(label)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
          <nav
            className="leaderboard-pagination"
            aria-label={convert("排行榜翻页")}
          >
            <button
              className="secondary-button"
              disabled={data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              {convert("上一页")}
            </button>
            <span>{convert(`第 ${data.page} / ${data.totalPages} 页`)}</span>
            <button
              className="secondary-button"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage(data.page + 1)}
            >
              {convert("下一页")}
            </button>
          </nav>
        </>
      )}
      <p className="setup-note">
        {convert(
          "同分并列排名。结局跨版本去重，重复通关计入完成局数。只统计已确认且可收藏的结局；累计成就点包含未领取奖励，消费不扣减。",
        )}
      </p>
    </section>
  );
}
