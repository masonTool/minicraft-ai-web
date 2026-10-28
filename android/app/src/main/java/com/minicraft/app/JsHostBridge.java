package com.minicraft.app;

import android.content.Context;
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
}
