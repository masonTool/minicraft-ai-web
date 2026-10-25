package com.minicraft.server;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 设备级验收：**.so 在这个 ABI 上真的能被加载、JNI 真的能起一个服务端**。
 *
 * <p>为什么要有这条（而不是只看"APK 里有没有 .so"）：`System.loadLibrary` 失败、
 * JNI 名字对不上、tokio 在 Android 上起不来——这三种都只在设备上才暴露，
 * 而它们的表现都是"点开房没反应"。这条测试把"能不能起"这件事压到一次
 * `connectedDebugAndroidTest` 里，并且**顺带验了 HTTP 端点**（同端口分流）。
 *
 * <p>跑法：`./gradlew connectedDebugAndroidTest`（需要一台连着的设备/已启动的模拟器）。
 */
@RunWith(AndroidJUnit4.class)
public class NativeServerInstrumentedTest {

    @Test
    public void startsServesHealthAndStops() throws Exception {
        File dataDir = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),
                "instrumented-" + System.currentTimeMillis());

        int port = NativeServer.startServer(dataDir.getAbsolutePath(), 0, 20261014L);
        assertTrue("应当绑定到一个真实端口，实际=" + port, port > 0);
        assertEquals("serverPort() 与返回值要一致", port, NativeServer.serverPort());

        // 等 HTTP 起来（服务端在独立线程里跑，绑端口之后才 accept）
        String body = null;
        for (int attempt = 0; attempt < 50; attempt++) {
            try {
                HttpURLConnection connection =
                        (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/healthz").openConnection();
                connection.setConnectTimeout(300);
                connection.setReadTimeout(300);
                if (connection.getResponseCode() == 200) {
                    StringBuilder text = new StringBuilder();
                    try (BufferedReader reader =
                                 new BufferedReader(new InputStreamReader(connection.getInputStream(), "utf-8"))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            text.append(line);
                        }
                    }
                    body = text.toString();
                    break;
                }
            } catch (Exception ignored) {
                // 还没起来，重试
            }
            Thread.sleep(100);
        }
        assertNotNull("/healthz 应当有响应", body);
        assertTrue("健康检查要回 ok： " + body, body.contains("\"ok\":true"));
        assertTrue("发现层应当默认打开（手机当房主的主线功能）： " + body, body.contains("\"beacon\":true"));
        assertTrue("端口与启动参数一致： " + body, body.contains("\"protocol\":2"));

        NativeServer.stopServer();
        assertEquals("停掉之后端口归零", 0, NativeServer.serverPort());
    }
}
