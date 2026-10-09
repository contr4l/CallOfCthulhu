import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

const fileReference = z.object({
  path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const numberId = z.string().regex(/^[1-9][0-9]*$/);
const paragraphId = z.string().regex(/^[1-9][0-9]*:p[0-9]+$/);
export const sourceFragmentSchema = z.object({
  id: numberId, document: z.string(),
  paragraphs: z.array(z.object({
    id: paragraphId, kind: z.enum(["heading", "body"]), text: z.string(), sourceLocation: z.string(),
  }).strict()).min(1),
}).strict();
const supplementsSchema = z.object({
  documents: z.array(z.object({
    document: z.string(), entries: z.array(z.object({
      kind: z.string(), section: z.string(), sourceLocation: z.string(), text: z.string().optional(),
    }).passthrough()),
  }).strict()),
}).strict();
export const sourceDagSchema = z.object({
  format: z.literal("coc-story-graph@2"), id: z.string(), title: z.string(), language: z.string(),
  entry: numberId, runtimePlayable: z.literal(false),
  source: z.object({ filename: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive() }).strict(),
  supplements: fileReference,
  nodes: z.array(z.object({ id: numberId, fragment: fileReference, terminal: z.boolean() }).strict()).min(1),
  edges: z.array(z.object({
    id: z.string(), source: numberId, target: numberId, paragraphId,
    evidence: z.enum(["printed-link-number", "printed-prose-number", "source-arithmetic-secret"]),
    originalHref: z.string().optional(), textOffset: z.number().int().nonnegative().optional(),
    condition: z.object({ type: z.literal("discovered-secret-and-player-choice"), discoveryNodeId: numberId }).strict().optional(),
    ruleParagraphId: paragraphId.optional(), offset: z.number().int().positive().optional(),
  }).strict()),
  issues: z.array(z.record(z.string(), z.unknown())),
}).strict();
export type SourceDag = z.infer<typeof sourceDagSchema>;
export type SourceFragment = z.infer<typeof sourceFragmentSchema>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (message: string): never => { throw new Error(`Source graph: ${message}`); };

/** Relationships only. Scene text is read separately when needed. Cycles are retained. */
export function validateSourceDag(input: unknown): SourceDag {
  const graph = sourceDagSchema.parse(input);
  const ids = new Set(graph.nodes.map(n => n.id));
  const edgeIds = new Set(graph.edges.map(e => e.id));
  if (ids.size !== graph.nodes.length || edgeIds.size !== graph.edges.length || !ids.has(graph.entry))
    fail("duplicate IDs or missing entry");
  const paths = [graph.supplements.path, ...graph.nodes.map(n => n.fragment.path)];
  if (new Set(paths).size !== paths.length) fail("duplicate fragment paths");
  for (const path of paths) if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) fail("invalid fragment path");
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || !e.paragraphId.startsWith(`${e.source}:p`)) fail("invalid transition reference");
    if (e.evidence === "source-arithmetic-secret") {
      if (!e.condition || !ids.has(e.condition.discoveryNodeId) || !e.ruleParagraphId?.startsWith(`${e.condition.discoveryNodeId}:p`) || !e.offset || Number(e.source) + e.offset !== Number(e.target))
        fail("invalid secret reference");
    } else if (e.condition || e.offset || e.ruleParagraphId) fail("unexpected secret condition");
  }
  return graph;
}
export function loadSourceDag(path: string): SourceDag {
  return validateSourceDag(JSON.parse(readFileSync(path, "utf8")));
}
function readReferenced(graphPath: string, ref: z.infer<typeof fileReference>): unknown {
  const root = dirname(resolve(graphPath));
  const path = resolve(root, ref.path);
  const local = relative(root, path);
  if (isAbsolute(local) || local === ".." || local.startsWith("../")) fail("invalid fragment path");
  const bytes = readFileSync(path);
  if (digest(bytes) !== ref.sha256) fail(`fragment integrity mismatch: ${ref.path}`);
  return JSON.parse(bytes.toString("utf8"));
}
export function loadSourceFragment(graphPath: string, nodeId: string, graph = loadSourceDag(graphPath)): SourceFragment {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) fail(`unknown node: ${nodeId}`);
  const fragment = sourceFragmentSchema.parse(readReferenced(graphPath, node!.fragment));
  if (fragment.id !== nodeId || fragment.paragraphs[0].kind !== "heading") fail("fragment identity mismatch");
  for (const [index, p] of fragment.paragraphs.entries()) {
    if (p.id !== `${nodeId}:p${index}` || (index > 0 && p.kind !== "body")) fail("fragment paragraph identity mismatch");
  }
  return fragment;
}
/** Full package check for imports; ordinary scene loads need only one fragment. */
export function validateSourceFragments(graphPath: string, graph = loadSourceDag(graphPath)) {
  const paragraphs = new Map<string, string>();
  for (const node of graph.nodes) {
    const fragment = loadSourceFragment(graphPath, node.id, graph);
    for (const p of fragment.paragraphs) {
      if (paragraphs.has(p.id)) fail("duplicate paragraph");
      paragraphs.set(p.id, p.text);
    }
    const terminal = fragment.paragraphs.some(p => p.kind === "body" && p.text.trim().toLowerCase() === "the end.");
    if (terminal !== node.terminal) fail("terminal mismatch");
  }
  for (const edge of graph.edges) {
    if (!paragraphs.has(edge.paragraphId) || (edge.ruleParagraphId && !paragraphs.has(edge.ruleParagraphId))) fail("missing transition paragraph");
  }
  const supplements = supplementsSchema.parse(readReferenced(graphPath, graph.supplements));
  return { nodes: graph.nodes.length, edges: graph.edges.length,
    originalParagraphs: paragraphs.size + supplements.documents.reduce((sum, d) => sum + d.entries.filter(e => e.kind === "p").length, 0),
    fragmentFiles: graph.nodes.length + 1 };
}
