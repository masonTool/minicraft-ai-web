/**
 * 桌面端的「主机服务器」：把 Node 版服务端作为**子进程**拉起来（2026-10-30）。
 *
 * 为什么用子进程而不是在主进程里跑：服务端是长生命周期的 CPU/网络活，
 * 放进主进程会和窗口、渲染进程抢同一个事件循环——一局人多的时候窗口会卡。
 * 子进程还能在崩溃时被单独重启，不牵连界面。
 *
 * ▶ 生命周期口径与 Android 一致（用户 2026-10-30）：
 *   只有玩家在游戏里当房主时才存在；
 *   退出世界 / 关掉应用 → 立刻停；
 *   应用崩溃或被强杀时，子进程随父进程退出（Electron 会带走，且下面还有一层 `detached:false`）。
 *
 * 端口固定 8887，与 Android/iOS 一致：换端口 = 换地址，队友保存的房间号就失效了。
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

/** 与 Android/iOS 一致的默认端口 */
export const GAME_SERVER_PORT = 8887;

/** 本机局域网 IPv4（拿不到返回 null），与 Android 侧 `localIp()` 同口径 */
export function lanIpv4() {
  const groups = networkInterfaces();
  for (const list of Object.values(groups)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (item.address.startsWith('169.254.')) continue; // 链路本地，队友连不上
      return item.address;
    }
  }
  return null;
}

/** 探一次端口通不通；通了说明服务端真的绑上了（而不是"进程起来了"） */
function probe(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export function createGameServer({ scriptPath, dataDir, log = console.log }) {
  let child = null;
  let ready = false;
  let timer = null;

  const stopPolling = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const stop = () => {
    stopPolling();
    ready = false;
    if (child === null) return;
    try {
      child.kill();
    } catch {
      // 已经没了
    }
    child = null;
  };

  const start = (seed = 0) => {
    if (child !== null) return;
    const env = {
      ...process.env,
      // Electron 的二进制在带上这个变量后就是纯 Node，不必额外装运行时
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(GAME_SERVER_PORT),
      DATA_DIR: dataDir,
      // 看门狗用：父进程（本进程）被强杀时，子进程会发现自己被收养然后退出
      MINICRAFT_PARENT_PID: String(process.pid),
    };
    if (Number.isFinite(seed) && seed !== 0) env.SEED = String(seed);
    child = spawn(process.execPath, [scriptPath], {
      env,
      stdio: 'ignore',
      windowsHide: true,
      // 不脱离父进程：Electron 退出时子进程必须跟着走，否则就是"网络上的残留"
      detached: false,
    });
    child.once('exit', (code) => {
      if (child !== null) log(`[server] 子进程退出 code=${code}`);
      child = null;
      ready = false;
      stopPolling();
    });
    // 绑端口要几十~几百毫秒；玩家那边是每 120ms 轮询 `serverPort()` 的，这里等它真的通
    stopPolling();
    const deadline = Date.now() + 5000;
    timer = setInterval(() => {
      void probe(GAME_SERVER_PORT).then((ok) => {
        if (ok) {
          ready = true;
          stopPolling();
        } else if (Date.now() > deadline) {
          log('[server] 5 秒内没绑上端口');
          stopPolling();
        }
      });
    }, 120);
  };

  return {
    start,
    stop,
    /** 0 = 没在跑（网页侧据此判断"能不能开房"） */
    port: () => (ready ? GAME_SERVER_PORT : 0),
    ip: lanIpv4,
  };
}
