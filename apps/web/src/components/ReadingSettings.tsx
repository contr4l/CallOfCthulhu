import type { ReadingOptions } from "../reading";
import { CheckOutcomeText } from "./CheckOutcomeText";
import { useState } from "react";
import {
  Palette,
  Volume2,
  VolumeX,
  Sparkles,
  ArrowLeft,
  Settings2,
} from "lucide-react";
import { Modal } from "./Modal";
export const readingThemes = [
  {
    id: "bloodmoon",
    name: "血月",
    description: "炭黑与暗绯红，像烛火照见禁忌仪式。",
    colors: ["#100b0e", "#25151c", "#d2999d"],
  },
  {
    id: "abyss",
    name: "深渊",
    description: "深海墨蓝与冷银，静谧、幽暗、无边。",
    colors: ["#090e18", "#15243b", "#a2b8dc"],
  },
  {
    id: "nightmare",
    name: "梦魇",
    description: "近黑紫与黯淡丁香，梦境边缘的异色。",
    colors: ["#100c19", "#251933", "#bda0d2"],
  },
  {
    id: "sepia",
    name: "旧日手稿",
    description: "焦褐与旧纸骨白，尘封档案中的低语。",
    colors: ["#14100d", "#2c231b", "#ccb28c"],
  },
] as const;
export type ReadingTheme = (typeof readingThemes)[number]["id"];
export type PageScroll = "top" | "preserve";
export function initialTheme(): ReadingTheme {
  try {
    const value = localStorage.getItem("reading-theme");
    if (readingThemes.some((t) => t.id === value)) return value as ReadingTheme;
  } catch {}
  return "bloodmoon";
}
export function ReadingSettings({
  reading,
  onReading,
  englishAvailable = true,
  theme,
  onTheme,
  sound,
  onSound,
  reduced,
  onReduced,
  scroll,
  onScroll,
  onExit,
  immersive = false,
}: {
  reading: ReadingOptions;
  onReading: (value: ReadingOptions) => void;
  englishAvailable?: boolean;
  theme: ReadingTheme;
  onTheme: (theme: ReadingTheme) => void;
  sound: boolean;
  onSound: () => void;
  reduced: boolean;
  onReduced: () => void;
  scroll: PageScroll;
  onScroll: (value: PageScroll) => void;
  onExit?: () => void;
  immersive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {immersive ? (
        <div className="reader-controls" aria-label="阅读设置">
          <button aria-label="返回档案" title="返回档案" onClick={onExit}>
            <ArrowLeft size={19} />
          </button>
          <span className="control-separator" />
          <button
            aria-label={sound ? "关闭声音" : "开启声音"}
            title={sound ? "关闭声音" : "开启声音"}
            aria-pressed={sound}
            onClick={onSound}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            aria-label={reduced ? "启用完整动画" : "简化动画"}
            title={reduced ? "启用完整动画" : "简化动画"}
            aria-pressed={!reduced}
            onClick={onReduced}
          >
            <Sparkles size={19} />
          </button>
          <button
            aria-label="阅读偏好"
            title="配色与阅读偏好"
            onClick={() => setOpen(true)}
          >
            <Settings2 size={19} />
          </button>
        </div>
      ) : (
        <button
          className="icon-button"
          aria-label="选择配色"
          title="选择配色"
          onClick={() => setOpen(true)}
        >
          <Palette size={19} />
        </button>
      )}
      {open && (
        <Modal title="阅读偏好" wide onClose={() => setOpen(false)}>
          <fieldset className="text-preferences">
            <legend>正文显示</legend>
            <label>
              字号 · {reading.fontSize}px
              <input
                aria-label="正文字号"
                type="range"
                min="14"
                max="32"
                step="1"
                value={reading.fontSize}
                onChange={(e) =>
                  onReading({ ...reading, fontSize: Number(e.target.value) })
                }
              />
            </label>
            <div className="reading-fields">
              <label>
                正文字体
                <select
                  value={reading.font}
                  onChange={(e) =>
                    onReading({
                      ...reading,
                      font: e.target.value as ReadingOptions["font"],
                    })
                  }
                >
                  <option value="song">宋体</option>
                  <option value="kai">楷体</option>
                </select>
              </label>
              <label>
                正文语言
                <select
                  value={
                    !englishAvailable && reading.language === "en"
                      ? "zh"
                      : reading.language
                  }
                  onChange={(e) =>
                    onReading({
                      ...reading,
                      language: e.target.value as ReadingOptions["language"],
                    })
                  }
                >
                  <option value="zh">中文</option>
                  <option value="en" disabled={!englishAvailable}>
                    English
                  </option>
                </select>
              </label>
              <label>
                中文字形
                <select
                  value={reading.script}
                  onChange={(e) =>
                    onReading({
                      ...reading,
                      script: e.target.value as ReadingOptions["script"],
                    })
                  }
                >
                  <option value="simplified">简体</option>
                  <option value="traditional">繁體</option>
                </select>
              </label>
              <label>
                文字出现动画
                <select
                  value={reading.animation}
                  onChange={(e) => {
                    const animation = e.target
                      .value as ReadingOptions["animation"];
                    onReading({ ...reading, animation });
                    if (animation !== "none" && reduced) onReduced();
                  }}
                >
                  <option value="none">直接显示</option>
                  <option value="typewriter">打字机</option>
                  <option value="paragraph">逐段落浮现</option>
                </select>
              </label>
            </div>
            {!englishAvailable && <p className="setup-note">暂无英文正文。</p>}
            {reading.animation === "typewriter" && (
              <label>
                打字速度 · {reading.speed} 字／秒
                <input
                  aria-label="打字速度"
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={reading.speed}
                  onChange={(e) =>
                    onReading({ ...reading, speed: Number(e.target.value) })
                  }
                />
              </label>
            )}
            {reading.animation === "paragraph" && (
              <label>
                每段间隔 · {reading.paragraphDelay} 毫秒
                <input
                  aria-label="段落间隔"
                  type="range"
                  min="150"
                  max="2000"
                  step="50"
                  value={reading.paragraphDelay}
                  onChange={(e) =>
                    onReading({
                      ...reading,
                      paragraphDelay: Number(e.target.value),
                    })
                  }
                />
              </label>
            )}
            <p className="reading-font-preview">
              <CheckOutcomeText
                text={
                  reading.language === "en"
                    ? "The night wind stirs the dusty pages. A distant whisper breaks the silence."
                    : "夜风拂过尘封的书页，远处传来无法辨认的低语。"
                }
              />
            </p>
          </fieldset>
          <p className="settings-intro">配色</p>
          <div className="theme-options" role="group" aria-label="配色选择">
            {readingThemes.map((t) => (
              <button
                key={t.id}
                className={`theme-option ${theme === t.id ? "selected" : ""}`}
                aria-pressed={theme === t.id}
                onClick={() => onTheme(t.id)}
              >
                <span className="theme-swatches" aria-hidden="true">
                  {t.colors.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
                <strong>{t.name}</strong>
                <small>{t.description}</small>
              </button>
            ))}
          </div>
          <fieldset className="reading-scroll-options">
            <legend>翻页位置</legend>
            <label>
              <input
                type="radio"
                name="reading-scroll"
                checked={scroll === "top"}
                onChange={() => onScroll("top")}
              />{" "}
              新剧情回到正文开头
            </label>
            <label>
              <input
                type="radio"
                name="reading-scroll"
                checked={scroll === "preserve"}
                onChange={() => onScroll("preserve")}
              />{" "}
              保留当前位置
            </label>
          </fieldset>
          <button
            className="primary-button full"
            onClick={() => setOpen(false)}
          >
            返回阅读
          </button>
        </Modal>
      )}
    </>
  );
}
