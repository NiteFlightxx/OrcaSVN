# 更新命令与后台核对

工具栏和保留的更新页面共用 `useSvnUpdate`，更新不会导航到其他页面。

前台链路是工作副本身份确认、写操作门禁和原生 `svn update`。命令结束后立即记录结果并解除更新按钮的执行状态。文本及二进制冲突仍从原生命令输出提取，显示警告；命令失败保留失败记录。

命令结束时，后端使旧状态缓存失效，包括可能已更新部分文件的失败操作。这里不等待在途状态扫描。日志分别记录身份确认耗时 `check_ms` 和原生命令耗时 `update_ms`，用于区分命令自身与客户端后处理的等待。

前端随后启动一次共享的后台核对，保留当前文件列表并标记状态尚待校验。提交和丢弃等依赖新鲜状态的操作继续受原有状态门禁保护。后台失败会显示错误，不把已经成功的 SVN 命令改判为失败。

这次核对通过 `svn_status(includeInventory=false)` 查询最新 SVN 状态，不重建文件系统清单。正常轮询与手动刷新仍使用原有带清单的状态缓存；原缓存不会因这次简化核对被错误标记为有效。更新只使历史和 BASE 失效，不重复查询分支目录及贮藏列表。

更新页面复用该后台请求。只有页面仍激活、工作区仍匹配且本地核对成功时，才补充远程版本及待更新日志查询。这些查询不计入更新按钮的前台等待。离开页面或切换工作区会拒绝旧结果。

## 验证

所有运行测试都使用隔离的合成 SVN 工作副本。设置 `TEMP`、`TMP`、`TMPDIR` 为 `E:\Temp\OrcaSVN-Tests`，并提供 `svn` 和 `svnadmin` 后运行：

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml native_update -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml benchmark_native_update_completion -- --ignored --nocapture
```

显式基准比较本地 `file://` 仓库中无新版本更新的直接 CLI、原有前台链路和新前台链路，并单独记录后台 SVN 状态查询耗时。每个规模测三轮，输出中位数。该测试不能代表真实服务器上的传输耗时。
