/**
 * 谁会开门（J3 尾巴，批次 516）
 *
 * 原版：村民与灾厄村民（掠夺者/卫道士/唤魔者/幻术师/女巫）会推开**木门**；
 * 僵尸在困难难度会**砸门**（那是另一套行为，本项目不做）；猪灵、骷髅、蜘蛛都不会。
 *
 * 这里只回答"这一族会不会开门"，寻路那一侧拿到 true 才把**关着的门**当作可走格，
 * 并在贴近时真的把门打开（`EntityContext.openDoor`）。
 *
 * ⚠️ 只认木门：铁门需要红石，原版没有任何生物会开铁门。
 */

const DOOR_OPENERS: ReadonlySet<string> = new Set([
  'villager',
  'pillager',
  'vindicator',
  'evoker',
  'illusioner',
  'witch',
]);

export function opensDoors(typeId: string): boolean {
  return DOOR_OPENERS.has(typeId);
}
