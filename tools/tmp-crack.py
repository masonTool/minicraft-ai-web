"""临时脚本：给图集加 10 阶段破坏裂纹贴图（用完即删）"""

# ---- 1) 布局里加 10 个贴图名
p = 'src/render/atlasLayout.ts'
s = open(p, encoding='utf-8').read()
old = "  'observer_top',\n  'observer_side',\n] as const;"
new = """  'observer_top',
  'observer_side',
  // 破坏裂纹（10 个阶段）：每一阶段比上一阶段多露出一段裂纹
  'destroy_stage_0',
  'destroy_stage_1',
  'destroy_stage_2',
  'destroy_stage_3',
  'destroy_stage_4',
  'destroy_stage_5',
  'destroy_stage_6',
  'destroy_stage_7',
  'destroy_stage_8',
  'destroy_stage_9',
] as const;"""
assert s.count(old) == 1, 'layout'
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)

# ---- 2) 画师：裂纹按阶段逐段显露
p = 'src/render/TextureAtlas.ts'
s = open(p, encoding='utf-8').read()

anchor = "const PAINTERS: Record<string, Painter> = {"
assert s.count(anchor) == 1, 'painters anchor'

crack_code = '''/**
 * 破坏裂纹（10 个阶段）。
 *
 * 做法：先摆好一组裂纹线段（每条带一个"第几阶段开始出现"的门槛），
 * 某阶段的贴图只画门槛 ≤ 自己的那些线段；线段附近 1 像素内画成深灰，
 * 其余像素完全透明。这样 10 张贴图是**同一条裂纹逐渐加深**，
 * 而不是 10 个互不相干的随机图案（后者看起来像闪烁）。
 */
const CRACK_SEGMENTS: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; stage: number }> = [
  { x0: 7.5, y0: 7.5, x1: 2.5, y1: 3.5, stage: 0 },
  { x0: 7.5, y0: 7.5, x1: 12.5, y1: 4.5, stage: 0 },
  { x0: 2.5, y0: 3.5, x1: 1.5, y1: 0.5, stage: 1 },
  { x0: 12.5, y0: 4.5, x1: 15.0, y1: 2.0, stage: 2 },
  { x0: 7.5, y0: 7.5, x1: 9.5, y1: 13.5, stage: 3 },
  { x0: 7.5, y0: 7.5, x1: 3.0, y1: 12.0, stage: 4 },
  { x0: 9.5, y0: 13.5, x1: 11.5, y1: 15.0, stage: 5 },
  { x0: 3.0, y0: 12.0, x1: 1.0, y1: 14.5, stage: 6 },
  { x0: 10.5, y0: 5.0, x1: 14.0, y1: 8.5, stage: 7 },
  { x0: 5.0, y0: 10.5, x1: 2.0, y1: 8.0, stage: 8 },
  { x0: 1.5, y0: 0.5, x1: 0.5, y1: 3.0, stage: 9 },
];

/** 点到线段的最短距离 */
function distanceToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSq));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** 生成"第 stage 阶段"的裂纹画师（纯函数，同一阶段每次画都一样） */
function crackPainter(stage: number): Painter {
  return (x, y) => {
    // 像素中心（+0.5）参与计算，避免裂纹偏半边
    const px = x + 0.5;
    const py = y + 0.5;
    let nearest = Infinity;
    for (const segment of CRACK_SEGMENTS) {
      if (segment.stage > stage) continue;
      const distance = distanceToSegment(px, py, segment.x0, segment.y0, segment.x1, segment.y1);
      if (distance < nearest) nearest = distance;
    }
    if (nearest > 1.1) return [0, 0, 0, 0];
    // 越靠近裂纹中心越黑、越不透明；边缘 1 像素内做渐变，避免锯齿
    const edge = Math.max(0, 1 - nearest / 1.1);
    const alpha = Math.round(255 * Math.min(1, edge * 1.6) * 0.92);
    const shade = Math.round(28 + (1 - edge) * 40);
    return [shade, shade, shade, alpha];
  };
}

const PAINTERS: Record<string, Painter> = {'''
s = s.replace(anchor, crack_code, 1)

# ---- 3) 注册 10 个画师
old_tail = "  observer_top:"
assert s.count(old_tail) == 1, 'observer_top painter'
# 在 PAINTERS 的末尾（observer_side 之后）加
import re
m = re.search(r"\n\};", s[s.index('const PAINTERS'):])
assert m, 'PAINTERS 结束'
insert_at = s.index('const PAINTERS') + m.start()
extra = "\n  destroy_stage_0: crackPainter(0),\n  destroy_stage_1: crackPainter(1),\n  destroy_stage_2: crackPainter(2),\n  destroy_stage_3: crackPainter(3),\n  destroy_stage_4: crackPainter(4),\n  destroy_stage_5: crackPainter(5),\n  destroy_stage_6: crackPainter(6),\n  destroy_stage_7: crackPainter(7),\n  destroy_stage_8: crackPainter(8),\n  destroy_stage_9: crackPainter(9),"
s = s[:insert_at] + extra + s[insert_at:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
