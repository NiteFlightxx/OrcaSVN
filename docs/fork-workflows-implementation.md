# 分支、提交挑选与资产贮藏：首版实现

日期：2026-11-09。分支：`codex/fork-svn-workflows`，基于 `c11ffaf`。未提交、未推送。

## 使用方式

### 浏览和切换分支

- 打开 SVN 工作副本。左侧显示真实工作副本的当前分支，顶部提供定位分支列表的按钮。
- 默认列出当前 URL 上一级的目录；通过“分支位置”配置仓库布局。配置和收藏按仓库 UUID 保存。
- 若上级目录被 SVN 拒绝访问，不推断具体分支也无权限；当前分支和本地贮藏继续可用。通过“添加分支 URL…”直接填写有权限的完整分支地址，只查询该目录的 info 并验证仓库 UUID，不要求列举其父目录。已知分支按 UUID 保存；后台刷新不会反复请求已拒绝的列表目录，分支区的刷新按钮可显式重试。原始错误保留在可展开的详情中。
- 单击分支只浏览它的历史，不执行 Switch。当前工作副本和正在浏览的来源 URL 分别显示。
- 双击、右键或“切换工作副本…”进入预检查。确认时固定到预览中的目标 revision，操作整个真实工作副本根。
- Switch 默认保留本地修改并交给 SVN 合并，不再要求干净工作副本；确认后变更仍需重新检查。冲突保留待处理，不自动选版本。预检查不是 Switch dry-run，Externals 不更新。挑选提交仍沿用干净工作副本要求，最新行为见 [分支切换说明](branch-switching.md)。
- 从子目录打开的工作区，完成整副本操作后转到工作副本根，便于审阅完整变化。
- 左右拖动导航分隔线调整宽度，宽度保存在本机；分隔线支持方向键。

工作区现已支持目录树及 Staged / Unstaged 分区，具体行为见 [目录树与提交选择](workspace-tree-staging.md)。Staged 使用本地提交选择语义，不保存 Git index 内容快照。

### 从 dev 挑选一次提交到 publish

1. 让当前工作副本处于 publish，更新到统一 revision 和完整 depth。
2. 单击 dev 浏览历史，选中提交查看内嵌详情和文件 Diff。
3. 使用右键或详情中的“挑选提交…”。后端重新验证 UUID、来源、工作副本状态和 mergeinfo eligible，并运行 `svn merge --dry-run -c R`。
4. 确认后应用整个来源子树的该次提交，不自动向 SVN 服务器提交。
5. 无冲突时进入提交页，预填来源和 revision，包含目录 mergeinfo 的修改。最终由用户审阅和提交。

已经合并、部分子树合并无法可靠判断、混合版本、稀疏工作副本、存在本地受控修改等情形会拒绝快捷操作。不会自动添加 `--allow-mixed-revisions` 或忽略 ancestry。

活动区保留执行结果及持久化日志。仅当身份和应用后状态完全一致时允许“撤销本次应用”；撤销前保存当前文件和冲突材料，再按本次拥有的路径 Revert。外部编辑介入后拒绝自动撤销。

### 冲突处理

- 冲突页分别识别内容、属性和树冲突。
- 内容冲突展示可用的 BASE、本地、传入及当前工作文件；文本预览上限 512 KiB，二进制显示路径和大小。
- 可以使用本地版本、传入版本，或先在外部编辑文件后保留当前处理结果。
- 属性冲突展示 SVN 的属性拒绝文件；属性和树冲突先手工整理，再标记工作结果已解决，不自动猜测处理方式。
- Resolve 前保存完整冲突文件、双方版本、属性 XML 和恢复清单。二进制双方文件也完整保存。
- 重新查询实际冲突状态，命令成功退出不会被当作“没有冲突”。

### 文件与 UE 资产 Stash

- 进入贮藏页的“文件与资产贮藏”，或从工作区文件菜单选择“贮藏此文件…”。
- 选择文件/完整目录，检查选择，再保存并移除选定修改。
- 支持普通受控修改、无复制历史的 Added/Deleted、必要的目录调度、空目录及未版本控制文件/目录。保存原始字节和属性，不解析 `.uasset` / `.umap`。
- 若工作区从子目录打开，选择正确映射到根目录相对路径，不会操作根目录下的同名文件。
- Apply 保留记录；Pop 只在全部恢复与校验完成后隐藏记录。任何部分失败均保留数据和恢复材料。
- 目标内容或属性与保存基线不同时，先明确确认覆盖；当前内容仍会备份。覆盖决定绑定当前内容及属性指纹，变化后需重新检查。
- 来源 UUID 和分支 URL 必须匹配。当前不提供跨分支 Stash 迁移或自动三方内容合并。
- 导出的是完整文件夹，包含清单和 payload；导入时选择该文件夹，不是 ZIP。
- “移除记录”只隐藏活动记录，保留磁盘恢复材料，不回收空间。
- 原有文本分块功能继续保留。可将旧记录备份到磁盘，验证原始 JSON 保存成功后才移除浏览器中的旧记录。旧记录没有分支/BASE 信息，恢复时明确提示、限制原工作副本路径并要求干净目标。

复制/移动历史、Replaced、冲突、switched 子树、externals、嵌套仓库、符号链接/目录联接、pending mergeinfo 等状态不纳入普通资产贮藏；不能可靠恢复的选择会拒绝。

## 数据和恢复

Windows 默认数据目录为 `%LOCALAPPDATA%\com.orcasvn.desktop`，由 Tauri `app_local_data_dir()` 决定。

- `stashes/v2/<id>/manifest.json`：逐路径原始状态、基础 revision、BASE/WIP 引用和哈希、属性、阶段、错误。
- `stashes/v2/<id>/payload/`：以流方式保存和复核的原始文件。没有旧浏览器方案的 2 MiB 二进制限制。
- `stashes/v2/<id>/recovery/`：恢复前目标文件和对应清单。
- `operations/<id>.json`：预览身份、执行结果、应用后状态、撤销阶段。
- `recovery/<id>/`：Resolve/撤销前的材料。
- `recovery/discard-<id>/`：文件/目录批量丢弃前的全部工作文件与属性清单，以及完成路径和错误。文件按清单节点索引保存，没有一键恢复入口。

先保存并校验，再清理工作文件；先备份恢复目标，再替换文件。清单使用临时文件写入、同步并重命名。路径会拒绝越界、管理目录和重解析点，写操作按真实工作副本根互斥。应用门闩不控制外部 SVN 客户端或 UE，因此仍需执行前重验；修改期间应避免其他程序同时改动所选文件。

如果程序中断，活动日志的 running/undoing 阶段或 Stash 的 capturing/removing/restoring/partial 阶段保留原样，便于检查。不要直接删除恢复目录，也不要用旧 `.svn/wc.db` 覆盖现有工作副本。当前没有自动断点续传或保证取消即回滚的功能。

## 源码职责

- `src-tauri/src/workflows.rs`：身份、目录浏览、预览与执行、写入协调、操作日志、冲突与撤销。
- `src-tauri/src/asset_stash.rs`：磁盘清单、文件快照、属性/调度恢复、碰撞检查、旧数据迁移及导入导出。
- `src-tauri/src/discard.rs`：按面板选择范围预览丢弃、确认计划、字节与属性复查、备份、精确还原/删除和部分失败记录。
- `src-tauri/src/workflow_tests.rs`：临时真实 SVN 仓库集成测试。
- `src/api/workflows.ts`、`src/stores/workflows.ts`：命令契约、当前身份、浏览来源、进度及活动状态。
- `BranchSidebar`、`OperationDialog`、`ActivityPanel`、`AssetStashPanel` 和 `ConflictsView`：对应工作流界面。
- 复用原有历史、工作区、提交、文本分块及 DiffViewer；新增代次与缓存失效，防止切分支后旧响应覆盖当前页面。

## 验证与边界

使用 Node/npm、隔离安装的 Rust 1.99.1 和 SVN/svnadmin 1.14.5。测试只操作临时仓库，未操作用户的 ExampleWorkspace 工作副本或资产。

- 前端类型检查和 Vite 构建通过，84 项 Node 测试通过；包含旧来源历史响应、旧 Stash 检查响应，以及父目录无权限时保留当前身份和贮藏、直接添加分支、显式重试与迟到响应隔离的测试。直接添加分支命令也在本地真实 SVN 仓库验证；未验证用户服务器的具体分支权限。
- 新增 19 项真实 SVN 集成测试通过，覆盖 Switch、远端历史、单次 merge、重复/过期计划拒绝、写操作互斥、四类冲突、恢复材料、撤销所有权及资产字节/属性/调度恢复。
- 还覆盖大于旧 2 MiB 限制的二进制、中文与 `@`、新增/删除/未版本控制子目录、空目录、子目录同名文件、文件占用、快照损坏、external 边界、旧数据迁移及恢复。
- 最后一次完整 Rust 测试为 87 通过、3 失败、2 忽略。失败项是既有状态缓存测试：`directory_fallback_skips_inventory_and_detects_timestamp_preserving_edits`、`disk_snapshot_reopens_and_checks_offline_changes`、`polling_reuses_unchanged_status_and_forces_metadata_and_periodic_checks`。未修改基线 `c11ffaf` 在同一工具链也复现三项失败；polling 在本次部分运行中会通过。本次不修改缓存实现或放宽断言。
- Clippy 在排除既有 `chunks_exact_to_as_chunks`、`needless_return` 两类 lint 后通过；不能据此称严格默认 Clippy 全绿。
- Tauri Debug 可执行程序包含构建后的前端，不需要单独启动 Vite。不是正式发布安装包。
- 桌面验证只观察到当前工作副本及分支列表，后续操作被用户按 Esc 中断。没有完成最终界面连续操作、真实 UE 工程、性能或发布安装包验收。

尚未补齐的体验包括：全部设计快捷键、历史逐条 merged/eligible 标签、详情区尺寸持久化、外部三方合并工具配置、内置属性编辑器、跨重启自动恢复流程，以及原有新建文本分块记录的统一磁盘化。原有文本分块仍使用其既有存储；磁盘备份迁移为显式操作。当前不宣称与 Fork 功能完全对齐。

## 本地运行与检查

正常开发环境：`npm ci`，随后 `npm run tauri dev`。构建无需安装器的调试程序：`npm run tauri -- build --debug --no-bundle`。

检查：`npm run check`；仅新增流程：`cargo test --manifest-path src-tauri/Cargo.toml workflow_tests`。完整检查的已知失败见上文，不将失败用例排除后宣称全部通过。

本次使用的 Rust 在 `E:\Temp\codex-orcasvn-toolchain`，未修改系统 PATH。如使用该工具链，需在当前终端设置 `CARGO_HOME` 为其 `cargo` 子目录，`RUSTUP_HOME` 为其 `rustup` 子目录，并把 `cargo\bin` 与 SVN 程序目录加入本终端 PATH。
