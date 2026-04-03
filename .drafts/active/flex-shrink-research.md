# Flex Shrink 实现研究

> 状态：研究阶段，尚未実装
> 关联：`src/nodes/flex.ts`、`src/types.ts`、`src/text.ts`、`src/nodes/text.ts`

---

## 1. CSS flex-shrink 语义

### 触发条件

当 flex 容器的 **主轴方向** 存在已知上限（`maxMain`），且各子项自然宽度之和加上 gap > 可用空间时发生「溢出」。flex-shrink 负责将这个溢出量分配给各子项，使容器不超界。

### 关键概念

| 概念 | CSS 默认值 | 说明 |
|---|---|---|
| `flex-basis` | `auto` | 子项的起始尺寸；`auto` = 内容尺寸 |
| `flex-shrink` | `1` | 收缩权重因子 |
| min-content size | — | 子项可收缩到的最小尺寸（不能再小） |

### CSS 规范算法（简化）

```
// 假设所有项目 flex-basis = auto（即内容尺寸）
deficit = sum(basis_i) + gapTotal − availableMain   // 溢出总量
if deficit <= 0: 不需要收缩

totalScaled = sum(shrink_i * basis_i)               // 总加权因子
for each item i:
  if shrink_i == 0: frozen, finaleMain_i = basis_i
  else:
    shrinkage_i = (shrink_i * basis_i / totalScaled) * deficit
    tentative_i = basis_i − shrinkage_i
    finaleMain_i = max(tentative_i, minContent_i)  // 不能低于 min-content

// 如果有项目触底 (finaleMain_i == minContent_i)，将这些项目"冻结"，
// 用剩余未冻结项目重新计算，直到无新冻结（迭代）
```

注意：如果溢出后仍有 grow 项（grow 优先级高），grow 阶段不适用，先 shrink 再 grow。实际上 CSS 规范保证两者不同时发生（只有正 free space 才 grow，只有负 free space 才 shrink）。

---

## 2. 当前代码状态

### `FlexItemOptions`（`src/types.ts`）

```typescript
export interface FlexItemOptions {
  grow?: number;
  alignSelf?: CrossAxisAlignment | "auto";
  // Phase 5 已移除 shrink / basis，待补全
}
```

### `computeFlexLayout`（`src/nodes/flex.ts`）

当前流程：
1. **Phase 1**（非 grow 项）：从可用空间递减地给每个子项分配约束 `max: availableMain − consumedMain`，只是防止子项「撑大」容器，并不是真正的 shrink 分配。
2. **Phase 2**（grow 项）：按 grow 比例分配剩余空间。
3. **Stretch pass**：对 `alignSelf: stretch` 的项重新测量交叉轴。

**问题**：当子项自然尺寸之和超过 `availableMain` 时，目前没有 shrink 分配逻辑——后面的子项只是被给到「剩余 0」或被限制，并不是按权重均摊溢出量。

### `MultilineText.measure`（`src/nodes/text.ts`）

```typescript
measure(ctx: Context<C>): Box {
  const { width, lineCount } = getMultiLineMeasureLayout(this, ctx, this.text, ...);
  return { width, height: lineCount * this.options.lineHeight };
}
```

- 宽度约束来自 `ctx.constraints?.maxWidth`
- 给定 `maxWidth` → 文字自动折行 → 返回 `{ width, height }`
- **width 与 height 存在耦合**：`maxWidth` 越小 → 行数越多 → `height` 越大

---

## 3. 核心挑战

### 3.1 交叉轴高度依赖（最重要）

对于 **row 方向** + `MultilineText` 子项的组合：

```
shrink → 主轴 width 减小 → maxWidth 约束变小
       → 文字折行变多 → height 增大
       → 容器交叉轴（height）需要重新计算
```

这意味着 shrink 分配完主轴之后，必须重新收集所有子项的新 cross size，更新容器高度，然后再做 stretch re-measure（如有）。

当前代码的 stretch pass 发生在 grow 阶段之后，其结构可以复用，但 shrink pass 需要在此之前插入。

**对 column 方向的影响较小**：收缩的是高度（主轴），`MultilineText` 的高度依赖 `lineCount × lineHeight`，而 `lineCount` 由 `maxWidth` 决定（与高度约束无关）。所以 column shrink 不引发高度→宽度的回路，相对简单。

### 3.2 Min-content 尺寸获取

CSS 不允许子项收缩到 min-content 以下。min-content 的定义：

- **固定尺寸 box**（如 `Fixed`）：min-content = 其固定宽度/高度（无法压缩）
- **多行文本**（`MultilineText`）：min-content = 最长不可打断的词/token 的宽度
- **单行文本**（`Text`）：min-content = 整行宽度（不能截断）
- **PaddingBox**：min-content = 内部 min-content + padding
- **Flex 容器**：min-content 递归为子项 min-content 之和（row）或最大值（column）

**现状**：`Node` 接口没有 `measureMinContent()` 方法，`@chenglou/pretext` 公开 API 中也没有直接的 min-content 测量函数。

#### `@chenglou/pretext` 可用 API

```typescript
// 主要布局入口
walkLineRanges(prepared, maxWidth, onLine): number
layoutNextLine(prepared, start, maxWidth): LayoutLine | null
layoutWithLines(prepared, maxWidth, lineHeight): LayoutLinesResult

// 内部数据（通过 PreparedTextWithSegments 可访问，但属于 brand 类型）
breakableWidths: (number[] | null)[]   // 每个 segment 中可断词单元的宽度列表
```

获取文本 min-content 的可行路径：
- **方式 A**（公开 API）：`walkLineRanges(prepared, ε, callback)` 以极小的 `maxWidth`（如 `0.001`）强制最大折行，每行宽度的最大值即为 min-content。代价：每段文本多一次 O(n) 折行遍历。
- **方式 B**（内部 API）：读取 `prepared.breakableWidths`，对每个 segment 的宽度数组取最大值。速度最快，但依赖未公开的内部结构，升级 pretext 时可能失效。
- **方式 C**（库扩展）：向 `@chenglou/pretext` 提 issue / PR，请求暴露 `minContentWidth()` 函数。长期最干净，但短期无法自给。

### 3.3 迭代冻结问题

当某个子项触底于 min-content 时，需要：
1. 将该项「冻结」（不再参与后续分配）
2. 用剩余溢出量重新分配给未冻结项
3. 重复直到所有项要么冻结、要么溢出量归零

这是一个最坏 O(n²) 的迭代过程（n = 子项数量），但实践中通常 1-2 轮即收敛。

### 3.4 Basis 语义

目前 `FlexItemOptions` 不含 `basis`。CSS flex-basis 属性：
- `auto`（默认）：使用子项内容尺寸
- `<length>`：固定值
- `min-content` / `max-content`：CSS intrinsic sizes

最简路径：只支持 `"auto"`（内容尺寸），后续可扩展为数值。

---

## 4. 需新增的 API 接口

### `FlexItemOptions`

```typescript
export interface FlexItemOptions {
  grow?: number;
  shrink?: number;         // 新增；默认 0，显式开启 shrink
  // basis 先不暴露，内部固定为 "auto"
  alignSelf?: CrossAxisAlignment | "auto";
}
```

**本轮决议**：
- `shrink` 恢复后默认值设为 `0`，保持 opt-in，优先控制兼容性。
- 理由：当前仓库刚在 Phase 5 移除了未实现的 `shrink` / `basis`，如果直接回到 CSS 默认 `1`，有限主轴下的旧布局会在无显式配置时发生行为变化。
- 本轮 README 需要补 migration note，明确：只有显式设置 `shrink > 0` 的子项会参与 overflow redistribution。

### `Node` 接口（可选扩展）

```typescript
export interface Node<C extends CanvasRenderingContext2D> {
  measure(ctx: Context<C>): Box;
  draw(ctx: Context<C>, x: number, y: number): boolean;
  hittest(ctx: Context<C>, test: HitTest): boolean;
  // 可选扩展：
  measureMinContent?(ctx: Context<C>): Box;  // 若不实现，fallback 到 measure(无约束)
}
```

**本轮决议**：
- `measureMinContent?()` 作为正式扩展点引入 `Node`。
- fallback 保持保守：若节点未实现，则用移除主轴上限后的 `measure()` 结果近似，保证 shrink 算法不会因空值崩溃。
- 该接口只承担“最小可收缩内容尺寸”职责，不替代常规 `measure()`。

---

## 5. 算法设计草案

```
function computeFlexLayout(children, options, constraints, measureChild):

  // === Phase 0: 测量所有子项的 flex-basis（auto = 内容尺寸）===
  // 非 grow 项：给予主轴无限制约束，得到 basis
  // grow 项：同 Phase 0，无主轴上限
  for child of orderedChildren:
    basisConstraints = 移除主轴 max 约束
    measured = measureChild(child, basisConstraints)
    basis_i = mainSize(measured)

  totalBasis = sum(basis_i) + gapTotal

  // === Phase A: 判断 shrink 还是 grow ===
  if availableMain != null:
    freeSpace = availableMain − totalBasis
    if freeSpace < 0:    → 走 shrink 路径
    else:                → 走 grow 路径（现有逻辑）

  // === Phase B: Shrink 路径 ===
  deficit = −freeSpace   // 正的溢出量
  frozen = new Set()     // 触底的项目

  loop:
    unfrozen = children filtered by shrink_i > 0 and not frozen
    totalScaled = sum(shrink_i * basis_i for unfrozen)
    if totalScaled == 0: break  // 没有可收缩的项，溢出无法消除

    newFreeze = false
    for item of unfrozen:
      shrinkage = (item.shrink * item.basis / totalScaled) * deficit
      tentative = item.basis − shrinkage
      minC = measureMinContent(item)   // 获取 min-content
      if tentative <= minC:
        item.finalMain = minC
        deficit -= (item.basis - minC)  // 减去已消耗的溢出
        frozen.add(item)
        newFreeze = true
      else:
        item.finalMain = tentative
    if not newFreeze: break

  // === Phase C: 以 finalMain 为 maxMain 重新测量子项 ===
  for child of orderedChildren:
    finalConstraints = { ...childConstraints, maxMain: child.finalMain }
    child.measured = measureChild(child, finalConstraints)
    child.frameCross = crossSize(child.measured)

  // === Phase D: 计算容器 cross size（考虑文字折行后变高）===
  containerCross = max(child.frameCross for all children)
  clamp to [minCross, maxCross]

  // === Phase E: Stretch re-measure（同现有逻辑）===
  ...
```

---

## 6. 潜在问题与解决方案选项

### P1：Min-content 测量接口缺失

**问题**：目前没有方法准确获取任意 `Node` 的 min-content 尺寸。

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. `Node.measureMinContent?()` 可选方法 | 显式、可精确实现 | 需要所有节点实现 |
| B. 在 `text.ts` 用 `walkLineRanges(ε)` 近似 | 利用现有 API | 每次多一次遍历，且全局不统一 |
| C. 无 min-content，允许收缩到 0 | 最简实现 | 文字可能被压至不可见 |
| D. fallback：测量时不传主轴约束，取 "max-content" 为 min | 无需新接口 | 实际上等价于「禁止折行收缩」，语义错误 |

**推荐**：短/中期用 **方案 A + B 组合**：为 `Node` 添加可选 `measureMinContent()`；`MultilineText` 实现时用 `walkLineRanges(0.001)` 近似；其余节点 fallback 到 `measure(无约束)`。

### P2：Basis 测量需要「无主轴上限」

**问题**：Phase 0 需要在无主轴 max 的情况下测量每个子项，但当前 `createAxisConstraints` 会透传父约束。对非 grow 项，目前已有递减限制逻辑，需要重组。

**解决**：Phase 0 统一用「移除主轴 max」的约束测量所有子项 basis（grow/非 grow 一视同仁），然后再判断 grow/shrink。

### P3：Stretch + Shrink 交叉作用

**问题**：现有 stretch re-measure 在 grow 阶段之后。加入 shrink 后，顺序变为：
```
shrink → 确定 finalMain → re-measure（得最终 frameCross）
       → containerCross 确定 → stretch re-measure（用 containerCross 重测交叉轴）
```
Stretch re-measure 本身也可能改变子项大小（例如高度变化），这不会影响主轴，但需要确认当前 stretch 逻辑不会重置 `finalMain`。

**解决**：确保 stretch pass 中对主轴约束的 `min/max` 使用的是 `shrink` 后的 `finalMain`（而非原始 basis）。

### P4：Column 方向 + 多行文本

**问题**：`column` 方向 shrink 会压缩高度，但 `MultilineText` 的高度 = `lineCount * lineHeight`，而 `lineCount` 取决于 `maxWidth`（交叉轴）。**主轴 maxHeight 约束不影响行数**。

**结果**：给 `MultilineText` 设置 `maxHeight` 约束不会让文字重新折行，只会导致内容裁剪（视渲染代码而定）。但这是 CSS 的正常行为（overflow: hidden）。目前渲染器没有裁剪逻辑，shrink 后高度可能「溢出帧」。

**本轮决议**：
- `column shrink + MultilineText` 的视觉溢出问题先**记录风险**，不在本轮补齐完整裁剪系统。
- Phase 4/5 需要通过测试与 README 明确该限制，避免它成为隐性行为差异。

### P5：布局缓存 key 兼容性

**问题**：现有 `getTextLayout` 缓存以 `maxWidth` 为 key。Shrink 后 `maxWidth` 会是 shrink 后的 `finalMain`，与之前的 key 不同，会 miss 缓存。

**结论**：**无需修改缓存逻辑**。以 `maxWidth` 为 key 的设计天然支持不同约束下的缓存分离。只需确保 Phase C re-measure 时传入正确的 `maxWidth: finalMain`。

### P6：默认 shrink 值的 breaking change

**问题**：CSS 默认 `flex-shrink = 1`，即所有子项都参与收缩。若沿用此默认值，现有布局（之前无 shrink 概念）可能在容器有限时出现意外的尺寸变化。

**结论**：
- 本轮采用默认 `shrink = 0`。
- 保持 `basis` 为内部固定 `"auto"`，不对外暴露额外 API。
- Phase 5 必须补 migration note，说明这是一次“能力恢复但保持兼容默认值”的发布。

### P7：Flex 容器嵌套 shrink 递归

**问题**：子项本身也是 `Flex` 容器时，outer flex 给其分配 `finalMain`，inner flex 如何响应？

**结论**：当前架构通过 `ctx.constraints` 传递约束，`inner Flex.measure(ctx)` 会读取 `ctx.constraints.maxWidth`（或 maxHeight）并据此布局。只要 outer 将 `finalMain` 正确设为 `maxMain` 传入，inner flex 会自然处理。

**注意**：inner flex 的子项是否会跟着 shrink 取决于 inner flex 自身逻辑——如果内部也有 `shrink > 0`，需要递归生效（天然满足，因为是递归调用）。

---

## 7. 实现步骤建议（供参考，不是本次工作范围）

1. `FlexItemOptions` 添加 `shrink?: number`
2. `Node` 添加可选 `measureMinContent?(ctx): Box`
3. `src/text.ts` 添加 `measureTextMinContent()` 函数（基于 `walkLineRanges(ε)`）
4. `MultilineText`、`Text`、`PaddingBox`、`Fixed`、`Flex`、`FlexItem` 各自实现 `measureMinContent`
5. `computeFlexLayout` 重构 Phase 1/2，插入 shrink 路径（Phase B–E）
6. 更新 `FlexMeasurement` 增加 `shrink`, `basis`, `minContentMain` 字段
7. 补充测试：row shrink、column shrink、多行文本 shrink、min-content 冻结迭代

---

## 8. 参考链接

- [CSS Flexbox 规范 §9.7 Resolving Flexible Lengths](https://www.w3.org/TR/css-flexbox-1/#resolve-flexible-lengths)
- `@chenglou/pretext` 公开 API：`walkLineRanges`, `prepareWithSegments`
- 当前 flex 实现：[src/nodes/flex.ts](../../src/nodes/flex.ts)
- 文本测量：[src/text.ts](../../src/text.ts)
- 文本节点：[src/nodes/text.ts](../../src/nodes/text.ts)
