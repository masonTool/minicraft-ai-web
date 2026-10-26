/**
 * 服务端的世界快照落盘（联机13）。
 *
 * 为什么要有：服务端原来全在内存里，`Ctrl+C` / 重启 / 容器重建之后，队友们搭的东西、
 * 箱子里的内容全没了（客户端那边的增量存档还在，但连上来的新玩家拿到的快照是空的，
 * 于是"同一个人换个设备进来，世界变回原始地形"）。
 *
 * 三件事：
 *  1. **原子写**：先写 `<file>.tmp` 再 `rename`——直接写目标文件的话，写到一半断电会留下
 *     半个 JSON，下次启动既读不出来、也没法判断它是不是"最后一版好数据"。
 *  2. **损坏回退**：读失败时把坏文件改名成 `<file>.broken-<时间戳>` 再重新开始。**不能
 *     静静删掉**——里面可能还有人工能救的部分，而且"删掉 + 下轮保存"会让现场彻底消失。
 *  3. **定时 + 退出保存**：定时器兜住"进程被 kill -9"以外的所有情况；正常退出（SIGINT /
 *     SIGTERM）再补一次，把最后几秒的改动留住。
 *
 * 只依赖 `node:fs` / `node:path`，没有第三方库，可以被测试直接 import。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 快照格式版本：字段一旦不兼容就 +1，读到不认识的版本按"损坏"处理。
 *
 * v2（用户 2026-10-26）：**不再存世界数据**——世界以房主本地存档为唯一真相，服务端只当
 * 这一局的会话缓存（房间一结束就清）。v1 里那四张表（edits/containers/signs/frames）
 * 仍然**读得进来**（时间/天数/天气照用），但调用方一律丢弃它们，下一次保存自然写成 v2。
 */
export const SNAPSHOT_VERSION = 2;
/**
 * 还读得懂的版本。
 *
 * 为什么不把 v1 当"损坏"：那样会把一份内容完好的存档改名成 `.broken-<时间戳>`，
 * 日志里还得说一句"存档损坏"——而它其实只是旧格式，时间/天气/天数照样是有效的。
 */
const READABLE_VERSIONS = new Set([1, SNAPSHOT_VERSION]);

/**
 * 读快照。
 *
 * @returns {{data: object|null, reason: 'ok'|'missing'|'broken'}}
 */
export function readSnapshot(file, log = () => {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log(`读存档失败（${error.code ?? error.message}），按空世界启动`);
      return { data: null, reason: 'broken' };
    }
    return { data: null, reason: 'missing' };
  }

  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('顶层不是对象');
    if (!READABLE_VERSIONS.has(data.version)) throw new Error(`版本 ${data.version} 不认识`);
    return { data, reason: 'ok' };
  } catch (error) {
    // 损坏：先备份再重来。备份名带时间戳，连坏两次不会互相覆盖
    const backup = `${file}.broken-${Date.now()}`;
    try {
      renameSync(file, backup);
      log(`存档损坏（${error.message}），已备份为 ${backup}，按空世界启动`);
    } catch (renameError) {
      log(`存档损坏（${error.message}），备份也失败（${renameError.message}），按空世界启动`);
    }
    return { data: null, reason: 'broken' };
  }
}

/** 原子写：tmp + rename。返回是否成功（磁盘满/只读时不该把服务端搞崩） */
export function writeSnapshot(file, data) {
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 定时保存。返回 `{ stop }`——退出流程里要先 stop，否则可能在保存过程中再触发一次。
 */
export function startAutoSave(file, snapshot, { intervalMs = 30_000, log = () => {} } = {}) {
  const timer = setInterval(() => {
    const data = snapshot();
    if (!writeSnapshot(file, data)) log('定时保存失败（磁盘满或无权限？）');
  }, intervalMs);
  // 不拖住进程退出：测试里 spawn 服务端，收尾要能干净收
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      return writeSnapshot(file, snapshot());
    },
  };
}
