package com.minicraft.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把解封后的核心数据交给网页：{@code Capacitor.Plugins.CoreVault.read()}。
 *
 * <p>为什么走插件而不是 {@code shouldInterceptRequest}：Capacitor 6 的 {@code Bridge}
 * 内部自己装了 {@code WebViewClient}，而 {@code WebView} 没有 {@code getWebViewClient()}，
 * 想在外层再包一层就只能整块替换——那样会连带把 Capacitor 自己的协议处理一起拆掉，
 * 属于"为了省一次 JS 改动去动第三方内部"的赔本买卖。
 *
 * <p>安全性质不变：页面拿不到 assets 里的 {@code core.sealed}（WebView 的静态根是
 * {@code assets/public}，封存体在 {@code assets/sealed}），也拿不到"校验没过的数据"——
 * 签名不符时本插件直接 reject，页面落到既有的"去应用里玩"路径。
 */
@CapacitorPlugin(name = "CoreVault")
public class CoreVaultPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        byte[] data;
        try {
            data = CoreVault.unseal(getContext());
        } catch (Throwable ignored) {
            data = null;
        }
        if (data == null || data.length == 0) {
            // 不区分"签名不符 / 数据坏了 / 没打包"：对外统一是"没有核心数据"
            call.reject("core unavailable");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        call.resolve(ret);
    }
}
