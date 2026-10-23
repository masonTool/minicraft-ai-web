/**
 * 中文文案·标签表（多语言 P2-3c3 起）
 *
 * 第一批是**状态效果名**（30 条）：它原来在 `survival/StatusEffects.ts` 里当常量表，
 * 于是 HUD、药水说明、药箭说明、命令帮助的 `/effect` 下拉全都拿不到英文。
 * P2-5 的其余标签族（附魔 / 群系 / 维度 / 音效组 / 朝向 / 旗帜图案…）也进这个文件。
 */

export const label = {
  "label.effect.speed": "速度",
  "label.effect.slowness": "缓慢",
  "label.effect.haste": "急迫",
  "label.effect.mining_fatigue": "挖掘疲劳",
  "label.effect.strength": "力量",
  "label.effect.instant_health": "瞬间治疗",
  "label.effect.instant_damage": "瞬间伤害",
  "label.effect.jump_boost": "跳跃提升",
  "label.effect.nausea": "反胃",
  "label.effect.regeneration": "生命恢复",
  "label.effect.resistance": "抗性提升",
  "label.effect.fire_resistance": "抗火",
  "label.effect.water_breathing": "水下呼吸",
  "label.effect.invisibility": "隐身",
  "label.effect.blindness": "失明",
  "label.effect.night_vision": "夜视",
  "label.effect.hunger": "饥饿",
  "label.effect.weakness": "虚弱",
  "label.effect.poison": "中毒",
  "label.effect.wither": "凋零",
  "label.effect.health_boost": "生命提升",
  "label.effect.absorption": "伤害吸收",
  "label.effect.saturation": "饱和",
  "label.effect.levitation": "飘浮",
  "label.effect.slow_falling": "缓降",
  "label.effect.conduit_power": "潮涌能量",
  "label.effect.dolphins_grace": "海豚的恩惠",
  "label.effect.bad_omen": "不祥之兆",
  "label.effect.hero_of_the_village": "村庄英雄",
  "label.effect.darkness": "黑暗",
} as const;
