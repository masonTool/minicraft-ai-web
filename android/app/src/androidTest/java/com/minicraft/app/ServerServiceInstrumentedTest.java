package com.minicraft.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 设备级验收：**前台服务这条路上真的能把服务端跑起来**。
 *
 * <p>与 {@code NativeServerInstrumentedTest} 的分工：那条只验 JNI（能不能加载 .so、
 * 能不能起 tokio、HTTP 通不通）；这条验的是**应用真正会走的那条路**——
 * 起 `ForegroundService`（常驻通知）→ 服务里申请 `MulticastLock`/`WifiLock` →
 * 工作线程调 JNI → `ServerService.port()` 有了值。
 *
 * <p>为什么值得单独验：`MulticastLock` 拿不到、前台服务被系统拒绝、通知渠道没建，
 * 这三件都不会让编译失败，只会让"点开房没反应"或"锁屏后房间消失"。
 */
@RunWith(AndroidJUnit4.class)
public class ServerServiceInstrumentedTest {

    @Test
    public void foregroundServiceStartsServer() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File dataDir = new File(context.getFilesDir(), "service-" + System.currentTimeMillis());

        Intent intent = new Intent(context, ServerService.class);
        intent.putExtra("dataDir", dataDir.getAbsolutePath());
        intent.putExtra("port", 0);
        intent.putExtra("seed", 424242L);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }

        int port = 0;
        for (int attempt = 0; attempt < 60; attempt++) {
            port = ServerService.port();
            if (port > 0) break;
            Thread.sleep(100);
        }
        assertTrue("前台服务应当把服务端拉起来（实际端口 " + port + "）", port > 0);

        // 服务端真的在答 HTTP（不只是端口变量被赋值）
        boolean answered = false;
        for (int attempt = 0; attempt < 40; attempt++) {
            try {
                HttpURLConnection connection =
                        (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/rooms").openConnection();
                connection.setConnectTimeout(300);
                connection.setReadTimeout(300);
                if (connection.getResponseCode() == 200) {
                    answered = true;
                    break;
                }
            } catch (Exception ignored) {
                // 还没起来
            }
            Thread.sleep(100);
        }
        assertTrue("/rooms 应当返回 200", answered);

        context.stopService(new Intent(context, ServerService.class));
        int stopped = 1;
        for (int attempt = 0; attempt < 40; attempt++) {
            stopped = ServerService.port();
            if (stopped == 0) break;
            Thread.sleep(100);
        }
        assertEquals("停服务后端口归零", 0, stopped);
    }
}
