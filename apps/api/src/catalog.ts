import playtimeEstimates from "./modules/playtime-estimates.json" with {
  type: "json",
};
import { instruction, targets } from "./program-schema.js";
import {
  fragmentReference,
  loadFragmentStory,
} from "./modules/story-fragments.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Story, StorySummary } from "../../../packages/contracts/index.js";
const condition = z.object({ flag: z.string(), equals: z.boolean() }).strict();
const effect = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("flag"), key: z.string(), value: z.boolean() })
    .strict(),
  z
    .object({ type: z.enum(["hp", "sanity"]), amount: z.number().int() })
    .strict(),
  z
    .object({ type: z.literal("item"), key: z.string(), label: z.string() })
    .strict(),
]);
const asset = z.string().regex(/^\/(art|media)\/[a-zA-Z0-9._/-]+$/);
const readingLocale = z
  .object({ title: z.string(), text: z.array(z.string()) })
  .strict();
const readingFields = z
  .object({ en: readingLocale.optional(), "zh-CN": readingLocale.optional() })
  .strict();
export const storySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string(),
    rulesVersion: z.enum(["coc7-subset@1", "coc7-solo@2"]),
    creationPolicy: z.enum(["guided", "fixed"]).optional(),
    healthPolicy: z.enum(["static", "tide"]).optional(),
    spendLuck: z.boolean().optional(),
    source: z
      .object({
        file: z.string(),
        sha256: z.string(),
        notes: z.array(z.string()),
      })
      .strict()
      .optional(),
    title: z.string(),
    subtitle: z.string(),
    description: z.string(),
    duration: z.string(),
    difficulty: z.string(),
    cover: asset,
    accent: z.string(),
    tags: z.array(z.string()),
    entry: z.string(),
    presets: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            description: z.string(),
            occupation: z.string(),
            attributes: z
              .record(z.string(), z.number().int().min(0).max(99))
              .optional(),
            mp: z.number().int().nonnegative().optional(),
            damageBonus: z.string().optional(),
            templateId: z.string().optional(),
            movement: z.number().int().nonnegative().optional(),
            build: z.number().int().optional(),
            specializations: z.record(z.string(), z.string()).optional(),
            profile: z
              .object({
                age: z.number().int().positive().optional(),
                pronouns: z.string().optional(),
                birthplace: z.string().optional(),
                residence: z.string().optional(),
              })
              .strict()
              .optional(),
            skills: z.record(z.string(), z.number().int().min(0).max(99)),
            hp: z.number().int().positive(),
            sanity: z.number().int().min(0).max(99),
          })
          .strict(),
      )
      .min(1),
    nodes: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            chapter: z.string(),
            text: z.array(z.string()).min(1),
            reading: readingFields.optional(),
            help: z.array(z.string()).optional(),
            illustration: z
              .object({
                key: z.string(),
                src: asset,
                alt: z.string(),
                caption: z.string().optional(),
              })
              .strict()
              .optional(),
            type: z.enum(["narrative", "choice", "check", "ending", "program"]),
            program: z.array(instruction).min(1).optional(),
            sourceId: z.string().optional(),
            background: asset,
            music: asset.optional(),
            next: z.string().optional(),
            choices: z
              .array(
                z
                  .object({
                    id: z.string(),
                    label: z.string(),
                    hint: z.string().optional(),
                    target: z.string(),
                    condition: condition.optional(),
                    effects: z.array(effect).optional(),
                  })
                  .strict(),
              )
              .optional(),
            check: z
              .object({
                skill: z.string(),
                label: z.string(),
                difficulty: z.enum(["regular", "hard", "extreme"]),
                bonusDice: z.number().int().min(0).max(2).optional(),
                penaltyDice: z.number().int().min(0).max(2).optional(),
                success: z.string(),
                failure: z.string(),
              })
              .strict()
              .optional(),
            enterEffects: z.array(effect).optional(),
            memory: z.string().optional(),
            ending: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const runtimeGraphSchema = storySchema
  .omit({ nodes: true })
  .extend({
    format: z.literal("coc-runtime-graph@1"),
    nodes: z
      .array(
        storySchema.shape.nodes.element
          .omit({ text: true, reading: true })
          .extend({
            fragment: fragmentReference,
          }),
      )
      .min(1),
  })
  .strict();

export function validateStory(input: unknown): Story {
  const s = storySchema.parse(input) as Story;
  const ids = new Set(s.nodes.map((n) => n.id));
  if (ids.size !== s.nodes.length || !ids.has(s.entry))
    throw new Error("节点重复或入口缺失");
  if (new Set(s.presets.map((p) => p.id)).size !== s.presets.length)
    throw new Error("角色 ID 重复");
  const graph = new Map<string, string[]>();
  for (const n of s.nodes) {
    if (n.type === "check" && (!n.check || n.choices || n.next))
      throw new Error(`${n.id} 检定配置错误`);
    if (n.type === "narrative" && (!n.next || n.check || n.choices))
      throw new Error(`${n.id} 继续配置错误`);
    if (n.type === "choice" && (!n.choices?.length || n.next || n.check))
      throw new Error(`${n.id} 选项配置错误`);
    if (n.type === "ending" && (!n.ending || n.next || n.choices || n.check))
      throw new Error(`${n.id} 结局配置错误`);
    if (
      n.choices &&
      new Set(n.choices.map((c) => c.id)).size !== n.choices.length
    )
      throw new Error(`${n.id} 行动 ID 重复`);
    if (
      n.type === "program" &&
      (s.rulesVersion !== "coc7-solo@2" ||
        !n.program ||
        n.check ||
        n.next ||
        n.choices)
    )
      throw new Error(`${n.id} 程序配置错误`);
    if (n.program) {
      for (const [i, step] of n.program.entries()) {
        const registrations =
          step.kind === "effects" || step.kind === "rollEffects"
            ? step.effects
            : step.kind === "choices"
              ? step.choices.flatMap((c) => c.effects ?? [])
              : step.kind === "check"
                ? [
                    ...(step.check.successEffects ?? []),
                    ...(step.check.failureEffects ?? []),
                  ]
                : [];
        for (const mutation of registrations)
          if (
            mutation.op === "register" &&
            mutation.kind === "skill" &&
            mutation.key !== "$last" &&
            s.presets.some((p) => !(mutation.key in p.skills))
          )
            throw new Error(`${n.id} 未知登记技能 ${mutation.key}`);
        if (
          step.kind === "check" &&
          !step.check.target &&
          s.presets.some(
            (p) =>
              !(step.check.skill in p.skills) &&
              !(step.check.skill in (p.attributes ?? {})) &&
              !["sanity", "luck"].includes(step.check.skill),
          )
        )
          throw new Error(`${n.id} 未知检定对象 ${step.check.skill}`);
        if (
          step.kind === "choices" &&
          new Set(step.choices.map((c) => c.id)).size !== step.choices.length
        )
          throw new Error(`${n.id} 重复行动`);
        if (
          i === n.program.length - 1 &&
          !["choices", "check", "combat", "random", "route", "end"].includes(
            step.kind,
          )
        )
          throw new Error(`${n.id} 程序缺少出口`);
        if (
          i === n.program.length - 1 &&
          step.kind === "check" &&
          (!step.check.success || !step.check.failure)
        )
          throw new Error(`${n.id} 检定缺少出口`);
        if (step.kind === "random" && step.targets.length !== step.sides)
          throw new Error(`${n.id} 随机分支数量错误`);
        if (
          step.kind === "check" &&
          step.check.push &&
          ["sanity", "luck", "fightingBrawl", "dodge"].includes(
            step.check.skill,
          )
        )
          throw new Error(`${n.id} 此检定不可孤注一掷`);
      }
    }
    const nodeTargets = [
      ...(n.program ? targets(n.program) : []),
      ...(n.next ? [n.next] : []),
      ...(n.choices?.map((c) => c.target) ?? []),
      ...(n.check ? [n.check.success, n.check.failure] : []),
    ];
    if (nodeTargets.some((t) => !ids.has(t)))
      throw new Error(`${n.id} 引用缺失节点`);
    if (
      n.check &&
      s.presets.some(
        (p) =>
          !(n.check!.skill in p.skills) &&
          !(n.check!.skill in (p.attributes ?? {})) &&
          !["sanity", "luck"].includes(n.check!.skill),
      )
    )
      throw new Error(`${n.id} 未知技能`);
    graph.set(n.id, nodeTargets);
  }
  const visited = new Set<string>(),
    stack = new Set<string>();
  function visit(id: string) {
    if (stack.has(id)) {
      if (s.rulesVersion === "coc7-subset@1")
        throw new Error("首版内容不支持未声明的剧情循环");
      return;
    }
    if (visited.has(id)) return;
    stack.add(id);
    for (const t of graph.get(id)!) visit(t);
    stack.delete(id);
    visited.add(id);
  }
  visit(s.entry);
  if (s.healthPolicy === "static")
    for (const id of ["324", "325", "328", "329", "334"]) {
      if (!ids.has(id)) throw new Error(`缺少健康处理节点 ${id}`);
      visit(id);
    }
  if (s.healthPolicy === "tide") {
    if (!ids.has("tide-retirement")) throw new Error("缺少永久性疯狂退场节点");
    visit("tide-retirement");
  }
  if (visited.size !== ids.size) throw new Error("存在不可达节点");
  return s;
}
const readingSidecar = z
  .object({
    storyId: z.string(),
    version: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    nodes: z.record(z.string(), readingFields),
  })
  .strict();
export function loadStories(root: string) {
  const stories = new Map<string, Story>();
  for (const id of readdirSync(root))
    for (const version of readdirSync(join(root, id))) {
      const path = join(root, id, version, "story.json");
      const input = JSON.parse(readFileSync(path, "utf8"));
      const story =
        input.format === "coc-runtime-graph@1"
          ? loadFragmentStory(
              path,
              (data) => runtimeGraphSchema.parse(data),
              validateStory,
            )
          : validateStory(input);
      if (story.id !== id || story.version !== version)
        throw new Error("剧本目录与版本不匹配");
      const readingPath = join(root, id, version, "reading.json");
      if (existsSync(readingPath)) {
        if (input.format === "coc-runtime-graph@1")
          throw new Error("片段格式不能同时存放重复正文语言包");
        const reading = readingSidecar.parse(
          JSON.parse(readFileSync(readingPath, "utf8")),
        );
        if (
          reading.storyId !== id ||
          reading.version !== version ||
          Object.keys(reading.nodes).length !== story.nodes.length ||
          story.nodes.some((n) => !reading.nodes[n.id])
        )
          throw new Error("正文语言包与剧本节点不匹配");
        for (const node of story.nodes) node.reading = reading.nodes[node.id];
      }
      stories.set(`${story.id}@${story.version}`, story);
    }
  return stories;
}
export function publicStory(s: Story): StorySummary {
  const { nodes: _nodes, entry: _entry, ...summary } = s;
  const estimate = playtimeEstimates.find(
    (entry) => entry.storyId === s.id && entry.version === s.version,
  );
  return { ...summary, duration: estimate?.duration ?? s.duration };
}
