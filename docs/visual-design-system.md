# OrcaSVN 视觉规范

本规范适用于桌面工作区、对话框、空状态和设置页。`src/design-tokens.css` 是颜色、文字、形状、间距与尺寸的唯一取值来源；`src/style.css` 负责将变量映射到 Element Plus 和通用控件，页面样式只负责布局。

## 颜色

颜色按用途命名。浅色和深色使用同一个变量名，由 `html.theme-dark` 切换取值；页面不按主题分别写固定颜色。

| 用途 | 变量 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 主操作 | `--md-sys-color-primary` | `#1261a0` | `#8bc7fa` |
| 主操作上的文字 | `--md-sys-color-on-primary` | `#ffffff` | `#082840` |
| 选中背景 | `--md-sys-color-primary-container` | `#e4f0ff` | `#163c61` |
| 选中背景上的文字 | `--md-sys-color-on-primary-container` | `#17486f` | `#d9edff` |
| 应用画布 | `--md-sys-color-surface` | `#f5f7fb` | `#101820` |
| 内容表面 | `--md-sys-color-surface-container-lowest` | `#ffffff` | `#16212b` |
| 次级表面 | `--md-sys-color-surface-container-low` | `#f8fafc` | `#131d26` |
| 主要文字 | `--md-sys-color-on-surface` | `#1c2938` | `#e7eef6` |
| 次要文字 | `--md-sys-color-on-surface-variant` | `#536274` | `#aab9c8` |
| 分隔线 | `--md-sys-color-outline-variant` | `#dbe3ea` | `#344454` |

文件状态使用成对的背景和文字变量，不依赖透明度区分状态。

| 状态 | 浅色背景 / 文字 | 深色背景 / 文字 |
| --- | --- | --- |
| 修改、替换 | `#fff3c4` / `#805000` | `#4a330a` / `#ffd278` |
| 新增 | `#dcfce7` / `#166534` | `#123d2a` / `#7fe3a2` |
| 冲突、缺失、删除 | `#ffe4e6` / `#ad1f32` | `#4d2028` / `#ff9da7` |
| 未版本文件 | `#e8ebff` / `#414aa4` | `#2b2e59` / `#b7bcff` |

主要文字、次要文字、主按钮以及上述状态文字与各自背景的对比度均至少为 4.5:1。不要仅靠颜色表达状态：徽标同时保留文字。

## 文字与图标

正文字体为 `Inter`、系统 UI 字体和中文系统字体；文件路径使用 `--app-font-family-mono`。默认字号为 14px，窄窗口保持相同字号。

| 层级 | 变量 | 大小 | 常见用途 |
| --- | --- | --- | --- |
| 微型标注 | `--app-font-size-2xs` | 10px | 状态徽标、分组标题 |
| 辅助信息 | `--app-font-size-xs` | 11px | 版本号、路径摘要 |
| 说明 | `--app-font-size-sm` | 12px | 辅助文案、筛选项 |
| 控件标签 | `--app-font-size-label` | 13px | 导航、按钮、文件路径 |
| 正文 | `--app-font-size-body` | 14px | 表单和内容 |
| 小标题 | `--app-font-size-subtitle` | 16px | 设置分区 |
| 页面标题 | `--app-font-size-title` | 18px | 工作区和页面标题 |
| 欢迎标题 | `--app-font-size-display` | 30px | 仅用于空状态主标题 |

常规、强调和标题分别使用 400、600、700 字重；正文行高 1.5，长说明行高 1.6。图标采用同一套 Material Symbols：常用尺寸 16、20、24px，常态轮廓、选中态填充。图标按钮必须有可访问名称。

## 间距、形状与尺寸

间距遵循 4px 网格：`--app-spacing-xs/sm/默认/md/lg/xl/2xl` 分别为 4、8、12、16、24、32、48px。手机宽度不缩小文字，仅把较大间距收紧到 16 和 24px。

| 用途 | 变量 | 尺寸 |
| --- | --- | --- |
| 状态徽标 | `--app-radius-xs` | 4px |
| 按钮、输入框、导航项 | `--app-radius-sm` | 8px |
| 普通容器 | `--app-radius-md` | 12px |
| 工作台 | `--app-radius-sm` | 8px |
| 欢迎卡片、对话框 | `--app-radius-xl` | 24px |
| 控件 / 输入框 | `--app-size-control` / `--app-size-field` | 38 / 40px |
| 表格行 / 文件行 | `--app-size-table-row` / `--app-size-list-row` | 44 / 48px |
| 面板 / 页面标题栏 | `--app-size-panel-header` / `--app-size-page-header` | 52 / 62px |
| 工具栏 / 状态栏 / 侧边栏 | `--app-size-toolbar` / `--app-size-statusbar` / `--app-size-sidebar` | 64 / 28 / 224px |

交互控件的默认圆角为 8px；仅计数徽标等胶囊元素使用 `--app-radius-full`。工作台使用 6px 紧凑外边距，只保留一层外边框，内部面板以细分隔线区分，避免重复套卡片。

## 状态与响应式

- 主要操作用主色填充；次要操作用内容表面和细边框。悬停通过表面色变化提示，禁用态仍保留可读标签。
- 选中项使用主色容器及其配对文字；键盘焦点显示 2px 主色轮廓，不用阴影替代焦点。
- 视口不大于 900px 时，侧边导航改为横向滚动；不大于 650px 时，工具栏与工作区切换器分两行；不大于 640px 时，较大间距收紧。业务内容允许纵向滚动，导航和状态栏保持可见。
- 新页面优先复用本文件列出的变量。新增颜色、字号、圆角或控件尺寸时，先在 `src/design-tokens.css` 中定义语义变量，同时给出深色值，再用于页面样式。

验收至少检查浅色和深色主题下的 1280px 与 390px 宽度，并运行 `npm run build` 和 `npm run test:unit`。
