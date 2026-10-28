# R8 规则（A27 起 release 开启 minify + shrinkResources）
#
# 目标有两个，缺一不可：
#   1. 别把运行时靠**反射/名字**找到的东西删掉或改名——那会变成"装上去就崩/功能静默失效"；
#   2. 尽量把 Java 层的名字连同注释一起抹掉——这是目前**性价比最高**的一层保护：
#      解封链路（HKDF 派生、AES-GCM、形态变换）以前是明文的，读一遍就能照着实现。

# ------------------------------------------------------------------ JNI
# Rust 侧按名字找 Java 方法（server/rust/src/jni.rs），名字一改就 UnsatisfiedLinkError
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
# JNI 入口类：类名与方法签名都被 native 侧硬编码
-keep class com.minicraft.server.NativeServer { *; }

# ------------------------------------------------------------------ WebView 的 JS 接口
# addJavascriptInterface 暴露的方法按名字反射调用，被改名 = 网页拿不到宿主桥
-keepclassmembers class com.minicraft.app.JsHostBridge {
    public *;
}

# ------------------------------------------------------------------ Capacitor
# 插件方法靠 @PluginMethod 注解反射调用；注解本身也不能被剥掉
-keepattributes *Annotation*
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
# Capacitor 的 WebViewClient/Bridge 用到了若干回调接口
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# ------------------------------------------------------------------ 保险柜本身
# CoreVault / SealedCore 只被我们自己的代码直接调用，理论上可以混淆；
# 但它们是"改包的人第一眼要找的东西"，保留类名反而降低门槛——
# 所以这里**不 keep**，让 R8 把名字压成 a/b/c。

# ------------------------------------------------------------------ 通用
# 保留行号用于崩溃栈映射（mapping.txt 不进包，见 docs/CODE-PROTECTION.md）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 关掉对第三方库的告警噪音（它们只在编译期出现，不影响产物）
-dontwarn org.jetbrains.annotations.**
