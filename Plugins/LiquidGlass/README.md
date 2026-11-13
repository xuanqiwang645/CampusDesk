# CampusDesk Liquid Glass 1.0

液态玻璃插件已随 CampusDesk 2.1.0 内置，无需单独复制文件。打开「连接与设置 → 插件与液态玻璃」，可启停插件，调整透明度、圆角和 regular / clear 材质。透明度 100% 隐藏材质；文字始终由前景 WebKit 层绘制。macOS 26+ 使用 NSGlassEffectView；旧系统或开启「降低透明度」时使用原有背景。

此 ZIP 是插件源代码与 SDK，供开发者扩展；不是双击运行的安装程序。普通用户请下载完整 DMG 或更新补丁。原生插件当前由应用在编译时注册，不支持从磁盘加载任意二进制或脚本。

## API 1

原生入口在 `Sources/CampusPlugins.swift`。实现 `CampusDeskPlugin`：声明稳定 manifest（id、version、apiVersion、capabilities），实现 activate/configure/receiveLayout/deactivate，然后在 `CampusPluginManager` 注册。context 只包含 presentation surface host，不传入学习资料、凭据或网络客户端。声明 capabilities 是接口约定，不是针对任意本地代码的安全沙箱。

前端入口 `window.CampusDeskPlugins`：

```js
const unsubscribe = CampusDeskPlugins.subscribe(plugins => console.log(plugins));
CampusDeskPlugins.configure('campusdesk.liquid-glass', { enabled: true, transparency: 50 });
const current = CampusDeskPlugins.getPlugins();
unsubscribe();
```

`register(manifest, { update, deactivate })` 为随应用发布的前端扩展注册生命周期回调，返回卸载回调。manifest 的 API 版本必须是 1，id 不得重复。原生端仍须注册相同插件；SDK 不会从 URL 获取或执行扩展。插件设置独立保存在本机 UserDefaults，不进入学校资料备份。

布局消息是固定 `plugin` bridge action，operation 为 layout，pluginId 为已注册 id。viewport 和 surfaces 使用 CSS 像素；原生端验证有限数、尺寸范围和最多 48 个矩形，再转换为视图坐标。禁用时移除原生材质并恢复原有渲染。

参考：<https://developer.apple.com/documentation/appkit/nsglasseffectview>、<https://developer.apple.com/documentation/appkit/nsglasseffectcontainerview>。
