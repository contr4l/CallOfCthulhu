import { NarrativeText } from "./NarrativeText";
import { useEffect, useState } from "react";
import type {
  StoryCollection,
  CollectionKind,
  CollectedScene,
} from "../../../../packages/contracts/collections";
import { api } from "../api";
import { Modal } from "./Modal";
export function CollectionLibrary({
  owner,
  onReplay,
}: {
  owner: string;
  onReplay: (id: string) => void;
}) {
  const [collections, setCollections] = useState<StoryCollection[]>([]),
    [kind, setKind] = useState<CollectionKind>("endings"),
    [selected, setSelected] = useState<CollectedScene | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<StoryCollection[]>("/collections")
      .then((r) => {
        if (active) setCollections(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner]);
  async function open(story: StoryCollection, id: string) {
    setError("");
    try {
      const q = new URLSearchParams({
        storyId: story.storyId,
        version: story.version,
        kind,
        id,
      });
      setSelected(await api<CollectedScene>(`/collections/entry?${q}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="collection-library" aria-label="故事收集">
      <div className="collection-heading">
        <h2>故事收集</h2>
        <div className="mode-tabs" role="group" aria-label="收集类别">
          {(["endings", "chapters"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              className={kind === k ? "selected" : ""}
              onClick={() => setKind(k)}
            >
              {k === "endings" ? "结局收集" : "章节收集"}
            </button>
          ))}
        </div>
      </div>
      <p className="page-description">
        跨局保存已经读过的段落与抵达的结局。未解锁内容保留为未知。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在整理收集档案…</p>
      ) : (
        collections.map((story) => {
          const group = story[kind];
          return (
            <article
              className="collection-story"
              key={`${story.storyId}:${story.version}`}
            >
              <header>
                <div>
                  <h3>{story.title}</h3>
                  <small>版本 {story.version}</small>
                </div>
                <strong aria-label={`${story.title}收集进度`}>
                  {group.entries.length} / {group.total}
                </strong>
              </header>
              <progress
                value={group.entries.length}
                max={Math.max(1, group.total)}
                aria-label={`${story.title}${kind === "endings" ? "结局" : "章节"}完成度`}
              />
              <div className="collection-entries">
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => void open(story, entry.id)}
                  >
                    <span>{entry.title}</span>
                    <small>
                      {entry.chapter} · {entry.visits} 次经历
                    </small>
                  </button>
                ))}
              </div>
              {group.entries.length < group.total && (
                <p className="collection-locked">
                  ◇ 尚有 {group.total - group.entries.length} 份未知
                  {kind === "endings" ? "结局" : "章节"}等待发现
                </p>
              )}
            </article>
          );
        })
      )}
      {selected && (
        <Modal
          title={selected.scene.ending ?? selected.scene.title}
          wide
          onClose={() => setSelected(null)}
        >
          <p className="setup-note">
            {selected.scene.storyTitle} · {selected.scene.chapter} ·
            已收集的经历
          </p>
          {selected.scene.illustration && (
            <img
              className="map-full"
              src={selected.scene.illustration.src}
              alt={selected.scene.illustration.alt}
            />
          )}
          <div className="collected-text">
            <NarrativeText
              scene={selected.scene}
              identity={`${selected.runId}:${selected.sequence}`}
            />
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              const id = selected.runId;
              setSelected(null);
              onReplay(id);
            }}
          >
            回放这次经历
          </button>
        </Modal>
      )}
    </section>
  );
}
