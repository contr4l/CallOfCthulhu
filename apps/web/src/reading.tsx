import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SceneView } from "../../../packages/contracts/index";
export type ReadingOptions = {
  fontSize: number;
  font: "song" | "kai";
  language: "zh" | "en";
  script: "simplified" | "traditional";
  animation: "none" | "typewriter" | "paragraph";
  speed: number;
  paragraphDelay: number;
};
export const defaultReading: ReadingOptions = {
  fontSize: 20,
  font: "song",
  language: "zh",
  script: "simplified",
  animation: "none",
  speed: 35,
  paragraphDelay: 450,
};
export function initialReading(): ReadingOptions {
  try {
    const saved = JSON.parse(localStorage.getItem("reading-options") ?? "{}");
    const result = { ...defaultReading };
    for (const [key, values] of Object.entries({
      font: ["song", "kai"],
      language: ["zh", "en"],
      script: ["simplified", "traditional"],
      animation: ["none", "typewriter", "paragraph"],
    })) {
      if (values.includes(saved[key]))
        Object.assign(result, { [key]: saved[key] });
    }
    for (const [key, min, max] of [
      ["fontSize", 14, 32],
      ["speed", 5, 100],
      ["paragraphDelay", 150, 2000],
    ] as const) {
      if (Number.isFinite(saved[key]))
        result[key] = Math.max(min, Math.min(max, Math.round(saved[key])));
    }
    return result;
  } catch {
    return { ...defaultReading };
  }
}
const ReadingContext = createContext({
  options: defaultReading,
  reduced: false,
  convert: (text: string) => text,
  converting: false,
});
let conversion: Promise<(text: string) => string> | undefined;
export function ReadingProvider({
  options,
  reduced,
  children,
}: {
  options: ReadingOptions;
  reduced: boolean;
  children: ReactNode;
}) {
  const [converter, setConverter] = useState<((text: string) => string) | null>(
    null,
  );
  useEffect(() => {
    if (options.script !== "traditional" || converter) return;
    let live = true;
    conversion ??= import("opencc-js/cn2t").then((m) =>
      m.Converter({ from: "cn", to: "tw" }),
    );
    void conversion.then((fn) => {
      if (live) setConverter(() => fn);
    });
    return () => {
      live = false;
    };
  }, [options.script, converter]);
  const value = useMemo(
    () => ({
      options,
      reduced,
      converting: options.script === "traditional" && !converter,
      convert: (text: string) =>
        options.script === "traditional" && converter ? converter(text) : text,
    }),
    [options, reduced, converter],
  );
  return (
    <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>
  );
}
export const useReading = () => useContext(ReadingContext);
export function selectedReading(
  scene: Pick<SceneView, "text" | "title" | "reading">,
  language: "zh" | "en",
) {
  return scene.reading?.[language === "en" ? "en" : "zh-CN"] ?? scene;
}
