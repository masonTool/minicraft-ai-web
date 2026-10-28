package com.minicraft.server;

/**
 * Rust 服务端的 JNI 入口（对应 {@code server/rust/src/jni.rs}）。
 *
 * <p>类名与包名必须逐字一致：JNI 的函数名是
 * {@code Java_com_minicraft_server_NativeServer_startServer}，改名后表现为
 * {@code UnsatisfiedLinkError}（而且报错只说"找不到方法"，不说是名字对不上）。
 *
 * <p>{@link #startServer} 会阻塞到端口绑好（最多 3 秒，内部等 tokio 起来），
 * <b>不要在主线程调</b>——那会 ANR。{@code ServerService} 里是丢给工作线程的。
 */
public final class NativeServer {
    static {
        System.loadLibrary("minicraft_server");
    }

    private NativeServer() {}

    /**
     * 起服务。
     *
     * @param dataDir 存档目录（{@code world.json} 落在它下面）
     * @param port    0 = 让系统挑端口
     * @param seed    0 = 用服务端默认种子
     * @return 实际监听端口；-1 = 启动失败
     */
    public static native int startServer(String dataDir, int port, long seed);

    /** 停服务（会先补存一次快照）。 */
    public static native void stopServer();

    /** 当前端口；0 = 没在跑。 */
    public static native int serverPort();
}
