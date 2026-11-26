# 文档截图

截图来自 ForkSVN 的 Windows WebView，使用本地临时 SVN 仓库。示例工作区和历史均为测试数据。

| 文件 | 场景 |
| --- | --- |
| `orcasvn-workspace.png` | 简体中文、浅色主题、1500 × 1000，工作区文件列表与选中文件 Diff |
| `orcasvn-workspace-dark.png` | 同一场景的深色主题，使用青绿主题色 |

## 在浏览器中生成另一组示例截图

需要本地已安装 `browser-use`。在项目根目录运行 `npm run dev -- --host 127.0.0.1`，另开 PowerShell：

```powershell
$env:PYTHONIOENCODING = 'utf-8'
browser-use --session docs-update open http://127.0.0.1:1420
browser-use --session docs-update eval (Get-Content -Raw docs/images/workspace-demo.js)
browser-use --session docs-update python "cdp = browser._run(browser._session.get_or_create_cdp_session(target_id=None, focus=False)); browser._run(cdp.cdp_client.send.Emulation.setDeviceMetricsOverride(params={'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False}, session_id=cdp.session_id))"
browser-use --session docs-update screenshot docs/images/orcasvn-workspace.png
browser-use --session docs-update eval "(async () => { (await import('/src/composables/useSettings.ts')).useSettings().updateSettings({theme:'dark'}); await (await import('/node_modules/.vite/deps/vue.js')).nextTick(); })()"
browser-use --session docs-update screenshot docs/images/orcasvn-workspace-dark.png
browser-use --session docs-update close
```

该流程使用 browser-use 当前 Python 会话的内部 CDP 接口设置视口；CLI 更新后可能需要调整。截图前确认六个示例路径已显示，`src/config.ts` 已选中，Diff 显示新增 3 行、删除 2 行，图标和字体均已加载。截图后检查文字清晰、面板完整且没有错误提示，再同步更新文档中的日期和版本说明。

示例脚本只在手动执行的浏览器会话中注入数据，不会被应用入口导入。刷新页面即可移除模拟命令桥接。
