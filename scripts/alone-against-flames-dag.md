# Alone Against the Flames：剧情关系与原文片段

格式为 `coc-story-graph@2`。关系和文本分开存储，没有内嵌 EPUB、Base64、原始 XHTML、字体或图片二进制；原 EPUB 保留在 `scripts`，通过文件名与 SHA-256 追溯。

## 文件结构

```text
scripts/
├── CHA23145 - Alone Against the Flames.epub
├── CHA23145 - Alone Against the Flames.dag.json
└── alone-against-flames/fragments/
    ├── 001.json
    ├── 002.json
    ├── …
    ├── 270.json
    └── supplements.json
```

- **关系图**：270 个节点、421 条边，约 157 KiB。节点只引用片段文件并记录是否结局。边只记录起点、终点、原文段落 ID、来源依据及必要的隐藏跳转条件，没有重复正文。为了兼容此前路径继续使用 `.dag.json` 文件名，实际内容是保留原作回环的有向图，不再保存派生的 SCC DAG、拓扑顺序或冗余索引。
- **原文片段**：每个原书编号段落一个 JSON，270 个文件。`paragraphs` 保留段落标题和每个自然段的原文、自然段 ID、源 EPUB 元素位置。正文与原规则指令完整存储，没有翻译、总结或删改；Unicode、空白和自然段顺序均保留。片段总计约 334 KiB，含附录。
- **附录**：`supplements.json` 保留前言、版权、封面与尾页等其他原文，以及原书图片和链接的来源引用。图片内容仍保存在原 EPUB；这里不重复导出二进制资源。
- **完整性**：关系图中每个片段引用带 SHA-256，后端读取片段时进行校验。原文总共 1,398 个段落，包含编号标题和附录段落；从 EPUB 独立遍历逐段比对，确认没有丢失或重复。

编号段落与自然段各有独立 ID。`001.json` 对应节点 `1`，`1:p0` 是原书标题，`1:p1` 起是正文自然段。边的 `paragraphId` 指向包含选择／检定／跳转文字的自然段；隐藏边的 `ruleParagraphId` 指向秘密规则所在的原文，不在图中重复保存这段文字。

## 后端读取

后端加载器位于 `apps/api/src/modules/source-dag.ts`，保留原有函数名：

```ts
import { loadSourceDag, loadSourceFragment } from './modules/source-dag.js';

const graph = loadSourceDag(graphPath);
const fragment = loadSourceFragment(graphPath, '1', graph);
const body = fragment.paragraphs.filter(p => p.kind === 'body');
const transitions = graph.edges.filter(e => e.source === '1');
```

关系图只读一次；推进到新节点时按需读取对应片段，不需要先加载所有正文，也不需要在运行时打开 EPUB。`validateSourceFragments(graphPath)` 用于导入时检查全部片段、SHA-256、段落 ID、结局和边引用。JSON Schema 分别位于 `tools/story/source-dag.schema.json` 和 `tools/story/source-fragment.schema.json`。

## 转换与验证

```bash
python3 tools/story/epub_graph.py \
  "scripts/CHA23145 - Alone Against the Flames.epub" \
  --output "scripts/CHA23145 - Alone Against the Flames.dag.json"

python3 tools/story/epub_graph.py \
  "scripts/CHA23145 - Alone Against the Flames.epub" \
  --validate "scripts/CHA23145 - Alone Against the Flames.dag.json"

npx tsx tools/story/validate-source-dag.ts \
  "scripts/CHA23145 - Alone Against the Flames.dag.json"
```

Python 校验包括重新转换一致性，以及独立遍历 EPUB 的全部原始段落，与片段中的文字、来源位置和顺序比对。转换时可计算 SCC 与结构可达性用于检查；这些派生结果不写入关系图。

## 原作问题与规则边界

7 个原 EPUB 超链接的 `href` 为空：6→16、76→58、76→52、79→240、79→234、222→13、266→76。关系图按印出的编号建立边，同时保留问题记录。第 25 段的 `go to 3` 没有超链接，但已从原文提取。

第 268 段存在一个孤立的 `1`，未明确表达跳转含义。第 20 段的原文完整保留，但仍没有已确认的入边；不擅自补成 268→20 或 268→1。

7 条隐藏边保留 +100、+10、+20、+40、+50 编号偏移、秘密发现节点和规则段落引用。原文提示与具体编号的对应关系属于转换时的解释，执行前需要审校，不能仅因访问节点就自动跳转。

`runtimePlayable: false` 表示原书规则仍待编译为可执行条件与效果。当前简化游戏引擎还不能直接执行完整建卡、战斗、探索次数、隐藏仪式等内容；本图用于后端内容读取和后续规则编译，不直接加入现有 `stories` 发布目录。选择、检定结果和隐含条件的文字在片段中完整保留，不能将所有出边当作无条件选项。
