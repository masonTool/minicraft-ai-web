/**
 * 协议错误码 → 玩家能看懂的一句话（本批）。
 *
 * 为什么单独一层：同一条错误会出现两个地方——局内消息栏（`main.ts` 的 `onError`）和
 * 联机面板表单下方的错误行。以前只有消息栏按 code 翻译（一串嵌套三元），面板拿到的是
 * 服务端那句中文原文，非中文玩家看不懂。抽成查表后两处共用同一份口径。
 *
 * 返回**空串**表示"没有专门文案"（`bad-json` / `unknown` / 服务端以后新加的码）：
 * 调用方回退到服务端原话，而不是显示一句比原文更含糊的"服务器错误"。
 */
import { t } from '../i18n/I18n.ts';

export function netErrorText(code: string): string {
  switch (code) {
    case 'duplicate-name':
      return t('say.net.duplicateName');
    case 'host-taken':
      return t('say.net.hostTaken');
    case 'host-offline':
      return t('say.net.hostOffline');
    case 'no-host':
      return t('say.net.noHost');
    case 'password':
      return t('say.net.password');
    default:
      return '';
  }
}
