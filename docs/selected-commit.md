# 所选路径提交

工作区提交审阅窗口及保留的独立提交视图共用 `svn_commit`。传入显式文件列表时，后端通过 `svn::commit_selection` 完成一次操作；省略列表的整仓库接口保持原有语义。

## 操作顺序

1. 获取工作副本写操作门禁，在门禁内确认当前 URL 并查询所选路径的最新状态。普通文件使用 `svn status --depth empty`，不建立全仓库文件系统清单。
2. 新文件先添加并返回 `addedPaths`，让用户再次审阅后显式提交。已有目录的属性被选中，不代表其未选子文件也被选中。
3. 执行 `svn commit --depth empty`。删除、替换或缺失目录需要展开受影响子树并验证完整选择；复制或移动目录继续由原有保护拒绝部分提交。
4. 查询所选路径、必要父目录，以及结构变化涉及的子树，返回 `StatusPatch`。提交后发生的新编辑以查询到的状态为准。

文件 external、嵌套工作副本、符号链接、越界路径、切换过的子路径及冲突不能通过该提交入口写入。

## 结果与刷新

`CommitOutcome.success/error` 表示 SVN 命令结果，`warning` 表示局部刷新失败；刷新失败不把已经成功的提交改判为失败。结果另带检查、命令和刷新耗时。

前端合并状态补丁时保留未查询路径及被显示过滤器隐藏的修改，拒绝旧工作区和旧请求的结果。局部刷新失败会标记状态待核实，并异步启动完整检查；成功提示不等待这次恢复扫描。

成功提交使对应来源的历史缓存失效，并推进独立的 `historyEpoch`，不触发分支目录和贮藏列表的重复查询。普通状态刷新使用原有 `epoch`；操作末尾仅在该计数未改变时补发一次元数据刷新。

## 隔离验证

运行测试前将 `TEMP`、`TMP`、`TMPDIR` 指向 `E:\Temp\OrcaSVN-Tests`，并提供 `svn`、`svnadmin`。不得将用户的项目工作副本用作测试夹具。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml scoped_submission -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml benchmark_scoped_submission -- --ignored --nocapture
npm run check
```

显式性能测试创建本地 `file://` 仓库，比较直接 CLI、模拟旧的完整前台链路和新的局部链路，每个规模各运行三轮并报告中位数。该测试不连接真实 SVN 服务器，不衡量网络、服务端钩子或用户仓库的实际耗时。
