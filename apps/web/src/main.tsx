import { SceneInputForm } from "./components/SceneInputForm";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Compass,
  History,
  Layers,
  UserRound,
  Volume2,
  VolumeX,
  ChevronRight,
  X,
  Dices,
  Flame,
  Search,
  Check,
  LogOut,
  Pause,
  Play,
  SkipForward,
  RotateCcw,
  Shield,
  Feather,
  Menu,
} from "lucide-react";
import type {
  StorySummary,
  SceneView,
  RunSummary,
  HistoryFrame,
  User,
  Command,
  CommandResponse,
  CheckResult,
  Character,
  CharacterTemplateCatalog,
} from "../../../packages/contracts/index";
import { api, ApiError } from "./api";
import { audio } from "./audio";
import "./styles.css";
import { CharacterCard } from "./components/CharacterCard";
import { Modal } from "./components/Modal";
import { DiceAnimation, diceStorageKey } from "./components/DiceRoller";
import { SetupModal } from "./components/SetupModal";
import { CharacterLibrary } from "./components/CharacterLibrary";
type Page = "library" | "runs" | "archive" | "characters" | "play";
const skillLabels: Record<string, string> = {
  spotHidden: "侦查",
  listen: "聆听",
  persuade: "说服",
  stealth: "潜行",
  firstAid: "急救",
};
const gradeLabels: Record<string, string> = {
  critical: "大成功",
  extreme: "极难成功",
  hard: "困难成功",
  regular: "成功",
  failure: "失败",
  fumble: "大失败",
};
function checkLabel(result: CheckResult) {
  return result.success
    ? gradeLabels[result.grade]
    : result.grade === "fumble"
      ? "大失败"
      : "未通过检定";
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState<Page>("library");
  const [stories, setStories] = useState<StorySummary[]>([]),
    [runs, setRuns] = useState<RunSummary[]>([]),
    [templates, setTemplates] = useState<
      { id: string; character: Character }[]
    >([]);
  const [characterCatalog, setCharacterCatalog] =
    useState<CharacterTemplateCatalog>({ groups: [], templates: [] });
  const [scene, setScene] = useState<SceneView | null>(null),
    [setup, setSetup] = useState<StorySummary | null>(null),
    [auth, setAuth] = useState(false),
    [register, setRegister] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sound, setSound] = useState(false),
    [search, setSearch] = useState("");
  const [reduced, setReduced] = useState(
    () =>
      localStorage.getItem("reduced-motion") === "true" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [result, setResult] = useState<CheckResult | null>(null),
    [rolling, setRolling] = useState(false),
    [history, setHistory] = useState<HistoryFrame[] | null>(null),
    [historyMode, setHistoryMode] = useState<"read" | "replay">("read"),
    [frameIndex, setFrameIndex] = useState(0),
    [replaying, setReplaying] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false);
  const lock = useRef(false),
    rollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    sceneRef = useRef<SceneView | null>(null);
  sceneRef.current = scene;
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setAuth(true);
    }
  }
  async function refresh() {
    const [r, c] = await Promise.all([
      api<RunSummary[]>("/runs"),
      api<{ id: string; character: Character }[]>("/characters"),
    ]);
    setRuns(r);
    setTemplates(c);
  }
  function go(next: Page) {
    setMobileMenu(false);
    setPage(next);
    setScene(null);
    setResult(null);
    setHistory(null);
    setReplaying(false);
    location.hash = `/${next}`;
    audio.music();
    setError("");
  }
  async function loadRun(id: string) {
    try {
      setBusy(true);
      setResult(null);
      const s = await api<SceneView>(`/runs/${encodeURIComponent(id)}`);
      setScene(s);
      setError(
        sessionStorage.getItem(`pending:${s.runId}`)
          ? "上次行动的响应尚未确认。请重试以取得已保存的结果。"
          : "",
      );
      setPage("play");
      setHistory(null);
      location.hash = `/play/${id}`;
      audio.music(s.music);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<StorySummary[]>("/stories"),
      api<User>("/me").catch(() => null),
      api<CharacterTemplateCatalog>("/character-templates"),
    ])
      .then(([s, u, catalog]) => {
        if (!live) return;
        setStories(s);
        setUser(u);
        setCharacterCatalog(catalog);
        setReady(true);
      })
      .catch((e) => {
        if (live) {
          fail(e);
          setReady(true);
        }
      });
    return () => {
      live = false;
      clearTimeout(rollTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    function route() {
      const path = location.hash.slice(1);
      if (path.startsWith("/play/")) {
        if (user) void loadRun(path.slice(6));
        else {
          setPage("library");
          setAuth(true);
        }
      } else {
        const p = path.slice(1);
        if (["library", "runs", "archive", "characters"].includes(p))
          setPage(p as Page);
      }
    }
    route();
    window.addEventListener("hashchange", route);
    if (user) void refresh().catch(fail);
    return () => window.removeEventListener("hashchange", route);
  }, [user, ready]);
  useEffect(() => {
    document.documentElement.dataset.reduced = String(reduced);
    localStorage.setItem("reduced-motion", String(reduced));
  }, [reduced]);
  useEffect(() => {
    if (!replaying || !history) return;
    const timer = setTimeout(() => {
      if (frameIndex < history.length - 1) setFrameIndex((v) => v + 1);
      else setReplaying(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [replaying, frameIndex, history]);
  useEffect(() => {
    if (historyMode === "replay" && history)
      audio.music(history[frameIndex]?.scene.music);
  }, [frameIndex, history, historyMode]);
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const u = await api<User>(`/auth/${register ? "register" : "login"}`, {
        username: f.get("username"),
        password: f.get("password"),
      });
      setUser(u);
      setAuth(false);
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!setup || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      custom = f.get("mode") === "custom";
    const skills = Object.fromEntries(
      Object.keys(skillLabels)
        .filter((k) => k !== "firstAid")
        .map((k) => [k, Number(f.get(k))]),
    );
    try {
      const s = await api<SceneView>("/runs", {
        storyId: setup.id,
        ...(f.get("mode") === "saved"
          ? { characterId: f.get("characterId") }
          : {
              presetId: f.get("preset"),
              ...(setup.creationPolicy !== "guided"
                ? { luckRollId: f.get("luckRollId") }
                : {}),
            }),
        name: f.get("name"),
        ...(custom ? { skills } : {}),
      });
      sessionStorage.removeItem(
        diceStorageKey(`${user!.id}:story:${setup.id}`),
      );
      setSetup(null);
      setScene(s);
      setPage("play");
      location.hash = `/play/${s.runId}`;
      audio.music(s.music);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function createFromTemplate(
    templateId: string,
    name: string,
    luckRollId: string,
  ) {
    if (lock.current) throw new Error("正在处理上一个操作。");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/characters", { templateId, name, luckRollId });
      await refresh();
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function command(
    actionId: string,
    input?: Record<string, number | string>,
  ) {
    const s = sceneRef.current;
    if (!s || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const key = `pending:${s.runId}`;
    let body: Command;
    try {
      const saved = sessionStorage.getItem(key);
      body = saved
        ? JSON.parse(saved)
        : {
            commandId: crypto.randomUUID(),
            expectedRevision: s.revision,
            actionId,
            ...(input ? { input } : {}),
          };
      sessionStorage.setItem(key, JSON.stringify(body));
      const response = await api<CommandResponse>(
        `/runs/${s.runId}/commands`,
        body,
      );
      sessionStorage.removeItem(key);
      // A delayed idempotent response must not replace a newer authoritative view.
      const current = sceneRef.current;
      if (
        current?.runId === response.scene.runId &&
        current.revision <= response.scene.revision
      ) {
        setScene(response.scene);
        audio.music(response.scene.music);
      }
      if (response.check) {
        setResult(response.check);
        setRolling(!reduced);
        audio.sfx("roll");
        clearTimeout(rollTimer.current);
        rollTimer.current = setTimeout(
          () => {
            setRolling(false);
            audio.sfx(response.check!.success ? "success" : "fail");
          },
          reduced ? 0 : 950,
        );
      }
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) {
        sessionStorage.removeItem(key);
        if (e.status === 409) {
          try {
            const current = await api<SceneView>(`/runs/${s.runId}`);
            setScene(current);
          } catch (inner) {
            fail(inner);
          }
        }
      }
      fail(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openHistory(id: string, mode: "read" | "replay") {
    try {
      setBusy(true);
      const all: HistoryFrame[] = [];
      let after: number | null = -1;
      do {
        const data: { frames: HistoryFrame[]; nextAfter: number | null } =
          await api(
            `/runs/${id}/${mode === "replay" ? "replay" : "history"}?after=${after}`,
          );
        all.push(...data.frames);
        after = data.nextAfter;
      } while (after !== null);
      setHistory(all);
      setHistoryMode(mode);
      setFrameIndex(0);
      setReplaying(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", {});
      setUser(null);
      setRuns([]);
      setTemplates([]);
      sessionStorage.clear();
      go("library");
    } catch (e) {
      fail(e);
    }
  }
  function closeHistory() {
    setHistory(null);
    setReplaying(false);
    if (scene) audio.music(scene.music);
    else audio.music();
  }
  const nav = [
    { page: "library" as Page, label: "剧本馆", icon: Compass },
    { page: "runs" as Page, label: "我的调查", icon: Layers },
    { page: "archive" as Page, label: "回忆档案", icon: History },
    { page: "characters" as Page, label: "调查员", icon: UserRound },
  ];
  const active = runs.filter((r) => r.status === "active"),
    ended = runs.filter((r) => r.status === "ended");
  const filtered = stories.filter((s) =>
    `${s.title}${s.description}${s.tags.join("")}`.includes(search),
  );
  const titles = {
    library: "剧本馆",
    runs: "我的调查",
    archive: "回忆档案",
    characters: "调查员",
    play: scene?.storyTitle ?? "调查进行中",
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a className="brand" href="#/library" onClick={() => go("library")}>
          <span className="brand-mark">
            <Flame size={23} />
          </span>
          <span>
            余烬档案<small>THE EMBER ARCHIVE</small>
          </span>
        </a>
        <div className="sidebar-label">独行，亦有回响</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.page}
              className={`nav-item ${page === n.page ? "active" : ""}`}
              onClick={() => go(n.page)}
            >
              <n.icon size={18} />
              {n.label}
              {n.page === "runs" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-star">✧</span>
          <p>
            每一个选择，
            <br />
            都在黑暗里留下回声。
          </p>
          <small>无主持人 · 克苏鲁独行冒险</small>
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          档案室已开放<span className="version">VOL. 01</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              aria-label="打开导航"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu size={20} />
            </button>
            <span>档案室</span>
            <ChevronRight size={13} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button"
              aria-label={sound ? "关闭声音" : "开启声音"}
              title={sound ? "关闭声音" : "开启声音"}
              onClick={() => {
                audio.enable(!sound);
                setSound(!sound);
              }}
            >
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              className="motion-button"
              aria-pressed={reduced}
              onClick={() => setReduced(!reduced)}
            >
              {reduced ? "简化动画" : "完整动画"}
            </button>
            <span className="header-divider" />
            {user ? (
              <>
                <span className="user-label">
                  <span className="avatar">{user.username[0]}</span>
                  {user.username}
                </span>
                <button
                  className="icon-button"
                  aria-label="退出登录"
                  onClick={() => void logout()}
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <button
                className="login-link"
                onClick={() => {
                  setRegister(false);
                  setAuth(true);
                }}
              >
                登录档案室 <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {scene && sessionStorage.getItem(`pending:${scene.runId}`) && (
              <button onClick={() => void command("retry")}>
                重试上次行动
              </button>
            )}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!ready ? (
          <main className="loading-page">正在打开档案室…</main>
        ) : page === "library" ? (
          <main className="library">
            <div className="section-eyebrow">
              <span className="line" /> STORIES FOR THE SOLITARY
            </div>
            <div className="page-title">
              <div>
                <h1>故事，从你开始。</h1>
                <p>没有主持人，没有预设的答案。只有你，和下一次选择。</p>
              </div>
              <span className="edition">
                独行剧本集 <span>01 / 2026</span>
              </span>
            </div>
            {stories[0] && (
              <section className="featured">
                <img
                  className="featured-art"
                  src={stories[0].cover}
                  alt="迷雾中临海的灯塔"
                />
                <div className="featured-shade" />
                <div className="featured-content">
                  <div className="feature-tag">
                    <span />
                    本期精选 <span className="tag-separator">/</span> 独行冒险
                  </div>
                  <span className="feature-subtitle">
                    {stories[0].subtitle}
                  </span>
                  <h2>{stories[0].title}</h2>
                  <p>{stories[0].description}</p>
                  <div className="feature-meta">
                    <span>
                      <BookOpen size={14} /> {stories[0].duration}
                    </span>
                    <span>◈ {stories[0].difficulty}调查</span>
                    <span>多重结局</span>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (!user) {
                        setAuth(true);
                        return;
                      }
                      setSetup(stories[0]);
                    }}
                  >
                    开启调查 <ArrowRight size={17} />
                  </button>
                  <small className="feature-footnote">
                    每局一条旅程，每个选择不可撤回。
                  </small>
                </div>
                <div className="feature-number">
                  CASE FILE <strong>001</strong>
                </div>
              </section>
            )}
            {user && active.length > 0 && (
              <button
                className="resume-strip"
                onClick={() => void loadRun(active[0].id)}
              >
                <span className="status-dot" />
                <div>
                  <strong>一份调查，还在等你</strong>
                  <span>
                    {active[0].storyTitle} · {active[0].characterName} ·{" "}
                    {active[0].chapter}
                  </span>
                </div>
                <span>
                  继续调查 <ArrowRight size={16} />
                </span>
              </button>
            )}
            <div className="collection-header">
              <div>
                <h2>
                  探索剧本{" "}
                  <span>{stories.length.toString().padStart(2, "0")}</span>
                </h2>
                <p>走入另一个世界，留下你的版本。</p>
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  placeholder="寻找一段故事"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="搜索剧本"
                />
              </label>
            </div>
            <div className="story-grid">
              {filtered.map((s, i) => (
                <article className={`story-card ${s.accent}`} key={s.id}>
                  <div className="card-image">
                    <img src={s.cover} alt={s.title} />
                    <span className="card-file">
                      CASE {String(i + 1).padStart(3, "0")}
                    </span>
                    <span className="card-type">可游玩</span>
                    <button
                      className="card-open"
                      aria-label={`开始${s.title}`}
                      onClick={() => {
                        if (!user) {
                          setAuth(true);
                          return;
                        }
                        setSetup(s);
                      }}
                    >
                      <ArrowUpRight size={21} />
                    </button>
                  </div>
                  <div className="card-body">
                    <span className="card-subtitle">{s.subtitle}</span>
                    <h3>{s.title}</h3>
                    <p>{s.description}</p>
                    <div className="card-tags">
                      {s.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="card-bottom">
                      <span>
                        <BookOpen size={13} />
                        {s.duration}
                      </span>
                      <span>
                        {s.difficulty} <span className="mini-dot" />
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="empty-state">暂时没有匹配的剧本。</div>
            )}
            <section className="principles">
              <div>
                <Shield size={22} />
                <h3>选择，只有一次</h3>
                <p>一局一条单向旅程。掷骰与选择，都会留下不可撤回的痕迹。</p>
              </div>
              <div>
                <Feather size={22} />
                <h3>故事，不会遗失</h3>
                <p>行动后自动保存。随时回来，继续尚未结束的调查。</p>
              </div>
              <div>
                <History size={22} />
                <h3>回忆，始终在场</h3>
                <p>重读线索，回放经历。你走过的每一段，都有迹可循。</p>
              </div>
            </section>
            <footer>
              <span>余烬档案 · 在未知中留下你的故事</span>
              <span>
                致每一位独行的调查员 <span className="tiny-star">✧</span>
              </span>
            </footer>
          </main>
        ) : page === "play" && scene ? (
          <main className="play-page">
            <div className="play-heading">
              <button className="text-button" onClick={() => go("runs")}>
                ← 我的调查
              </button>
              <span>
                <span className="status-dot" /> 已自动保存 · 第{" "}
                {scene.revision + 1} 段经历
              </span>
            </div>
            <div className="play-layout">
              <div className="story-panel">
                <div className="scene-image" key={scene.visitId}>
                  <img src={scene.background} alt={scene.title} />
                  <span>{scene.storyTitle}</span>
                </div>
                <article className="narrative" key={`${scene.visitId}-text`}>
                  <span className="section-eyebrow">{scene.chapter}</span>
                  <h1>{scene.title}</h1>
                  {scene.text.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                  {scene.check && (
                    <div className="check-note">
                      <Dices size={18} />
                      <span>
                        {scene.check.label}检定 · 目标值 {scene.check.target}
                      </span>
                      <span>D100</span>
                    </div>
                  )}
                  {scene.ending && (
                    <div className="ending">
                      <span>调查结局</span>
                      <h2>{scene.ending}</h2>
                      <p>这段旅程已经写入你的档案。</p>
                    </div>
                  )}
                  {scene.notices?.map((notice, i) => (
                    <p className="check-note" key={`notice-${i}`}>
                      {notice}
                    </p>
                  ))}
                  {scene.combat && (
                    <p className="check-note">
                      第 {scene.combat.round} 回合 · {scene.combat.name} ·
                      剩余生命 {scene.combat.hp}
                    </p>
                  )}
                  {scene.input && (
                    <SceneInputForm
                      key={`${scene.visitId}-${scene.revision}`}
                      input={scene.input}
                      busy={busy || !!result}
                      onSubmit={(action, input) => void command(action, input)}
                    />
                  )}
                  <div className="choices">
                    {!scene.input &&
                      scene.actions.map((a, i) => (
                        <button
                          key={a.id}
                          disabled={busy || !!result}
                          onClick={() => void command(a.id)}
                        >
                          <span className="choice-index">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            {a.label}
                            {a.hint && <small>{a.hint}</small>}
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                  </div>
                  {scene.status === "ended" && (
                    <button
                      className="primary-button"
                      onClick={() => go("library")}
                    >
                      开启另一段旅程 <ArrowRight size={16} />
                    </button>
                  )}
                  <div className="narrative-bottom">
                    <span>选择一经确认，不可倒退。</span>
                    <button
                      className="text-button"
                      onClick={() => void openHistory(scene.runId, "read")}
                    >
                      回忆这一局 <History size={14} />
                    </button>
                  </div>
                </article>
              </div>
              <aside className="character-panel">
                <CharacterCard character={scene.character} />
                {!!scene.records?.length && (
                  <section className="record-sheet">
                    <h3>本局记录表</h3>
                    {scene.records.map((k) => (
                      <p key={k}>✓ {k}</p>
                    ))}
                  </section>
                )}
                <div className="inventory">
                  <h3>随身物品</h3>
                  {scene.inventory.length ? (
                    scene.inventory.map((i) => (
                      <div key={i.key}>◇ {i.label}</div>
                    ))
                  ) : (
                    <p>还没有获得物品。</p>
                  )}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => void openHistory(scene.runId, "replay")}
                >
                  <Play size={15} />
                  剧情线回放
                </button>
                <p className="side-hint">
                  回忆与回放只供查看，
                  <br />
                  不会改变当前进度。
                </p>
              </aside>
            </div>
          </main>
        ) : (
          <main className="account-page">
            <span className="section-eyebrow">YOUR PERSONAL ARCHIVE</span>
            <h1>{titles[page]}</h1>
            <p className="page-description">
              {page === "runs"
                ? "尚未结束的旅程，与你曾经抵达的结局。"
                : page === "archive"
                  ? "你经历过的故事，不会因为离开而消失。"
                  : "每一位调查员，都有自己的观察世界的方式。"}
            </p>
            {!user ? (
              <div className="empty-state">
                <UserRound size={32} />
                <h2>进入你的档案室</h2>
                <p>登录后保存调查，管理角色，重访故事。</p>
                <button
                  className="primary-button"
                  onClick={() => setAuth(true)}
                >
                  登录或创建账号 <ArrowRight size={16} />
                </button>
              </div>
            ) : page === "characters" ? (
              <CharacterLibrary
                owner={user!.id}
                reduced={reduced}
                catalog={characterCatalog}
                characters={templates}
                onCreate={createFromTemplate}
                busy={busy}
                error={error}
              />
            ) : runs.length ? (
              <>
                <div className="run-tabs">
                  {page === "runs"
                    ? `进行中 ${active.length} · 已结束 ${ended.length}`
                    : `共 ${runs.length} 份经历档案`}
                </div>
                <div className="run-list">
                  {runs.map((r) => (
                    <article className="run-card" key={r.id}>
                      <img src={r.cover} alt={r.storyTitle} />
                      <div>
                        <span className={`run-status ${r.status}`}>
                          {r.status === "active" ? "调查进行中" : "已抵达结局"}
                        </span>
                        <h2>{r.storyTitle}</h2>
                        <p>
                          {r.characterName} · {r.chapter} · {r.revision + 1}{" "}
                          段经历
                        </p>
                        <small>
                          最后保存{" "}
                          {new Date(r.updatedAt).toLocaleString("zh-CN")}
                        </small>
                      </div>
                      <div className="run-buttons">
                        {page === "runs" && (
                          <button
                            className="secondary-button"
                            onClick={() => void loadRun(r.id)}
                          >
                            {r.status === "active" ? "继续调查" : "查看结局"}{" "}
                            <ArrowRight size={15} />
                          </button>
                        )}
                        <button
                          className="text-button"
                          onClick={() => void openHistory(r.id, "read")}
                        >
                          <History size={15} />
                          回忆
                        </button>
                        <button
                          className="text-button"
                          onClick={() => void openHistory(r.id, "replay")}
                        >
                          <Play size={15} />
                          回放
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Compass size={32} />
                <h2>你的第一份档案，尚待书写</h2>
                <p>挑选一份剧本，让故事从这里开始。</p>
                <button
                  className="primary-button"
                  onClick={() => go("library")}
                >
                  前往剧本馆 <ArrowRight size={16} />
                </button>
              </div>
            )}
          </main>
        )}
      </div>
      {auth && (
        <Modal
          title={register ? "创建你的档案室" : "欢迎回到档案室"}
          onClose={() => setAuth(false)}
        >
          <p className="modal-intro">让每一次选择，都有迹可循。</p>
          <form onSubmit={(e) => void authenticate(e)}>
            <label>
              用户名
              <input
                name="username"
                required
                minLength={2}
                maxLength={32}
                autoComplete="username"
                placeholder="你的档案员名字"
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="至少 8 位"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button full" disabled={busy}>
              {busy ? "正在进入…" : register ? "创建账号" : "登录"}
              <ArrowRight size={16} />
            </button>
          </form>
          <button
            className="auth-switch"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "已有账号？登录" : "第一次来？创建账号"}
          </button>
        </Modal>
      )}
      {setup && (
        <SetupModal
          characters={templates}
          diceScope={`${user!.id}:story:${setup.id}`}
          reduced={reduced}
          story={setup}
          onClose={() => setSetup(null)}
          onSubmit={start}
          busy={busy}
          error={error}
        />
      )}
      {result && (
        <Modal
          title="命运已经落定"
          onClose={() => {
            setResult(null);
            setRolling(false);
            clearTimeout(rollTimer.current);
          }}
        >
          <div
            className={`dice-result ${result.success ? "success" : "failure"}`}
          >
            <span>
              {result.label} · 目标值 {result.target}
            </span>
            <DiceAnimation
              sides={100}
              results={result.candidates}
              rolling={rolling}
            />
            <h2>{rolling ? "骰子滚动中…" : checkLabel(result)}</h2>
            <p>
              {rolling
                ? "正在揭示本次判定"
                : `${result.success ? "通过" : "未通过"}检定${result.candidates.length > 1 ? ` · 候选骰点 ${result.candidates.join(" / ")}` : ""}`}
            </p>
            <small>本次判定已保存，刷新不会重新掷骰。</small>
            <button
              className="primary-button full"
              onClick={() => {
                setResult(null);
                setRolling(false);
                clearTimeout(rollTimer.current);
              }}
            >
              继续故事 <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {history && (
        <Modal
          wide
          title={historyMode === "read" ? "本局回忆" : "剧情线回放"}
          onClose={closeHistory}
        >
          <div className="history-toolbar">
            <span>{history.length} 段已发生的经历 · 只读</span>
            <div>
              <button
                className={historyMode === "read" ? "selected" : ""}
                onClick={() => {
                  setHistoryMode("read");
                  setReplaying(false);
                }}
              >
                阅读
              </button>
              <button
                className={historyMode === "replay" ? "selected" : ""}
                onClick={() => setHistoryMode("replay")}
              >
                回放
              </button>
            </div>
          </div>
          {historyMode === "read" ? (
            <div className="history-scroll">
              {history.map((f) => (
                <article className="history-frame" key={f.sequence}>
                  <span className="history-number">
                    {String(f.sequence + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <span className="section-eyebrow">{f.scene.chapter}</span>
                    {f.action && (
                      <p className="history-action">
                        你的行动：{f.action}
                        {f.check &&
                          ` · ${f.check.label} ${f.check.roll}/${f.check.target} · ${checkLabel(f.check)}`}
                      </p>
                    )}
                    <h3>{f.scene.title}</h3>
                    {f.scene.text.map((t, i) => (
                      <p key={i}>{t}</p>
                    ))}
                    {f.memory && (
                      <div className="memory-note">◇ 线索：{f.memory}</div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            history[frameIndex] && (
              <div className="replay">
                <img
                  src={history[frameIndex].scene.background}
                  alt="回放场景"
                />
                <div className="replay-text" key={frameIndex}>
                  <span className="section-eyebrow">
                    {history[frameIndex].scene.chapter}
                  </span>
                  <h2>{history[frameIndex].scene.title}</h2>
                  {history[frameIndex].check && (
                    <p className="memory-note">
                      {history[frameIndex].check!.label}：
                      {history[frameIndex].check!.roll} ·{" "}
                      {checkLabel(history[frameIndex].check!)}
                    </p>
                  )}
                  {history[frameIndex].scene.text.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </div>
                <div className="replay-controls">
                  <button
                    aria-label="回到开始"
                    onClick={() => {
                      setFrameIndex(0);
                      setReplaying(false);
                    }}
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    aria-label={replaying ? "暂停" : "播放"}
                    onClick={() => setReplaying(!replaying)}
                  >
                    {replaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <input
                    aria-label="回放进度"
                    type="range"
                    min={0}
                    max={history.length - 1}
                    value={frameIndex}
                    onChange={(e) => {
                      setFrameIndex(Number(e.target.value));
                      setReplaying(false);
                    }}
                  />
                  <span>
                    {frameIndex + 1} / {history.length}
                  </span>
                  <button
                    aria-label="下一段"
                    disabled={frameIndex === history.length - 1}
                    onClick={() =>
                      setFrameIndex(
                        Math.min(history.length - 1, frameIndex + 1),
                      )
                    }
                  >
                    <SkipForward size={18} />
                  </button>
                </div>
              </div>
            )
          )}
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
