# 声明式自定义图表（Custom Charts）

> 把一份 JSON 清单放进 `~/.metricstudio/charts/`，应用就会多一个图表类型。
> 当前 `schemaVersion` 为 `1`；实现见 `backend/core/custom_charts.py`。

自定义图表是**纯数据**：清单声明通道、算子、Plotly trace 模板、layout 片段和少量标量选项，不包含任何可执行代码。模块从不导入用户代码，也不调用 `eval` / `exec`；清单里的值只有三种来源——JSON 字面量、白名单槽位（`$x`、`$opt.foo` 等）和算子/模板的固定语义。文件读取与保存都封顶 **256 KB**，`id` 也不能逃出 `~/.metricstudio/charts/`。

## 目录

- [1. 概念与渲染流程](#1-概念与渲染流程)
- [2. 安装、导入与重载](#2-安装导入与重载)
- [3. 清单字段](#3-清单字段)
- [4. 通道 channels](#4-通道-channels)
- [5. 槽位 slots](#5-槽位-slots)
- [6. 算子 transforms](#6-算子-transforms)
- [7. trace 模板](#7-trace-模板)
- [8. layout](#8-layout)
- [9. options](#9-options)
- [10. 完整示例](#10-完整示例)
- [11. 失败与排查](#11-失败与排查)
- [12. AI 助手与项目分享](#12-ai-助手与项目分享)
- [13. 版本与兼容](#13-版本与兼容)

## 1. 概念与渲染流程

一份清单 = 一个图表类型。预览时，后端按固定顺序执行：

1. 校验清单（保存、手动放置后的列表加载都会走同一套校验）；
2. 按编码绑定通道，建立「槽位 → 数据列」映射；
3. 按顺序执行 `transforms`（整张表执行一次，分面之前）；
4. 如果声明了 `facet` 通道或 `facetBy: "$color"`，按取值拆成子图格子；
5. 在每个格子内解析槽位并生成 Plotly traces（`splitBy` 按颜色值展开）；`segments` trace **不产生 trace**，只按行累积 layout 线段（见第 7 节）；
6. 把清单的 `layout` 合并到应用基础 layout，并为分面写入 `grid` 与各格坐标轴；
7. 渲染器把 `segments` 线段与分面 annotation 追加到 layout 末尾（清单自己不能声明 `shapes` / `annotations`）；类目轴上 `segments` 的位置在这一步统一换算成标签下标；
8. 返回 figure；`NaN` 转为 `null`，日期/时间转为 ISO 字符串。

需要特别说明的边界：

- **每个格子内，除 `splitBy` / `segments` 外，一条 trace 模板生成一条 trace**。`splitBy` 会按颜色值展开；`segments` 一条 trace 都不生成（只出 layout 线段）；`color`、`size`、`z`、`error` 不会自动复制 trace。只有 `facet` / `facetBy` 会拆子图；`source` / `target` 现在由 `sankey` 消费。
- `facet` 通道会产生子图网格；`source` / `target` 作为 sankey 端点通道使用（见第 4、7 节）。
- 清单不执行 Plotly 表达式；trace 里只允许单个 `$` 槽位字符串或字面量。需要「一行画两段」时用 `segments`（见第 7 节）。
- `segments` 走的是 layout 路线：线段是 `layout.shapes`，不是 trace。所以只含 `segments` 的清单会正常返回 `{"data": [], "layout": {..., "shapes": [...]}}`，这不是「配置缺失」的空图。

## 2. 安装、导入与重载

| 方式 | 操作 |
| --- | --- |
| 手动放置 | 保存为 `~/.metricstudio/charts/{id}.json`，**文件名（不含 `.json`）必须等于清单里的 `id`** |
| 应用内导入 | 图表类型选择器右上角的滑杆按钮 →「管理自定义图表」→「导入 JSON」 |
| 重新加载 | 管理对话框里的「重新加载」重新拉取目录；手工改完文件后点它刷新列表 |
| 导出 | 管理对话框每行的下载按钮，下载后端规范化后的 `{id}.json` |
| 删除 | 管理对话框每行的删除按钮，确认后删除磁盘文件 |

- 目录不存在时，首次保存/导入会自动创建；手工放置前请先自行创建目录。
- 单个文件上限 **256 KB**；读取、工作台预览和保存共用同一套校验与上限，超限会进入 invalid 列表或直接报错。
- 每个 `*.json` 独立解析。一个文件坏掉不会影响其他文件，也不会让列表接口失败。
- 「导入 JSON」先在浏览器里 `JSON.parse`，再 POST 给后端校验。校验失败不会写文件，错误显示为 `导入失败：<后端 detail>`；后端把所有问题用 `; ` 连接在同一行 `detail` 里。
- 导入同一个 `id` 会覆盖已有文件（接口返回 `replaced: true`）；写入的是规范化后的 pretty JSON，并采用原子替换。
- 无效文件仍保留在磁盘上，在管理对话框的「清单无效」区域按 `file` + `errors[]` 展示；它们**不会出现在图表类型列表里，也不能被选择**。
- 后端的清单缓存按目录内文件的 `mtime` / `size` 失效；应用不会监听文件系统，手工编辑后请点「重新加载」刷新管理列表。

### 工作台

「自定义图表工作台」是全屏编辑表单，带实时预览、校验错误和 AI 生成草稿。入口：

- 「管理自定义图表」→「新建自定义图表」或某一行的「编辑」；
- 图表类型选择器 →「管理自定义图表」。

编辑方式：

- 结构化表单：基础信息、通道、选项、算子（transforms）；
- JSON 编辑：traces 与 layout。

通道表单里，未启用的通道不会写入清单；带必填标记的通道缺少绑定时图表无法渲染（`chart.workbench.hint.channels`）。

预览与保存：

- 预览调用 `/custom/preview`，会先用与保存相同的校验（包括 256 KB 上限）校验未保存的 manifest；校验失败返回 400 和逐项错误，不会写文件。
- 只有点「校验并保存」才会**写入** `~/.metricstudio/charts/{id}.json`；预览本身从不落盘。
- 保存到已存在的 `id` 时会先弹出覆盖确认（`chart.workbench.overwrite`）。
- 预览绑定会在 manifest 的通道或 `yFields` mode 变化后自动重新补齐（已有选择不覆盖），应用 AI 草稿后同样会重新播种；图为空表示还需要补绑定，界面用 `chart.workbench.previewEmpty` 提示。

AI 草稿的约定：

- 后端返回 **502**（模型/服务不可用）时，工作台提供前往设置页的入口，同时保留并显示后端的原始错误消息（`chart.workbench.ai.failed`）。
- 后端返回 **422**（草稿校验失败）时，草稿会被填入工作台，连同校验错误一起供修改，不覆盖已有文件。
- 编辑已有 manifest 时 `id` 锁定；AI 草稿也不会改掉这个锁定 id。

需要新 id 时用「另存为副本」或新建；编辑已有 manifest 时不能在原文件上改名。

## 3. 清单字段

最小可运行清单：

```json
{
  "schemaVersion": 1,
  "id": "minimal",
  "label": {
    "zh": "最小图",
    "en": "Minimal"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "one"
    }
  },
  "traces": [
    {
      "type": "bar",
      "x": "$x",
      "y": "$y0"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 清单版本 | 只能是 `1`（布尔 `true` 也不接受） |
| `id` | string | 是 | 图表类型标识 | 匹配 `^[a-z][a-z0-9_-]{1,39}$`（2–40 字符，小写字母开头）；不得与内置 id 冲突；文件 stem 必须等于它 |
| `label` | object | 是 | 类型显示名 | `{ "zh": string, "en": string }`，两个键都必填，各 1–60 字符；不允许其他语言键 |
| `description` | object | 否 | 类型说明（配置面板展示） | 同样双语的 `{ "zh", "en" }`，各 1–200 字符 |
| `channels` | object | 是 | 编码通道声明 | 至少要有一个可用通道，或 `yFields.mode` 不是 `none`；键只能来自第 4 节 |
| `facetBy` | string \| null | 否 | 清单级分面 | 只能写 `"$color"`；`null` 视为未设置（不分面、不报错）；必须声明 `color` 通道；不能与 `facet` 通道同时声明 |
| `transforms` | array | 否 | 行处理算子链 | 0–8 条，按数组顺序执行 |
| `traces` | array | 是 | Plotly trace 模板 | 1–8 条 |
| `layout` | object | 否 | layout 覆盖项 | 顶层键只能来自第 8 节白名单 |
| `options` | array | 否 | 标量选项 | 0–8 个；结构见第 9 节 |
| `keywords` | string[] | 否 | AI 点名关键词 | 0–5 个，每个 2–24 字符；会转小写、不能重复，且不能与内置或其他自定义图表关键词冲突 |

严格校验：

- 未知顶层字段直接报错：`unexpected: unknown top-level key`。
- `channels`、`transforms`、`options`、trace 顶层键/样式键、`segments` 都有各自的允许键；未知键不会被静默忽略。
- `layout` 只限制顶层键，嵌套对象里的键不限制（见第 8 节）。
- 双语对象只允许 `zh` / `en`；多写语言会报 `unsupported language`。

内置 id（不可占用）：

```
line, bar, barh, area, step, scatter, dot, scatter3d, pie, histogram,
box, violin, ecdf, density_heatmap, density_contour, heatmap, contour,
splom, treemap, sunburst, icicle, sankey, parcoords, parcats, radar,
ternary, waterfall, funnel, table, gantt, candlestick, surface, timeline, gauge
```

## 4. 通道 channels

`channels` 的可用键与渲染效果：

| 键 | 对应槽位 | 说明 |
| --- | --- | --- |
| `x` | `$x` | 主分类/数值列；可被 trace 的数据字段引用 |
| `color` | `$color` | 颜色列；默认只是数据槽，声明 `splitBy` 时用于按取值拆分 trace |
| `size` | `$size` | 大小列；可作为数据槽或 `$size.values` 数组样式槽 |
| `z` | `$z` | 第三数值列；可作为数据槽或 `$z.values` 数组样式槽 |
| `error` | `$error` | 误差列；可作为数据槽或 `$error.values` 数组样式槽 |
| `facet` | — | 绑定时按取值拆成子图网格；不产生 `$facet` 数据槽 |
| `source` | `$source` | sankey 的来源端点列；只对 `sankey` trace 有意义 |
| `target` | `$target` | sankey 的目标端点列；只对 `sankey` trace 有意义 |
| `yFields` | `$y0`…`$y4` | Y 字段声明，只包含 `mode` |

除 `yFields` 外，通道对象的结构是：

```text
{ "required": true|false, "types": ["quantitative"|"nominal"|"temporal", ...] }
```

| 键 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `required` | boolean | 否 | **默认 `true`**。为 `true` 时该通道必须绑定字段；未绑定或类型不匹配时预览返回空 `data`，不是错误 |
| `types` | string[] | 否 | 允许的字段类型；省略或空数组表示不限。取值只能是 `quantitative` / `nominal` / `temporal`，不能重复 |

要点：

- 只有声明了的通道才会出现在编码面板。
- 声明了 `required: true`（含默认）的通道，如果用户没绑字段，整张图退化为 `{"data": [], "layout": ...}`；可选通道没绑定时只是对应槽位不可用。
- 绑定的字段类型不在 `types` 里时，等同于该通道未绑定：`required` → 空图；可选 → 槽位不可用。
- `channels` 至少要声明一个通道，或声明 `yFields.mode` 且不等于 `none`；否则报 `channels: declare at least one channel or a yFields mode other than "none"`。
- `facet` 现在会产生子图网格（见第 7 节）。`source` / `target` 现在会作为 `$source` / `$target` 数据槽供 `sankey` 使用；普通 trace 不能写 `source` / `target` 键。
- `color` 默认不会自动分组。`$color` 取的是颜色列的值，`$color.label` 取的是颜色列名。声明 `"splitBy": "$color"` 后，渲染器才会按颜色值拆成多条 trace（见第 7 节）；`facetBy: "$color"` 则按颜色值拆子图。

### yFields

`yFields` 只有 `mode` 一个键，**没有 `types`**：

| 键 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | `yFields` 存在时必填 | `none` / `one` / `range` / `multi`；不写 `yFields` 等同于 `none` |

| mode | 校验期可用槽位 | 运行时要求 |
| --- | --- | --- |
| `none` | 无 `$yN` | 不需要 Y 字段 |
| `one` | `$y0` | 至少 1 个 Y 字段；只用第 1 个 |
| `range` | `$y0`、`$y1` | 至少 2 个 Y 字段；只用前 2 个 |
| `multi` | `$y0`…`$y4` | 至少 1 个 Y 字段；最多使用前 5 个 |

- `multi` 在校验期会放行 `$y4`，但用户如果只绑了 1 个 Y 字段，运行时只有 `$y0`；trace 引用未绑定的 `$yN` 会让整张图变为空 `data`。
- `range` 下多绑的 Y 字段会被忽略；`one` 下也只取第一个。
- `$yN.label` 优先取编码里 `yFields[N].label`，没有时退化为字段名。

## 5. 槽位 slots

### 数据槽

| 槽位 | 含义 | 可用条件 |
| --- | --- | --- |
| `$x` | `x` 通道的整列值 | 声明并绑定 `x` |
| `$y0`…`$y4` | 第 N 个 Y 字段的整列值 | `yFields.mode` 提供且该 Y 字段已绑定 |
| `$color` | `color` 通道的整列值 | 声明并绑定 `color` |
| `$size` | `size` 通道的整列值 | 声明并绑定 `size` |
| `$z` | `z` 通道的整列值 | 声明并绑定 `z` |
| `$error` | `error` 通道的整列值 | 声明并绑定 `error` |
| `$source` | `source` 通道的整列值（sankey 端点） | 声明并绑定 `source` |
| `$target` | `target` 通道的整列值（sankey 端点） | 声明并绑定 `target` |
| `$count` | **每行一个 `1` 的常量列**，用于给 bar 等提供基线 | 始终可用 |
| `$index` | 变换之后的行号 `0..n-1` | 始终可用 |
| `$<as>` | `group_agg` / `reduce` / `cumulate` 的输出列 | 对应算子执行之后 |

关于 `$count` 和 `$index`：

- `$count` **不是行数统计**。它返回 `[1] * 行数`，适合做常量基线（例如配合 `width` 的 bar）。要统计行数请用 `group_agg` 或 `reduce` 的 `agg: "count"` 并给出 `as` 别名。
- `$index` 是**变换后**的行号，不是原始数据的行号；`dropna` / `sort` / `limit` / `group_agg` / `reduce` 之后会重新从 0 开始。
- 这两个槽位在校验器中始终放行；即使 `group_agg` / `reduce` 清空了其他槽位，它们仍然可以用。它们可以用于 trace 数据字段，也可通过 `$count.values` / `$index.values` 进入数组样式路径；不能写进 `transforms` 的 `slots` / `by` / `field`（算子只能引用通道槽位和算子输出）。

`$<as>` 规则：

- 别名匹配 `^[a-z][a-z0-9_]{0,23}$`。
- 不能与已有槽位同名，也不能使用保留名（`x`、`y0`…`y4`、`color`、`size`、`z`、`error`、`facet`、`source`、`target`、`count`、`index`）。
- `group_agg` 之后，校验期可用的槽位是 `groupBy` 中的所有分组槽位 + `as` 输出；其他原始槽位（以及 `$yN`）都不能再引用。`$count` / `$index` 例外，仍然可用。
- `reduce` 之后，校验期只保留 `as` 输出（以及 `$count` / `$index`）。
- `cumulate` 之后，原有槽位保留，并新增 `as`。

### 数组样式槽 `$<slot>.values`

`$<slot>.values` 把一个完整数据槽暴露成 Plotly 数组，供**指定样式路径**使用。它和 `$slot` 指向同一列，只是使用位置不同。

| 路径 | 是否数值化 | 说明 |
| --- | --- | --- |
| `marker.color` | 否 | 保留字符串/数字原值 |
| `marker.size` | 是 | `pd.to_numeric(errors="coerce")`；缺失值变 `null` |
| `marker.opacity` | 是 | 同上 |
| `error_x.array` | 是 | 同上 |
| `error_x.arrayminus` | 是 | 同上 |
| `error_y.array` | 是 | 同上 |
| `error_y.arrayminus` | 是 | 同上 |

`<slot>` 可以是任何可解析的数据槽：`x`、`y0`…`y4`、`color`、`size`、`z`、`error`、`source`、`target`、`count`、`index`，或 `group_agg` / `reduce` / `cumulate` 的 `as` 输出。`$count.values` 是每行 `1`，`$index.values` 是变换后的 `0..n-1`。

规则：

- **只允许**上表列出的 7 个精确路径。其他样式路径（如 `line.color`、顶层 `opacity`）会报：`traces[0].line.color: '$x.values' is only allowed at marker.color, marker.size, marker.opacity, error_x.array, error_x.arrayminus, error_y.array, error_y.arrayminus`。
- 上述路径限制只针对 `$<slot>.values`；字面量数组仍按普通样式值处理（例如 `line.color` 可以写字面量数组，但它会原样出现在每个系列上，见第 7 节）。
- 放到数据字段（`x` / `y` / `z` / `labels` / `values`）不合法，会按未知数据槽处理。
- 同一路径仍接受字面量数组、字面量标量和 `$opt.<key>` 标量；`$opt` 不会展开成数组。
- 数值化路径保留 `null` 表示缺失；`marker.color` 不做数值化，字符串和数字都原样保留。
- `datetime` / `timedelta` 列在数值数组路径上输出 `null`，不会变成 epoch 纳秒；把 temporal 的 `x` 放到 `marker.size` 会得到 null。
- 数组样式槽使用与数据槽相同的、变换后的行子集；配合 `splitBy` 时，每个系列只拿到该系列的行。
- `error_x` / `error_y` 是新的嵌套样式对象，键见第 7 节。

### 标签槽

| 槽位 | 解析为 |
| --- | --- |
| `$x.label` | `x` 字段的列名 |
| `$y0.label`…`$y4.label` | `yFields[N].label`，缺省为字段名 |
| `$color.label` | `color` 字段的列名（不是分组值） |

标签槽只能出现在 trace 的 `name` / `text`，不能当数据用。`name` / `text` 还可以写普通字符串或 `$opt.<key>`。

### 选项槽

`$opt.<key>` 引用 `options` 中声明的标量值。解析顺序：

1. 当前图表编码里的 `options` 覆盖值；
2. 清单里的 `default`。

`$opt.*` 只能出现在样式键的值（`name` / `text` 也是样式键）或 `layout` 的值里；不能出现在 `x` / `y` / `z` / `labels` / `values` 这些数据字段里。

### 允许位置

| 类别 | 允许位置 | 禁止位置 |
| --- | --- | --- |
| 数据槽 | trace 的 `x` / `y` / `z` / `labels` / `values` | `name`、`text`、样式键、`layout` |
| 数组样式槽 | 仅第 5 节列出的 7 个样式路径 | 其他样式路径、数据字段、`layout` |
| 标签槽 | trace 的 `name` / `text` | 数据字段、其他样式键、`layout` |
| 选项槽 | 样式键的值（包括 `name` / `text`）、`layout` 的值 | 数据字段 `x` / `y` / `z` / `labels` / `values` |

### 数组与字面量

- **数据字段不支持槽位数组**：`"x": ["$x", "$x"]` 会报 `slots inside literal arrays are not supported; use a single slot string`。需要一行画两个端点时用 `segments`。
- `x` / `y` / `z` / `labels` / `values` 可以是单个槽位字符串，也可以是 JSON 字面量（字符串、数字、数组等）；字段本身不能是对象。字面量数组里不能再出现 `$` 开头的字符串。
- 以 `$` 开头的字符串一律按槽位解析，不能作为字面量转义。
- `labels` / `values` 与 `x` / `y` 一样接受单个槽位或字面量，不存在特殊的「标签/值数组」语法。
- `$<slot>.values` 是样式槽，不是数据槽数组；它只在上文列出的 7 个样式路径里成立。

## 6. 算子 transforms

`transforms` 是显式的、按数组顺序执行的算子链，最多 8 条。**算子里的槽位写裸名**（`x`、`y0`、`total`），不能写 `$x`；写 `$` 会直接报错。

```text
{ "op": "dropna", "slots": ["x", "y0"] }
{ "op": "sort", "by": "y0", "descending": true }
{ "op": "limit", "count": 20, "from": "top" }
```

### dropna

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `slots` | string[] | 是 | 1–6 个裸槽位名；不能重复 |

语义：只要所列槽位中任意一个为空 / `NaN` / `null`，整行丢弃。不改变列、不改变行序。

### sort

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `by` | string | 是 | 排序键，必须是当前可用的裸槽位名 |
| `descending` | boolean | 否 | `true` 为降序；默认 `false`（升序） |

语义：稳定排序；空值统一排在最后，不受 `descending` 影响。

### limit

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `count` | integer | 是 | 保留行数，1–5000 |
| `from` | string | 否 | `top`（默认）或 `bottom` |

语义：保留当前顺序的前 `count` 行；`from: "bottom"` 保留最后 `count` 行。紧跟在 `sort` 之后即为 Top N / Bottom N。

### group_agg

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `groupBy` | string \| string[] | 是 | 单个分组槽位（裸名），或 1–2 个槽位的数组；数组内不能重复，3 个及以上会被拒绝 |
| `field` | string | 是 | 被聚合的槽位（裸名）；`sum` / `mean` / `min` / `max` 需要数值列，`count` 只统计非空值 |
| `agg` | string | 是 | `sum` / `mean` / `count` / `min` / `max` |
| `as` | string | 是 | 输出列名；生成 `$<as>` |

语义：

- 按 `groupBy` 的唯一值聚合，输出一行一组。`groupBy` 是单个槽位时输出该列 + `as`；是数组时**每个分组列都保留**，再加 `as`（多键分组，sankey 的聚合链接就靠它）。
- `count` 统计 `field` 的**非空值**数量（与 pandas `groupby.count()` 一致）。
- 聚合后校验期可用的槽位是 `groupBy` 的所有分组槽位 + `as` 输出；之后的 trace 或其他算子只能引用这些（`$count` / `$index` 仍可用）。
- `as` 不能与当前已有槽位同名，也不能使用保留名。
- `groupBy` 数组有重复槽位时：`transforms[0].groupBy: duplicate slot 'x'`；数组长度不是 1–2 时：`transforms[0].groupBy: accepts a slot or an array of 1-2 slots`。
- 声明了 `facet` 通道或 `facetBy`（非 null）时，`group_agg` 会在导入校验阶段被拒绝：`transforms[0]: group_agg cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)`。
- **没有 `metrics[]` 数组**：一次 `group_agg` 只做「一个分组键（或 1–2 个键）+ 一个字段 + 一个聚合 + 一个输出名」。需要多个指标就写多条算子，但注意第二条只能看到第一条收缩后的槽位。

### reduce

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `field` | string | 是 | 被聚合的槽位（裸名）；`sum` / `mean` / `min` / `max` 需要数值列，`count` 可对任意列 |
| `agg` | string | 是 | `sum` / `mean` / `count` / `min` / `max` |
| `as` | string | 是 | 输出列名；生成 `$<as>` |

语义：把**整张表**折叠成一行，只保留 `as` 输出。之后只有 `$<as>`、`$index`、`$count` 可解析；`$index` 是 `[0]`，`$count` 是 `[1]`。`reduce` 是行语义变化算子，和 `group_agg` / `cumulate` / `limit` 一样禁用抽样。缺少任一字段时导入报：`transforms[0]: 'reduce' requires 'field', 'agg' and 'as'`。

数值要求：`sum` / `mean` / `min` / `max` 作用在文本列等非数值列时，渲染阶段抛 `transforms[0]: aggregate 'sum' needs a numeric column`（`agg` 随实际值变化）；`count` 不受此限制。声明了 `facet` 通道或 `facetBy`（非 null）时，`reduce` 在导入阶段直接报：`transforms[0]: reduce cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)`。

### cumulate

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `field` | string | 是 | 输入数值槽位（裸名） |
| `as` | string | 是 | 输出列名；生成 `$<as>` |

语义：

- 如果当前存在 `x` 槽位且列还在，先按 `x` 升序稳定排序；
- 对 `field` 做 `pd.to_numeric(..., errors="raise")` 后累计求和；
- 原字段保留，结果写入新列 `as`，并把 `as` 加入可用槽位。
- `field` 不是数值列时，渲染返回空 `data`（不会 500）。

### 抽样规则

- 只有 **`group_agg` / `reduce` / `cumulate` / `limit`** 会让清单退出抽样；`dropna` / `sort` 仍然可抽样。
- 任何 `indicator` trace 都不参与抽样（即使没有 transform）。
- 可抽样时沿用应用的 5000 点上限（`METRICSTUDIO_CHART_MAX_POINTS` 可调整，`0` 或负数关闭），并在 `layout.meta.sampled` 记录 `total` / `shown` / `max`。
- 算子按整张表执行一次；分面在算子之后才拆格，不会按 facet / color 分组重跑 transforms。

## 7. trace 模板

`traces` 是 1–8 条模板。每条必须有 `type`，类型只能是：

| `type` | 常见数据键 | 说明 |
| --- | --- | --- |
| `scatter` | `x`、`y` 或 `segments` | 点/线；`mode` 控制。写 `segments` 时只产出 layout 线段，`mode` 被忽略 |
| `bar` | `x`、`y` | 柱/条；`orientation: "h"` 时 `x` 为数值、`y` 为类目 |
| `box` | `y`（`x` 可选） | 箱线 |
| `violin` | `y`（`x` 可选） | 小提琴 |
| `waterfall` | `x`、`y` | 瀑布图 |
| `funnel` | `x`、`y` | 漏斗 |
| `indicator` | `value` | KPI / 仪表盘；不输出 `x` / `y` |
| `histogram` | `x` | 直方图 |
| `sankey` | `source`、`target`、`values` | 桑基流向图 |

校验器**不强制**任何数据字段：一条只有 `{"type": "bar"}` 的 trace 也能通过校验（只是 Plotly 画不出东西）。上表是常用搭配，不是必填规则。

`splitBy` 只支持 `scatter`、`bar`、`box`、`violin`、`histogram`、`funnel`；`waterfall`、`indicator`、`sankey` 不支持。

### trace 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 上表九种之一，必填 |
| `x` / `y` / `z` / `labels` / `values` | 槽位字符串或 JSON 字面量 | 数据；`$` 开头按槽位解析 |
| `value` | 槽位或字面量 | 仅 `indicator`；解析后必须恰好一行 |
| `source` / `target` | 槽位或字面量 | 仅 `sankey`；与 `values` 等长 |
| `mode` | string | `scatter` 的 `lines` / `markers` / `lines+markers` 等 |
| `name` / `text` | 标签槽、`$opt` 或字符串 | 图例名 / 文本 |
| `orientation` | `"v"` / `"h"` | bar / waterfall / funnel |
| `segments` | object | 仅 `scatter`；见下文 |
| `splitBy` | string | 仅 `"$color"`；按颜色值展开 trace，见下文 |
| `error_x` / `error_y` | object | 误差条；嵌套键见样式白名单 |
| `title` / `number` / `gauge` / `delta` | object | 仅 `indicator`；见 indicator 小节 |
| `node` / `link` / `arrangement` | object / string | 仅 `sankey`；见 sankey 小节 |
| 其余样式键 | 白名单字面量或 `$opt` | 见下 |

### 样式键白名单

顶层允许的样式键**正好**是：

```
mode, name, text, textposition, orientation, opacity, fill, line, marker,
width, offsetgroup, showlegend, hovertemplate, hole, boxpoints, cumulative,
histnorm, error_x, error_y, title, number, gauge, delta, node, link,
arrangement
```

嵌套对象：

```
line:        color, width, dash, shape, smoothing, simplify
marker:      color, size, symbol, opacity, angle, line, colorscale,
             showscale, cmin, cmax, sizemode, sizeref, standoff
marker.line: 与 line 相同的键
cumulative:  enabled, direction, currentbin, values
error_x:     type, array, arrayminus, visible, color, thickness, width
error_y:     type, array, arrayminus, visible, color, thickness, width
node:        pad, thickness, line, color
link:        color, line
```

数组样式槽 `$<slot>.values` 只允许出现在这些精确路径（数值化行为见第 5 节）：

| 路径 | 允许 `$<slot>.values` | 数值化 |
| --- | --- | --- |
| `marker.color` | 是 | 否 |
| `marker.size` | 是 | 是 |
| `marker.opacity` | 是 | 是 |
| `error_x.array` | 是 | 是 |
| `error_x.arrayminus` | 是 | 是 |
| `error_y.array` | 是 | 是 |
| `error_y.arrayminus` | 是 | 是 |

`line.color`、`line.width`、`marker.symbol`、顶层 `opacity` 等路径**不接受** `$slot.values`；写错会得到第 5 节引用的 `is only allowed at ...` 错误。

- 样式值可以是标量、列表、`$opt.<key>` 或 `$<slot>.values`（仅数组路径）；`line` / `marker` / `cumulative` / `error_x` / `error_y` / `node` / `link` / `title` / `number` / `gauge` / `delta` 必须是对象。
- `name` / `text` 还允许标签槽（`$x.label`、`$y0.label`…、`$color.label`）。
- 样式位置不接受普通数据槽：`"marker": {"color": "$color"}` 会报 `data slots like '$color' are only allowed on x, y, z, labels, values...`。要按数据着色/定大小/画误差，请使用 `$<slot>.values` 并放在第 5 节列出的数组样式路径（如 `marker.color`）。
- `hovertemplate` 只接受字面量或整个 `$opt.<key>`；可以写 Plotly 的 `%{x}` / `%{y}`。
- 白名单是**全局**的，不按 trace type 细分；但 indicator 专用键（`title` / `number` / `gauge` / `delta`）和 sankey 专用键（`node` / `link` / `arrangement`）会在其他 trace 类型上单独拒绝。例如 `hole` 在允许列表里，但 `pie` 不在 trace 类型列表里；`boxpoints` 也可以写在非 box trace 上，Plotly 会自行忽略。

### segments

`segments` 是「一行 → 一条两点线段」的语法，只用于 `scatter`。它**不产生 trace**：每个数据行生成一条 `layout.shapes` 线段。

```text
{
  "segments": {
    "x": "$x",
    "from": "$y0",
    "to": "$y1",
    "horizontal": false
  }
}
```

- 只能出现在 `type: "scatter"` 的 trace 上。`mode` 可以照旧写上，但**会被忽略**（shape 没有 mode）；新清单不必写它。
- `segments` 与顶层 `x` / `y` 互斥；同时出现会报 `'segments' and 'x' are mutually exclusive`（或 `'y'`）。
- `x` / `from` / `to` 必填，值必须是数据槽；`horizontal` 可选，默认 `false`，必须是布尔值。
- `segments` 的槽位只能是数据槽，不能是 `$opt.*` 或 `*.label`。

渲染结果：每行一条 layout shape

```text
{
  "type": "line",
  "x0": i,
  "x1": i,
  "y0": from,
  "y1": to,
  "xref": "x",
  "yref": "y",
  "line": { "color": ..., "width": ..., "dash": ... },
  "layer": "below"
}
```

- 默认：`x0 == x1 ==` 该行的 `x` 位置，`y0` / `y1` 是 `from` / `to`。
- `horizontal: true`：角色互换——`y0 == y1 ==` 该行的 `x` 位置，`x0` / `x1` 是 `from` / `to`。
- 分面时使用该格的轴引用：第一格 `x` / `y`，之后 `x2` / `y2`、`x3` / `y3`……
- `line` 只取 trace 的 `line` 样式里的 `color` / `width` / `dash`；没写就是空对象，交给 Plotly 默认。
- `layer: "below"`：线段画在 marker / bar trace 之下，端点不会被线盖住。
- 任何一行的 `x` / `from` / `to` 缺失或 `NaN`，整条线段被丢弃（不会生成 `[None, value]` 的半截线）。
- **没有图例项、没有 hover**：线段不是 trace，所以不会出现在图例里，`name` / `hovertemplate` / `marker` 对它都无效。图例名、hover 与端点样式请放在同轴的 marker trace 上。
- `layout.shapes` 由渲染器拥有：它在清单 `layout` 合并**之后**追加，基础 layout 里已有的 `shapes` 会保留并排在前面；清单自己不能声明 `shapes`（见第 8 节）。

#### 类目轴：位置改用标签下标

shape 的坐标必须是数值，而 Plotly 的类目轴并不把「类目名」当作数值位置，所以渲染器对**非数值**的 segments 轴做一次统一换位：

- 轴上出现过的类目按**首次出现**顺序编号 `0..n-1`；shape 的 `x0` / `x1`（`horizontal: true` 时是 `y0` / `y1`）写这个下标。
- 同一根轴上的**其他 trace**（例如哑铃图的两个 marker trace）的坐标也一起换成同一组下标；否则线段和端点会落在不同的坐标系里。
- 轴本身写成 `type: "linear"` + `tickmode: "array"` + `tickvals: [0, 1, …]` + `ticktext: ["A", "B", …]`：位置是数字，用户看到的仍是类目名。
- 数值轴（`quantitative`）保持原始值：`x0` / `x1` 直接写数据里的数，不加 `tickvals` / `ticktext`。
- 分面按格独立编号：每格只给自己出现过的类目编号，`xaxis2` / `yaxis2` 等各自拿自己的 `tickvals` / `ticktext`。
- 布尔列按类目处理；只有一个类目且不分面时不换位（没有位置冲突，保留原标签更易读）。

这就是哑铃图能读对的原因：**类目在轴上（`ticktext`），数值在数值轴上（shape 的 `y0` / `y1` 与 marker 的 `y`）**。旧的实现把两个端点写成嵌套数组塞进一条 `scatter`，而嵌套数组只有 `multicategory` 轴才画得出来：Plotly 会把两个端点摆到两个类目槽位上，把同一根轴上的其他 trace 一起压乱；强制成线性轴又会直接丢掉连接线。所以现在改成 layout shape。

写法建议：

- 连接线只负责「连线」：`line.color` / `line.width` 用 `$opt` 暴露成选项即可，不要把样式、图例名、hover 放在 segments trace 上（它都不生效）。
- 端点、图例与 hover 放在 marker trace 上（`name: "$y0.label"`、`marker.size` / `marker.color`）。
- 经典哑铃形状：**类目 `x` + 两个数值 `yFields`**（`mode: "range"`），segments 的 `from` / `to` 分别取 `$y0` / `$y1`。

仓库里的哑铃图第一条 trace 就是完整用法（`mode` 保留只为向后兼容，可省略）：

```text
{
  "type": "scatter",
  "segments": {
    "x": "$x",
    "from": "$y0",
    "to": "$y1"
  },
  "line": {
    "color": "$opt.connector",
    "width": "$opt.width"
  }
}
```

### splitBy

`splitBy` 让一条 trace 模板按颜色列展开成多条 trace。它是 trace 顶层字段，不是样式键：

```text
{
  "type": "scatter",
  "mode": "lines+markers",
  "splitBy": "$color",
  "x": "$x",
  "y": "$y0"
}
```

规则：

- 值只能是精确的 `"$color"`；其他值报 `traces[0].splitBy: only '$color' is supported`。
- 清单必须声明 `color` 通道；否则报 `traces[0].splitBy: requires a 'color' channel`。运行时还必须绑定颜色列，否则整张图退化为空 `data`。
- 只有 `scatter` / `bar` / `box` / `violin` / `histogram` / `funnel` 支持；其他类型报 `traces[0].splitBy: not supported on trace type 'waterfall'`。
- 拆分后的 trace 不能再把 `$color` 当数据槽（`x` / `y` / `z` / `labels` / `values` 或 `segments`），也不能用 `$color.values`；否则报 `traces[0]: a split trace cannot also plot the 'color' slot`。
- `splitBy` 可以和 `segments` 一起用；它本身不会出现在输出的 trace 里。
- `splitBy` 可以出现在普通 `facet` 通道里；不能与 `facetBy: "$color"` 同时使用（见下文 facet 小节）。

每个系列：

- 顺序按颜色值在（变换后的）数据里的**首次出现**顺序，不排序。
- `name` = 模板解析后的 `name` + `" · "` + 值标签；模板没有可用 `name` 时只用值标签。
- `legendgroup` = 值标签；`None` / `NaN` 的值标签是字符串 `"None"`。datetime 使用 ISO-8601（例如 `2024-01-01T00:00:00`），date 使用 `YYYY-MM-DD`；timedelta 仍是 `str()` 形式（如 `1 days 00:00:00`）。
- `showlegend` 默认 `true`；模板显式设置 `showlegend`（包括 `false`）时保留模板值。
- `marker.color` = `palette[series_index % len(palette)]`；`scatter` 且解析后的 `mode` 包含 `lines` 时，`line.color` 也设为同一颜色。
- 调色板按系列序号循环取色；默认是内置 builder 同款 10 色：`#3b82f6`、`#ef4444`、`#10b981`、`#f59e0b`、`#8b5cf6`、`#ec4899`、`#06b6d4`、`#84cc16`、`#f97316`、`#6366f1`。`render(..., palette=[...])` 可以覆盖调色板，但清单本身没有 palette 字段。
- 调色板会覆盖模板里的**标量** `marker.color` / `line.color`；数组值不会被调色板覆盖。`marker.color` 可以写字面量数组或 `$<slot>.values`；`line.color` 的数组只能是**字面量数组**（会通过校验并渲染），不能是 `$<slot>.values`（该路径不在第 5 节的 7 个数组路径内）。注意 `line.color` 的字面量数组会原样写到每个系列上，并抑制调色板对 line 的着色。
- 数组样式槽按系列各自的行子集解析；`segments` 也按系列分别生成 layout shapes（每个系列只对自己那些行出线段）。注意连接线本身不进图例，所以 `splitBy` + `segments` 的图例项只能来自同系列的 marker / bar trace。
- `cumulate` 在拆分**之前**对整张表执行，所以每个系列的累计值都包含其他系列的行；如果需要按系列累计，先用 `group_agg` 汇总到系列粒度，再设计 split 后的 trace。

### facet 与 facetBy

两种声明方式产生同一种子图网格：

1. 声明 `channels.facet` 并绑定一列；
2. 在清单顶层写 `"facetBy": "$color"`（唯一合法值），并声明 `color` 通道。

`facetBy` 是 camelCase 顶层字段；`facetBy: null` 或省略等同于“未设置”（不分面、不报错）；`facet_by` 会被当成未知顶层键。`facetBy` 要求声明 `color` 通道，且不能和 `facet` 通道同时声明。

网格规则：

- 格子 = facet 列的 distinct 值，按**首次出现**顺序（`pd.unique`，不排序）；`None` / `NaN` 的格子标题是字符串 `"None"`。datetime 使用 ISO-8601（例如 `2024-01-01T00:00:00`），date 使用 `YYYY-MM-DD`；timedelta 仍是 `str()` 形式（如 `1 days 00:00:00`）。
- 最多渲染 `MAX_FACET_CELLS`（24）个格子：只取首次出现顺序的前 24 个值，其余丢弃；`columns = min(n, 3)`、`rows = ceil(n / columns)` 都按截断后的格子数计算。超过 24 个时，渲染器在合并后的 layout 末尾追加**一条**自己的 annotation：

  ```text
  {
    "text": "Showing 24 of 137 facet values",
    "showarrow": false,
    "xref": "paper",
    "yref": "paper",
    "x": 0,
    "y": 1.08,
    "xanchor": "left",
    "font": {"size": 11}
  }
  ```

  格子数不超过 24 时不追加 annotation。`annotations` 由渲染器拥有，清单不能设置或删除它（`annotations` 不在 layout 顶层白名单里）。
- 渲染器写入精确的 `layout.grid`：

  ```text
  {
    "rows": 1,
    "columns": 2,
    "pattern": "independent",
    "xgap": 0.08,
    "ygap": 0.12
  }
  ```

  `grid` 由渲染器拥有：清单的 `layout` 顶层不允许 `grid`，写入会被校验拒绝，不能覆盖或删除它。
- 第 `i` 个格子（从 0 开始）使用轴后缀 `""`（第一个）或 `str(i + 1)`：trace 上写 `xaxis: "x"` / `"x2"` …，layout 上写 `xaxis` / `xaxis2` …。每个格子的 `xaxis` 标题设为该格的值；`yaxis` 复制合并后的基础/清单 y 轴。
- 每个格子的轴从合并后的基础 + 清单 `xaxis` / `yaxis` 样式出发（顶层浅合并），因此清单里的网格线、刻度等样式会应用到每一格；但 `domain`、`anchor`、`overlaying`、`matches`、`position`、`scaleanchor`、`constrain` 会从每格副本中剥离，防止清单重定位/联动轴并压塌网格。`range` 保留（数据范围，不改变位置）；`gridcolor`、`showgrid`、`zeroline`、`tickangle`、`title.font` 也保留。若 `title` 是对象，只把 `text` 换成格值，`font` 等其余键保留。

每格内容：

- 该格的 trace 只看到该格的行：数据槽、`$<slot>.values` 数组、`segments`、`splitBy` 都是按格解析的。
- `$index` / `$count` 也按格重新开始：`$index` 是格内 `0..n-1`，`$count` 是格内每行一个 `1`。
- `splitBy` 可以出现在普通 `facet` 通道里（每格再按颜色分系列）；`showlegend` 默认只在第一格为 `true`，模板显式设置 `showlegend` 时以模板为准。未显式设置 `showlegend` 的普通 trace 也遵循“只在第一格显示图例”。
- `splitBy` 不能与 `facetBy: "$color"` 同时使用（见错误表）。
- `facet` 不产生 `$facet` 数据槽；`facet` / `facetBy` / `annotations` 都不会作为 trace 字段出现。
- `group_agg` 与分面不能组合：导入时直接报 `transforms[0]: group_agg cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)`，因为聚合会丢掉分面列。`reduce` 同理：`transforms[0]: reduce cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)`。运行时的空图只适用于真正未绑定的 facet 通道。
- 声明了 `facet` 通道但用户没有绑定可用列时，整张图退化为空 `{"data": [], "layout": ...}`；`facetBy` 的 `color` 未绑定时同样为空。
- `dropna` / `limit` / 抽样会先改变整张表：如果某个 facet 值因此失去全部行，它就不会出现在 `pd.unique` 里，网格会静默少一格（不是只缩小该格）。`limit` 和 `dropna` 在分面之前执行，抽样也在网格之前。
- `cumulate` 在分面之前对整张表执行，因此每格的累计值都包含其他格的行；v1 没有“按格累计”的表达方式（`group_agg` + facet 被禁止）。
- 抽样发生在**整张表**进入网格之前；超过上限时先抽样再分格，因此每格的行数会随 `METRICSTUDIO_CHART_MAX_POINTS` 一起缩小。
- 自定义图表按首次出现顺序排列格子；内置 facet 构建器使用排序后的 `groupby` 顺序。两者切换时，格子顺序可能不同。

### indicator

`type: "indicator"` 用来画单值 KPI / 仪表盘：

- 数据键 `value`：可写数据槽或字面量；槽位解析后必须**恰好一行**，通常先用 `reduce` 折叠成一行。`indicator` 不输出 `x` / `y`，也不参与抽样。
- indicator 上不能写 `values` / `labels` / `z`：`traces[0].values: not allowed on the 'indicator' trace type`（`labels` / `z` 同理）。
- `mode` 是普通样式键，例如 `"gauge+number"`。
- 只允许下列 indicator 专用样式对象（字面量和 `$opt.<key>`；不接受数据槽/标签槽）：
  - `title`: `{text, font}`；`font` 键为 `family`、`size`、`color`。
  - `number`: `{valueformat, suffix, prefix, font}`。
  - `delta`: `{reference, relative, valueformat, increasing, decreasing, position}`；`increasing` / `decreasing` 是 `{color, symbol}`。
  - `gauge`: `{axis, bar, bgcolor, steps, shape, thickness}`；`axis` 为 `{range, tickvals, ticktext, tickformat, visible}`，`bar` 为 `{color, thickness}`。
- 标量叶子（`title.text`、`number.valueformat` / `suffix` / `prefix`、`delta.reference` / `relative` / `valueformat` / `position`、`gauge.bgcolor` / `shape` / `thickness`、`bar.color` / `thickness`、`font.*`、`tickformat`、`visible`）拒绝列表：`traces[0].number.valueformat: must be a scalar`。只有 `axis.range`、`tickvals`、`ticktext`、`steps[].range` 接受列表（前两者/后者分别是数值/文本列表或恰好两个值的 range）；`steps[].color` 也允许列表。
- `gauge.axis.range` 与 `gauge.steps[].range` 必须是**恰好两个值**的数组；`steps` 是字面量数组，最多 10 项，每项 `{range: [lo, hi], color}`，`range` 必填。
- `$opt.<key>` 在 indicator 样式里任意位置都可用，包括 `axis.range` 和 `steps[].range` 的两个元素。
- `title` / `number` / `gauge` / `delta` / `value` 只允许出现在 `indicator` trace；放到其他 trace 类型会报：
  - `traces[0].title: only allowed on the 'indicator' trace type`（`number` / `gauge` / `delta` 同理）
  - `traces[0].value: only allowed on the 'indicator' trace type`
- 值不是恰好一行时渲染直接报错：`traces[0].value: needs exactly one row after transforms (got 5); add a 'reduce' transform`（数字随实际行数变化）；0 行时报 `traces[0].value: no rows after transforms`。
- `steps` 超过 10 项：`traces[0].gauge.steps: at most 10 steps are allowed`；range 不是两个值：`traces[0].gauge.axis.range: must contain exactly two values`。

### sankey

`type: "sankey"` 画来源 → 目标的流向图：

- 必填数据键 `source`、`target`、`values`，都可以是数据槽或字面量数组，且三者**长度必须相等**。字面量长度不相等会在导入校验报 `traces[0]: sankey needs source, target and values of equal length`；槽位在渲染时才发现不等长，也报同一条消息（作为 400 的 `ValueError`，不是空图）。
- `source` / `target` 是 trace 键，只能在 `sankey` 上出现；它们由清单的 `source` / `target` 通道喂入，其他 trace 类型写这两个键会报 `traces[0].source: only allowed on the 'sankey' trace type`（`target` 同理）。
- `node` / `link` / `arrangement` 同样是 sankey-only；放到其他 trace 类型会报 `traces[0].node: only allowed on the 'sankey' trace type`（`link` / `arrangement` 同理）。
- 节点标签的推导顺序：先按行序列出所有 source，再按行序补上尚未出现过的 target；重复标签只出现一次。
- 渲染输出 `node.label`、`link.source` / `link.target`（节点索引）和 `link.value`（`values` 的数值化结果）。**重复 `(source, target)` 行不会被渲染器聚合**；要合并重复链接，先用多键 `group_agg`，例如 `groupBy: ["source", "target"]`（见 `flow-sankey` 示例）。
- `values` 会被 `pd.to_numeric(errors="coerce")` 数值化：非数值项变成 `null`，全列都不是数值时渲染报 `traces[0].values: sankey link values must be numeric`。
- 样式：`node {pad, thickness, line, color}`、`link {color, line}`、`arrangement`、`orientation`；`node.line` / `link.line` 使用与 `line` 相同的嵌套键。`node.color` / `link.color` 只接受字面量或 `$opt` 标量；`link.color` 不接受 `$color.values` 数组槽。
- `splitBy` 不支持 `sankey`；未绑定所需的 `source` / `target` 通道时返回空配置态。

### 已知限制（v1 实现）

- `waterfall` 允许，但白名单里没有 `measure` 字段，因此清单无法逐项声明 `relative` / `total` / `absolute`；只能使用 Plotly 的默认行为。
- `sankey` 的 `link.color` 不接受 `$color.values`（只接受字面量或 `$opt`）；重复链接不会自动聚合，需要多键 `group_agg`。
- `funnel` 没有 `measure` / `textinfo` 等专用键；`hole` 没有对应的 `pie` trace 类型。
- 这些是当前校验常量决定的边界，不要按 Plotly 文档直接粘贴清单里不存在的键。

## 8. layout

`layout` 只允许覆盖以下顶层键：

```
showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title
```

- 顶层键之外会报 `layout.template: is not an allowed layout key (allowed: ...)`。
- 嵌套对象**不再做键白名单**：`xaxis.gridcolor`、`yaxis.automargin`、`margin.l`、`legend.orientation` 等都可以写（参考示例里的 bullet）。嵌套值会递归解析。
- 值可以是字面量或 `$opt.<key>`；数据槽/标签槽不能进 layout。数组里也可以放 `$opt` 项。
- 清单 `layout` 会**浅合并**到应用基础 layout：同名的顶层键整体替换。比如清单写了 `margin`，基础 layout 的 `margin` 会被整体替换，而不是逐键深合并。
- 分面时 `grid` 由渲染器写入；清单不能声明或删除它（`grid` 不在上面的顶层白名单里）。每一格的 `xaxis` / `yaxis` 会复制合并后的轴样式，`xaxis.title` 改为该格的值。
- `annotations` 也由渲染器拥有：清单不能设置或删除它；分面值超过 24 个时渲染器会追加一条 `"Showing 24 of N facet values"` annotation。
- `shapes` 同样由渲染器拥有：清单不能声明它（不在上面的顶层白名单里，会报 `layout.shapes: is not an allowed layout key (allowed: ...)`）。`segments` 线段在清单 `layout` 合并**之后**追加到 `layout.shapes`；基础 layout 里已有的 `shapes`（例如画在图上的参考线）会保留并排在前面，且不会写回调用方传入的 `base_layout`。
- 类目轴的换位（`type` / `tickmode` / `tickvals` / `ticktext`）也发生在合并之后、由渲染器写入；清单对同一根 `xaxis` / `yaxis` 的样式（`gridcolor`、`title.font` 等）会保留，但不要自己写 `tickvals` / `ticktext` 去和类目轴抢。

## 9. options

`options` 是**数组**（不是对象），最多 8 个：

```text
{
  "key": "barWidth",
  "type": "number",
  "default": 0.55,
  "label": { "zh": "柱宽", "en": "Bar width" }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | 匹配 `^[a-z][a-zA-Z0-9_]{0,23}$`；同一清单内不能重复 |
| `type` | string | 是 | `number` / `text` / `boolean` / `select` |
| `default` | number / string / boolean | 是 | 类型必须与 `type` 匹配；`select` 必须在 `choices` 内 |
| `label` | object | 是 | `{ "zh", "en" }`，各 1–60 字符 |
| `choices` | string[] | `select` 必填 | 1–20 个不重复字符串；非 `select` 不允许出现 |

- `number` 的 `default` 必须是有限数字（布尔不算数字）。
- `text` 必须是字符串；`boolean` 必须是 `true` / `false`。
- `select` 的 `default` 必须是 `choices` 里的字符串。
- 选项值在图表编码里作为 `ChartOptions` 的额外键保存（`extra="allow"`）；渲染 `$opt.<key>` 时先读编码覆盖值，再回退到清单 `default`。前端还会丢弃类型不匹配或已不在 `choices` 里的旧值，回退默认值。
- 清单里引用未声明的 `$opt.<key>` 会被校验器拒绝；运行时如果仍解析不到，布局解析失败会退化为空图。
- 修改选项只影响当前图表实例，不回写清单文件。

## 10. 完整示例

下面九份清单就是仓库 `examples/charts/` 里的真实文件（`dumbbell.json`、`lollipop.json`、`bullet.json`、`series-line.json`、`bubble.json`、`facet-grid.json`、`colors-grid.json`、`kpi-gauge.json`、`flow-sankey.json`）。九份都通过 `validate_payload`，并在测试中实际渲染。文档里的 JSON 代码块必须与这些文件保持逐字节一致；测试会逐个校验每个示例文件都已嵌入本文（当前比较的是解析后的 JSON，不是原始字节）。改动示例时请同步文件内容。

### 10.1 哑铃图（dumbbell）

- `x` 是类目，`yFields.mode: "range"` 提供 `$y0` / `$y1`；
- 第一条 trace 用 `segments` 画连接线（渲染成 `layout.shapes`，不进图例、没有 hover），后两条 `scatter` 画两个端点并负责图例名；
- 类目 `x` 会被换位成标签下标，同一根轴上的两个 marker trace 一起换，轴用 `tickvals` / `ticktext` 显示类目名（见第 7 节）；
- `dropna` + `sort` + `limit`，因为出现 `limit`，这张图不参与抽样；
- `connector` / `width` 两个选项注入连接线的 `line.color` / `line.width`。

```json
{
  "schemaVersion": 1,
  "id": "dumbbell",
  "label": {
    "zh": "哑铃图",
    "en": "Dumbbell"
  },
  "description": {
    "zh": "比较两个时点的差距",
    "en": "Compare two points per category"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal",
        "temporal"
      ]
    },
    "yFields": {
      "mode": "range"
    },
    "color": {
      "required": false,
      "types": [
        "nominal"
      ]
    }
  },
  "transforms": [
    {
      "op": "dropna",
      "slots": [
        "x",
        "y0",
        "y1"
      ]
    },
    {
      "op": "sort",
      "by": "y1",
      "descending": true
    },
    {
      "op": "limit",
      "count": 20
    }
  ],
  "traces": [
    {
      "type": "scatter",
      "mode": "lines",
      "segments": {
        "x": "$x",
        "from": "$y0",
        "to": "$y1"
      },
      "showlegend": false,
      "line": {
        "color": "$opt.connector",
        "width": "$opt.width"
      }
    },
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$x",
      "y": "$y0",
      "name": "$y0.label",
      "marker": {
        "size": 10,
        "color": "#94a3b8"
      }
    },
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$x",
      "y": "$y1",
      "name": "$y1.label",
      "marker": {
        "size": 12,
        "color": "#2563eb"
      }
    }
  ],
  "layout": {
    "showlegend": true,
    "margin": {
      "l": 70,
      "r": 20,
      "t": 30,
      "b": 50
    }
  },
  "options": [
    {
      "key": "connector",
      "type": "text",
      "default": "#cbd5e1",
      "label": {
        "zh": "连线颜色",
        "en": "Connector color"
      }
    },
    {
      "key": "width",
      "type": "number",
      "default": 2,
      "label": {
        "zh": "线宽",
        "en": "Line width"
      }
    }
  ],
  "keywords": [
    "哑铃图",
    "dumbbell chart"
  ]
}
```

### 10.2 棒棒糖图（lollipop）

- `yFields.mode: "one"`；
- 一条横向 `bar` 当「杆」，一条 `scatter` marker 当「糖」；
- `dropna` + `sort`（可抽样），`stem` / `dot` 两个颜色选项。

```json
{
  "schemaVersion": 1,
  "id": "lollipop",
  "label": {
    "zh": "棒棒糖图",
    "en": "Lollipop"
  },
  "description": {
    "zh": "用一条细柱连接零点与数值",
    "en": "Connect zero to each value with a thin stem"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal",
        "temporal"
      ]
    },
    "yFields": {
      "mode": "one"
    }
  },
  "transforms": [
    {
      "op": "dropna",
      "slots": [
        "x",
        "y0"
      ]
    },
    {
      "op": "sort",
      "by": "y0",
      "descending": true
    }
  ],
  "traces": [
    {
      "type": "bar",
      "x": "$x",
      "y": "$y0",
      "width": 0.08,
      "showlegend": false,
      "marker": {
        "color": "$opt.stem"
      }
    },
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$x",
      "y": "$y0",
      "name": "$y0.label",
      "marker": {
        "size": 12,
        "color": "$opt.dot"
      }
    }
  ],
  "layout": {
    "showlegend": false,
    "margin": {
      "l": 60,
      "r": 20,
      "t": 24,
      "b": 50
    }
  },
  "options": [
    {
      "key": "stem",
      "type": "text",
      "default": "#cbd5e1",
      "label": {
        "zh": "柱颜色",
        "en": "Stem color"
      }
    },
    {
      "key": "dot",
      "type": "text",
      "default": "#2563eb",
      "label": {
        "zh": "圆点颜色",
        "en": "Dot color"
      }
    }
  ],
  "keywords": [
    "棒棒糖图",
    "lollipop chart"
  ]
}
```

### 10.3 子弹图（bullet）

- `yFields.mode: "range"`：`$y0` 实际值、`$y1` 目标值；
- 一条横向 `bar` 画实际值，一条 `scatter` 用 `line-ns` marker 画目标刻度；
- `layout` 里的 `xaxis.gridcolor` / `yaxis.automargin` 演示了嵌套 layout 键会透传；
- `barWidth` / `targetColor` / `targetSize` 三个选项分别注入宽度、目标颜色与目标 marker 大小。

```json
{
  "schemaVersion": 1,
  "id": "bullet",
  "label": {
    "zh": "子弹图",
    "en": "Bullet"
  },
  "description": {
    "zh": "对比实际值与目标值",
    "en": "Compare actual values with targets"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "range"
    }
  },
  "transforms": [
    {
      "op": "dropna",
      "slots": [
        "x",
        "y0",
        "y1"
      ]
    }
  ],
  "traces": [
    {
      "type": "bar",
      "orientation": "h",
      "x": "$y0",
      "y": "$x",
      "width": "$opt.barWidth",
      "marker": {
        "color": "#93c5fd"
      },
      "showlegend": false
    },
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$y1",
      "y": "$x",
      "name": "$y1.label",
      "showlegend": false,
      "marker": {
        "symbol": "line-ns",
        "size": "$opt.targetSize",
        "color": "$opt.targetColor",
        "line": {
          "width": 2
        }
      }
    }
  ],
  "layout": {
    "showlegend": false,
    "margin": {
      "l": 90,
      "r": 20,
      "t": 30,
      "b": 40
    },
    "xaxis": {
      "gridcolor": "#e2e8f0"
    },
    "yaxis": {
      "automargin": true
    }
  },
  "options": [
    {
      "key": "barWidth",
      "type": "number",
      "default": 0.55,
      "label": {
        "zh": "柱宽",
        "en": "Bar width"
      }
    },
    {
      "key": "targetColor",
      "type": "text",
      "default": "#1e293b",
      "label": {
        "zh": "目标颜色",
        "en": "Target color"
      }
    },
    {
      "key": "targetSize",
      "type": "number",
      "default": 18,
      "label": {
        "zh": "目标标记大小",
        "en": "Target marker size"
      }
    }
  ],
  "keywords": [
    "子弹图",
    "bullet chart"
  ]
}
```

### 10.4 分系列折线图（series-line）

- `color` 为必填通道，`splitBy: "$color"` 把一条 `scatter` 按颜色值展开成多条；
- 模板没有 `name`，所以图例名直接使用颜色值；`legendgroup` 同名；
- 调色板按首次出现顺序分配，`scatter` + `lines+markers` 同时写入 `marker.color` 与 `line.color`。

```json
{
  "schemaVersion": 1,
  "id": "series-line",
  "label": {
    "zh": "分系列折线图",
    "en": "Series line"
  },
  "description": {
    "zh": "按颜色拆成多条折线",
    "en": "Split one line per colour value"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "one"
    },
    "color": {
      "required": true,
      "types": [
        "nominal"
      ]
    }
  },
  "traces": [
    {
      "type": "scatter",
      "mode": "lines+markers",
      "splitBy": "$color",
      "x": "$x",
      "y": "$y0",
      "marker": {
        "size": 6
      }
    }
  ],
  "layout": {
    "showlegend": true
  },
  "keywords": [
    "分系列折线图",
    "series line chart"
  ]
}
```

### 10.5 气泡图（bubble）

- `marker.size` 使用 `$size.values`，`marker.color` 使用 `$color.values`，`error_y.array` 使用 `$error.values`；
- 没有 `splitBy`，所以 `marker.color` 的数组会原样保留，不会被调色板覆盖；
- `error_y` 是新的嵌套样式对象，`type: "data"`、`visible: true`。

```json
{
  "schemaVersion": 1,
  "id": "bubble",
  "label": {
    "zh": "气泡图",
    "en": "Bubble"
  },
  "description": {
    "zh": "用大小、颜色与误差表达三个维度",
    "en": "Size, colour and error in one scatter"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "quantitative"
      ]
    },
    "yFields": {
      "mode": "one"
    },
    "color": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "size": {
      "required": true,
      "types": [
        "quantitative"
      ]
    },
    "error": {
      "required": true,
      "types": [
        "quantitative"
      ]
    }
  },
  "traces": [
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$x",
      "y": "$y0",
      "marker": {
        "size": "$size.values",
        "color": "$color.values"
      },
      "error_y": {
        "type": "data",
        "array": "$error.values",
        "visible": true
      }
    }
  ],
  "layout": {
    "showlegend": false,
    "margin": {
      "l": 60,
      "r": 20,
      "t": 24,
      "b": 50
    }
  },
  "keywords": [
    "气泡图",
    "bubble chart"
  ]
}
```

### 10.6 分面网格（facet-grid）

- `channels.facet` 必填；每个 region 值一个格子，按首次出现顺序排列；
- 所有格子共享同一个 `bar` 模板，`x` / `y0` 只看到本格的行；
- 渲染器写入 `grid`，每个 `xaxis` 的标题是格子值；这个示例不声明 `facetBy`。

```json
{
  "schemaVersion": 1,
  "id": "facet-grid",
  "label": {
    "zh": "分面网格",
    "en": "Facet grid"
  },
  "description": {
    "zh": "按分类列拆成子图网格",
    "en": "Split categories into a subplot grid"
  },
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "one"
    },
    "facet": {
      "required": true,
      "types": [
        "nominal"
      ]
    }
  },
  "traces": [
    {
      "type": "bar",
      "x": "$x",
      "y": "$y0"
    }
  ],
  "layout": {
    "showlegend": false,
    "margin": {
      "l": 50,
      "r": 20,
      "t": 30,
      "b": 45
    }
  },
  "keywords": [
    "分面网格",
    "facet grid"
  ]
}
```

### 10.7 颜色网格（colors-grid）

- 顶层 `facetBy: "$color"`，按 `color` 值拆格；`color` 必填；
- `marker.color` 使用 `$color.values`，在每个格子里只留下该格的颜色值；
- 因为用的是 `facetBy`，这个 trace 不能同时声明 `splitBy`。

```json
{
  "schemaVersion": 1,
  "id": "colors-grid",
  "label": {
    "zh": "颜色网格",
    "en": "Colors grid"
  },
  "description": {
    "zh": "按颜色值拆成子图网格",
    "en": "Split colour values into a subplot grid"
  },
  "facetBy": "$color",
  "channels": {
    "x": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "one"
    },
    "color": {
      "required": true,
      "types": [
        "nominal"
      ]
    }
  },
  "traces": [
    {
      "type": "scatter",
      "mode": "markers",
      "x": "$x",
      "y": "$y0",
      "marker": {
        "size": 8,
        "color": "$color.values"
      }
    }
  ],
  "layout": {
    "showlegend": false,
    "margin": {
      "l": 50,
      "r": 20,
      "t": 30,
      "b": 45
    }
  },
  "keywords": [
    "颜色网格",
    "colors grid"
  ]
}
```

### 10.8 KPI 仪表盘（kpi-gauge）

- `reduce` 把 `y0` 求和折叠成一行 `$total`；
- `indicator` 用 `value: "$total"`，`gauge.axis.range` 与 `gauge.steps[].range` 都支持 `$opt` 对；
- 三个 options 控制最小值、最大值和仪表颜色，`indicator` 不参与抽样。

```json
{
  "schemaVersion": 1,
  "id": "kpi-gauge",
  "label": {
    "zh": "KPI 仪表盘",
    "en": "KPI gauge"
  },
  "description": {
    "zh": "把一列汇总成一个仪表盘数值",
    "en": "Reduce one column to a single gauge value"
  },
  "channels": {
    "yFields": {
      "mode": "one"
    }
  },
  "transforms": [
    {
      "op": "reduce",
      "field": "y0",
      "agg": "sum",
      "as": "total"
    }
  ],
  "traces": [
    {
      "type": "indicator",
      "mode": "gauge+number",
      "value": "$total",
      "gauge": {
        "axis": {
          "range": [
            "$opt.min",
            "$opt.max"
          ]
        },
        "bar": {
          "color": "$opt.color"
        },
        "steps": [
          {
            "range": [
              0,
              40
            ],
            "color": "#fee2e2"
          },
          {
            "range": [
              40,
              70
            ],
            "color": "#fef3c7"
          },
          {
            "range": [
              70,
              100
            ],
            "color": "#dcfce7"
          }
        ]
      }
    }
  ],
  "options": [
    {
      "key": "min",
      "type": "number",
      "default": 0,
      "label": {
        "zh": "最小值",
        "en": "Minimum"
      }
    },
    {
      "key": "max",
      "type": "number",
      "default": 100,
      "label": {
        "zh": "最大值",
        "en": "Maximum"
      }
    },
    {
      "key": "color",
      "type": "text",
      "default": "#2563eb",
      "label": {
        "zh": "仪表颜色",
        "en": "Gauge color"
      }
    }
  ],
  "keywords": [
    "kpi 仪表盘",
    "kpi gauge"
  ]
}
```

### 10.9 流向图（flow-sankey）

- `source` / `target` 通道喂给 `sankey` 的 `source` / `target` 键，`values` 来自 `$total`；
- 多键 `group_agg` 用 `groupBy: ["source", "target"]` 合并重复链接；
- 节点标签按 source 行序 + 未见过的 target 推导，`link.source` / `link.target` 是节点索引。

```json
{
  "schemaVersion": 1,
  "id": "flow-sankey",
  "label": {
    "zh": "流向图",
    "en": "Flow Sankey"
  },
  "description": {
    "zh": "把来源到目标的流量画成桑基图",
    "en": "Draw source-to-target flows as a Sankey"
  },
  "channels": {
    "source": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "target": {
      "required": true,
      "types": [
        "nominal"
      ]
    },
    "yFields": {
      "mode": "one"
    }
  },
  "transforms": [
    {
      "op": "group_agg",
      "groupBy": [
        "source",
        "target"
      ],
      "field": "y0",
      "agg": "sum",
      "as": "total"
    }
  ],
  "traces": [
    {
      "type": "sankey",
      "source": "$source",
      "target": "$target",
      "values": "$total",
      "arrangement": "snap",
      "node": {
        "pad": 16,
        "thickness": 16,
        "color": "#3b82f6",
        "line": {
          "color": "#ffffff",
          "width": 1
        }
      },
      "link": {
        "color": "#cbd5e1",
        "line": {
          "color": "#e2e8f0",
          "width": 0
        }
      }
    }
  ],
  "layout": {
    "margin": {
      "l": 20,
      "r": 20,
      "t": 20,
      "b": 20
    }
  },
  "keywords": [
    "流向图",
    "sankey flow"
  ]
}
```

## 11. 失败与排查

### 清单无效

校验失败的文件不会出现在图表类型列表里，而是在管理对话框的「清单无效」区域显示 `file`、`id` 和 `errors[]`。文件保持原样，不会被自动删除或覆盖。修正后点「重新加载」。

错误信息会收集**所有**问题，而不是遇到第一条就停；保存接口返回的 HTTP 400 `detail` 是 `"; ".join(errors)`，前端显示为 `导入失败：<detail>`。

### 能校验通过但画不出来

渲染阶段的配置问题不会抛 500：`custom_charts.render()` 捕获 `_RenderError` / 其他异常并返回 `{"data": [], "layout": <合并后的 layout>}`。典型原因：

- 必填通道未绑定，或绑定列的类型不在 `types` 里；
- `yFields.mode` 要求的 Y 字段数量不够（`range` 需要 2 个）；
- 引用了用户没绑定的 `$yN`；
- `$size.values` / `$error.values` 等数组样式槽对应的通道没有绑定；
- 声明了 `facet` 通道但没有绑定可用列（无论 `required` 与否），或 `facetBy` 的 `color` 没有绑定；
- `splitBy` 的 `color` 通道没有绑定（即使声明为可选也会让整张图变空）；如果 `color` 已被 `group_agg` 清掉，则属于清单校验错误，不会进入渲染；
- `cumulate` 的 `field` 不是数值列。

结果是空图（layout 仍在），不是「图表渲染出错」横幅。补齐编码即可。`group_agg` + facet 不在此列：它是上面的导入校验错误，不会走到渲染。`indicator` 的 `value` 行数不对、`sankey` 的 `source` / `target` / `values` 长度不一致，会抛 `ValueError` 并以 400 显示可操作错误，也不是空图。

反过来，`{"data": [], "layout": {..., "shapes": [...]}}` **不一定是空图**：只含 `segments` 的清单本来就只产出 layout 线段，`data` 为空是正常的。判断方法是有没有 `layout.shapes` 以及 `segments` 是否被丢弃——整段没有任何 shape，通常是 `segments` 的 `x` / `from` / `to` 槽位没绑定，或每一行都缺了某个坐标。

### 未知 id

项目/图表按 `id` 引用类型。打开一个引用了本机未安装的自定义图表时：

- 项目照常打开，数据、变换链、Dashboard 布局不受影响；
- 预览请求会因 `ChartEncoding` 校验失败返回 **422**，消息包含 `unknown chart type 'ghostchart'`；
- 界面显示「图表渲染出错」横幅（`chart.renderError`）与后端详情，而不是崩溃；
- 导入同名 `id` 的清单后重试即可恢复。

### 常见错误对照

| 报错（节选，均为真实文案） | 原因 | 处理 |
| --- | --- | --- |
| `schemaVersion: must be 1` | 缺少版本或写了其他值 | 固定写 `1`；布尔 `true` 不接受 |
| `id: must match ^[a-z][a-z0-9_-]{1,39}$ (2-40 characters, lowercase letter first)` | id 大小写/长度/字符不合法 | 用小写字母开头，后续只允许小写字母、数字、`_`、`-` |
| `id 'bar': collides with a built-in chart type` | 占用了内置 id | 换一个自定义 id，如 `my_bar` |
| `id 'rightid': does not match the file name 'wrongname.json'` | 文件名与 id 不一致 | 把文件重命名为 `{id}.json` |
| `channels.theta: unknown channel (allowed: x, color, size, facet, z, error, source, target, yFields)` | 通道键拼错或不存在 | 只用允许的 8 个通道 + `yFields` |
| `channels: declare at least one channel or a yFields mode other than "none"` | `channels` 为空，或只有 `yFields.mode: "none"` | 至少声明一个通道或一个非 none 的 Y 模式 |
| `channels.yFields.types: not allowed on yFields` | 把 `types` 写进了 `yFields` | `yFields` 只写 `mode`；类型限制写在普通通道上 |
| `transforms[0].slots[0]: use bare slot names in transforms (for example 'x' or 'y0'), not '$x'` | 算子里写了 `$x` | 算子槽位一律写裸名 `x` / `y0` / `total` |
| `transforms[0].by: unknown slot 'nope' (available: x, y0)` | 引用了未声明/已被清掉的槽位 | 先检查 `channels` 和前面的 `group_agg` |
| `transforms[0].count: must be an integer between 1 and 5000` | `limit.count` 越界或不是整数 | 写 1–5000 的整数 |
| `transforms[0].as: 'x' shadows an existing slot` | 输出别名与现有槽位重名 | 换一个别名，如 `total` / `running` |
| `transforms[0].agg: must be one of sum, mean, count, min, max` | `reduce` / `group_agg` 的聚合名不合法 | 使用 `sum` / `mean` / `count` / `min` / `max` |
| `transforms[0]: 'reduce' requires 'field', 'agg' and 'as'` | `reduce` 缺少字段 | 三个字段都写 |
| `transforms[0].groupBy: accepts a slot or an array of 1-2 slots` | `group_agg.groupBy` 不是槽位或 1–2 项数组 | 写单槽位或 1–2 项数组 |
| `transforms[0].groupBy: duplicate slot 'x'` | `groupBy` 数组里有重复槽位 | 去掉重复项 |
| `transforms[0]: group_agg cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)` | 分面与 `group_agg` 同时使用；聚合会丢掉分面列 | 去掉 `group_agg`，或不要分面；v1 没有“按格聚合” |
| `transforms[0]: reduce cannot be combined with a facet ('facet'/'facetBy' drop the faceted column)` | 分面与 `reduce` 同时使用 | 去掉 `reduce`，或不要分面 |
| `transforms[0]: aggregate 'sum' needs a numeric column` | `reduce` 的 `sum` / `mean` / `min` / `max` 用在了非数值列（`count` 不受限） | 换成数值列，或改用 `count` |
| `traces[0].y: data slot '$y0' is not available after the preceding 'reduce' transform (only its 'as' output, $index and $count remain)` | `reduce` 之后引用了被清掉的原始槽位 | 只引用 `$<as>`、`$index`、`$count` |
| `traces[0].x: data slot '$x' requires an 'x' channel` | `group_agg` 之后原始槽位被清掉；即使 `channels` 里声明了 `x`，这条消息仍会说你没有 `x` 通道（`reduce` 不会这样，它报专门的 `not available after the preceding 'reduce'`） | `group_agg` 后只引用 `groupBy` / `as`（以及 `$count` / `$index`），或把需要的列设为 `groupBy` |
| `traces[0].splitBy: the 'color' slot is not available after the preceding transforms (group_agg drops ungrouped columns)` | `group_agg` 清掉了 `color` 列，`splitBy` 无法拆分 | 让 `group_agg` 以 `color` 为 `groupBy`，或在聚合前完成拆分设计 |
| `manifest: 'facetBy' is only '$color'` | `facetBy` 写了其他值或不是字符串 | 顶层只写 `"facetBy": "$color"`（camelCase；`facet_by` 会报未知顶层键） |
| `manifest: 'facetBy' requires a 'color' channel` | 用了 `facetBy` 但没有声明 `color` 通道 | 在 `channels` 里声明 `color`，或改用 `facet` 通道 |
| `manifest: 'facetBy' and a 'facet' channel are mutually exclusive` | 同时用了 `facetBy` 和 `facet` 通道 | 二选一 |
| `traces[0].splitBy: not allowed when the manifest facets by '$color'` | `facetBy: "$color"` 与 `splitBy` 同时出现 | 去掉 `splitBy`，或用普通 `facet` 通道代替 `facetBy` |
| `traces[0].type: unsupported trace type 'mesh3d' (allowed: scatter, bar, box, violin, waterfall, funnel, indicator, histogram, sankey)` | trace 类型不在白名单 | 只用 9 种允许类型 |
| `traces[0].bogus: unsupported key; allowed style keys: ...; allowed data keys: x, y, z, labels, values; 'source'/'target' (sankey); 'value' (indicator); 'segments'; 'splitBy'` | trace 顶层键拼错 | 对照第 7 节字段与样式白名单 |
| `traces[0].line.bogus: unsupported style key for line` | 嵌套样式键不在 `line` 白名单 | 只用 `color` / `width` / `dash` / `shape` / `smoothing` / `simplify` |
| `traces[0]: 'segments' and 'x' are mutually exclusive` | `segments` 和 `x` / `y` 同时写了 | 二选一；线段只写 `segments` |
| `traces[0].segments: only allowed on type 'scatter'` | 把 `segments` 写在 bar/box 等 trace 上 | 改成 `scatter` |
| `traces[0].x[0]: slots inside literal arrays are not supported; use a single slot string` | 用了 `["$x", "$x"]` 这种槽位数组 | 改用 `segments`，或单槽位字符串 |
| `traces[0].splitBy: only '$color' is supported` | `splitBy` 写了别的槽位 | 只能写 `"$color"` |
| `traces[0].splitBy: requires a 'color' channel` | 清单没有声明 `color` 通道 | 在 `channels` 里声明 `color` |
| `traces[0].splitBy: not supported on trace type 'waterfall'` | 在不支持拆分的 trace 类型上用了 `splitBy` | 只用 scatter / bar / box / violin / histogram / funnel |
| `traces[0]: a split trace cannot also plot the 'color' slot` | 拆分 trace 又引用了 `$color` 或 `$color.values` | 拆分后删掉颜色数据槽；颜色只由 `splitBy` 控制 |
| `traces[0].line.color: '$x.values' is only allowed at marker.color, marker.size, marker.opacity, error_x.array, error_x.arrayminus, error_y.array, error_y.arrayminus` | 在非数组样式路径用了 `$slot.values` | 只用第 5 节列出的 7 个路径 |
| `traces[0].error_y.bogus: unsupported style key for error_y` | `error_y` / `error_x` 里有未知键 | 只用 `type` / `array` / `arrayminus` / `visible` / `color` / `thickness` / `width` |
| `traces[0].error_y: must be an object` | `error_y` / `error_x` 不是对象 | 写嵌套对象，不要写成字符串或数组 |
| `traces[0].title: only allowed on the 'indicator' trace type` | 把 indicator 专用样式键放到其他 trace 类型 | 只写在 `indicator` trace 上 |
| `traces[0].number: only allowed on the 'indicator' trace type` | 把 indicator 专用样式键放到其他 trace 类型 | 只写在 `indicator` trace 上 |
| `traces[0].gauge: only allowed on the 'indicator' trace type` | 把 indicator 专用样式键放到其他 trace 类型 | 只写在 `indicator` trace 上 |
| `traces[0].delta: only allowed on the 'indicator' trace type` | 把 indicator 专用样式键放到其他 trace 类型 | 只写在 `indicator` trace 上 |
| `traces[0].value: only allowed on the 'indicator' trace type` | 把指标数据键 `value` 放到其他 trace 类型 | 只写在 `indicator` trace 上 |
| `traces[0].values: not allowed on the 'indicator' trace type` | indicator 上写了 `values` | indicator 只用 `value` |
| `traces[0].labels: not allowed on the 'indicator' trace type` | indicator 上写了 `labels` | indicator 只用 `value` |
| `traces[0].z: not allowed on the 'indicator' trace type` | indicator 上写了 `z` | indicator 只用 `value` |
| `traces[0].value: no rows after transforms` | 0 行数据进入 indicator | 先修正筛选/变换，或提供一行数据 |
| `traces[0].number.valueformat: must be a scalar` | indicator 标量叶子写了列表 | 标量叶子只写标量或 `$opt`；列表只用于 range/tickvals/ticktext 等 |
| `traces[0].node: only allowed on the 'sankey' trace type` | 把 sankey 的 `node` 放到其他 trace | 只写在 `sankey` trace 上 |
| `traces[0].link: only allowed on the 'sankey' trace type` | 把 sankey 的 `link` 放到其他 trace | 只写在 `sankey` trace 上 |
| `traces[0].arrangement: only allowed on the 'sankey' trace type` | 把 sankey 的 `arrangement` 放到其他 trace | 只写在 `sankey` trace 上 |
| `traces[0].value: needs exactly one row after transforms (got 5); add a 'reduce' transform` | indicator 的 `value` 不是恰好一行 | 先用 `reduce` 折叠成一行 |
| `traces[0].gauge.steps: at most 10 steps are allowed` | gauge steps 超过 10 项 | 最多写 10 项 |
| `traces[0].gauge.axis.range: must contain exactly two values` | gauge range 不是两个值 | 写 `[lo, hi]` |
| `traces[0]: sankey needs source, target and values of equal length` | sankey 三个数据键缺失或长度不等 | 补齐并保证等长 |
| `traces[0].values: sankey link values must be numeric` | sankey 的 `values` 全列都无法转成数值 | 提供数值列；非数值项会先变成 `null` |
| `traces[0].source: only allowed on the 'sankey' trace type` | 把 sankey 的 `source` 键放到其他 trace（`target` 同理） | 只写在 `sankey` trace 上 |
| `traces[0].target: only allowed on the 'sankey' trace type` | 把 sankey 的 `target` 键放到其他 trace | 只写在 `sankey` trace 上 |
| `traces[0].y: data slot '$y2' is not supplied by yFields.mode 'range' (only y0 and y1)` | 引用了当前 mode 不提供的 Y 槽位 | 改 mode 为 `multi`，或把槽位降到 `$y0` / `$y1` |
| `layout.template: is not an allowed layout key (allowed: showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title)` | layout 顶层键不在白名单 | 只用 9 个顶层键；想调轴样式写进 `xaxis` / `yaxis` |
| `layout.grid: is not an allowed layout key (allowed: showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title)` | 试图在清单里声明/覆盖 `grid` | 删除 `grid`；分面网格由渲染器根据 `facet` / `facetBy` 写入 |
| `layout.shapes: is not an allowed layout key (allowed: showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title)` | 试图在清单里声明 `shapes` | 删除 `shapes`；线段由 `segments` trace 生成，渲染器在 layout 合并后追加 |
| `options[0].choices: select options need 1-20 choices` | `select` 缺少 `choices` 或数量不对 | 给 1–20 个不重复字符串 |
| `options[1].default: must be a finite number` | `number` 选项默认值不是有限数字 | 改成数字；布尔不算数字 |
| `options[0].default: is required` | 漏写 `default` | 每个选项都必须有类型匹配的默认值 |
| `keywords[0]: 'bar chart' is already used by built-in chart type 'bar'` | 关键词与内置/其他自定义图表冲突 | 换一个更独特的词 |
| `file is larger than 256 KB` | 单个清单超过 256 KB | 清单只放模板，不要把数据嵌进去 |
| `invalid JSON: Expecting ... at line 1 column 2` | 文件不是严格 JSON | 去掉注释、尾逗号、单引号；使用 UTF-8 |

## 12. AI 助手与项目分享

自定义图表对图表 AI 是「额外类型」，不是内置 registry 条目：

- `chartType` 接受有效的自定义 `id`；未知 id 会在 `ChartEncoding` 校验时报 `unknown chart type ...`（预览 HTTP 422）。
- 存在有效清单时，prompt 会多出一行：

  ```text
  Custom chart types: dumbbell (x, yFields×2), lollipop (x, yFields×1)
  ```

  行里只列必填通道和 `yFields` 数量；最多列 10 个，再多的以 `…` 结尾。没有有效清单时这一行完全不出现，prompt 与之前逐字节一致。
- 自定义 `keywords` 会转小写后与内置关键词合并参与「点名」检测；同一位置命中多个时取更长的短语，最早出现的优先。
- 自定义类型**不可被确定性改型**：AI 的 `enforce_requested_type` / 降级推荐改型只在内置关系图族（含 histogram）里工作，不会把内置推荐改写成自定义 `id`。它只能由模型直接输出，或当前编码已经是该 `id`。
- agent 会从清单派生 Y 字段最低要求（`one`/`multi` → 1，`range` → 2），并要求 Y 列是数值列；但必填通道的绑定最终由预览渲染器的空图行为兜底。

项目分享：

- 项目文件保存图表的 `id` 与编码，不内嵌清单定义。
- 分享项目时，用「导出」把清单 JSON 一并分发，或在目标机器上先导入；目标机器缺少对应 `id` 时，图表会显示第 11 节的错误横幅。
- 修改 `id` 等同于删除旧类型再新建：旧项目里的引用会失效。改名之前先导出备份。

## 13. 版本与兼容

- 当前校验器只接受 `schemaVersion: 1`；缺失或写其他值都会报 `schemaVersion: must be 1`。没有迁移逻辑。
- 清单必须是严格 JSON 对象（不能是数组）；后端读取时会去掉 UTF-8 BOM。
- 保存/导出得到的是后端规范化后的 JSON（camelCase、`ensure_ascii=False`、2 空格缩进），因此导出文件与手工写的排版可能不同，但内容语义一致，可直接再次导入。
- 清单是纯数据，可以跨机器复制；id、文件名、关键词冲突规则在所有机器上一致。
- 文件上限、id 正则、通道/算子/trace/样式/layout 白名单都以内置常量为准（`backend/core/custom_charts.py` 的 `MAX_*`、`MAX_FACET_CELLS`、`CHANNEL_KEYS`、`TRANSFORM_KEYS`、`TRACE_TYPES`、`STYLE_KEYS`、`LAYOUT_KEYS`、`TOP_LEVEL_KEYS`、`SPLIT_TRACE_TYPES`、`INDICATOR_STYLE_KEYS`、`INDICATOR_DATA_KEYS`、`SANKEY_DATA_KEYS`、`_ARRAY_SLOT_PATHS`、`_NESTED_STYLE_KEYS`、`_FACET_AXIS_STRIP_KEYS`）。
