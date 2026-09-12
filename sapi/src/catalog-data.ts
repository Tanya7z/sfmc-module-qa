/** 控件目录用的静态示例数据，不含 Minecraft 依赖，便于单测。 */

export function catalogDemoData(): Record<string, unknown> {
  return {
    // 测试世界已启用的 [RP] DogeLake（world_resource_packs.json）
    imagePack: "70201c92-14fd-4227-a774-ed0ed6d29ce2",
    imageSrc: "textures/items/kanameisi.png",
    items: [
      { id: "alpha", name: "甲项" },
      { id: "beta", name: "乙项" },
    ],
  };
}

export function catalogEcho(input: Record<string, unknown>): {
  ok: boolean;
  message: string;
} {
  return { ok: true, message: String(input.text ?? "") };
}
