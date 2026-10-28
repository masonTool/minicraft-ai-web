package com.minicraft.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.minicraft.server.NativeServer;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * 给网页用的插件：{@code Capacitor.Plugins.NativeServer.start({ port, seed })}。
 *
 * <p>为什么中间隔一层插件而不是让网页直接碰 JNI：WebView 里没有 JNI，"手机当房主"
 * 必须有原生那一跳；这一跳只做三件事——起前台服务、报当前端口、停服务。
 * 服务端的全部逻辑在 Rust 里（{@code server/rust/src/lib.rs}），这里不复制任何业务。
 */
@CapacitorPlugin(name = "NativeServer")
public class NativeServerPlugin extends Plugin {

    /** 起服务。参数：{@code port}（0 = 系统挑）、{@code seed}（0 = 默认）。 */
    @PluginMethod
    public void start(PluginCall call) {
        // 走 JSONObject 的 opt*：JS 只传数字，别在这里纠结装箱/默认值
        JSObject data = call.getData();
        int port = data.optInt("port", 0);
        long seed = data.optLong("seed", 0L);

        Context context = getContext();
        Intent intent = new Intent(context, ServerService.class);
        intent.putExtra("dataDir", context.getFilesDir().getAbsolutePath() + "/world");
        intent.putExtra("port", port);
        intent.putExtra("seed", seed);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    /** 当前端口（0 = 还没起来 / 没在跑）。网页轮询它拿"进房地址"。 */
    /**
     * 本机局域网 IPv4（用户 2026-10-27）。
     *
     * <p>网页侧**不再猜网段**：拿不到这个地址就说明不是完整版，联机界面直接不让进。
     * 所以这里要挑"能用来看局域网的那一个"：跳过回环、跳过 169.254（没拿到 DHCP 时的
     * 链路本地地址，它扫不出任何东西）。
     */
    @PluginMethod
    public void localIp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ip", findLocalIpv4());
        call.resolve(ret);
    }

    private String findLocalIpv4() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                    String host = addr.getHostAddress();
                    if (host != null && !host.startsWith("169.254.")) return host;
                }
            }
        } catch (Exception ignored) {
            // 拿不到就返回 null：JS 侧会当成"不是完整版"处理，这里不该抛
        }
        return null;
    }

    @PluginMethod
    public void port(PluginCall call) {
        int port;
        try {
            port = NativeServer.serverPort();
        } catch (Throwable error) {
            port = 0;
        }
        JSObject result = new JSObject();
        result.put("port", port);
        call.resolve(result);
    }

    /** 停服务（会先补存一次快照）。 */
    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(new Intent(context, ServerService.class)
                    .setAction(ServerService.ACTION_STOP));
        } else {
            context.stopService(new Intent(context, ServerService.class));
        }
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }
}
