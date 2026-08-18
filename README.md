# MetricStudio (HarmonyOS)

MetricStudio 的个人数据分析工具的鸿蒙原生移植版（`harmonyos-port` 分支），对 `main` 分支（React/Tauri 桌面版）进行像素级 UI 对齐移植。

## 技术栈

- **框架**: HarmonyOS Stage 模型 + ArkTS / ArkUI 声明式开发
- **API Level**: 22 (HarmonyOS 6.0.2)
- **图表**: @ohos/charts
- **测试**: @ohos/hypium

## 开发

### 前置要求

- DevEco Studio / devecocli
- ohpm

### 构建

```bash
devecocli build
```

### 运行

```bash
devecocli run --skip-build
```

## 移植进度

- [x] 工程骨架（Stage 模型，可编译）
- [ ] 应用外壳：标题栏 / 侧边栏 / 状态栏 / 主区域布局
- [ ] 数据视图（表格 / CSV 导入 / 数据集列表）
- [ ] 图表构建器
- [ ] Dashboard
- [ ] AI 面板（NL 查询 / 洞察）

## 相关文档

- 移植计划与设计见 `docs/superpowers/plans/` 与 `docs/superpowers/specs/`
