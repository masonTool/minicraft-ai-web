package com.minicraft.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 给网页用的插件：{@code Capacitor.Plugins.NativeServer.start({ port, seed })}。
 *
 * <p>为什么中间隔一层插件而不是让网页直接碰 JNI：WebView 里没有 JNI，"手机当房主"
 * 必须有原生那一跳；这一跳只做三件事——起前台服务、报当前端口、停服务。
 * 服务端的全部逻辑在 Rust 里（{@code server/rust/src/lib.rs}），这里不复制任何业务。
 *
 * <p>实际的能力都在 {@link ServerControl} 里，与同步桥 {@link JsHostBridge} 共用同一份
 * ——网页当前用的是后者（同步、DOM 渲染前就要知道有没有宿主），插件保留给"以后要
 * 传参数/拿返回值"的场景。
 */
@CapacitorPlugin(name = "NativeServer")
public class NativeServerPlugin extends Plugin {

    /** 起服务。参数：{@code port}（0 = 系统挑）、{@code seed}（0 = 默认）。 */
    @PluginMethod
    public void start(PluginCall call) {
        // 走 JSONObject 的 opt*：JS 只传数字，别在这里纠结装箱/默认值
        JSObject data = call.getData();
        ServerControl.start(getContext(), data.optInt("port", 0), data.optLong("seed", 0L));

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    /** 本机局域网 IPv4。 */
    @PluginMethod
    public void localIp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ip", ServerControl.localIpv4());
        call.resolve(ret);
    }

    /** 当前端口（0 = 还没起来 / 没在跑）。 */
    @PluginMethod
    public void port(PluginCall call) {
        JSObject result = new JSObject();
        result.put("port", ServerControl.port());
        call.resolve(result);
    }

    /** 停服务（会先补存一次快照）。 */
    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        ServerControl.stop(context);
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }
}
