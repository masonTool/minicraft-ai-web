/**
 * 服务端启动参数（端口）
 *
 * 为什么单独测这一层：`--port` 写错时的**默认行为**很危险——静默回落到 8887 的表现是
 * "两台机器各自跑了一份世界、却都以为自己连上了"，比启动即失败难查得多。
 * 这里把"哪些写法算数 / 哪些必须报错 / 谁优先"钉死，index.mjs 只负责调用。
 */

import { describe, expect, it } from 'vitest';
import { PORT_USAGE, parsePortArg, resolvePort } from '../server/node/cli.mjs';
import { DEFAULT_PORT } from '../server/node/protocol.mjs';

describe('parsePortArg', () => {
  it('支持 --port 9000 / --port=9000 / -p 9000 三种写法', () => {
    expect(parsePortArg(['--port', '9000'])).toBe(9000);
    expect(parsePortArg(['--port=9000'])).toBe(9000);
    expect(parsePortArg(['-p', '9000'])).toBe(9000);
  });

  it('没写端口时返回 null（而不是默认值：调用方要能区分"没写"和"写了 0"）', () => {
    expect(parsePortArg([])).toBeNull();
    expect(parsePortArg(['--verbose'])).toBeNull();
  });

  it('0 是合法值（系统挑端口，并行工作树/测试用）', () => {
    expect(parsePortArg(['--port', '0'])).toBe(0);
    expect(parsePortArg(['--port=0'])).toBe(0);
  });

  it('无关参数不影响解析，位置也不限', () => {
    expect(parsePortArg(['--foo', '--port', '9000', '--bar'])).toBe(9000);
  });

  it('越界 / 非整数 / 缺值 / 空值都算错', () => {
    for (const argv of [
      ['--port', 'abc'],
      ['--port', '90o0'], // 手滑把 0 打成字母 o
      ['--port', '70000'],
      ['--port', '-1'],
      ['--port', '9000.5'],
      ['--port'], // 缺值
      ['--port='],
      ['--port', '--verbose'], // 后面跟的是另一个参数
    ]) {
      expect(() => parsePortArg(argv), JSON.stringify(argv)).toThrow();
    }
  });
});

describe('resolvePort', () => {
  it('都没有时用 DEFAULT_PORT', () => {
    expect(resolvePort({ argv: [], env: {} })).toBe(DEFAULT_PORT);
  });

  it('只给环境变量时用它', () => {
    expect(resolvePort({ argv: [], env: { PORT: '9000' } })).toBe(9000);
  });

  it('命令行参数优先于环境变量（环境里遗留的 PORT 不该顶掉手写的值）', () => {
    expect(resolvePort({ argv: ['--port', '9100'], env: { PORT: '9000' } })).toBe(9100);
  });

  it('PORT=0 不会被当成"没写"而回落默认端口', () => {
    expect(resolvePort({ argv: [], env: { PORT: '0' } })).toBe(0);
  });

  it('PORT 为空串时按"没写"处理（容器里常出现 PORT= 这种空值）', () => {
    expect(resolvePort({ argv: [], env: { PORT: '' } })).toBe(DEFAULT_PORT);
  });

  it('环境变量里的非法值同样报错，不静默回落', () => {
    expect(() => resolvePort({ argv: [], env: { PORT: 'abc' } })).toThrow(/PORT/);
  });

  it('报错信息里带上用法（人看终端就知道怎么改）', () => {
    expect(PORT_USAGE).toContain('--port');
  });
});
