package com.minicraft.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.minicraft.server.NativeServer;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * 「手机当房主」的四件事：起、停、查端口、查本机 IP。
 *
 * <p>为什么单独抽出来：这些能力有**两个**入口——Capacitor 插件
 * （`NativeServer.start/port/stop`，异步）和网页直接调的同步 JS 接口
 * （`window.MinicraftAndroid`，见 {@link JsHostBridge}）。两份实现迟早会漂，
 * 而漂了的表现是"插件能开房、网页看不到"，极难查。
 */
final class ServerControl {

    private ServerControl() {}

    /** 起服务。{@code port} 传 0 表示用默认端口（8887）。 */
    static void start(Context context, int port, long seed) {
        Intent intent = new Intent(context, ServerService.class);
        intent.putExtra("dataDir", context.getFilesDir().getAbsolutePath() + "/world");
        intent.putExtra("port", port);
        intent.putExtra("seed", seed);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    /** 停服务（会先补存一次快照）。 */
    static void stop(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(
                    new Intent(context, ServerService.class).setAction(ServerService.ACTION_STOP));
        } else {
            context.stopService(new Intent(context, ServerService.class));
        }
    }

    /** 当前端口；0 = 没在跑（JNI 拿不到也按 0 处理）。 */
    static int port() {
        try {
            return NativeServer.serverPort();
        } catch (Throwable ignored) {
            return 0;
        }
    }

    /**
     * 本机局域网 IPv4（用户 2026-10-27）。
     *
     * <p>网页侧**不再猜网段**：拿不到这个地址就说明不是完整版，联机界面直接不让进。
     * 所以这里要挑"能用来看局域网的那一个"：跳过回环、跳过 169.254（没拿到 DHCP 时的
     * 链路本地地址，它扫不出任何东西）。
     */
    static String localIpv4() {
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
}
