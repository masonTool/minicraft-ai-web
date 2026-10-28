package com.minicraft.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * 应用入口。除了注册插件，还负责把同步宿主桥注入 WebView。
 *
 * <p>插件注册必须在 {@code super.onCreate()} **之前**（Capacitor 的插件表在那一步被冻结）；
 * JS 接口注入相反，必须在**之后**（那时 WebView 才存在）。
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

    /**
     * 注入 `window.MinicraftAndroid`（见 {@link JsHostBridge}）。
     *
     * <p>为什么覆盖 {@code load()} 而不是写在 {@code onCreate} 末尾：
     * Capacitor 在 {@code load()} 里才创建出 {@link #bridge}，而真正的页面加载是
     * {@code webView.post(() -> loadUrl(...))}——投递到主线程队列。这里同步注入，
     * 一定排在那次投递之前，所以首屏 JS 就能看到对象，不需要 reload。
     */
    @Override
    protected void load() {
        super.load();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        webView.addJavascriptInterface(new JsHostBridge(this), "MinicraftAndroid");
    }
}
