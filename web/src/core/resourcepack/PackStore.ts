/**
 * 资源包的**持久化**（2026-10-28）
 *
 * 起因（用户）："导入的资源包为什么只有当次生效？"
 * 答：以前确实只作用于这一次运行——图集在内存里被重画，页面一刷新就回到程序化贴图。
 * 原版不是这样（Java 记在 `options.txt` 的 `resourcePacks`，基岩版按世界存），
 * 所以这里补上：把导入的**原始文件字节**存进 IndexedDB，下次进游戏自动重新应用。
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 *  - 一个材质包通常几 MB，localStorage 只有 5MB 且要装世界清单、设置、诊断日志；
 *  - 字节可以直接结构化克隆，不必 base64（那会再胖 33%）。
 *
 * 只存**一份**（`current`）：这套资源包是"这台设备当前的皮肤"，与设置同一层级；
 * 换一个包就覆盖旧的，避免"卸不掉的包越攒越多"。
 */

const DB_NAME = 'minicraft-resource-packs';
const DB_VERSION = 1;
const STORE = 'pack';
const KEY = 'current';

export interface StoredPack {
  /** 原始文件名（用来还原显示名与扩展名） */
  name: string;
  /** 原始字节（zip） */
  bytes: ArrayBuffer;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // 无痕模式 / 配额被拒：当作"没有持久化"，游戏照常玩
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** 存一份资源包（覆盖旧的）；成功返回 true */
export async function saveStoredPack(name: string, bytes: ArrayBuffer): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name, bytes, savedAt: Date.now() } satisfies StoredPack, KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

/** 读出上次存的资源包（没有 / 读失败返回 null） */
export async function loadStoredPack(): Promise<StoredPack | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => {
        const value = request.result as Partial<StoredPack> | undefined;
        db.close();
        if (!value || typeof value.name !== 'string') {
          resolve(null);
          return;
        }
        if (!(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength === 0) {
          resolve(null);
          return;
        }
        resolve({
          name: value.name,
          bytes: value.bytes,
          savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
        });
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** 忘掉已存的资源包（下次启动不再应用） */
export async function clearStoredPack(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
