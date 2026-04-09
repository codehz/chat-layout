# 文本性能观测基线

本文档定义本仓库文本布局优化的统一观察口径，覆盖 plain / rich / ellipsis / multiline / min-content 等高频路径。

## 目标

- 在不引入正式 benchmark 框架的前提下，提供可重复执行的手动观测步骤。
- 固定输入样本，避免每次优化后只靠主观体感判断。
- 同时观察：
  - 执行时间
  - Offscreen/测量调用次数
  - 缓存预热前后差异

## 样本输入

### 1. 长 plain 英文段落

```ts
const plainEnglish = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega repeated plain text sample for layout benchmarking";
```

### 2. 长 CJK 段落

```ts
const plainCjk = "这是一个用于文本布局性能观察的长段落，包含中文标点、连续词组以及适合 keep-all 与 normal 对比的内容，重复若干次以制造稳定负载。".repeat(6);
```

### 3. 多 span rich 文本

```ts
const richSpans = [
  { text: "alpha beta gamma ", color: "#111" },
  { text: "强调片段", font: "700 16px perf-bold", color: "#c00" },
  { text: " with extra gap", extraWidth: 6, color: "#333" },
  { text: " [atomic]", break: "never", font: "600 16px perf-medium", color: "#06c" },
  { text: " 尾部补充 mixed content", color: "#555" },
];
```

## 必测场景

对每组样本至少记录以下场景：

1. 单行 intrinsic
2. 单行 constrained
3. multiline constrained
4. multiline + ellipsis + maxLines
5. rich multiline constrained

推荐额外记录：

- `whiteSpace: normal` vs `pre-wrap`
- `wordBreak: normal` vs `keep-all`
- `overflowWrap: break-word` vs `anywhere`

## 观测指标

### 时间

优先记录以下两项：

- 冷缓存首次调用耗时
- 热缓存重复调用耗时

建议每个场景执行至少 200~1000 次，取平均值或中位数。

### 测量调用数

仓库已有两类观测点：

- 主绘制上下文 `graphics.measureText()`
- Offscreen 共享测量上下文 `measureText()`

针对缓存优化阶段，重点比较：

- 首次调用的测量次数
- 相同输入重复调用时的新增测量次数
- 切换 `maxWidth` / `overflow` / `ellipsisPosition` 后是否还能复用 prepared 数据

### 分配趋势

当前不额外引入 profiler 框架，先通过以下代理指标观察：

- 是否仍会构造整行 atom 数组
- ellipsis 是否仍会复制“从可见起点到结尾”的整段 atoms
- 热路径里的 `map/reduce/slice/join` 是否减少

## 标准执行步骤

1. 先执行类型检查与文本相关测试，确保基线正确。
2. 使用固定输入样本运行 cold path。
3. 对相同输入重复运行 warm path。
4. 记录时间、测量次数、输出摘要。
5. 修改实现后重复同一流程，按阶段对比。

## 建议命令

```bash
bun test test/text test/renderer/text-layout-cache.test.ts
bun run typecheck
```

## 结果记录模板

建议每次优化在提交说明或计划文档里记录：

- Phase：
- 场景：
- 输入：plain-English / plain-CJK / rich-spans
- 冷缓存耗时：
- 热缓存耗时：
- graphics.measureText 次数：
- offscreen.measureText 次数：
- 结论：

## 当前覆盖结论

现有自动化测试已经覆盖：

- plain intrinsic / constrained / ellipsis / multiline / maxLines
- rich constrained / ellipsis / CJK / keep-all / pre-wrap / break-never
- 节点级 text layout cache 的跨节点、跨宽度、跨 whiteSpace 复用

仍需在后续优化阶段重点留意：

- rich 多行物化的中间数组分配
- `maxLines` 提前停止后的 overflow 判定边界
- ultra-narrow 宽度下 ellipsis 行宽不能超界
- 相同 font 的 shift / ellipsis 宽度缓存是否串值
