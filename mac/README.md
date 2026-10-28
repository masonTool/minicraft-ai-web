# macOS 端（预留）

当前**没有代码**。形态大概率与 [`windows/`](../windows/README.md) 一致（套壳消费
`web/dist`），差别在签名闸门：macOS 用 `SecCodeCopySigningInformation` 取 Team ID，
与 [`ios/App/CoreVault.swift`](../ios/App/CoreVault.swift) 的判断方式基本相同。

## 约定

- 不复制 `web/` 源码，一律通过 `web/dist` 消费；
- 一次性脚本放 `tools/`，不要放这里。
