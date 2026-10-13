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
            <article className="collection-story" key={story.storyId}>
              <header>
                <h3>{story.title}</h3>
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
                  <div className="collection-entry" key={entry.id}>
                    <button onClick={() => void open(story, entry.id)}>
                      {kind === "chapters" && entry.excerpt
                        ? `${entry.excerpt}…`
                        : entry.title.replace(/\s*[·]\s*\d+$/, "").trim()}
                    </button>
                    <details>
                      <summary>档案详情</summary>
                      <p>
                        {entry.chapter} · 阅读 {entry.visits} 次
                      </p>
                    </details>
                  </div>
                ))}
              </div>
              {group.entries.length === 0 && (
                <p className="collection-locked">
                  尚未发现{kind === "endings" ? "结局" : "章节"}。
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
