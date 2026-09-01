# 参与贡献

感谢你帮助改进页梭。

1. Fork 仓库并从 `main` 创建功能分支。
2. 保持功能围绕“Chrome 独立代理与网页环境一致性”这一单一目标。
3. 不提交真实节点、订阅地址、UUID、密码、发布私钥或用户数据。
4. 修改 JavaScript 后运行全部 Node 测试；修改 helper/updater 后同时运行 .NET 构建和自测。
5. 提交 Pull Request，说明动机、行为变化、测试结果和界面截图。

```powershell
node tests\parser.test.cjs
node tests\state-utils.test.cjs
node tests\location-override.test.cjs
dotnet build host\ChromeProxyHost.csproj -c Release
dotnet build updater\PageShuttleUpdater.csproj -c Release
```

修改 macOS 安装器、进程管理或打包逻辑时，Pull Request 还必须通过 `osx-arm64` 与 `osx-x64` GitHub Actions 真机任务。

Xray-core 与 js-yaml 是第三方项目，请不要把它们的源代码修改混入页梭自研代码。
