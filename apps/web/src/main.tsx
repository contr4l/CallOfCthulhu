import type { CharacterLibraryEntry } from "../../../packages/character-library/index";
import { STORY_UNLOCKS } from "../../../packages/contracts/shop";
import { version as gameVersion } from "../../../package.json";
import { ShopLibrary } from "./components/ShopLibrary";
import type { ShopState, CheckWindow } from "../../../packages/contracts/shop";
import { createUuid } from "./uuid";
import {
  AchievementLibrary,
  EndingAchievement,
} from "./components/AchievementLibrary";
import { CheckExplanation } from "./components/CheckExplanation";
import { NarrativeText } from "./components/NarrativeText";
import { ReadingProvider, initialReading, selectedReading } from "./reading";
import {
  CheckOutcomeText,
  checkOutcomeClass,
} from "./components/CheckOutcomeText";
import {
  ReadingSettings,
  initialTheme,
  type ReadingTheme,
  type PageScroll,
} from "./components/ReadingSettings";
import { CollectionLibrary } from "./components/CollectionLibrary";
import { SceneInputForm } from "./components/SceneInputForm";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  ShoppingBag,
  Flame,
  Search,
  Check,
  LogOut,
  Pause,
  Play,
  SkipForward,
  RotateCcw,
  Menu,
  LockKeyhole,
  Trophy,
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
  CharacterProfile,
  RuleDiceResult,
  SceneIllustration,
  CharacterTemplateCatalog,
} from "../../../packages/contracts/index";
import { api, ApiError } from "./api";
import { audio } from "./audio";
import "./styles.css";
import { CharacterCard } from "./components/CharacterCard";
import { CampaignState } from "./components/CampaignState";
import { FearRecord } from "./components/FearRecord";
import { FearSkillChoice } from "./components/FearSkillChoice";
import { ruleDiceDescription } from "./rule-dice";
import { Modal } from "./components/Modal";
import { DiceAnimation, diceStorageKey } from "./components/DiceRoller";
import { SetupModal } from "./components/SetupModal";
import { CharacterLibrary } from "./components/CharacterLibrary";
const FEATURED_STORY_ID = "alone-against-flames";
const STORY_ORDER: readonly string[] = [FEATURED_STORY_ID, ...STORY_UNLOCKS.map((item) => item.storyId)];
const AVAILABLE_STORY_IDS = new Set([
  FEATURED_STORY_ID,
  "alone-against-fear",
  "alone-against-frost",
  "alone-against-static",
  "alone-against-tide",
]);
type Page =
  | "library"
  | "runs"
  | "archive"
  | "characters"
  | "achievements"
  | "shop"
  | "play";
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
function resultSuccess(result: CheckResult) {
  return result.combat
    ? ["hit", "dodged"].includes(result.combat.result)
    : result.success;
}
function checkLabel(result: CheckResult) {
  if (result.combat)
    return (
      {
        hit: "你命中了对手",
        hurt: "对手命中了你",
        dodged: "你避开了攻击",
        miss: "本次没有命中",
      } as const
    )[result.combat.result];
  if (result.opponent) return result.success ? "对抗胜出" : "对抗未胜出";
  return result.success
    ? gradeLabels[result.grade]
    : result.grade === "fumble"
      ? "大失败"
      : "未通过检定";
}
function readerTitle(scene: SceneView) {
  return scene.title.replace(/\s*[·]\s*\d+$/, "").trim();
}
function App() {
  const [reading, setReading] = useState(initialReading);
  const [theme, setTheme] = useState<ReadingTheme>(initialTheme);
  const [pageScroll, setPageScroll] = useState<PageScroll>(() =>
    localStorage.getItem("reading-scroll") === "preserve" ? "preserve" : "top",
  );
  const narrativeRef = useRef<HTMLElement>(null);
  const readingPosition = useRef<{
    y: number;
    visitId: string;
    initial?: boolean;
    revision?: number;
  } | null>(null);
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState<Page>("library");
  const [stories, setStories] = useState<StorySummary[]>([]),
    [runs, setRuns] = useState<RunSummary[]>([]),
    [templates, setTemplates] = useState<
      CharacterLibraryEntry[]
    >([]);
  const [setupPresetId, setSetupPresetId] = useState<string | undefined>();
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
  const [ruleDice, setRuleDice] = useState<RuleDiceResult | null>(null);
  const [mapView, setMapView] = useState<SceneIllustration | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null),
    [dicePhase, setDicePhase] = useState<"ready" | "rolling" | "revealed">(
      "ready",
    ),
    [history, setHistory] = useState<HistoryFrame[] | null>(null),
    [historyMode, setHistoryMode] = useState<"read" | "replay">("read"),
    [frameIndex, setFrameIndex] = useState(0),
    [replaying, setReplaying] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [selectedAssistance, setSelectedAssistance] = useState(false);
  const [canReroll, setCanReroll] = useState(false);
  const [resumeCheckRun, setResumeCheckRun] = useState<string | null>(null);
  const rolling = dicePhase === "rolling";
  const diceStarted = useRef(false);
  // The server saves the result immediately; reveal its scene only after the player sees the dice.
  const pendingDiceScene = useRef<SceneView | null>(null);
  const diceGroupsRemaining = useRef(0);
  const lock = useRef(false),
    rollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    sceneRef = useRef<SceneView | null>(null);
  sceneRef.current = scene;
  const immersive = page === "play" && !!scene;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("reading-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("reading-scroll", pageScroll);
  }, [pageScroll]);
  useLayoutEffect(() => {
    const position = readingPosition.current;
    if (
      !immersive ||
      !scene ||
      !position ||
      (!position.initial && position.revision === scene.revision)
    )
      return;
    readingPosition.current = null;
    if (
      position.initial ||
      (scene.visitId !== position.visitId && pageScroll === "top")
    ) {
      const top = narrativeRef.current
        ? window.scrollY + narrativeRef.current.getBoundingClientRect().top - 64
        : 0;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    } else if (pageScroll === "preserve")
      window.scrollTo({ top: position.y, behavior: "instant" });
  }, [scene?.revision, scene?.visitId, immersive, pageScroll]);
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setAuth(true);
    }
  }
  async function refresh(includeShop = true) {
    const [r, c, wallet] = await Promise.all([
      api<RunSummary[]>("/runs"),
      api<CharacterLibraryEntry[]>("/characters"),
      includeShop ? api<ShopState>("/shop") : Promise.resolve(null),
    ]);
    setRuns(r);
    setTemplates(c);
    if (wallet) setShop(wallet);
  }
  function go(next: Page) {
    setMobileMenu(false);
    setPage(next);
    if (next === "library" && user)
      void api<ShopState>("/shop")
        .then(setShop)
        .catch(() => {});
    setScene(null);
    setRuleDice(null);
    setMapView(null);
    setResult(null);
    pendingDiceScene.current = null;
    setCanReroll(false);
    setSelectedAssistance(false);
    setHistory(null);
    setReplaying(false);
    location.hash = `/${next}`;
    audio.music();
    setError("");
  }
  async function loadRun(id: string) {
    const requestedFrom = location.hash;
    try {
      setBusy(true);
      setResult(null);
      const s = await api<SceneView>(`/runs/${encodeURIComponent(id)}`);
      if (location.hash !== requestedFrom) return;
      readingPosition.current = {
        y: window.scrollY,
        visitId: s.visitId,
        initial: true,
      };
      let displayScene = s;
      pendingDiceScene.current = null;
      const receiptKey = `rule-dice:${s.runId}`;
      const checkWindow = await api<CheckWindow | null>(
        `/runs/${s.runId}/check-window`,
      );
      // A late response must not reopen a run after the reader navigates away.
      if (location.hash !== requestedFrom) return;
      setCanReroll(!!checkWindow);
      if (checkWindow) {
        sessionStorage.setItem(
          receiptKey,
          JSON.stringify({
            revision: s.revision,
            check: checkWindow.check,
            before: checkWindow.before,
          }),
        );
        sessionStorage.removeItem(`pending:${s.runId}`);
      }
      const receipt = sessionStorage.getItem(receiptKey);
      setRuleDice(null);
      if (receipt) {
        try {
          const saved = JSON.parse(receipt) as Pick<
            CommandResponse,
            "dice" | "check"
          > & { revision: number; before?: SceneView };
          if (saved.revision === s.revision) {
            if (saved.before?.runId === s.runId) {
              displayScene = saved.before;
              pendingDiceScene.current = s;
            }
            setRuleDice(saved.dice ?? null);
            setResult(saved.check ?? null);
            setDicePhase("ready");
            diceStarted.current = false;
          } else sessionStorage.removeItem(receiptKey);
        } catch {
          sessionStorage.removeItem(receiptKey);
        }
      }
      setScene(displayScene);
      setError(
        sessionStorage.getItem(`pending:${s.runId}`)
          ? "上次行动的响应尚未确认。请重试以取得已保存的结果。"
          : "",
      );
      setPage("play");
      setHistory(null);
      location.hash = `/play/${id}`;
      audio.music(displayScene.music);
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
        setStories(s.sort((a, b) => {
          const rank = (id: string) => { const index = STORY_ORDER.indexOf(id); return index < 0 ? STORY_ORDER.length : index; };
          return rank(a.id) - rank(b.id);
        }));
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
        if (
          [
            "library",
            "runs",
            "archive",
            "characters",
            "achievements",
            "shop",
          ].includes(p)
        )
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
        ...(register ? { inviteCode: f.get("inviteCode") } : {}),
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
        ...(setup.creationPolicy === "guided" && f.get("age")
          ? { age: Number(f.get("age")) }
          : {}),
        ...(custom ? { skills } : {}),
      });
      sessionStorage.removeItem(
        diceStorageKey(`${user!.id}:story:${setup.id}`),
      );
      setSetup(null);
      setSetupPresetId(undefined);
      readingPosition.current = {
        y: window.scrollY,
        visitId: s.visitId,
        initial: true,
      };
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
    const retry = actionId === "shop-reroll";
    const s = retry ? pendingDiceScene.current : sceneRef.current;
    const beforeView = sceneRef.current;
    if (
      !s ||
      lock.current ||
      (!retry && (pendingDiceScene.current || ruleDice || result))
    )
      return;
    readingPosition.current = {
      y: window.scrollY,
      visitId: s.visitId,
      revision: s.revision,
    };
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
            commandId: createUuid(),
            expectedRevision: s.revision,
            actionId,
            ...(!retry && selectedAssistance
              ? { shopItem: "target-plus-10" as const }
              : {}),
            ...(input ? { input } : {}),
          };
      sessionStorage.setItem(key, JSON.stringify(body));
      const response = await api<CommandResponse>(
        `/runs/${s.runId}/commands`,
        body,
      );
      sessionStorage.removeItem(key);
      setSelectedAssistance(false);
      setCanReroll(!!response.canReroll);
      // A delayed idempotent response must not replace a newer authoritative view.
      const current = sceneRef.current;
      if (
        current?.runId === response.scene.runId &&
        current.revision <= response.scene.revision
      ) {
        if (response.dice || response.check) {
          pendingDiceScene.current = response.scene;
        } else {
          setScene(response.scene);
          audio.music(response.scene.music);
        }
      }
      if (response.dice || response.check) {
        sessionStorage.setItem(
          `rule-dice:${s.runId}`,
          JSON.stringify({
            revision: response.scene.revision,
            dice: response.dice,
            check: response.check,
            before: beforeView,
          }),
        );
        setRuleDice(response.dice ?? null);
        setResult(response.check ?? null);
        clearTimeout(rollTimer.current);
        diceStarted.current = false;
        diceGroupsRemaining.current = 0;
        setDicePhase("ready");
      }
      await refresh(!!body.shopItem || retry);
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
  function startStoryDice(
    dice: RuleDiceResult | null,
    check: CheckResult | null,
  ) {
    clearTimeout(rollTimer.current);
    diceStarted.current = true;
    diceGroupsRemaining.current = dice?.groups.length ?? 1;
    setDicePhase("rolling");
    audio.sfx("roll");
    rollTimer.current = setTimeout(() => {
      diceGroupsRemaining.current = 0;
      setDicePhase("revealed");
      if (check) audio.sfx(resultSuccess(check) ? "success" : "fail");
    }, 10000);
  }
  function rollStoryDice() {
    if (diceStarted.current || (!ruleDice && !result)) return;
    startStoryDice(ruleDice, result);
  }
  function finishStoryDice() {
    if (!diceStarted.current || diceGroupsRemaining.current <= 0) return;
    diceGroupsRemaining.current--;
    if (diceGroupsRemaining.current > 0) return;
    clearTimeout(rollTimer.current);
    setDicePhase("revealed");
    if (result) audio.sfx(resultSuccess(result) ? "success" : "fail");
  }
  async function closeStoryDice() {
    if (dicePhase !== "revealed" || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const authoritative = pendingDiceScene.current ?? scene;
      if (authoritative && canReroll)
        await api(`/runs/${authoritative.runId}/check-window/close`, {
          expectedRevision: authoritative.revision,
        });
      setCanReroll(false);
      const next = pendingDiceScene.current;
      if (next) {
        pendingDiceScene.current = null;
        setScene(next);
        audio.music(next.music);
      }
      if (scene) sessionStorage.removeItem(`rule-dice:${scene.runId}`);
      setRuleDice(null);
      setResult(null);
      setDicePhase("ready");
      diceStarted.current = false;
      clearTimeout(rollTimer.current);
    } catch (e) {
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
    { page: "achievements" as Page, label: "成就", icon: Trophy },
    { page: "shop" as Page, label: "商店", icon: ShoppingBag },
    { page: "archive" as Page, label: "回忆档案", icon: History },
    { page: "characters" as Page, label: "调查员", icon: UserRound },
  ];
  const active = runs.filter((r) => r.status === "active"),
    ended = runs.filter((r) => r.status === "ended");
  const featured = stories.find((story) => story.id === FEATURED_STORY_ID);
  const isStoryUnlocked = (storyId: string) =>
    !STORY_UNLOCKS.some((item) => item.storyId === storyId) ||
    !!shop?.storyUnlocks?.some((item) => item.storyId === storyId && item.unlocked);
  const filtered = stories.filter((s) =>
    `${s.title}${s.description}${s.tags.join("")}`.includes(search),
  );
  const titles = {
    library: "剧本馆",
    runs: "我的调查",
    archive: "回忆档案",
    characters: "调查员",
    achievements: "成就",
    shop: "商店",
    play: scene?.storyTitle ?? "调查进行中",
  };
  useEffect(() => {
    localStorage.setItem("reading-options", JSON.stringify(reading));
  }, [reading]);
  const readingPreferences = {
    reading,
    onReading: setReading,
    englishAvailable: !immersive || !!scene?.reading?.en,
    theme,
    onTheme: setTheme,
    sound,
    onSound: () => {
      audio.enable(!sound);
      setSound(!sound);
    },
    reduced,
    onReduced: () => setReduced(!reduced),
    scroll: pageScroll,
    onScroll: setPageScroll,
  };
  return (
    <ReadingProvider options={reading} reduced={reduced}>
      <div
        className={`app-shell ${immersive ? "is-reading" : ""}`}
        data-reading-font={reading.font}
        style={
          { "--reading-size": `${reading.fontSize}px` } as React.CSSProperties
        }
      >
        {immersive && (
          <ReadingSettings
            {...readingPreferences}
            immersive
            onExit={() => go("runs")}
          />
        )}
        {!immersive && (
          <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
            <a className="brand" href="#/library" onClick={() => go("library")}>
              <span className="brand-mark">
                <Flame size={23} />
              </span>
              <span>
                余烬档案
                <small className="brand-version" aria-label="游戏版本">
                  v{gameVersion}
                </small>
              </span>
            </a>
            <div className="sidebar-label">调查档案</div>
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
              <small>无主持人 · 克苏鲁独行冒险</small>
            </div>
          </aside>
        )}
        <div className="workspace">
          {!immersive && (
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
                <ReadingSettings {...readingPreferences} />
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
          )}
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
              <div className="page-title">
                <div>
                  <h1>独行调查</h1>
                </div>
              </div>
              {featured && (
                <section className="featured">
                  <img
                    className="featured-art"
                    src={featured.cover}
                    alt={featured.title}
                  />
                  <div className="featured-shade" />
                  <div className="featured-content">
                    <div className="feature-tag">
                      <span />
                      推荐剧本
                    </div>
                    <span className="feature-subtitle">
                      {featured.subtitle}
                    </span>
                    <h2>{featured.title}</h2>
                    <p>
                      {featured.id === "alone-against-flames"
                        ? "旅途中的一次抛锚，让你在烬头村留宿。村民正在准备一场庆典。"
                        : featured.description}
                    </p>
                    <div className="feature-meta">
                      <span>
                        <BookOpen size={14} /> {featured.duration}
                      </span>
                      <span>多重结局</span>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => {
                        if (!user) {
                          setAuth(true);
                          return;
                        }
                        setSetup(featured);
                      }}
                    >
                      开启调查 <ArrowRight size={17} />
                    </button>
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
                    <strong>继续调查</strong>
                    <span>
                      {active[0].storyTitle} · {active[0].characterName} ·{" "}
                      {active[0].chapter}
                    </span>
                  </div>
                  <ArrowRight size={16} />
                </button>
              )}
              <div className="collection-header">
                <div>
                  <h2>
                    探索剧本{" "}
                    <span>{stories.length.toString().padStart(2, "0")}</span>
                  </h2>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="搜索剧本"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="搜索剧本"
                  />
                </label>
              </div>
              <div className="story-grid">
                {filtered.map((s) => (
                  <article
                    className={`story-card ${s.accent}${AVAILABLE_STORY_IDS.has(s.id) && isStoryUnlocked(s.id) ? "" : " is-locked"}`}
                    key={s.id}
                  >
                    <div className="card-image">
                      <img src={s.cover} alt={s.title} />
                      <span className="card-type">
                        {AVAILABLE_STORY_IDS.has(s.id) &&
                        isStoryUnlocked(s.id)
                          ? "可游玩"
                          : "已锁定"}
                      </span>
                      <button
                        className="card-open"
                        aria-label={
                          AVAILABLE_STORY_IDS.has(s.id)
                            ? !isStoryUnlocked(s.id)
                              ? `解锁${s.title}`
                              : `开始${s.title}`
                            : `已锁定：${s.title}`
                        }
                        disabled={!AVAILABLE_STORY_IDS.has(s.id)}
                        title={
                          AVAILABLE_STORY_IDS.has(s.id)
                            ? !isStoryUnlocked(s.id)
                              ? `解锁${s.title}`
                              : `开始${s.title}`
                            : "此剧本暂未开放"
                        }
                        onClick={() => {
                          if (!AVAILABLE_STORY_IDS.has(s.id)) return;
                          if (!user) {
                            setAuth(true);
                            return;
                          }
                          if (!isStoryUnlocked(s.id)) {
                            go("shop");
                            return;
                          }
                          setSetup(s);
                        }}
                      >
                        {AVAILABLE_STORY_IDS.has(s.id) &&
                        isStoryUnlocked(s.id) ? (
                          <ArrowUpRight size={21} />
                        ) : (
                          <LockKeyhole size={18} />
                        )}
                      </button>
                    </div>
                    <div className="card-body">
                      <span className="card-subtitle">{s.subtitle}</span>
                      <h3>{s.title}</h3>
                      <p>{s.description}</p>
                      {STORY_UNLOCKS.filter((item) => item.storyId === s.id && !shop?.storyUnlocks?.some((entry) => entry.storyId === s.id && entry.unlocked)).map((item) => (
                        <p key={item.storyId}>通关《{item.prerequisiteTitle}》至少一次后，使用 {item.price} 点解锁。</p>
                      ))}
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
            </main>
          ) : page === "play" && scene ? (
            <main
              className="play-page"
              data-revision={scene.revision}
              data-visit={scene.visitId}
            >
              <div className="play-layout">
                <div className="story-panel">
                  <div className="scene-image">
                    <img src={scene.background} alt={scene.title} />
                  </div>
                  <article
                    className="narrative"
                    ref={narrativeRef}
                    aria-label="剧情正文"
                  >
                    <h1>
                      <CheckOutcomeText
                        text={readerTitle({
                          ...scene,
                          title: selectedReading(scene, reading.language).title,
                        })}
                      />
                    </h1>
                    <NarrativeText
                      scene={scene}
                      identity={scene.visitId}
                      animate
                    />
                    {scene.illustration && (
                      <figure className="scene-map">
                        <button
                          aria-label="放大地图"
                          onClick={() => setMapView(scene.illustration!)}
                        >
                          <img
                            src={scene.illustration.src}
                            alt={scene.illustration.alt}
                          />
                        </button>
                        <figcaption>{scene.illustration.caption}</figcaption>
                      </figure>
                    )}
                    {scene.help?.map((hint, i) => (
                      <p className="check-note" key={`help-${i}`}>
                        <CheckOutcomeText text={hint} />
                      </p>
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
                    {scene.check && (!scene.combat || scene.actions.some(action => action.id === "accept" || action.id === "spend-luck")) && (
                      <label className="check-assistance">
                        <input
                          type="checkbox"
                          checked={selectedAssistance}
                          disabled={
                            busy ||
                            !!result ||
                            !!ruleDice ||
                            !shop?.inventory["target-plus-10"] ||
                            scene.check.target >= 99
                          }
                          onChange={(event) =>
                            setSelectedAssistance(event.target.checked)
                          }
                        />
                        <span>
                          使用命运助力 · 本次目标＋10（持有{" "}
                          {shop?.inventory["target-plus-10"] ?? 0}）
                        </span>
                      </label>
                    )}
                    {scene.ending && (
                      <div className="ending">
                        <span>调查结局</span>
                        <h2>{scene.ending}</h2>
                        {((!result && !ruleDice) ||
                          dicePhase === "revealed") && (
                          <EndingAchievement
                            scene={scene}
                            onViewAchievements={() => go("achievements")}
                          />
                        )}
                      </div>
                    )}
                    {scene.fear?.pending?.prompt && <p className="check-note"><CheckOutcomeText text={scene.fear.pending.prompt} /></p>}
                    {scene.notices?.map((notice, i) => (
                      <p className="check-note" key={`notice-${i}`}>
                        <CheckOutcomeText text={notice} />
                      </p>
                    ))}
                    {scene.combat && (
                      <p className="check-note">
                        第 {scene.combat.round} 回合 · {scene.combat.name} ·
                        {scene.combat.damageGoal
                          ? <>{scene.combat.damageGoal.label}：已造成 {scene.combat.damageGoal.dealt}，还需 {scene.combat.damageGoal.remaining}</>
                          : <>剩余生命 {scene.combat.hp}</>}
                        {scene.combat.enemyLives && (
                          <> · 各对手：{scene.combat.enemyLives.join("、")}</>
                        )}
                        <br />
                        {scene.combat.turn}
                        <br />
                        你的武器：{scene.combat.weapon}
                        {scene.combat.armor
                          ? ` · 对手本轮剩余护甲 ${scene.combat.armor}`
                          : ""}
                      </p>
                    )}
                    {scene.input && (
                      <SceneInputForm
                        key={`${scene.visitId}-${scene.revision}`}
                        input={scene.input}
                        draftKey={`allocation:${user?.id}:${scene.runId}:${scene.visitId}:${scene.revision}`}
                        busy={busy || !!result || !!ruleDice}
                        onSubmit={(action, input) =>
                          void command(
                            scene.actions.length === 1 && !scene.actions.some((available) => available.id === action)
                              ? scene.actions[0].id
                              : action,
                            input,
                          )
                        }
                      />
                    )}
                    <div className="choices">
                      {scene.fear?.pending?.kind === "creation-skills" && (
                        <FearSkillChoice
                          key={`${scene.visitId}-${scene.revision}`}
                          pending={scene.fear.pending}
                          actions={scene.actions}
                          busy={busy || !!result || !!ruleDice}
                          onChoose={(id) => void command(id)}
                        />
                      )}
                      {!scene.input &&
                        scene.fear?.pending?.kind !== "creation-skills" &&
                        scene.actions.map((a, i) => (
                          <button
                            key={a.id}
                            disabled={busy || !!result || !!ruleDice}
                            onClick={() => void command(a.id)}
                          >
                            <span className="choice-index">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span>
                              <CheckOutcomeText text={a.label} />
                              {a.hint && (
                                <small>
                                  <CheckOutcomeText text={a.hint} />
                                </small>
                              )}
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
                        回到剧本馆 <ArrowRight size={16} />
                      </button>
                    )}
                    <div className="narrative-bottom">
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
                  <CharacterCard character={scene.character} compact />
                  <CampaignState
                    calendar={scene.calendar}
                    party={scene.party}
                  />
                  {scene.fear && <FearRecord fear={scene.fear} />}
                  {scene.frostCombat && <section className="record-sheet" aria-label="战斗队列">
                    <h3>战斗 · 第 {scene.frostCombat.round} 回合</h3>
                    {scene.frostCombat.damageInput ? <p>分配本次伤害后继续。</p> : <p>
                      当前行动：{scene.frostCombat.phase === "party"
                        ? scene.frostCombat.party.find(actor => actor.id === scene.frostCombat!.currentActorId)?.name
                        : scene.frostCombat.enemies.find(enemy => enemy.id === scene.frostCombat!.currentEnemyId)?.name}
                    </p>}
                    {scene.frostCombat.enemies.map(enemy => <p key={enemy.id}>{enemy.name} · 生命 {enemy.hp}/{enemy.maxHp}</p>)}
                  </section>}
                  {!!scene.playerNotes?.length && <section className="record-sheet player-notes" aria-label="我的笔记">
                    <h3>我的笔记</h3>
                    {scene.playerNotes.map(note => <details key={note.key}>
                      <summary>{note.label}</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.text}</p>
                    </details>)}
                  </section>}
                  {!!(scene.registrations?.length || scene.records?.length) && (
                    <section className="record-sheet">
                      <h3>本局记录表</h3>
                      {scene.registrations
                        ? scene.registrations.map((record) => (
                            <p key={record.key}>✓ {record.label}</p>
                          ))
                        : scene.records?.map((k) => <p key={k}>✓ {k}</p>)}
                    </section>
                  )}
                  <div className="inventory">
                    <h3>随身物品</h3>
                    {scene.inventory.length ? (
                      scene.inventory.map((i) => (
                        <div key={i.key}>
                          ◇ {i.label}
                          {i.quantity !== undefined ? ` × ${i.quantity}` : ""}
                          {i.illustration && (
                            <button
                              className="text-button"
                              onClick={() => setMapView(i.illustration!)}
                            >
                              查看地图
                            </button>
                          )}
                        </div>
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
                </aside>
              </div>
            </main>
          ) : (
            <main className="account-page">
              <h1>{titles[page]}</h1>
              <p className="page-description">
                {page === "runs"
                  ? "继续未完成的调查，或重看已抵达的结局。"
                  : page === "achievements"
                    ? "每个结局对应一项成就，抵达后解锁并可领取余烬点。"
                    : page === "shop"
                      ? "购买检定道具，准备下一次调查。"
                      : page === "archive"
                        ? "收集的结局与章节，以及历次调查的回忆。"
                        : "创建和管理调查员，填写角色资料。"}
              </p>
              {!user ? (
                <div className="empty-state">
                  <UserRound size={32} />
                  <h2>进入你的档案室</h2>
                  <p>登录后保存调查进度，管理调查员。</p>
                  <button
                    className="primary-button"
                    onClick={() => setAuth(true)}
                  >
                    登录或创建账号 <ArrowRight size={16} />
                  </button>
                </div>
              ) : page === "achievements" ? (
                <AchievementLibrary
                  key={user.id}
                  owner={user.id}
                  balance={shop?.balance ?? 0}
                  onShopChange={setShop}
                  onOpenShop={() => go("shop")}
                  onViewEnding={(id) => void loadRun(id)}
                />
              ) : page === "shop" ? (
                <ShopLibrary
                  key={user.id}
                  owner={user.id}
                  onChange={setShop}
                  resumeRun={resumeCheckRun}
                  onResume={(id) => void loadRun(id)}
                />
              ) : page === "characters" ? (
                <CharacterLibrary
                  owner={user!.id}
                  reduced={reduced}
                  catalog={characterCatalog}
                  stories={stories.filter(s => AVAILABLE_STORY_IDS.has(s.id))}
                  isStoryUnlocked={isStoryUnlocked}
                  onStartStory={(story, presetId) => {
                    if (!isStoryUnlocked(story.id)) { go("shop"); return; }
                    setError("");
                    setSetupPresetId(presetId);
                    setSetup(story);
                  }}
                  onResume={(id) => void loadRun(id)}
                  characters={templates}
                  onCreate={createFromTemplate}
                  onEdit={async (
                    id: string,
                    name: string,
                    profile: CharacterProfile,
                  ) => {
                    await api(`/characters/${id}`, { name, profile }, "PATCH");
                    await refresh();
                  }}
                  busy={busy}
                  error={error}
                />
              ) : page === "archive" ? (
                <>
                  <CollectionLibrary
                    key={user.id}
                    owner={user.id}
                    onReplay={(id) => void openHistory(id, "replay")}
                  />
                  <h2>旅程档案</h2>
                  <div className="run-list">
                    {runs.map((r) => (
                      <article className="run-card" key={r.id}>
                        <img src={r.cover} alt={r.storyTitle} />
                        <div>
                          <h3>{r.storyTitle}</h3>
                          <p>
                            {r.characterName} · {r.chapter}
                          </p>
                        </div>
                        <div className="run-buttons">
                          <button
                            className="text-button"
                            onClick={() => void openHistory(r.id, "read")}
                          >
                            回忆
                          </button>
                          <button
                            className="text-button"
                            onClick={() => void openHistory(r.id, "replay")}
                          >
                            回放
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : runs.length ? (
                <>
                  <div className="run-tabs">
                    {`进行中 ${active.length} · 已结束 ${ended.length}`}
                  </div>
                  <div className="run-list">
                    {runs.map((r) => (
                      <article className="run-card" key={r.id}>
                        <img src={r.cover} alt={r.storyTitle} />
                        <div>
                          <span className={`run-status ${r.status}`}>
                            {r.status === "active"
                              ? "调查进行中"
                              : "已抵达结局"}
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
                  <h2>还没有调查记录</h2>
                  <p>从剧本馆开始第一段调查。</p>
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
              {register && (
                <label>
                  邀请码
                  <input
                    name="inviteCode"
                    required
                    maxLength={128}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="输入你收到的邀请码"
                  />
                </label>
              )}
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
            initialPresetId={setupPresetId}
            onClose={() => { setSetup(null); setSetupPresetId(undefined); }}
            onSubmit={start}
            busy={busy}
            error={error}
          />
        )}
        {mapView && (
          <Modal wide title="烬头村地图" onClose={() => setMapView(null)}>
            <img className="map-full" src={mapView.src} alt={mapView.alt} />
            <p className="setup-note">{mapView.caption}</p>
          </Modal>
        )}
        {ruleDice && (
          <Modal
            title="规则骰结果"
            onClose={closeStoryDice}
            dismissible={dicePhase === "revealed"}
          >
            <div className="dice-result">
              <span>{ruleDice.label}</span>
              {dicePhase === "ready" ? (
                <div className="dice-ready">
                  <Dices size={60} />
                  <p>
                    {ruleDice.groups
                      .map((g) => `${g.results.length}D${g.sides}`)
                      .join(ruleDice.aggregate === false ? "；" : " + ")}
                    {ruleDice.multiplier !== 1
                      ? ` × ${ruleDice.multiplier}`
                      : ""}
                  </p>
                </div>
              ) : (
                ruleDice.groups.map((group, i) => (
                  <DiceAnimation
                    key={i}
                    sides={group.sides}
                    results={group.results}
                    rolling={rolling}
                    reduced={reduced}
                    onComplete={finishStoryDice}
                  />
                ))
              )}
              <div role="status" aria-live="polite">
                {rolling && <p>骰子摇动中…</p>}
                {dicePhase === "revealed" && (
                  <p className="roll-equation">
                    {ruleDiceDescription(ruleDice)}
                  </p>
                )}
              </div>
              <button
                className="primary-button full"
                disabled={rolling || busy}
                onClick={
                  dicePhase === "revealed" ? closeStoryDice : rollStoryDice
                }
              >
                {dicePhase === "revealed"
                  ? "继续故事"
                  : rolling
                    ? "正在掷骰…"
                    : "掷骰"}
              </button>
            </div>
          </Modal>
        )}
        {result && !ruleDice && (
          <Modal
            title="检定结果"
            onClose={closeStoryDice}
            dismissible={dicePhase === "revealed"}
          >
            <div
              className={`dice-result ${dicePhase === "revealed" ? (resultSuccess(result) ? "success" : "failure") : ""}`}
            >
              <span>
                {result.label} · 目标值 {result.target}
              </span>
              {dicePhase === "ready" ? (
                <div className="dice-ready">
                  <Dices size={60} />
                  <p>D100</p>
                </div>
              ) : (
                <DiceAnimation
                  sides={100}
                  results={result.candidates}
                  rolling={rolling}
                  reduced={reduced}
                  onComplete={finishStoryDice}
                />
              )}
              <div role="status" aria-live="polite">
                {rolling && <p>骰子摇动中…</p>}
                {dicePhase === "revealed" && (
                  <>
                    <h2 className={checkOutcomeClass(resultSuccess(result))}>
                      {checkLabel(result)}
                    </h2>
                    <CheckExplanation result={result} />
                    {canReroll && (
                      <div className="check-shop-actions">
                        <button
                          className="secondary-button"
                          disabled={busy || !shop?.inventory.reroll}
                          onClick={() => void command("shop-reroll")}
                        >
                          使用重掷券（持有 {shop?.inventory.reroll ?? 0}）
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setResumeCheckRun(scene!.runId);
                            go("shop");
                          }}
                        >
                          前往商店
                        </button>
                      </div>
                    )}
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    {result.combat && (
                      <p className="combat-resolution">
                        第 {result.combat.round} 回合 · {result.combat.action}：
                        {result.combat.recipient === "player"
                          ? `你受到 ${result.combat.damage} 点伤害`
                          : result.combat.recipient === "enemy"
                            ? `${result.combat.enemyName} 受到 ${result.combat.damage} 点伤害`
                            : "无人受到伤害"}
                        。
                      </p>
                    )}
                  </>
                )}
              </div>
              <button
                className="primary-button full"
                disabled={rolling || busy}
                onClick={
                  dicePhase === "revealed" ? closeStoryDice : rollStoryDice
                }
              >
                {dicePhase === "revealed"
                  ? "继续故事"
                  : rolling
                    ? "正在掷骰…"
                    : "掷骰"}
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
              <span>{history.length} 段经历</span>
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
                      {f.action && (
                        <p className="history-action">
                          你的行动：{f.action}
                          {f.check && (
                            <>
                              {` · ${f.check.label} ${f.check.roll}/${f.check.target} · `}
                              <span
                                className={checkOutcomeClass(
                                  resultSuccess(f.check),
                                )}
                              >
                                {checkLabel(f.check)}
                              </span>
                            </>
                          )}
                        </p>
                      )}
                      {f.dice && (
                        <p className="history-action">
                          {f.dice.label}：{ruleDiceDescription(f.dice)}
                        </p>
                      )}
                      <h3>
                        <CheckOutcomeText
                          text={readerTitle({
                            ...f.scene,
                            title: selectedReading(f.scene, reading.language)
                              .title,
                          })}
                        />
                      </h3>
                      <NarrativeText
                        scene={f.scene}
                        identity={String(f.sequence)}
                      />
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
                    <h2>
                      <CheckOutcomeText
                        text={readerTitle({
                          ...history[frameIndex].scene,
                          title: selectedReading(
                            history[frameIndex].scene,
                            reading.language,
                          ).title,
                        })}
                      />
                    </h2>
                    {history[frameIndex].discarded && (
                      <p className="check-note">已被重掷取代</p>
                    )}
                    {history[frameIndex].check && (
                      <p className="memory-note">
                        {history[frameIndex].check!.label}：
                        {history[frameIndex].check!.roll} ·{" "}
                        <span
                          className={checkOutcomeClass(
                            resultSuccess(history[frameIndex].check!),
                          )}
                        >
                          {checkLabel(history[frameIndex].check!)}
                        </span>
                      </p>
                    )}
                    {history[frameIndex].dice && (
                      <p className="memory-note">
                        {history[frameIndex].dice!.label}：
                        {ruleDiceDescription(history[frameIndex].dice!)}
                      </p>
                    )}
                    <NarrativeText
                      scene={history[frameIndex].scene}
                      identity={String(frameIndex)}
                    />
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
    </ReadingProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
