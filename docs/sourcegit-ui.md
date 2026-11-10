# SourceGit 源码对应与 OrcaSVN 工作流

分支列表与切换弹窗的最新交互、SourceGit 源码依据及验证范围见 [分支切换说明](branch-switching.md)。

本次依据本地 `E:\UnrealProjects\sourcegit` 的源码实现，参考版本为 `2026.24`。截图不作为行为契约。OrcaSVN 继续使用 Vue/Tauri 和已有 SVN 后端，没有引入 Avalonia 或 Git 命令执行逻辑。

## 对应源码

- `Views/LauncherTabBar.axaml`、`LauncherTabBar.axaml.cs`：仓库标签、切换及关闭。OrcaSVN 区分打开的标签与最近仓库；关闭标签不删除工作文件、暂存选择或提交草稿。关闭当前标签选择相邻标签，加载失败保留原标签。
- `Views/Repository.axaml`：49 像素页面切换栏、独立仓库侧栏和内容区。主界面采用仓库标签、紧凑工具栏、页面切换栏、可收起分支侧栏和底部状态栏。Ctrl+1/2/3 对应历史、工作副本和贮藏，Ctrl+Tab 切换打开的仓库。
- `Views/WorkingCopy.axaml`：左侧筛选及上下 Unstaged/Staged；右侧差异和提交编辑器；面板间分隔条。OrcaSVN 保存文件列表宽度、上下列表比例、提交编辑器高度及视图模式。分隔条支持鼠标拖动、方向键和 Home/End。
- `Views/ChangeCollectionView.axaml`、`ChangeCollectionView.axaml.cs`：树形、文件名及目录、完整路径三种视图；单击选择；目录双击只展开；文件双击触发暂存动作；方向键导航。切换视图时按实际文件路径保留选择。
- `ViewModels/ChangeSelection.cs`：目录选择收集所有后代，重叠选择去重；单文件和单目录选择保留各自含义。OrcaSVN 右键保留已选中的集合，右击未选中项则切换为该项；目录或多选不会保留之前文件的差异。
- `Views/WorkingCopy.axaml.cs`：双击及 Space/Enter 暂存或取消暂存；Delete/Backspace 进入丢弃确认；Ctrl+C、Ctrl+Shift+C 复制路径；操作后选中后续未处理项。OrcaSVN 还保留 Ctrl+Alt+C 别名；复制快捷键只在文件列表或对应菜单消费，不启用开发者工具。
- `ViewModels/WorkingCopy.cs` 的 `SelectedUnstaged`、`SelectedStaged`：两组高亮选择互斥。此高亮选择与 SVN 提交选择分开保存。
- `Resources/Themes.axaml`：采用源码中的浅色和深色 Window/Contents/SubPanel/ToolBar/Border/Foreground 层次，调整为 26 像素文件行、28 像素组标题和紧凑控件。

## SVN 行为契约

Staged 仍表示本次 SVN 提交的文件选择；内容由提交时读取。目录批量操作只使用当前列表的真实变更路径；筛选隐藏项和另一面板的修改继续受保护。提交标题和详细描述共用现有草稿，工作区按钮进入审阅页，保持现有 Add、确认和提交步骤。

分支单击浏览该分支历史；双击进入 Switch 预检；右击先显示“历史、切换、浏览目录、收藏”菜单，不直接发起切换。历史继续展示真实 SVN revision、作者、时间和说明，保留单次提交挑选及冲突处理。

本次没有改变 SVN 写操作、丢弃备份、资产贮藏、冲突恢复或事务边界。此前的 busy 释放与目标范围预检修复一起纳入新程序。

## 验证边界

所有测试只使用合成数据及 `E:\Temp\OrcaSVN-Tests` 下的独立 SVN 仓库和独立 WebView profile。禁止测试或启动到 ExampleWorkspace。自动化检查分别验证 UI 选择、键盘、批量菜单、标签切换、拖动边界、草稿/暂存隔离及后端恢复行为；桌面交互结果另行记录，构建通过不等同于完成鼠标验收。

2026-11-10 验证：前端类型检查、Vite 构建及 136 项 Node 测试通过；Tauri Debug 原生程序编译成功，输出仍为 BAT 指向的 `src-tauri/target/debug/OrcaSVN.exe`。完整 Rust 检查为 101 通过、3 失败、2 忽略，失败为既有 `status_cache` 的 polling、directory fallback、disk snapshot 用例；没有为本次 UI 改动调整这些实现或断言。

原生程序显式传入 `E:\Temp\OrcaSVN-Tests\ui-sourcegit-<id>\working-copy`，并通过 `WEBVIEW2_USER_DATA_FOLDER` 使用独立配置。可访问性树和窗口观察确认了标签、工具栏、页面栏、分支组和新历史布局。点击先报 `coordinate input geometry is unavailable`，随后两次快捷键输入被 `user input was detected in this window` 拦截，因此未完成真实鼠标暂存/取消暂存、拖动或提交确认验收；不能将 Node 事件测试视为完整桌面验收。

测试夹具修正：桌面演示仓库最初用两次目录创建建立 dev/publish，导致 publish 与 dev 无共同祖先，普通 Switch 正确返回 E195012。已仅在该临时仓库的 r3 将原空 publish 替换为从 dev@r2 的历史复制，并在另外创建的 `switch-check-<id>` 工作副本验证普通 `svn switch` 成功，未添加忽略祖先的选项。当前打开的测试工作副本仍保留在 dev，未改动其文件。后续演示分支必须使用 `svn copy`，不能以独立 mkdir 代替。现有 Rust 集成测试的 Fixture 原本就采用历史复制，此问题属于本次桌面演示夹具。
