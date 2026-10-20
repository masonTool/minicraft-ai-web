import type { FileStore, KeyValueStore } from './types.ts';

/** 内存键值存储：Node 测试与 localStorage 不可用时的回退 */
export function createMemoryStorage(initial?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    set(key: string, value: string): void {
      map.set(key, value);
    },
    remove(key: string): void {
      map.delete(key);
    },
    keys(): readonly string[] {
      return [...map.keys()];
    },
    clear(): void {
      map.clear();
    },
  };
}

function copyBuffer(data: ArrayBuffer): ArrayBuffer {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(new Uint8Array(data));
  return copy;
}

/** 内存文件存储：Node 测试与 web 端的占位实现 */
export function createMemoryFiles(): FileStore {
  const files = new Map<string, ArrayBuffer>();
  return {
    async mkdir(): Promise<void> {
      /* 内存文件系统没有目录概念 */
    },
    async write(path: string, data: ArrayBuffer | string): Promise<void> {
      if (typeof data === 'string') {
        files.set(path, new TextEncoder().encode(data).buffer);
      } else {
        files.set(path, copyBuffer(data));
      }
    },
    async read(path: string): Promise<ArrayBuffer> {
      const data = files.get(path);
      if (!data) throw new Error(`文件不存在：${path}`);
      return copyBuffer(data);
    },
    async remove(path: string): Promise<void> {
      files.delete(path);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async list(dir: string): Promise<readonly string[]> {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...files.keys()].filter((path) => path.startsWith(prefix));
    },
  };
}
