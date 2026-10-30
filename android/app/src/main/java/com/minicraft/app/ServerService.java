package com.minicraft.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import com.minicraft.server.NativeServer;

/**
 * 常驻的联机服务（"这台手机当房主"的核心）。
 *
 * <p>为什么必须有前台服务：Android 会把后台进程随手回收，玩家开着房间去回个消息，
 * 房间就没了；而"房主在跑模拟"是这一局别人能不能玩的前提。前台服务 + 常驻通知是唯一
 * 稳的做法（也是系统允许长期跑的正当理由）。
 *
 * <p>另外两件事在这里做：
 * <ul>
 *   <li>{@code MulticastLock}：不拿这个锁，息屏/省电时系统会**丢掉组播帧**，
 *       表现为"锁屏一会儿别人就找不到这个房间了"（N4 的发现层就靠组播）。</li>
 *   <li>{@code WifiLock}：同上，Wi-Fi 芯片打盹会让服务端的 TCP 也断。</li>
 * </ul>
 *
 * <p>服务本身跑在 Rust 里（{@link NativeServer}），这里只是"申请系统资源 + 起停"。
 */
public class ServerService extends Service {
    public static final String ACTION_STOP = "com.minicraft.app.action.STOP";
    private static final String CHANNEL_ID = "minicraft-server";
    private static final int NOTIFICATION_ID = 42;
    private static final String TAG = "MinicraftServer";

    /** 当前端口（0 = 没在跑）。给 {@code NativeServerPlugin.port()} 读。 */
    private static volatile int port = 0;

    private WifiManager.MulticastLock multicastLock;
    private WifiManager.WifiLock wifiLock;
    private Thread worker;

    public static int port() {
        return port;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        // 两参数版本会读 manifest 里的 foregroundServiceType（dataSync）
        startForeground(NOTIFICATION_ID, buildNotification("正在启动联机服务…"));
        acquireLocks();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        final String dataDir = intent != null && intent.getStringExtra("dataDir") != null
                ? intent.getStringExtra("dataDir")
                : getFilesDir().getAbsolutePath() + "/world";
        final int wantPort = intent != null ? intent.getIntExtra("port", 0) : 0;
        final long seed = intent != null ? intent.getLongExtra("seed", 0L) : 0L;

        // JNI 会阻塞到端口绑好：不能在主线程做（onStartCommand 就在主线程）
        if (worker == null) {
            worker = new Thread(() -> {
                int actual = -1;
                try {
                    actual = NativeServer.startServer(dataDir, wantPort, seed);
                } catch (Throwable error) {
                    Log.e(TAG, "启动失败", error);
                }
                port = actual;
                updateNotification(actual > 0
                        ? "联机服务已启动 · 端口 " + actual
                        : "联机服务启动失败（详见日志）");
                Log.i(TAG, "服务端端口：" + actual);
            }, "minicraft-server");
            worker.start();
        }
        /*
         * **不要** START_STICKY（2026-10-30 用户口径：主机的服务器只在主机玩着的时候存在）。
         *
         * 原来这里是 STICKY，注释写着"玩家的房间不该因为一次内存回收就消失"。但进程被杀之后
         * 重启出来的服务端是**空的**：没有房主连接、没有房间，端口却重新绑上了 LAN，
         * 邻居扫描能扫到一台连不进任何房间的服务器——所谓"网络上残留"就是这么来的。
         * 主机不在 = 房间不存在，宁可让队友看到房间消失，也不要挂一个假服务器在那儿。
         */
        return START_NOT_STICKY;
    }

    /**
     * 用户从最近任务里划掉应用 → 立刻停服。
     *
     * manifest 里已经把 `stopWithTask` 改成 true，正常情况系统会直接 stopService；
     * 这里再显式 `stopSelf()` 是兜底：不同 ROM 对 stopWithTask 的处理有出入，
     * 而这里多做一次的代价只是"已经要停了，再喊一声"。
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "任务被移除，停止联机服务");
        try {
            NativeServer.stopServer();
        } catch (Throwable error) {
            Log.w(TAG, "停止服务端出错", error);
        }
        port = 0;
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        try {
            NativeServer.stopServer();
        } catch (Throwable error) {
            Log.w(TAG, "停止服务端出错", error);
        }
        port = 0;
        releaseLocks();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------ 系统资源

    private void acquireLocks() {
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return;
            multicastLock = wifi.createMulticastLock("minicraft-beacon");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "minicraft-server");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Throwable error) {
            // 拿不到锁只是"息屏后可能找不到房间"，不该让服务起不来
            Log.w(TAG, "获取 Wi-Fi 锁失败（局域网发现可能在息屏后失效）", error);
        }
    }

    private void releaseLocks() {
        try {
            if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        } catch (Throwable ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {
        }
        multicastLock = null;
        wifiLock = null;
    }

    // ------------------------------------------------------------ 通知

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "联机服务", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("别人加入你的世界时，这里显示端口与人数");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setContentTitle("Minicraft 联机服务")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setOngoing(true)
                .setContentIntent(content);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        }
        return builder.build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(text));
        }
    }
}
