# host/ · App 内置的核心数据

`core-baseline.bin` —— **当前安卓 App 里内置的那份方块表快照**（724 条，约 40 KB）。

它在这里的唯一目的是"算增量时要有个对照"：`npm run gen:delta` 拿它跟当前的
`src/core/registry/blockSpecs.ts` 比，算出"线上要发哪些改动"。

## 什么时候换掉它

- **发新版 APK 时**：把这次打包用的 `core.bin` 覆盖到这里（内容必须与 APK 里那份**完全一致**，
  否则增量会按错误的基线算，启动时会被指纹校验拒绝——不会错方块，但新方块就白发了）。
- 覆盖之后记得把 `.tmp/hostcore/core-delta.json` 清掉/重新生成，增量会从零开始。

## 为什么提交进仓库

它是"线上增量对谁生效"的唯一依据。放在本机就会：换台机器算出的增量对不上、
CI 里算不出增量。40 KB 的二进制在这里是划算的。

## 台账：`baseline.json`

每次封版都会写一条，形如：

```json
{
  "baselineVersion": 1,        // 第几版基线（增量靠它对齐）
  "cutAt": "2026-10-25",       // 截止日期
  "gitCommit": "9674e233",     // 封版时的提交
  "blockCount": 724,           // 方块条数
  "fingerprint": "15eff840",   // 名字表指纹（与 bin 解出来的一致才算数）
  "appVersion": "1.0.0",       // 这版 App 的 versionName
  "note": "首个上架版本快照"
}
```

它回答三个问题：**线上 App 现在装的是哪一版基线、什么时候封的、封的时候代码在哪**。

`npm run build:web` 每次都会校验台账与 bin 自洽（条数对不上就报错），
`npm run gen:delta` 会把自己"基于第几版基线"写进增量文件。

> 2026-10-29 起只保留 `build:web` 一条构建线（`build:app` 随端上形态一起下线），
> 但基线台账的自洽校验仍然每次都跑。
