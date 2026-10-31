package com.minicraft.app;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.hardware.input.InputManager;
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
 * `assets/rt/libmcrt.so` 由 {@link BundleVault} 交给 native 整段解密，**明文只留在 native 堆**。
 * WebView 加载 `http://localhost/index.html`，每个请求由 {@link #shouldIntercept} 按路径
 * 向 native 要一份字节——磁盘上从来没有明文，Java 堆上也没有整包明文。
 * origin 用 `localhost` 是因为它被 Chromium 视为可信来源：IndexedDB、剪贴板、`ws://` 联机都正常。
 */
public class MainActivity extends Activity {

    /** 让网页知道"这是带原生壳的触屏设备"。UA 在任何脚本之前就可用，比注入全局变量可靠 */
    private static final String TOUCH_MARKER = "MinicraftTouch/1";
    private static final String ORIGIN = "http://localhost";

    private WebView webView;
    private InputManager inputManager;
    private final InputManager.InputDeviceListener gamepadListener = new InputManager.InputDeviceListener() {
        @Override
        public void onInputDeviceAdded(int deviceId) {
            notifyGamepad();
        }

        @Override
        public void onInputDeviceRemoved(int deviceId) {
            notifyGamepad();
        }

        @Override
        public void onInputDeviceChanged(int deviceId) {
            notifyGamepad();
        }
    };

    private void notifyGamepad() {
        if (webView == null) return;
        String type = JsHostBridge.gamepadPresent() ? "mc-gamepad-attached" : "mc-gamepad-detached";
        webView.evaluateJavascript("window.dispatchEvent(new Event('" + type + "'))", null);
    }

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

        vault = BundleVault.open(this);
        if (vault == null) {
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
        // 手柄接上 / 拔掉通知网页（见 `JsHostBridge.hasGamepad` 为什么不让网页自己监听）
        inputManager = (InputManager) getSystemService(INPUT_SERVICE);
        if (inputManager != null) inputManager.registerInputDeviceListener(gamepadListener, null);
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

        /*
         * 调试口：debug 构建常开；release 只在**这次启动带 `-e debugweb true`** 时开。
         *
         * 为什么 release 也要留这个口子：布局问题（视口宽度、dpr、安全区）只有在真机上
         * 通过 CDP 量得出，而 release 包才是"用户手里那个"。不带参数时完全关闭，
         * 正常使用不会暴露调试端口。
         *
         *   adb shell am start -n com.minicraft.app/.MainActivity -e debugweb true
         */
        boolean debugWeb = BuildConfig.DEBUG
                || getIntent().getBooleanExtra("debugweb", false)
                // `am start -e debugweb true` 传的是字符串，`getBooleanExtra` 会忽略它，
                // 所以两种写法都认：`--ez debugweb true` 与 `-e debugweb true`
                || "true".equals(getIntent().getStringExtra("debugweb"));
        if (debugWeb) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.loadUrl(ORIGIN + "/index.html");
    }

    /** 从内存表里取文件；取不到就 404（与"文件不存在"语义一致，不暴露内部结构） */
    private WebResourceResponse shouldIntercept(WebResourceRequest request) {
        // 只接管自己的 origin；外部页面（A/B 调试用）交给 WebView 正常走网络
        if (!request.getUrl().toString().startsWith(ORIGIN + "/")) return null;

        String path = request.getUrl().getPath();
        String name = path == null ? "" : path.replaceAll("^/+", "");
        if (name.isEmpty()) name = "index.html";

        // 每次只向 native 要**这一个**文件：完整明文不经过 Java 堆
        BundleVault current = vault;
        byte[] body = current == null ? null : current.read(name);
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

    /** 解密的句柄；明文本体在 native 堆（见 {@link BundleVault}），这里只是个句柄 */
    private BundleVault vault;

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
        /*
         * 屏幕转一下、系统回收重建这类销毁**不该**停服（`isChangingConfigurations()`）；
         * 玩家真正退出应用（返回键 / 被系统结束）才停。
         *
         * 为什么由壳来做而不是等网页：网页那边的 `dispose()` 只在"退出世界"时触发，
         * 玩家直接按返回键关掉应用根本走不到那里。而服务器只在主机玩着的时候才该存在，
         * 所以这里必须补一刀（用户 2026-10-30 的口径）。
         *
         * 不在这里处理的三件事：
         *  · 切后台（Home 键）：不停服——看条消息就断队友线太糟；
         *  · 划掉最近任务：由 `ServerService.onTaskRemoved` + `stopWithTask` 负责；
         *  · 进程被杀：服务是 START_NOT_STICKY，不会自己复活。
         */
        if (isFinishing() && !isChangingConfigurations()) {
            ServerControl.stop(this);
            // 玩家真的退出了：顺手放掉 native 侧的明文缓冲。
            // 旋转（isChangingConfigurations）不关——新实例会自己重新 open，
            // 而且 native 侧被重开时会先清掉旧的，不会泄漏。
            if (vault != null) {
                vault.close();
                vault = null;
            }
        }
        if (inputManager != null) inputManager.unregisterInputDeviceListener(gamepadListener);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
