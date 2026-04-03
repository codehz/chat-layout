# Flex Shrink 开发计划 Checklist

基于研究文档 [`.drafts/active/flex-shrink-research.md`](/home/codehz/Projects/chat-layout/.drafts/active/flex-shrink-research.md) 整理。这份计划面向“可直接推进开发”的执行视角，按依赖顺序拆成多个阶段，并统一使用 checklist 维护进度。

## 使用约定

- 状态标记统一使用：`[ ]` 未开始、`[-]` 进行中、`[x]` 已完成、`[!]` 阻塞。
- 每个阶段先勾“行动清单”，再勾“验收标准”；全部验收完成后再把阶段状态改成 `[x]`。
- 需要记录临时决策、兼容性取舍或实现偏差时，统一补到对应阶段的“备注”中。
- 如果某阶段完成后推翻了前置假设，先回写本文件，再进入下一阶段，避免实现和计划脱节。

## 本轮目标

- 在 `Flex` 主轴空间不足时，引入符合预期的 `flex-shrink` 分配逻辑，而不是当前“后项拿剩余空间”的近似行为。
- 让 shrink 后的重新测量能够正确反映文本折行带来的交叉轴变化。
- 为 `min-content` 建立最小可用支持，避免文本或容器被压缩到不可接受的尺寸。
- 把测试、示例、迁移说明同步补齐，确保该能力可长期维护。

## 非目标

- 本轮不引入完整 CSS `flex-basis` 语义，内部先固定为 `"auto"`。
- 本轮不追求完整 `overflow` / 裁剪系统；`column shrink + MultilineText` 的裁剪问题可以先记录风险，再决定是否单开后续任务。
- 本轮不尝试一次性对所有节点做复杂 intrinsic size 家族扩展，只聚焦 shrink 所需的最小接口。

## 总览看板

- [x] Phase 0. 锁定语义范围与兼容策略
- [x] Phase 1. 扩展类型与最小测量接口
- [x] Phase 2. 落地 `min-content` 测量能力
- [x] Phase 3. 重构 `Flex` 主轴分配流程并接入 shrink
- [x] Phase 4. 完成 shrink 后重测、stretch 与嵌套场景收口
- [ ] Phase 5. 补齐测试、示例、文档与发布检查

当前进度：`5 / 6` 已完成

---

## Phase 0. 锁定语义范围与兼容策略

状态：`[x] 已完成`

目标：

- 在正式改代码前锁定默认行为、兼容边界和本轮支持范围，避免后面返工。

主要改动点：

- [`.drafts/active/flex-shrink-research.md`](/home/codehz/Projects/chat-layout/.drafts/active/flex-shrink-research.md)
- [`.drafts/active/flex-shrink-development-checklist.md`](/home/codehz/Projects/chat-layout/.drafts/active/flex-shrink-development-checklist.md)
- [`README.md`](/home/codehz/Projects/chat-layout/README.md)

依赖：

- 无

行动清单：

- [x] 明确 `FlexItemOptions.shrink` 的默认值，优先在 `0` 和 `1` 中二选一，并记录原因。
- [x] 明确本轮 `basis` 语义只支持内部 `"auto"`，不对外暴露额外 API。
- [x] 确认 `Node.measureMinContent?()` 是否作为正式扩展点引入；若不引入，需要写清 fallback 方案。
- [x] 明确 `column shrink + MultilineText` 的视觉溢出问题本轮是“记录风险”还是“顺带处理裁剪”。
- [x] 明确是否需要 migration note；若 `shrink` 默认值可能影响旧布局，必须补迁移说明。

验收标准：

- [x] 研究文档和本计划中的关键假设一致，不存在互相冲突的默认值或范围定义。
- [x] 默认值、兼容策略、非目标三项都已形成可执行结论。
- [x] 后续阶段不再依赖“实现时再决定”的关键语义问题。

备注：

- 已确认采用“`shrink` 默认 `0`，后续再评估是否切到 CSS 默认 `1`”的保守路线，以兼容性优先。
- `measureMinContent?()` 将作为正式节点扩展点引入；未实现节点通过保守 fallback 参与 shrink。
- `column shrink + MultilineText` 本轮仅记录限制，不顺带实现裁剪系统。

## Phase 1. 扩展类型与最小测量接口

状态：`[x] 已完成`

目标：

- 为 shrink 算法补齐类型入口和节点级测量协议，但暂不进入完整算法改造。

主要改动点：

- [`src/types.ts`](/home/codehz/Projects/chat-layout/src/types.ts)
- [`src/index.ts`](/home/codehz/Projects/chat-layout/src/index.ts)
- [`test/public-api.test.ts`](/home/codehz/Projects/chat-layout/test/public-api.test.ts)

依赖：

- Phase 0

行动清单：

- [x] 在 `FlexItemOptions` 中恢复 `shrink?: number` 字段，并写明默认语义。
- [x] 为 `Node` 增加可选 `measureMinContent?(ctx): Box` 接口，保持现有节点向后兼容。
- [x] 确认 `Context.measureNode` 的现有约束传递链不需要额外签名变更；如需要，限定在最小范围内调整。
- [x] 检查根导出是否需要同步类型变更，避免公共 API 测试遗漏。
- [x] 更新相关注释或类型说明，明确 `measure()` 与 `measureMinContent()` 的职责边界。

验收标准：

- [x] 类型层已经可以表达 shrink 和最小内容测量能力。
- [x] 旧节点在未实现 `measureMinContent()` 时仍然可以正常编译和运行。
- [x] 公共 API 测试能覆盖新增类型接口没有意外破坏导出面。

备注：

- 已完成接口打底；`Context.measureNode` 签名保持不变，后续 shrink 仍复用现有约束传递链。
- 公共 API 测试新增了编译期哨兵，覆盖 `FlexItemOptions.shrink` 与 `Node.measureMinContent?()` 的导出可用性。

## Phase 2. 落地 `min-content` 测量能力

状态：`[x] 已完成`

目标：

- 为 shrink 冻结迭代提供可靠的 `min-content` 数据来源，至少覆盖文本、包装容器、固定尺寸和 Flex 容器。

主要改动点：

- [`src/text.ts`](/home/codehz/Projects/chat-layout/src/text.ts)
- [`src/nodes/text.ts`](/home/codehz/Projects/chat-layout/src/nodes/text.ts)
- [`src/nodes/box.ts`](/home/codehz/Projects/chat-layout/src/nodes/box.ts)
- [`src/nodes/base.ts`](/home/codehz/Projects/chat-layout/src/nodes/base.ts)
- [`src/nodes/place.ts`](/home/codehz/Projects/chat-layout/src/nodes/place.ts)
- [`src/nodes/flex.ts`](/home/codehz/Projects/chat-layout/src/nodes/flex.ts)
- [`test/text.test.ts`](/home/codehz/Projects/chat-layout/test/text.test.ts)
- [`test/nodes/composition.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/composition.test.ts)
- [`test/nodes/flex.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/flex.test.ts)

依赖：

- Phase 1

行动清单：

- [x] 在 `src/text.ts` 中新增 `measureTextMinContent()` 或等价 helper，优先采用 `walkLineRanges(0.001)` 方案实现。
- [x] 为 `MultilineText` 实现 `measureMinContent()`，使其宽度表示最长不可再压缩 token，高度仍按单行或相应最小行数计算。
- [x] 为 `Text` 实现 `measureMinContent()`，语义等同于整行不可折断宽度。
- [x] 为 `Fixed` 实现 `measureMinContent()`，直接返回固定尺寸。
- [x] 为 `PaddingBox` 实现 `measureMinContent()`，返回“内部 min-content + padding”。
- [x] 为 `Wrapper` / `Place` 明确转发规则，避免包装层吞掉 min-content。
- [x] 为 `Flex` / `FlexItem` 实现递归 `measureMinContent()`，`row` 汇总为子项主轴和，`column` 汇总为子项主轴最大值，并保留 gap 影响。
- [x] 为未实现 `measureMinContent()` 的节点保留安全 fallback，至少保证 shrink 不会因为空值崩溃。

验收标准：

- [x] 核心节点都能返回稳定的 `min-content` 尺寸。
- [x] 文本 `min-content` 与常规测量缓存不会互相污染。
- [x] 至少有测试覆盖“文本 longest token”“PaddingBox 叠加 padding”“嵌套 Flex 递归汇总”三个关键路径。

备注：

- 实现时发现 `walkLineRanges(0.001)` 会落到字符级断行，不符合“longest token”目标；最终改为读取 `prepareWithSegments()` 的 segment 宽度来求 min-content，并继续复用 pretext prepared cache。
- 已补测试覆盖文本 longest token、PaddingBox padding 叠加、Place/Wrapper 转发、以及嵌套 Flex 递归汇总。

## Phase 3. 重构 `Flex` 主轴分配流程并接入 shrink

状态：`[x] 已完成`

目标：

- 把当前基于“边测边扣减剩余主轴空间”的流程改成“先测 basis，再决定 grow / shrink 路径”的统一算法。

主要改动点：

- [`src/nodes/flex.ts`](/home/codehz/Projects/chat-layout/src/nodes/flex.ts)
- [`src/types.ts`](/home/codehz/Projects/chat-layout/src/types.ts)
- [`test/nodes/flex.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/flex.test.ts)

依赖：

- Phase 1
- Phase 2

行动清单：

- [x] 在 `computeFlexLayout` 中新增 Phase 0 basis 测量：对所有子项使用“移除主轴 max、保留交叉轴约束”的方式测量自然主轴尺寸。
- [x] 扩展内部 `FlexMeasurement` 结构，至少记录 `basis`、`shrink`、`minContentMain`、`finalMain`、`frozen`、`allocatedMain`。
- [x] 以 `availableMain - totalBasis` 判断分支：`freeSpace < 0` 进入 shrink，`freeSpace >= 0` 继续沿用 grow / 原有分配。
- [x] 实现 shrink 权重分配公式：按 `shrink * basis` 比例分担溢出量。
- [x] 实现冻结迭代：子项触底 `min-content` 后冻结，并把剩余 deficit 重新分配给未冻结项。
- [x] 处理 `shrink = 0` 或 `totalScaled = 0` 的退化路径，确保算法可以带着剩余溢出安全退出。
- [x] 保证无限主轴约束下不进入 shrink 路径，继续按 intrinsic 行为工作。
- [x] 保持现有 grow 路径在非溢出场景下行为不回退。

验收标准：

- [x] `row` 和 `column` 都能在有限主轴下按 shrink 权重分配溢出量。
- [x] 某个子项达到 `min-content` 后，其余子项能继续吸收剩余 shrink 量。
- [x] 没有 shrink 的旧场景仍与当前行为一致。
- [x] 代码中不再依赖“后测的子项拿到更小 maxMain”来模拟 shrink。

备注：

- 已改为 basis-first：所有子项先做自然主轴测量，再按 `availableMain - totalBasis` 选择 grow / shrink 路径。
- shrink 冻结迭代会只扣除已饱和项真实吸收的 deficit，避免把未冻结项的暂态 shrink 提前算死。
- 非 shrink 场景不会额外触发 `measureMinContent()`，保留现有 grow/stetch 测量次数和行为基线。

## Phase 4. 完成 shrink 后重测、stretch 与嵌套场景收口

状态：`[x] 已完成`

目标：

- 让 shrink 结果真正影响子项最终测量、容器交叉轴、stretch 第二阶段重测和嵌套 Flex 递归行为。

主要改动点：

- [`src/nodes/flex.ts`](/home/codehz/Projects/chat-layout/src/nodes/flex.ts)
- [`src/nodes/text.ts`](/home/codehz/Projects/chat-layout/src/nodes/text.ts)
- [`src/renderer/base.ts`](/home/codehz/Projects/chat-layout/src/renderer/base.ts)
- [`test/nodes/flex.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/flex.test.ts)
- [`test/renderer/layout-context.test.ts`](/home/codehz/Projects/chat-layout/test/renderer/layout-context.test.ts)

依赖：

- Phase 3

行动清单：

- [x] shrink 分配完成后，以每个子项的 `finalMain` 作为主轴上限重新测量，生成最终 `measured` 与 `finalConstraints`。
- [x] 用重测后的子项尺寸重新汇总 `contentCross` 和容器交叉轴，覆盖文本折行变高的场景。
- [x] 调整 stretch pass 顺序为“shrink/grow 后重测 -> 计算 containerCross -> stretch 精确重测”。
- [x] 确保 stretch 第二阶段使用的是 shrink 后的 `finalMain`，不会回退到原始 basis 或旧的剩余空间约束。
- [x] 检查 `contentBox`、`rect`、`draw`、`hittest` 读取到的都是最终约束对应的布局结果。
- [x] 覆盖嵌套 Flex：outer shrink 传入 `finalMain` 后，inner flex 能递归响应自己的 shrink / grow 逻辑。
- [x] 评估并记录 `column shrink + MultilineText` 的表现；若不处理裁剪，至少在备注和文档中说明限制。

验收标准：

- [x] `row + MultilineText` shrink 后会因折行变多而正确增高容器。
- [x] stretch 子项最终 frame 使用的是容器最终交叉轴，且主轴仍受 shrink 后约束控制。
- [x] 布局缓存、绘制、命中测试不会混用第一阶段和最终阶段的约束结果。
- [x] 嵌套 Flex 在 shrink 场景下没有明显回归。

备注：

- 已增加 final-main remeasure：只有当初测约束与最终约束不同才重测，避免非 shrink 场景平白增加测量噪音。
- stretch pass 现基于 `finalConstraints` 再固定交叉轴，因此 shrink 后的主轴上限不会在第二阶段被回退。
- `column shrink + MultilineText` 仍未补裁剪系统；本轮通过测试和文档明确它属于已知限制，而不是隐藏行为。

## Phase 5. 补齐测试、示例、文档与发布检查

状态：`[ ] 未开始`

目标：

- 把 shrink 的行为说明、回归护栏和示例同步到位，确保能力可验证、可迁移、可发布。

主要改动点：

- [`test/nodes/flex.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/flex.test.ts)
- [`test/text.test.ts`](/home/codehz/Projects/chat-layout/test/text.test.ts)
- [`test/nodes/composition.test.ts`](/home/codehz/Projects/chat-layout/test/nodes/composition.test.ts)
- [`test/renderer/text-layout-cache.test.ts`](/home/codehz/Projects/chat-layout/test/renderer/text-layout-cache.test.ts)
- [`example/chat.ts`](/home/codehz/Projects/chat-layout/example/chat.ts)
- [`README.md`](/home/codehz/Projects/chat-layout/README.md)
- [`.drafts/active/flex-shrink-development-checklist.md`](/home/codehz/Projects/chat-layout/.drafts/active/flex-shrink-development-checklist.md)

依赖：

- Phase 4

行动清单：

- [ ] 新增 `row shrink distributes overflow proportionally` 测试。
- [ ] 新增 `shrink respects min-content and freezes saturated items` 测试。
- [ ] 新增 `shrink=0 items opt out of overflow redistribution` 测试。
- [ ] 新增 `row multiline text shrink increases cross size` 测试。
- [ ] 新增 `stretch remeasure keeps finalMain after shrink` 测试。
- [ ] 新增 `nested flex responds to parent finalMain` 测试。
- [ ] 新增文本 min-content 测试，锁定 longest token 语义和空行 / whitespace 行为。
- [ ] 检查并在需要时更新聊天示例，验证 shrink 对 bubble、reply 预览、多段文本的实际效果。
- [ ] 更新 README，补充 shrink 的默认值、使用方式、已知限制和迁移说明。
- [ ] 回填本 checklist 的完成状态和实现备注，作为后续维护入口。

验收标准：

- [ ] shrink 核心行为至少被一组单测和一组组合场景测试锁住。
- [ ] 示例能展示 shrink 的真实收益，而不是只在测试里存在。
- [ ] README 与实现一致，没有残留旧语义描述。
- [ ] 兼容性说明已经明确：哪些布局不会变，哪些布局需要显式开启或调整。

备注：

- 如果某个行为仍存在争议，优先通过 README 和测试名称把语义写清楚，再决定是否继续扩能力。

## 建议执行顺序

1. 先完成 Phase 0 和 Phase 1，尽快锁定默认值与接口形态。
2. 再完成 Phase 2，确保 `min-content` 数据来源可靠，否则 shrink 冻结算法会反复返工。
3. Phase 3 和 Phase 4 建议连续推进，中间不要插入示例或文档类任务。
4. 最后集中完成 Phase 5，把测试、示例、README、迁移说明一次性收口。

## 建议验证命令

- [ ] `bun run typecheck`
- [ ] `bun test test/text.test.ts test/nodes/flex.test.ts test/nodes/composition.test.ts`
- [ ] `bun test test/renderer/text-layout-cache.test.ts test/renderer/layout-context.test.ts`
- [ ] `bun run example`

## 风险跟踪

- [ ] `measureTextMinContent()` 的近似方案在 mock canvas 和真实 canvas 下都稳定。
- [ ] shrink 新逻辑不会破坏现有 grow、justifyContent、reverse、stretch 语义。
- [ ] shrink 后的二次测量不会造成布局缓存错配或显著性能回退。
- [ ] `column shrink + MultilineText` 的限制已被明确记录，不会在发布后变成隐性 bug。
