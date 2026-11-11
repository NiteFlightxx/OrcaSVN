# 日志右键菜单

交互依据是本地 SourceGit 源码 `E:\UnrealProjects\sourcegit\src\Views\Histories.axaml.cs` 中的 `OnCommitListContextRequested`、`CreateContextMenuForSingleCommit`、`CreateContextMenuForMultipleCommits`，以及 `ViewModels/CherryPick.cs`、`Revert.cs` 和 `CheckoutDetached.cs`。

沿用单选与多选菜单分开构建、写操作先打开确认窗口、比较和复制单独分组的方式。右键点击已选版本保留多选集合；点击集合以外的版本改为单选。复用 `FileContextMenu` 的定位、子菜单、键盘导航、Esc 和焦点恢复。

## SVN 语义

- 从所选版本创建分支／标签：输入完整目标 URL 和提交说明，确认后进行仓库端目录复制，立即生成仓库版本，不切换当前工作副本。使用配置的 SVN 安装配套 `svnmucc cp`，目标已存在时原子失败，不会意外把源目录嵌套到目标中。通过 peg revision 沿复制历史定位所选版本的源路径。
- 更新到指定版本：运行带预期工作副本 URL 检查的 `svn update -r N`，沿用普通更新的后台核对流程，保留本地修改和冲突处理。
- 检出到其他目录：只允许现有工作副本和 Git 仓库之外的空目录／新目录，跳过 externals。当前工作副本保持打开。
- 挑选提交：从其他分支选择明确的版本集合。后端核对仓库 UUID、工作副本状态和 mergeinfo，预览后再应用。
- 反向合并：选择当前分支已包含的版本，预览后按从新到旧的顺序应用负 `-c` 集合。例如选择 r4、r6，分别使用 `-c 4,6` 或 `-c -6,-4`，不包含未选择的 r5。结果保留为本地变更，检查后自行提交。
- 修改提交说明：修改服务器 `svn:log` 版本属性，核对原说明并处理客户端行尾差异，仍受服务器权限和 revision-property hook 控制。程序不会安装或修改服务器钩子。
- 导出补丁：按版本分别生成 `rN.patch`，不覆盖已有文件。全部生成并检查后才写出；包含二进制内容或超限时拒绝整组导出，避免悄悄漏掉 UE 资源。
- 比较：单版本变更、两版本差异、与本地 BASE 或工作副本比较；保持比较方向，工作副本比较从所选版本开始。
- 复制：版本号、标题、完整说明、作者、时间、带版本的 URL、完整提交信息。

SVN 没有 Git 式 Interactive Rebase、Squash、Fixup 或删除已发布历史提交，不提供这些操作。多选菜单隐藏单版本表单，仅保留适用的合并、补丁、比较和复制操作。不可用的写操作保留原因提示。

`Ctrl+C` 复制版本号和标题，`Ctrl+Shift+C` 复制完整信息；`Ctrl+Shift+B/T` 打开分支／标签表单，`Shift+F10` 打开菜单。删除键在日志菜单中不绑定丢弃操作。

## 验证边界

运行测试的 `TEMP`、`TMP`、`TMPDIR` 必须指向 `E:\Temp\OrcaSVN-Tests`。集成测试仅创建本地 `file://` 合成仓库，覆盖精确版本集合、预览失效、二进制保护、目标冲突、跨仓库限制、复制祖先、日志钩子及检出目录保护。浏览器界面核对使用完全模拟的 Tauri 接口，不打开原生 OrcaSVN，也不访问用户项目或 SVN 服务器。
