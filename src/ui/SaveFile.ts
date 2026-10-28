/**
 * 文件另存（2026-10-28，用户："导出世界需要让用户选择目录进行保存"）
 *
 * 浏览器里有两条路：
 *  1. **File System Access API**（Chromium 系的 `showSaveFilePicker`）：弹出系统
 *     "另存为"对话框，玩家自己选目录与文件名，写完了才算成功——这才是"选择目录"；
 *  2. 老的 `<a download>`：只能交给浏览器下载目录，手机上通常进"下载"文件夹，
 *     玩家既看不到也选不了。
 *
 * 所以这里**优先用 ①**，只有它不存在（Safari / Firefox / Android WebView）或者
 * 调用失败时才退回 ②。取消（`AbortError`）不算失败，也不再退回 ②——否则玩家
 * 明明点了"取消"，文件却还是被下载了一份。
 *
 * 为什么不直接写 `window.showSaveFilePicker`：它不在 `lib.dom` 里（属于
 * WICG File System Access 规范），项目没有装 @types 包，所以这里自己声明最小的
 * 那部分形状——只声明我们真正调用的三个成员。
 */

/** `FileSystemWritableFileStream` 的最小形状 */
interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface HandleLike {
  createWritable(): Promise<WritableLike>;
}

interface PickerOptions {
  suggestedName?: string;
  types?: ReadonlyArray<{ description?: string; accept: Record<string, readonly string[]> }>;
}

type SavePicker = (options: PickerOptions) => Promise<HandleLike>;

export interface SaveBlobOptions {
  /** 默认文件名（含扩展名） */
  suggestedName: string;
  /** 对话框里"文件类型"那一行的人话说明（走 i18n） */
  description: string;
  /** 允许的扩展名，形如 `['.mc']` */
  extensions: readonly string[];
}

/**
 * 结果三种：
 *  - `saved`：玩家选了位置并写完了；
 *  - `cancelled`：玩家点了取消（调用方**不要**再退回下载）；
 *  - `unsupported`：这个浏览器没有该 API，或写入失败（调用方退回 `<a download>`）。
 */
export type SaveBlobOutcome = 'saved' | 'cancelled' | 'unsupported';

function pickerOf(): SavePicker | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof candidate === 'function' ? (candidate as SavePicker) : null;
}

/** 这个浏览器能不能弹"另存为"（验收脚本 / 界面提示可用） */
export function canPickSaveLocation(): boolean {
  return pickerOf() !== null;
}

/** 弹系统"另存为"对话框并把 `blob` 写进去 */
export async function saveBlobWithPicker(blob: Blob, options: SaveBlobOptions): Promise<SaveBlobOutcome> {
  const picker = pickerOf();
  if (picker === null) return 'unsupported';
  try {
    const handle = await picker({
      suggestedName: options.suggestedName,
      types: [
        {
          description: options.description,
          accept: { 'application/octet-stream': options.extensions },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  } catch (error) {
    // 玩家点了取消：不是错误，也**不要**偷偷下载一份
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    console.warn('[save] 另存为失败，回退到浏览器下载', error);
    return 'unsupported';
  }
}

/** 退路：交给浏览器下载（老的 `<a download>` 路径） */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻 revoke 会让部分浏览器的下载中断，留一拍再释放
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
