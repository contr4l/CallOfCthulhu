import { resolve } from "node:path";
import { validateSourceFragments } from "../../apps/api/src/modules/source-dag.js";
const path = process.argv[2];
if (!path) throw new Error("用法：tsx tools/story/validate-source-dag.ts <file.dag.json>");
console.log(JSON.stringify(validateSourceFragments(resolve(path)), null, 2));
