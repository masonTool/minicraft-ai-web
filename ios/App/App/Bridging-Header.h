/**
 * Swift 与 Rust 服务端之间的桥头文件（2026-10-30）。
 *
 * 头文件来自 `server/ios/include/minicraft_server.h`（与 xcframework 里那份同源）。
 * 指向 `include/` 而不是 xcframework 里的某个切片：模拟器与真机切片目录不同，
 * 写死其中一个会导致另一半编不过。
 */
#import "minicraft_server.h"
