import type { Story } from "../../packages/contracts/index.js";
export const fixture: Story = {
  id: "alone-against-flames",
  version: "0.0.1",
  rulesVersion: "coc7-subset@1",
  title: "商店测试",
  subtitle: "测试",
  description: "测试",
  duration: "测试",
  difficulty: "测试",
  cover: "/art/train.svg",
  accent: "amber",
  tags: [],
  entry: "entry",
  presets: [
    {
      id: "actor",
      label: "测试",
      description: "测试",
      occupation: "测试",
      skills: { listen: 20 },
      hp: 12,
      sanity: 50,
    },
  ],
  nodes: [
    {
      id: "entry",
      title: "商店测试入口",
      chapter: "测试",
      background: "/art/train.svg",
      text: ["测试入口。"],
      type: "choice",
      choices: [
        { id: "earn-hard", label: "测试困难奖励", target: "255" },
        { id: "earn-easy", label: "测试生还奖励", target: "223-end" },
        { id: "check", label: "进入测试检定", target: "check" },
      ],
    },
    {
      id: "check",
      title: "测试检定",
      chapter: "测试",
      background: "/art/train.svg",
      text: ["进行聆听检定。"],
      type: "check",
      check: {
        skill: "listen",
        label: "聆听",
        difficulty: "regular",
        success: "won",
        failure: "lost",
      },
    },
    ...[
      ["255", "困难奖励"],
      ["223-end", "生还奖励"],
      ["won", "检定成功"],
      ["lost", "检定失败"],
    ].map(([id, title]) => ({
      id,
      title,
      chapter: "测试",
      background: "/art/train.svg",
      text: [title],
      type: "ending" as const,
      ending: title,
      ...(id === "won" || id === "lost"
        ? {
            enterEffects: [
              { type: "hp" as const, amount: id === "won" ? -1 : -4 },
            ],
          }
        : {}),
    })),
  ],
};
