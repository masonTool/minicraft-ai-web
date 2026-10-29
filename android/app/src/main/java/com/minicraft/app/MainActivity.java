package com.minicraft.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import android.app.Activity;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 自研 WebView 壳（去 Capacitor）。
 *
 * ## 为什么不再用 Capacitor
 *
 * 整包是加密的，壳必须"解密后再交给 WebView"。Capacitor 6 的 Bridge 内部自装
 * `WebViewClient` 且没有 getter，外层再包一层会拆掉它自己的协议处理——它提供的
 * 资源服务恰好是我们不需要的那一层。现在只需要三件事：一个 WebView、一个拦截器、
 * 一个同步 JS 桥，这些自己写反而更短。
 *
 * ## 内容从哪来
 *
 * `assets/rt/libmcrt.so` 整段解密（见 {@link BundleVault}），全部放在内存里。
 * WebView 加载 `http://localhost/index.html`，每个请求由 {@link #shouldIntercept} 从内存
 * 切一份返回——**磁盘上从来没有明文**。origin 用 `localhost` 是因为它被 Chromium 视为
 * 可信来源：IndexedDB、剪贴板、`ws://` 联机都正常。
 */
public class MainActivity extends Activity {

    /** 让网页知道"这是带原生壳的触屏设备"。UA 在任何脚本之前就可用，比注入全局变量可靠 */
    private static final String TOUCH_MARKER = "MinicraftTouch/1";
    private static final String ORIGIN = "http://localhost";
    /**
     * 兼容基线：Android System WebView 88。
     *
     * 依据（caniuse，2026-09 全球使用份额）：min()/max()/clamp() 需要 79、flex gap 84、
     * inset 87、aspect-ratio 88——界面样式全部建立在这些之上，低于 88 的 WebView 会
     * **直接丢弃这些声明**，菜单容器 width 退化成 auto，整屏塌成一列。
     * 88 起步覆盖 97.07%，再往上抬（92 才有 Array.at）收益不足 0.05%，不值得。
     */
    private static final int MIN_WEBVIEW_MAJOR = 88;

    private WebView webView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 横屏 + 全屏：游戏本身就是横屏布局，别让玩家先看一屏"请横屏游玩"
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        /*
         * 调试入口：`adb shell am start -n com.minicraft.app/.MainActivity -e url <地址>`
         * 用壳直接加载任意页面，用于区分"壳环境有问题"还是"我们的资源供给有问题"。
         * 只在 debug 构建生效。
         */
        String debugUrl = BuildConfig.DEBUG ? getIntent().getStringExtra("url") : null;
        if (debugUrl != null && debugUrl.startsWith("http")) {
            WebView probe = new WebView(this);
            probe.getSettings().setJavaScriptEnabled(true);
            probe.getSettings().setDomStorageEnabled(true);
            probe.getSettings().setTextZoom(100);
            probe.getSettings().setUseWideViewPort(true);
            probe.getSettings().setLoadWithOverviewMode(true);
            setContentView(probe);
            applyImmersive();
            probe.loadUrl(debugUrl);
            return;
        }

        currentBundle = BundleVault.open(this);
        if (currentBundle == null) {
            // 解不开 = 不是我们的包（或包被动过）。没有降级分支，直接说清楚。
            showFatal("游戏内容校验失败：请从官方渠道重新安装");
            return;
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 资源都在内存里，不需要文件/内容提供器
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        /*
         * 下面四行是"浏览器里正常、壳里 DOM 尺寸全错"的根因（真机实测过）。
         *
         * WebView 与 Chrome 的默认值不一样：
         *  · `textZoom` 默认**跟随系统字体大小**——用户把字体调大过，WebView 里每个
         *    文字都会被放大，布局跟着错位；Chrome 浏览器不受这个设置影响。
         *  · `useWideViewPort` 默认 false，viewport meta 的 width 不被采纳，
         *    布局按 980px 虚拟宽度来，再整体缩放。
         *  · `loadWithOverviewMode` 默认 false，页面不会被缩放到适配宽度。
         */
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        // 设备默认 UA + 触屏标记：摸拟器带鼠标时 `pointer: coarse` 不成立，
        // 靠 UA 才能稳定走进触屏那套界面
        settings.setUserAgentString(settings.getUserAgentString() + " " + TOUCH_MARKER);

        webView.addJavascriptInterface(new JsHostBridge(this), "MinicraftAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return MainActivity.this.shouldIntercept(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 只允许留在自己的 origin 里；外链一律不跳（游戏内没有需要外跳的链接）
                String url = request.getUrl().toString();
                return !url.startsWith(ORIGIN);
            }
        });

        setContentView(webView);
        // 必须在 setContentView 之后：之前 decorView 还不存在，getInsetsController() 会 NPE
        applyImmersive();

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.loadUrl(ORIGIN + "/index.html");
        warnIfWebViewTooOld();
    }

    /**
     * WebView 太旧时提示更新。
     *
     * 为什么用原生弹窗而不是网页里弹：版本过低时网页的样式本身就是坏的
     * （`min()/clamp()/inset` 全被丢弃），用它自己的 UI 提示反而可能显示不全。
     */
    private void warnIfWebViewTooOld() {
        int major = webViewMajorVersion();
        // 取不到版本号时不做判断：宁可放行，也不要因为解析失败把正常用户挡在门外
        if (major == 0 || major >= MIN_WEBVIEW_MAJOR) return;

        new AlertDialog.Builder(this)
                .setTitle("WebView 版本过低")
                .setMessage("当前 Android System WebView 版本为 " + major
                        + "，低于建议的 " + MIN_WEBVIEW_MAJOR + "。\n\n"
                        + "游戏界面可能显示异常（按钮变形、布局错乱、无法进入世界）。\n"
                        + "请更新到最新版本后再玩。")
                .setPositiveButton("如何更新", (dialog, which) -> showUpdateGuide())
                .setNegativeButton("仍然进入", null)
                .show();
    }

    /** WebView 主版本号，取不到返回 0 */
    private int webViewMajorVersion() {
        try {
            String ua = WebSettings.getDefaultUserAgent(this);
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("Chrome/(\\d+)").matcher(ua);
            return matcher.find() ? Integer.parseInt(matcher.group(1)) : 0;
        } catch (Throwable ignored) {
            return 0;
        }
    }

    /**
     * 更新指引。
     *
     * 为什么不直接 startActivity(market://...) 了事：实测这台机器上 `market://` 会被
     * MIUI 应用商店接走，但它**没有 Google WebView 的条目**，于是自己跳去一个搜索结果页，
     * 玩家看到的是一屏广告和搜索框——比不给按钮还糟。
     * 所以先给可执行的文字步骤，把"打开商店"降级成可选的一步。
     */
    private void showUpdateGuide() {
        new AlertDialog.Builder(this)
                .setTitle("更新 Android System WebView")
                .setMessage("这台设备的 WebView 版本过低，游戏界面可能显示异常。可以这样更新：\n\n"
                        + "1. 打开「设置 → 应用管理」，搜索「Android System WebView」，看是否有更新；\n"
                        + "2. 若系统里没有更新项，在能访问 Google 的设备上下载 WebView 安装包，"
                        + "再用数据线连上安装；\n\n"
                        + "更新后不需要重装游戏，重新打开即可。")
                .setPositiveButton("打开应用商店", (dialog, which) -> openStoreBestEffort())
                .setNegativeButton("知道了", null)
                .show();
    }

    /** 尽力打开商店；没有处理者就算了（已经给过文字指引，不必再打断） */
    private void openStoreBestEffort() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=com.google.android.webview")));
        } catch (Throwable ignored) {
            // 没有商店：指引里已经写了手工步骤，这里静默即可
        }
    }

    /** 从内存表里取文件；取不到就 404（与"文件不存在"语义一致，不暴露内部结构） */
    private WebResourceResponse shouldIntercept(WebResourceRequest request) {
        // 只接管自己的 origin；外部页面（A/B 调试用）交给 WebView 正常走网络
        if (!request.getUrl().toString().startsWith(ORIGIN + "/")) return null;

        String path = request.getUrl().getPath();
        String name = path == null ? "" : path.replaceAll("^/+", "");
        if (name.isEmpty()) name = "index.html";

        Map<String, byte[]> bundle = currentBundle;
        byte[] body = bundle == null ? null : bundle.get(name);
        if (body == null) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }

        String mime = MIME.getOrDefault(extensionOf(name), "application/octet-stream");
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null,
                new ByteArrayInputStream(body));
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot).toLowerCase(Locale.ROOT);
    }

    /** minSdk 23：`Map.ofEntries` 要 API 30，这里用静态初始化块 */
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put(".html", "text/html");
        MIME.put(".js", "text/javascript");
        MIME.put(".mjs", "text/javascript");
        MIME.put(".css", "text/css");
        MIME.put(".json", "application/json");
        MIME.put(".webmanifest", "application/manifest+json");
        MIME.put(".svg", "image/svg+xml");
        MIME.put(".png", "image/png");
        MIME.put(".jpg", "image/jpeg");
        MIME.put(".webp", "image/webp");
        MIME.put(".woff2", "font/woff2");
        MIME.put(".txt", "text/plain");
    }

    /** 解密结果常驻内存：整包 4~5 MB，反复解密没有意义 */
    private Map<String, byte[]> currentBundle;

    private void showFatal(String message) {
        TextView view = new TextView(this);
        view.setText(message);
        view.setTextSize(16f);
        view.setPadding(48, 48, 48, 48);
        setContentView(view);
        applyImmersive();
        view.setVisibility(View.VISIBLE);
    }

    private void applyImmersive() {
        if (getWindow().getDecorView() == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            return;
        }
        // API 30 以下：老的那套 flags（这个项目 minSdk 23）
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
