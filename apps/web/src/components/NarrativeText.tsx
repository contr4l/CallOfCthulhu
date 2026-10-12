import { useEffect, useRef, useState } from "react";
import type { SceneView } from "../../../../packages/contracts/index";
import { selectedReading, useReading } from "../reading";
import { CheckOutcomeText } from "./CheckOutcomeText";
export function NarrativeText({
  scene,
  identity,
  animate = false,
}: {
  scene: Pick<SceneView, "text" | "title" | "reading">;
  identity: string;
  animate?: boolean;
}) {
  const { options, reduced, convert, converting } = useReading();
  const lines = selectedReading(scene, options.language).text.map(convert);
  const animation =
    animate && !reduced && !converting ? options.animation : "none";
  return (
    <AnimatedParagraphs
      key={`${identity}:${lines.join("\n")}:${animation}:${options.speed}:${options.paragraphDelay}`}
      lang={
        options.language === "en" && !!scene.reading?.en
          ? "en"
          : options.script === "traditional"
            ? "zh-Hant"
            : "zh-Hans"
      }
      lines={lines}
      animation={animation}
      speed={options.speed}
      delay={options.paragraphDelay}
    />
  );
}
function AnimatedParagraphs({
  lang,
  lines,
  animation,
  speed,
  delay,
}: {
  lang: string;
  lines: string[];
  animation: "none" | "typewriter" | "paragraph";
  speed: number;
  delay: number;
}) {
  const chars = lines.map((line) => Array.from(line));
  const total =
    animation === "paragraph"
      ? lines.length
      : chars.reduce((n, line) => n + line.length, 0);
  const [shown, setShown] = useState(
    animation === "none"
      ? total
      : animation === "paragraph"
        ? Math.min(1, total)
        : 0,
  );
  const done = useRef(false);
  useEffect(() => {
    if (animation === "none" || total === 0) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (done.current) return;
      const count =
        animation === "paragraph"
          ? 1 + Math.floor((now - start) / delay)
          : Math.floor(((now - start) * speed) / 1000);
      setShown(Math.min(total, count));
      if (count < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation, total, speed, delay]);
  let offset = 0;
  return (
    <div
      className="narrative-text"
      lang={lang}
      data-animation={animation}
      data-complete={shown >= total}
    >
      {shown < total && (
        <button
          className="text-button finish-text"
          onClick={() => {
            done.current = true;
            setShown(total);
          }}
        >
          显示全文
        </button>
      )}
      {lines.map((line, i) => {
        const prefix = chars[i].slice(0, Math.max(0, shown - offset)).join("");
        offset += chars[i].length;
        return (
          <p
            key={i}
            className={
              animation === "paragraph" && !done.current
                ? shown > i
                  ? "paragraph-visible"
                  : "paragraph-hidden"
                : ""
            }
          >
            {animation === "typewriter" && shown < total ? (
              <>
                <span className="reveal-ghost" aria-hidden="true">
                  {line}
                </span>
                <span className="revealed-copy" aria-hidden="true">
                  <CheckOutcomeText text={prefix} />
                </span>
                <span className="sr-only">{line}</span>
              </>
            ) : (
              <CheckOutcomeText text={line} />
            )}
          </p>
        );
      })}
    </div>
  );
}
