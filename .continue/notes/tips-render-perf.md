# 手机发热 / 帧时间超预算的定位手法（渲染）

> 从 `TIPS.md#渲染与光照` 拆出来的细节。批次 20261030-1925 的实测过程与结论都在这里；
> 主文件只留一句"先分清填充率还是提交量"。

## 症状

低端机（Pixel 2 XL / 骁龙 835 / Adreno 540 / Android 11）进游戏就烫。
`adb shell dumpsys gfxinfo com.minicraft.app`：

- 卡顿帧 **43.37%**，90 分位 **18ms**，而 60Hz 的帧预算是 16.7ms
  → **每帧稳定超 1~2ms**，不是偶发尖峰；
- GPU 侧 50 分位只有 7ms、90 分位 10ms —— 单看这一项会误判"GPU 不是瓶颈"。

危险之处：帧率看着"还行"（48~60），所以凭感觉改什么都像"没效果"。

## 第一步：按线程量，先否掉"游戏逻辑慢"

不需要任何调试端口（生产 WebView 没有 devtools socket）。读
`/proc/<pid>/task/<tid>/stat` 的第 14+15 字段（utime+stime，单位 10ms），隔 10~15 秒采两次做差：

```sh
for t in $(ls /proc/$PID/task); do
  n=$(cat /proc/$PID/task/$t/comm)
  u=$(awk '{print $14+$15}' /proc/$PID/task/$t/stat)
  echo "$n $u"
done
```

WebView 游戏的线程归属（记住这张表，以后一眼能分）：

| 线程 | 职责 |
| --- | --- |
| `Chrome_InProcGp` | **WebGL 的 GL 命令执行**（渲染开销的主要去处） |
| `RenderThread` | Android hwui 合成 |
| `VizWebView` | 合成器 / viz |
| 进程同名线程（`m.minicraft.app`） | JS 主线程 = 全部游戏逻辑 |
| `Chrome_IOThread` | IPC |
| `AAudio_*` | 音频 |

实测（游戏中，15 秒窗口）：`InProcGp` 21.5% · `RenderThread` 16.3% · **JS 只有 9.5%** ·
`VizWebView` 6.5% → **图形管线 70%，游戏逻辑 9.5%**。
"把游戏逻辑优化一下"这条路当场被否掉。

顺带：同步确认没有热降频（`/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq`
与 `cpuinfo_max_freq` 对比），否则测出来的都是降频后的假象。

## 第二步：抬镜头看天——一眼分出填充率还是提交量

**这是最省事的一次判别实验。** 抬头看天时：地形被视锥剔掉 → draw call 掉到极少，
整屏基本只有天空穹顶一次绘制。

实测结果反直觉：`Chrome_InProcGp` **从 21.5% 升到 37.4%**，而 JS 从 9.5% 降到 6.1%，
整角掉到 48fps。结论非常硬：

> **瓶颈是每像素的片元成本，不是 draw call 数量。**
> 于是"合批 / 减 draw call / 实例化"这一整类优化对本问题**无效**，该去砍整屏着色器。

反过来说，如果看天时 GPU 线程明显下降、帧率变好，那才轮到 draw call / 提交量那条线。

## 第三步：按这个结论动手（本批做的三处）

1. **上下文标志是"每帧都付"的常驻税。** `preserveDrawingBuffer: true` 原本只为
   "存档缩略图能 `drawImage`"（一局抓几次）而开，却和 `antialias: true` 叠成
   **每帧一次 MSAA resolve + 一块不可复用的背板**。
   隔离基准（设备 Chrome，同 GPU、1644×822、MSAA 开、绘制量相同，**只改这一位**）：
   **42.9 fps → 57.8 fps**。
   正确做法：抓图前**在同一个 JS 任务里重画一帧**再 `drawImage`（背板此刻仍有效），
   见 `App.renderForThumbnail()`。
2. **整屏着色器逐像素省钱**（天空穹顶 135 万像素全在跑）：
   - 已经是单位长的 uniform 不要再 `normalize`（`uSunDir` 写进去就是 `(cos t, sin t, 0)`）；
   - `pow(x, 常数)` 一律展开成乘法（GLSL ES 不保证驱动展开常数幂，`pow` 是一对超越函数）；
   - 只在少数时段非零的项（日落霞光 `uSunGlow`）用 **uniform 判据整段跳过**——
     uniform 分支同帧内所有像素一致，没有发散代价。
3. **同一个屏幕空间图案别算两遍**：地形着色器的阈值抖动（批次 524）与输出抖色（批次 520）
   用的是同一个 `bayer4(gl_FragCoord.xy)`，各算一遍等于整屏多十几条 ALU。
   抽出 `ditherWithBayer(color, bayer)` 复用。

## 别顺手做的事

- `antialias: true`（MSAA）是这类项目剩下最大的 GPU 开销，**但它是画质**。
  用户明确要求"画质和帧率尽量不要降"，别把它当优化交出去。
- 地形材质的 `discard`（镂空贴图与实心方块共用一份材质）会破坏 early-Z、放大不透明 overdraw。
  要治得把"镂空层 / 实心层"拆成两套网格 = 多一倍 draw call，属于独立重构，别在性能微调里顺手做。
- 1440p60 的合成开销（`RenderThread` 那 16%）是 WebView 路线的固有地板，
  除非换 SurfaceView，否则动不了。

## 验证这台机器的坑

真机 A/B 需要重新签名安装 release 包：`assembleRelease` 依赖
`MINICRAFT_KEYSTORE` / `MINICRAFT_KEYSTORE_PASSWORD` / `MINICRAFT_KEY_ALIAS` /
`MINICRAFT_KEY_PASSWORD`（密钥 `~/.keys/minicraft-release.jks`，别名 `minicraft`），**口令只有用户知道**。
前端资源是加密打包进 APK、由 `MainActivity` 内存拦截返回的，磁盘上没有明文可替换；
debug 包签名不同，`adb install -r` 会失败，先卸载会连带删掉 `/data/data` 里的世界存档
（不可回退，别擅自做）。

替代手段：`adb reverse` + 设备 Chrome 打开**隔离微基准页**（同 GPU / 同分辨率 / 同 MSAA），
用来量化单个驱动层标志或单条着色器。⚠️ 但设备 Chrome 与 App 内 WebView 的进程模型差别很大
（同一场景实测 189% vs 63% 单核），**整局游戏的绝对 CPU 数字不能横向比较**。

微基准本身也有两个容易搞错的默认值：

- `canvas` 设 `display: none` 仍能跑 rAF，但**真的不合成**——测"合成/呈现"相关开销要让它可见；
- 多个全屏四边形叠在同深度、且开着深度测试时，**第 2 个之后全被 early-z 剔掉**，
  于是"200 draw call"实际只着色了一次，测出来的帧率漂亮但没有信号。
  要么 `gl.disable(gl.DEPTH_TEST)`，要么把几何散到不同深度。
