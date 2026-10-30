package com.minicraft.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.InputDevice;
import android.webkit.JavascriptInterface;

/**
 * 网页读的那个同步宿主桥：`window.MinicraftAndroid`。
 *
 * <p>契约在 `web/src/core/net/HostBridge.ts`：四个方法、同步返回 JSON 字符串
 * （{@code @JavascriptInterface} 只能这样返回）。**这是网页侧判断
 * "能不能开房"的唯一依据**——没有它，`hasHostBridge()` 恒为 false，开房入口永远不出现。
 *
 * <p>为什么不用 Capacitor 插件：插件是异步的（返回 Promise），而
 * `hasHostBridge()` 是同步调用，用在"渲染这一屏要不要显示开机按钮"上。
 * 为一个布尔值把整条链路改成异步，代价比补一个注入大得多。
 *
 * <p>⚠️ 安全边界：`addJavascriptInterface` 会把方法暴露给**当前页面**。
 * 这里成立的前提是 WebView 只加载包内页面（Capacitor 的 `server.url` 没配、
 * `allowNavigation` 没开），外部链接由 Capacitor 交给系统浏览器。若以后允许加载
 * 远程页面，这层托桥必须先去删掉。
 */
public final class JsHostBridge {

    private final Context context;

    JsHostBridge(Context context) {
        // 持有 application context：Service 的生命周期比 Activity 长
        this.context = context.getApplicationContext();
    }

    /** `{"ip":"192.168.1.5"}`，拿不到时 `{"ip":null}` */
    @JavascriptInterface
    public String localIp() {
        String ip = ServerControl.localIpv4();
        return ip == null ? "{\"ip\":null}" : "{\"ip\":\"" + ip + "\"}";
    }

    /** `{"port":8887}`，0 = 没在跑 */
    @JavascriptInterface
    public String serverPort() {
        return "{\"port\":" + ServerControl.port() + "}";
    }

    /** 立刻返回；端口要靠轮询 {@link #serverPort()} 等（JNI 绑端口最多 3 秒） */
    @JavascriptInterface
    public String startServer() {
        ServerControl.start(context, 0, 0L);
        return "{\"started\":true}";
    }

    @JavascriptInterface
    public String stopServer() {
        ServerControl.stop(context);
        return "{\"stopped\":true}";
    }

    /**
     * 现在有没有接手柄（批次 20261031-0055）。
     *
     * <p>网页侧只有拿到 {@code true} 才开始轮询 Gamepad API：Chromium 里只要页面注册了
     * {@code gamepadconnected} 监听，就会常驻一条手柄轮询线程（真机约 2% CPU），
     * 而绝大多数玩家没接手柄。接上 / 拔掉由 {@link MainActivity} 的设备监听通知网页。
     */
    @JavascriptInterface
    public boolean hasGamepad() {
        return gamepadPresent();
    }

    static boolean gamepadPresent() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (device == null || device.isVirtual()) continue;
            int sources = device.getSources();
            if ((sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                    || (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK) {
                return true;
            }
        }
        return false;
    }

    /**
     * 打开应用商店里 Android System WebView 的详情页。
     *
     * <p>为什么这件事必须留在原生：网页打不开 `market://`（WebView 会把它当成导航，
     * 被拦截器挡掉）。版本检测本身在页面里做（见 `index.html`），只有"跳商店"这一步过桥。
     *
     * @return 总是 `{"ok":true}`：打不开商店也静默——页面上的文案已经写清了手工更新方式
     */
    @JavascriptInterface
    public String openWebViewStore() {
        try {
            context.startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=com.google.android.webview"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Throwable ignored) {
            // 没有可用商店：静默，文案里已给出"设置 → 应用管理"的手工路径
        }
        return "{\"ok\":true}";
    }
}
