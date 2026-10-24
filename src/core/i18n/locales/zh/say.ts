/**
 * 中文文案·局内提示（聊天栏：左上角弹出的那一行 + 展开后的聊天记录）
 *
 * 为什么单开一组，而不是塞进 `chat.*` / `misc.*`：
 *  · `chat.*` 是**聊天框自己的界面文案**（发送键、提示行、候选）；
 *  · `misc.toast.*` 是**快捷栏上方那条 toast**；
 *  · 这里这一组是"游戏过程中说给玩家的一句话"——伤害、饥饿、袭击、唱片机…
 *    它们的共同点是**都进聊天栏**，且数量多、彼此无关，混进上面任何一组都会让那份文件失去主题。
 *
 * ⚠️ 与 `notice.*` 的分工：`notice.*` 是**拼接用的碎片**（伤害原因、来源），
 * 这一组是**完整的句子**。一句里既有中文又有变量就用 `tp()`，别在调用处拼字符串
 * （英文语序会把变量挪到别的句段，这条在批次 425 踩过）。
 */

export const say = {
  // ---- 状态与战斗（T1）
  'say.damage.taken': '受到 {amount} 点伤害：{reasons} · 生命 {health}/20',
  'say.damage.reason': '{cause}（{amount} 点）',
  'say.damage.sep': '；',
  'say.health.gain': '生命 +{amount}（自然恢复或治疗效果）· 当前 {health}/20',
  'say.food.loss': '饥饿值 -{amount}（体力消耗：走动 / 跳跃 / 战斗 / 挖掘）· 剩余 {food}/20{hint}',
  'say.food.lowHint': ' · 快吃点东西，否则会饿到掉血',
  'say.food.gain': '饥饿值 +{amount}（进食 / 饱和效果）· 当前 {food}/20',
  'say.health.low': '生命值偏低（{health}/20）：先躲开敌人或危险方块，吃东西可以回血',
  'say.food.starving': '饥饿值耗尽（体力透支）：会持续掉血，也无法自然回血；快吃东西',
  'say.air.low': '氧气不足（正在水下憋气，剩余 {air}）：浮上水面换气',
  'say.air.empty': '氧气耗尽（已经憋不住）：正在溺水掉血，立刻上浮',
  'say.air.back': '回到水面（已能呼吸）：氧气正在恢复',
  'say.burning': '你着火了（站在火/岩浆里或被点燃）：每秒掉血，跳进水里可熄灭',
  'say.shield.axeBreak': '盾牌被斧头破防（{seconds} 秒）',
  'say.shield.broken': '盾牌碎了',
  'say.totem.saved': '不死图腾救了你一命',
  'say.hardcore.dead': '极限模式：你已死亡，只能以旁观者继续查看这个世界',
  'say.respawn.anchorEmpty': '重生锚的充能耗尽了，回世界出生点复活',
  'say.respawn.bedGone': '你的床不在了，回世界出生点复活',
} as const;
