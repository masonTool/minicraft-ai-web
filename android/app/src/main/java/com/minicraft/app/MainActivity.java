package com.minicraft.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * 应用入口。只多做一件事：把 {@link NativeServerPlugin} 注册进桥，
 * 让网页能通过 {@code Capacitor.Plugins.NativeServer} 起停"手机当房主"的服务。
 *
 * <p>注册必须在 {@code super.onCreate()} **之前**（Capacitor 的插件表在那一步被冻结）。
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeServerPlugin.class);
        // 核心数据的唯一出口：先验签名再解封，签名不符时这个插件只会 reject
        registerPlugin(CoreVaultPlugin.class);
        super.onCreate(savedInstanceState);
        // release 包关掉 chrome://inspect（最省事的内存 dump 入口）。
        // 默认值本来就是 false，这里显式写出来是为了"有人改成 true"时能在 review 里看见。
        if (!BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(false);
        }
    }
}
