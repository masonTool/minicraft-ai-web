# 安卓 / iOS 发版 · 代码与内容保护方案

适用形态：只发原生壳 —— Google Play（AAB）+ App Store（IPA）。不发布 Web 版，仓库私有，无任何公开静态站。

**强度定位**：跳过完整性校验 = 应用不可用；离线重建内容需要重写原生解封逻辑、重新封装数据、重新打包。

**边界**：解密后的明文必然在运行进程内存里，纯本地包不存在密码学意义上的"绝对安全"。本方案的目标是让所有绕过路径都收敛到"数据解不开"，而不是"弹个窗继续玩"。

---

# 第一部分 · 方案

## P · 发布形态

- **P1** 只分发原生安装包：Play 上传 AAB、App Store 上传 IPA。**删除** `.github/workflows/deploy-pages.yml`、`deploy-cf-app.yml`、`deploy-cf-web.yml`，不部署任何可公开访问的 Web 构建；`build:web` 只保留给本地预览。
- **P2** 构建形态三分，互不复用产物：`dev`（可调试、数据明文）、`build:app`（改造为 store 形态：`SPECS_STUB=1` + 数据封存 + 关调试 + 关备份）、`build:web`（仅供本机预览，产物不进任何分发通道）。
- **P3** 发布构建只允许在干净环境出：CI 或专用构建机，`npm ci` 起步，不使用个人工作区产物；每次发布记录产物 SHA-256 与源码 commit。
- **P4** 标识统一：`applicationId` / iOS bundle id 用同一个值（当前 `com.minicraft.app`），`hostCore.ts` 的 `PLAY_STORE_URL` 与之对齐；`versionCode` 由 CI 自增，`versionName` 与 `host/baseline.json` 的 `appVersion` 同源。
- **P5** 上传前强制门禁：`npm run release:audit` 非零退出即拒绝上传，人工不得绕过（清单见 A 组）。

## K · 密钥与签名基础设施

- **K1** Android upload key 在离线机生成，存 `~/.keys/minicraft-upload.jks`（不进仓库、不进 CI 缓存），密码进密码库；两份异地离线介质备份 + 一份纸质恢复卡。
- **K2** 开启 Play App Signing，记录 Play 的 **app signing 证书 SHA-256**（用于运行时白名单，见 I1），并确认 key rotation 后的证书历史一并登记。
- **K3** iOS 用 Apple Distribution 证书 + App Store Connect API Key（App Manager 角色），证书与私钥只存在钥匙串与离线备份；team id / bundle id 视为常量写进原生。
- **K4** 内容密钥与分发密钥分离：`CEK`（数据加密密钥）随数据封装，`KEK`（密钥加密密钥）由签名摘要 + 代码段派生（见 R4）；`CEK` 永不出现在任何产物明文里。
- **K5** 密钥派生只用**确定性**输入（编译期盐、代码段、签名摘要）。时间、设备指纹、安装次数一律**不参与**派生，只参与完整性判定。

## D · 数据封存（构建期）

- **D1** 数据唯一来源是 `src/core/registry/blockSpecs.ts`；`SPECS_STUB=1` 后产物中不得残留（保留 `release-check.mjs` 的探针断言 `minicraft:amethyst_cluster`）。
- **D2** 生成 `core.sealed`（新格式），布局：`[8B nonce][u8 包裹数][每份包裹: 4B keyId + 2B len + AEAD 密文(CEK)][u32 数据长][AEAD 密文]`。**文件不带魔数**，解密失败即拒绝。
- **D3** 密文前的数据先做形态变换（顺序：规范化 → 记录重排 → 字段位打包 → 数值双射编码 → 字符串表置换），全部可逆、无随机性、不依赖时间。
- **D4** `core.sealed` 只放 `assets/sealed/`，**不得**放 `assets/public/` 下（WebView 静态根不可读）。
- **D5** 明文只有两个去处：构建中间产物写 `.tmp/hostcore/`（gitignore，构建结束即删）、增量基线 `host/core-baseline.bin`（私有仓库，只作 `gen:delta` 的对照）。除这两处外，任何产物、缓存、归档、日志都不允许携带明文。
- **D6** 每个分发构建在保留字段写入构建指纹（canary，按渠道/版本不同），不影响游玩行为，用于泄漏溯源。
- **D7** `host/baseline.json` 的 `fingerprint` 仍按**明文**计算（增量机制不变），另加 `sealedSha256` 记录密文摘要；`host/core-baseline.bin` 改为保存明文且仅作增量基线，不再进入任何安装包。

## R · 运行时解封（原生）

- **R1** Android：`shouldInterceptRequest` 只精确匹配 `__host/core` 单一 URL（不做前缀匹配），命中后读 `assets/sealed/core.sealed` → JNI `unsealCore()`；成功返回 200 + 紧凑表，失败返回 404（与未安装时的表现一致）。
- **R2** iOS：在 `WKWebViewConfiguration` 上注册私有 scheme handler（如 `minicraft-core://core`），Capacitor 子类里配置；解封在 Swift 侧完成，调 `MinicraftServer.xcframework`。
- **R3** 解封在 Rust 完成：AEAD 解密 → 逆变换 → 直接产出**紧凑注册表视图**（typed array + 名称表 + 索引表）。JS 侧只保留"装表"代码（`installBlockTable`），**不再包含结构解析器**（`blockTableCodec.ts` 只留构建期编码器 + 只读装载器）。
- **R4** 派生：`KEK = HKDF-SHA256(salt = 编译期盐, ikm = SHA256(只读代码段) ‖ 分片常量)`；`KEK` 只用于解开 `CEK` 包裹体，`CEK` 只用于解数据。编译期盐与分片常量分散存放在多个不相关的原生模块里，并混入等量的伪常量。
- **R5** fail-closed：签名不匹配、包裹体校验失败、段哈希不符、schema 版本不符 —— 任一条件不成立都返回错误表，启动门禁直接拒绝（复用现有"核心数据不可用"路径），**不弹窗、不提示原因、不给重试**。
- **R6** 内存收敛：解封后立即 zero 掉 sealed 原文与中间缓冲；表以只读副本交出；不挂到 `window` / `globalThis`，不放 `localStorage`，不写日志。
- **R7** schema 版本与 `BLOCK_TABLE_VERSION` 同源：不匹配走"请更新应用"路径，禁止硬解半张表。

## I · 防重打包与完整性

- **I1** Android 签名白名单：运行时取 `PackageManager` 的签名摘要 SHA-256（`getSigningCertificateHistory()` 全量比对，覆盖 Play app signing 证书 + 内部测试证书 + 本地 upload 证书），结果作为 R4 的 `ikm` 输入之一。
- **I2** 校验点分散三处、且只有一处与功能耦合：Java 层查安装来源（`InstallSourceInfo`，次要信号）；原生层校验段哈希与签名（**与解封耦合**）；JS 层只校验宿主能力令牌（不承担安全职责）。
- **I3** 禁止"校验失败弹窗/退出"这种可被 patch 的并列分支；失败必须表现为**数据解不开**。
- **I4** 数据完整性：AEAD tag + 记录级 CRC 双层；篡改任一字节 → 解封失败。
- **I5** 原生自校验：`.so` / xcframework 加载后计算只读段哈希（与 R4 同源），不符即派生失败；`extractNativeLibs=false`，避免运行时解压出的副本被替换。
- **I6** iOS 对应：`SecCodeCopySigningInformation` 取 team id + bundle id 参与 `ikm`；bundle 内资源与可执行文件的一致性由 `_CodeSignature` 兜底。

## W · WebView 加固

- **W1** `capacitor.config.json`：`androidScheme` 改 `https`，`allowMixedContent` 改 `false`。**必须在首次上架前改**（换 origin 会清空 localStorage/IndexedDB 里的存档）。
- **W2** Android release 显式 `setWebContentsDebuggingEnabled(false)`，并关闭 `setAllowFileAccess` / `setAllowContentAccess` / `setAllowUniversalAccessFromFileURLs` / `setJavaScriptCanOpenWindowsAutomatically`。
- **W3** iOS：`webView.isInspectable = false`（iOS 16.4+），`limitsNavigationsToAppBoundDomains = true` 并在 `Info.plist` 声明 `WKAppBoundDomains`，关闭 `allowFileAccessFromFileURLs`。
- **W4** 导航白名单：只允许本地源与私有数据 scheme，其余一律交给系统浏览器（`openExternal`），不留在 WebView 内。
- **W5** CSP 收紧到 `default-src 'self'`；生产构建移除全部 `console.*` 输出（避免结构信息进 logcat / 设备日志）。
- **W6** `AndroidManifest.xml`：`allowBackup="false"`、`usesCleartextTraffic` 只在 debug manifest 打开、`android:debuggable` 由构建类型保证为 false。

## G · 原生产物加固

- **G1** Android：`minifyEnabled true` + `shrinkResources true`，keep 规则只保留 Capacitor 插件、`@JavascriptInterface`、JNI 入口类与反射用到的类名。
- **G2** Android：`.so` 用 `-C strip=symbols` 编译，去掉 panic 消息与源码路径；只保留 `arm64-v8a`（Play 需要时再补 `x86_64`）。
- **G3** iOS：`STRIP_INSTALLED_PRODUCT=YES`、`DEPLOYMENT_POSTPROCESSING=YES`、`SWIFT_REFLECTION_METADATA_LEVEL=none`、`ENABLE_TESTABILITY=NO`、`SWIFT_OPTIMIZATION_LEVEL=-O`；xcframework 的静态库先 `strip -x`。
- **G4** dSYM / `mapping.txt` 只存私有存储用于符号化，不随包、不随仓库、不进任何公开制品。

## N · 增量通道

- **N1** `core-delta` 与主数据同形态：编码变换 + AEAD，文件名用不可预测哈希路径；`release-check` 断言 `dist` 内不存在明文 `core-delta.json`。
- **N2** 增量文件带 Ed25519 签名，公钥内置原生；验签失败一律忽略（沿用现有"安全失败"语义），不提示用户。
- **N3** 增量只允许改数据字段（`CoreDeltaFields` 白名单），**禁止**下发任何 JS / 逻辑 / 新代码路径（既是 App Store 2.5.2 要求，也是自身安全边界）。
- **N4** 保留现有纪律：id 只能末尾追加、`baseVersion` / `baseCount` 必须与基线自洽、客户端拒绝套不上的增量。

## S · 存档与联机

- **S1** 存档写入前附 HMAC-SHA256（密钥派生自安装态 + 存档 id），读取校验失败 → 只读模式，不覆盖原档。
- **S2** 联机协议保持房主权威：入房做版本/能力握手；所有长度字段、数组计数、id 索引设上限。
- **S3** Rust FFI 边界统一 `catch_unwind`，panic 不得跨语言；CI 里对协议解析跑 10 分钟短时 fuzz。
- **S4** 房主侧校验玩家上报的坐标、视距、背包增量的合理范围，防伪造与瞬移。
- **S5** 不上传任何用户数据；iOS Privacy Manifest 与 Play 数据安全表单按实际行为如实填写。

## A · CI 门禁

- **A1** 新增 `tools/release-audit.mjs`（或并入 `release-check.mjs`），`npm run release:audit` 一条命令跑完 A2–A5，任一不通过退出非零。
- **A2** 产物断言：无 `.map`；`dist` 内无 `__host/`；无 `assets/public/**/core*`；`core.sealed` 前 4 字节 ≠ `MCTB`、香农熵 > 7.9、大小 ≠ 明文；全产物无 `com.minicraft.game` 残留；无 `http://` 明文 URL（例外需在脚本内注释说明理由）。
- **A3** Android 断言：`apksigner verify --print-certs` 证书指纹 ∈ 白名单；`aapt2 dump badging` 无 `debuggable`、`allowBackup` 为 false、无 cleartext；`readelf -S` 无 `.symtab`。
- **A4** AAB 断言：`bundletool dump manifest --bundle` 复查上述 manifest 项；`versionCode` 严格大于上一次发布的记录值。
- **A5** iOS 断言：`codesign -dv --verbose=4` team id 正确；`otool -l` 无 `__LLVM` 段；`nm -a` 无源码路径与调试符号；`plutil -p` 校验 `CFBundleIdentifier`、`ITSAppUsesNonExemptEncryption`、`WKAppBoundDomains`。
- **A6** 供应链：`npm ci` 只认 lockfile；Actions 钉 commit SHA；workflow 用最小 `permissions`，production 部署加 environment 人工批准；开启 secret scanning + push protection。

## L · 商店与法务

- **L1** 品牌与资产自有：应用名、图标、截图、贴图、音效全部为原创，不使用也不会让人联想到既有商业作品的字样与素材；在目标市场注册商标与开发者实名一致。
- **L2** 侵权处置 SOP 成文：监测到克隆后 72 小时内提交 Play 的 impersonation / DMCA 表单、App Store 的 5.2 投诉、必要时律师函；每次提交附证据包（store id、截图、签名指纹、canary）。
- **L3** 取证能力：贴图嵌不可见水印（频域或最低有效位），配合 D6 的 canary，泄漏副本可溯源到具体构建/渠道。
- **L4** 密钥事故预案：keystore / 证书丢失的判定条件、恢复流程、最坏情况换包名重上架的代价评估，写进内部运行手册。

## X · 明确不采用

- **X1** 不做反 frida / 反注入 / 反调试军备竞赛（成本持续投入、Android 大版本易误伤，且无法改变"明文在内存"的事实）。
- **X2** 现阶段不做商业壳 / VMP / 自定义虚拟化（唯一对 AI 逆向有效的商业手段，但按年授权，与本项目被抄的动机不匹配）。
- **X3** 不做整包 JS 强混淆（控制流平坦化对 2 MB 主包带来体积膨胀与启动变慢，收益仅几小时，且会顶爆现有体积基线）。

---

# 第二部分 · 解释

## P · 发布形态

- **P1** 防住：绕开安装包直接拿数据的全部路径（网页抓取、静态站目录遍历、CDN 缓存残留）。防不住：已安装设备上的本地提取。成本：一次配置，零运行时开销。
- **P2** 防住：调试构建意外外流（debug 证书可被任意重签覆盖）。防不住：内部人员主动外传。成本：脚本层三条命令分流。
- **P3** 防住：构建机上的后门、陈旧产物误发、被篡改的依赖产物。防不住：CI 供应商层面的攻击。成本：一次性配置 + 每次发布几分钟。
- **P4** 防住：落地页引流到不存在的应用、两个商店版本号错位、审核因标识不一致退回。防不住：攻击者用相似的包名做仿冒（那要靠 L1/L2）。成本：十几分钟。
- **P5** 防住："这次赶时间先不发加断言"导致保护静默失效。防不住：有人手工改脚本绕过。成本：与 A 组共用同一份实现。

## K · 密钥与签名基础设施

- **K1** 防住：keystore 进仓库/进 CI 缓存被拖走；磁盘损坏导致应用永久无法更新。防不住：备份介质本身被盗；内部人拿钥匙。成本：半天（含备份与恢复演练）。
- **K2** 防住：上架后签名被 Play 重签导致校验全红；key rotation 后旧校验逻辑失效。防不住：Play 账号被盗后的恶意发版（靠账号 2FA）。成本：一小时。
- **K3** 防住：证书私钥泄漏后被用来签名恶意包。防不住：Apple 账号层面的社会工程。成本：一小时。
- **K4** 防住：一次密钥泄漏导致历史与未来所有版本数据被批量解开（CEK 与 KEK 分离后，换 KEK 即可重新封装）。防不住：攻击者同时拿到 CEK 与解封代码。成本：增加封装体一层，约 1 天。
- **K5** 防住：因时间/设备变化导致的"随机解不开"事故（这类 bug 在真机上不可复现，排查成本极高）。防不住：完全确定性的派生一旦被逆向，可离线复现。成本：设计上免费，测试上要多一轮多设备冷启动验证。

## D · 数据封存

- **D1** 防住：`unzip` 直接读出 724 条方块表；也防住"主包里还留着一份"这类静默回退。防不住：内存 dump。成本：已有机制，保住断言即可。
- **D2** 防住：把数据当结构体直接解析（加密 + 无魔数，读文件的人先要判断这是什么）。防不住：知道格式并拿到 KEK 的人。成本：编码器改写约 1 天。
- **D3** 防住：AI 或人工"看到连续 14 字节记录立刻认出字段"；让结构猜测需要真正的工作量。防不住：拿到内存明文后的对拍。成本：1-2 天（含往返测试与解码器一致性测试）。
- **D4** 防住：WebView 层的静态读取（`file://`、相对路径直取、路径遍历）。防不住：root 设备直接读 APK。成本：半小时。
- **D5** 防住：明文从构建缓存/日志/归档侧漏（这条比 APK 加密更容易被忽略）。防不住：构建机被实时监控。成本：改两行输出路径 + 清理步骤。
- **D6** 防住：无法判断"泄漏的是哪个构建、走哪个渠道流出"。防不住：攻击者把 canary 一并抹掉再传播。成本：半小时。
- **D7** 防住：加密改造把"改方块不用发版"的增量机制一起废掉（这是最容易在加固时踩坏的功能）。防不住：基线文件本身在私有仓库里被内部人取走。成本：半天。

## R · 运行时解封

- **R1** 防住：`assets` 被静态读取；拦截面收敛到一个精确 URL，避免前缀匹配被构造路径绕过。防不住：进程内 hook 拦截函数。成本：半天（含回归：启动、进世界、增量应用）。
- **R2** 防住：iOS 侧把解封逻辑放在 JS 或资源目录里（IPA 的资源是不加密的）。防不住：越狱设备做动态注入。成本：一天（需要处理 Capacitor 的 configuration 覆盖）。
- **R3** 防住：dump 内存后**连解码器一起拿到**——JS 里没有结构解析器，攻击者必须自己反推字段语义。这是本方案里性价比最高的一条。防不住：把装好的表整份导出（这必然可行）。成本：2-3 天（Rust 侧新模块 + JS 侧装载器回归）。
- **R4** 防住：静态分析找固定密钥（没有单一常量，KEK 由多源派生）。防不住：完整动态调试并复现派生链路（有能力的团队，3 天以上）。成本：1-2 天。
- **R5** 防住：把"校验失败"patch 成"继续运行"——因为失败路径没有返回值可用，唯一的后果是数据解不开。防不住：攻击者重写整条解封链并重新封装数据。成本：设计层面已包含在 R3/R4 里。
- **R6** 防住：`window.__blocks` 之类的一行 grep、崩溃日志与遥测里泄漏表内容。防不住：内存遍历（但需要自己推断结构）。成本：半天。
- **R7** 防住：格式升级后旧壳硬解出半张表（表现是静默错方块，比黑屏更难查）。防不住：—。成本：已有机制。

## I · 防重打包与完整性

- **I1** 防住：`apktool` 改包重签后仍能正常运行（签名一变 → KEK 变 → 数据解不开）。这是对"AI 自动重打包"最直接的一击。防不住：用你的原始证书签名（那意味着证书已泄漏，属 K 组事故）。成本：半天。
- **I2** 防住：单点 patch（分散之后攻击者要同时理解三处，且只有一处决定能不能启动）。防不住：熟练的逆向者定位到唯一耦合点。成本：半天。
- **I3** 防住：把校验改成一个永远为 true 的布尔值就把整道防线关掉。这是绝大多数加固方案失效的真实原因。防不住：—。成本：0（换个写法）。
- **I4** 防住：替换数据文件以注入自造方块/属性（联机场景下的伪造数据源）。防不住：内存内直接改表。成本：包含在 D2 里。
- **I5** 防住：替换或 patch 掉 `.so` 后继续使用同一份数据。防不住：同时 patch 段哈希计算函数（需重新对齐整个派生链）。成本：1 天。
- **I6** 防住：iOS 上改 bundle id 重签（越狱/企业证书）后仍能解数据。防不住：App Store 正版包本身的资源提取（那依赖 D 组）。成本：半天。

## W · WebView 加固

- **W1** 防住：明文流量被同网段嗅探/篡改、混合内容被注入。注意边界：换 scheme 会清空存量存档，必须在有真实用户之前完成。成本：2 小时 + 一轮存档回归。
- **W2** 防住：`chrome://inspect` 远程调试（最省事的内存 dump 入口）、`file://` 读取应用私有目录。防不住：root + frida。成本：1 小时。
- **W3** 防住：Safari Web Inspector 直接看 JS 变量（iOS 上等价于 W2 的敞口）、WebView 被导航到任意外部页面。防不住：越狱设备。成本：1 小时。
- **W4** 防住：用外链把游戏页面导到攻击者控制的站点，再借宿主上下文执行脚本。防不住：—。成本：1 小时。
- **W5** 防住：注入脚本读取表、第三方 CDN 被投毒。防不住：已拿到原生层控制权的攻击者。成本：半天（需要处理引擎对 `eval` 的依赖）。
- **W6** 防住：`adb backup` 整份拖数据、明文流量被商店/系统安全扫描标红。防不住：root 读取。成本：10 分钟。

## G · 原生产物加固

- **G1** 防住：脚本小子读 Java 层拿到 JNI 入口与资源路径；顺带减包体。防不住：AI 仍能还原语义（它靠结构不靠命名）。成本：1 小时 + keep 规则调试。
- **G2** 防住：`strings` 一把捞出密钥片段、panic 信息暴露源码路径与模块结构。防不住：反汇编。成本：1 小时。
- **G3** 防住：Swift 符号表等于一张目录（`__swift5` 段会暴露类型与方法名）。防不住：Objective-C runtime 反射（原生里少用 ObjC 即可）。成本：1 小时。
- **G4** 防住：符号文件随包发布时把函数名与行号一并送出。防不住：—。成本：10 分钟。

## N · 增量通道

- **N1** 防住：加密了主数据却把新方块属性用明文 JSON 挂在网上（当前设计里真实存在的侧门）。防不住：能解主数据的人自然也能解增量。成本：半天。
- **N2** 防住：伪造增量往客户端注入攻击者构造的数据。防不住：拿到私钥（私钥只存在发布机与 CI secret）。成本：半天。
- **N3** 防住：审核方把"远程下发逻辑"判成可执行代码（2.5.2 硬性拒审）；也防住自己被这条通道变成后门。防不住：—。成本：0（约束既有接口）。
- **N4** 防住：增量与基线错位导致全服错方块。防不住：—。成本：已有机制。

## S · 存档与联机

- **S1** 防住：改存档刷物品、把改过的存档带进多人局。防不住：内存内实时修改（房主侧校验才是对治）。成本：1 天。
- **S2** 防住：畸形包把房主打崩、超大数组导致内存耗尽。防不住：协议层之外的 DDoS（局域网内意义有限）。成本：半天。
- **S3** 防住：Rust panic 跨 FFI 直接杀进程（这类崩溃看起来像"随机闪退"，极难定位）。防不住：真正的内存安全漏洞（Rust 大幅降低但不为零）。成本：半天 + CI 加 10 分钟。
- **S4** 防住：联机作弊（瞬移、超视距挖掘、凭空物品）——对已上线的游戏，这类损失比"被抄"更直接。防不住：完全客户端权威的设计缺陷（需要改架构）。成本：1-2 天。
- **S5** 防住：因隐私申报不实被商店拒审或下架。防不住：—。成本：2 小时。

## A · CI 门禁

- **A1** 防住：把"记得检查"变成"不通过就发不出去"。防不住：有人本地手工打包上传（靠 P3 的流程约束）。成本：半天。
- **A2** 防住：`.map` 泄漏源码、明文数据回潮、混合内容回潮、旧包名残留——这些都不会让构建报错，只会静默作废。防不住：逻辑层面的漏洞。成本：并入现有 `release-check`。
- **A3** 防住：debug 签名包误发、备份开关忘了关、调试符号残留。防不住：证书本身被窃。成本：1 小时。
- **A4** 防住：AAB 与 APK 断言不一致（Play 只收 AAB，很多团队只测 APK）。防不住：—。成本：1 小时。
- **A5** 防住：iOS 侧漏配（最常见：`isInspectable` 没关、加密申报填错、App-Bound Domains 没声明）。防不住：—。成本：1 小时。
- **A6** 防住：依赖投毒、Action 被篡改、CI secret 被无关 workflow 读取。防不住：GitHub 平台级事件。成本：半天。

## L · 商店与法务

- **L1** 防住：以"名称/图标/素材相似"为入口的克隆应用获得审核通过；也防住自己的应用因 IP 争议被下架。防不住：玩法与规则的模仿（多数司法辖区不予保护）。成本：商标注册的官费与时间，是本方案里唯一无法用代码替代的部分。
- **L2** 防住：克隆应用长期在线（平台投诉是下架的最快路径，通常快于任何技术对抗）。防不住：境外商店/第三方市场反应慢。成本：写成 SOP，一次 2 小时；每次投诉 1 小时。
- **L3** 防住：举证时"无法证明素材是你的"、无法定位泄漏源。防不住：攻击者彻底重绘素材。成本：水印工具 1 天，canary 已在 D6。
- **L4** 防住：密钥丢失时的慌乱决策（换包名 = 评分与用户归零）。防不住：—。成本：写文档 2 小时 + 一次恢复演练。

## X · 不采用

- **X1** 理由：反调试只能提高"动态调试"的门槛，而本方案已经把关键判定移进"数据能否解开"，再叠军备竞赛的边际收益趋近于零，且每次 Android/iOS 大版本都要复测误伤。保留一个可选项：3 行的 `TracerPid` 检查（成本 10 分钟，收益有限）。
- **X2** 理由：商业壳确实对 AI 逆向最有效，但按年授权且需要持续适配；本项目的被盗动机是"抄一份上架"而非金融窃密，投入产出不成立。触发条件：出现规模化克隆或收入跨过阈值时再评估。
- **X3** 理由：强混淆会让主包膨胀 30%-100%、启动变慢，而 `release-check` 的体积基线会直接顶爆；收益只是"让逆向慢几小时"，不如把预算放进 D/R 两组。

---

# 附 · 最低验收线

上线前这 8 条必须同时成立，缺一条即视为方案未落地：

1. `npm run release:audit` 在 store 产物上全绿。
2. 解压 APK/IPA 找不到任何明文方块数据（含增量文件）。
3. 用另一套证书重签安装包 → 应用启动后进不去（数据解不开）。
4. `chrome://inspect` 与 Safari Web Inspector 都连不上 release 包。
5. `androidScheme` 为 `https`，`allowBackup=false`，无 cleartext。
6. 两个商店的包名 / bundle id / 版本号一致，签名指纹已登记。
7. 同一份产物在 3 台设备上冷启动 20 次全部正常（验证派生确定性）。
8. 商标与素材权属文件、canary 记录、密钥备份位置三样都有据可查。
