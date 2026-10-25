/**
 * Minicraft 联机服务端 · C 接口（iOS / 其它非 JVM 宿主用）
 *
 * 与 `rust-server/src/capi.rs` 一一对应；Android 走的是 JNI（`src/jni.rs`），
 * 两端共用同一份生命周期（`src/instance.rs`）。
 *
 * 约定：
 *   · `minicraft_start_server` **会阻塞**到端口绑好（最多 3 秒）——不要在主线程调，
 *     否则 iOS 会报 `Thread Performance Checker` 并在真机上卡顿；
 *   · 停止时内部会先补存一次快照，所以 `minicraft_stop_server` 也可能花几十毫秒。
 */
#ifndef MINICRAFT_SERVER_H
#define MINICRAFT_SERVER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * 起服务。
 *
 * @param data_dir 存档目录（UTF-8，`world.json` 落在它下面）；传 NULL 用 `./.data`
 * @param port     0 = 让系统挑端口
 * @param seed     0 = 服务端默认种子
 * @param beacon   非 0 = 开局域网发现（手机当房主时的主线功能）
 * @return 实际监听端口；-1 = 启动失败
 */
int32_t minicraft_start_server(const char *data_dir, int32_t port, int64_t seed, int32_t beacon);

/** 停服务（会先补存一次快照）。 */
void minicraft_stop_server(void);

/** 当前端口；0 = 没在跑。 */
int32_t minicraft_server_port(void);

#ifdef __cplusplus
}
#endif

#endif /* MINICRAFT_SERVER_H */
