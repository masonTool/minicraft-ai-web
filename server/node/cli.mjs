/**
 * Node 版服务端的启动参数（目前只有端口）
 *
 * 端口原先只能用环境变量覆盖：`PORT=9000 npm run server`。补命令行参数是为了两件事：
 *   1. `npm run server -- --port 9000` 是"给脚本传参"的通用直觉，不用记环境变量前缀；
 *      Windows 的 cmd / PowerShell 写法还不一样（`$env:PORT=9000; npm run server`）。
 *   2. 环境里遗留的 `PORT` 不该顶掉**手写在命令行上**的值——两张同时开着的终端
 *      很容易一个带 `PORT` 一个不带，出问题很难看出是哪一层生效。
 *
 * **优先级：命令行参数 > 环境变量 `PORT` > `DEFAULT_PORT`**。
 *
 * 单独成模块（而不是写在 `index.mjs` 里）是为了可测：`index.mjs` 一 import 就会监听端口，
 * 没办法对一个"解析函数"写断言。
 */

import { DEFAULT_PORT } from './protocol.mjs';

/** 0 = 交给系统挑（测试与并行工作树用）；65535 是 TCP 端口上限 */
const MIN_PORT = 0;
const MAX_PORT = 65535;

export const PORT_USAGE = '用法：node server/node/index.mjs [--port <端口>]（等价于 PORT=<端口>）';

/**
 * 从 argv 里找端口；**没写就返回 null**。
 *
 * 为什么不直接回落到默认值：调用方要能区分"没写"和"写了 0"——`PORT=0` 是合法值
 * （系统挑端口），`||` / 三元里用真值判断会把它当成没写。
 *
 * 支持 `--port 9000` / `--port=9000` / `-p 9000` 三种写法；其余参数一律忽略
 * （服务端没有别的开关，多余参数交给未来的自己，不要在这里报错拦下来）。
 */
export function parsePortArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let raw;
    if (arg === '--port' || arg === '-p') raw = argv[i + 1];
    else if (arg.startsWith('--port=')) raw = arg.slice('--port='.length);
    else continue;
    return toPort(raw, `参数 ${arg}`);
  }
  return null;
}

/**
 * 最终生效的端口：命令行 > 环境变量 > 默认值。
 *
 * `argv` / `env` 都显式传进来（默认取当前进程的），这样测试不用改 `process.argv`。
 */
export function resolvePort({ argv = process.argv.slice(2), env = process.env } = {}) {
  const fromArg = parsePortArg(argv);
  if (fromArg !== null) return fromArg;
  const fromEnv = env.PORT;
  if (fromEnv === undefined || fromEnv === '') return DEFAULT_PORT;
  return toPort(fromEnv, 'PORT');
}

/**
 * 转成端口号，不合法就**抛错**。
 *
 * 为什么不静默回落到默认端口：`--port 90o0`（手滑打成字母 o）如果悄悄用 8887，
 * 表现是"两台机器各自跑了一份世界、却都以为自己连上了"，比启动即失败难查得多。
 */
function toPort(raw, source) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const port = Number(text);
  if (text === '' || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    const shown = raw === undefined ? '（缺值）' : JSON.stringify(raw);
    throw new Error(`${source} 的端口不合法：${shown}（应为 ${MIN_PORT}~${MAX_PORT} 的整数）`);
  }
  return port;
}
