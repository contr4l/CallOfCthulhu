import { resolve } from "node:path";
import { loadCharacterTemplates } from "../../apps/api/src/modules/character-templates.js";
const catalog = loadCharacterTemplates(resolve("chars"));
for (const group of catalog.groups)
  console.log(
    `${group.title}：${group.status === "guided-creation" ? "随剧情建卡，无预生成角色" : `${group.templateFiles.length} 个官方模板`}。`,
  );
console.log("角色结构、派生值及原始 PDF SHA-256 校验通过。");
