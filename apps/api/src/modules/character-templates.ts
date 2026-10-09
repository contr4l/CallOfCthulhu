import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  CharacterTemplate,
  CharacterTemplateCatalog,
  CharacterTemplateGroup,
} from "../../../../packages/contracts/index.js";
const score = z.number().int().min(0).max(99);
const attributes = z
  .object({
    str: score,
    con: score,
    siz: score,
    dex: score,
    app: score,
    int: score,
    pow: score,
    edu: score,
  })
  .strict();
export const templateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    defaultName: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    occupation: z.string().min(1),
    sourceStoryId: z.string(),
    sourceStoryTitle: z.string(),
    attributes,
    skills: z.record(z.string(), score),
    hp: z.number().int().positive(),
    sanity: score,
    mp: z.number().int().nonnegative(),
    damageBonus: z.string(),
    build: z.number().int(),
    movement: z.number().int().nonnegative(),
    luckFormula: z.literal("3d6x5"),
    source: z
      .object({
        publisher: z.string(),
        url: z.url(),
        pdfUrl: z.url(),
        localPath: z.string().regex(/^sources\/[a-z0-9-]+\.pdf$/),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
  })
  .strict();
const groupSchema = z
  .object({
    storyId: z.string(),
    title: z.string(),
    status: z.enum(["official-pregenerated", "guided-creation"]),
    description: z.string(),
    sourceUrl: z.url(),
    templateFiles: z.array(z.string().regex(/^[a-z0-9-]+\.json$/)),
  })
  .strict();
export function loadCharacterTemplates(root: string): CharacterTemplateCatalog {
  const groups: CharacterTemplateGroup[] = [],
    templates: CharacterTemplate[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(root, entry.name),
      group = groupSchema.parse(
        JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
      );
    if (group.storyId !== entry.name)
      throw new Error("角色目录与剧本标识不匹配");
    if (group.status === "guided-creation" && group.templateFiles.length)
      throw new Error("剧情建卡不能标为预生成角色");
    groups.push(group);
    for (const file of group.templateFiles) {
      const template = templateSchema.parse(
        JSON.parse(readFileSync(join(dir, file), "utf8")),
      );
      if (
        template.sourceStoryId !== group.storyId ||
        templates.some((t) => t.id === template.id)
      )
        throw new Error("模板剧本不匹配或标识重复");
      const digest = createHash("sha256")
        .update(readFileSync(join(dir, template.source.localPath)))
        .digest("hex");
      if (digest !== template.source.sha256)
        throw new Error("角色卡原件校验值不匹配");
      if (
        template.hp !==
          Math.floor(
            (template.attributes.con + template.attributes.siz) / 10,
          ) ||
        template.mp !== Math.floor(template.attributes.pow / 5) ||
        template.sanity !== template.attributes.pow
      )
        throw new Error("预设角色的初始派生值不一致");
      templates.push(template);
    }
  }
  return { groups, templates };
}
