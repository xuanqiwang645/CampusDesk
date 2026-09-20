# 可选：Microsoft Graph 接入

这份指南仅适用于设置中的 **Microsoft Graph** 连接方式。0.4.1 默认的 Chrome/Edge 浏览器同步不要求注册 Graph 应用，参见 [README](README.md#teams-首次连接)。两条路径的授权、数据覆盖和附件支持不同。

Graph 适配器已实现，但正式作业、成绩和教师反馈尚未完成实际租户逐项验收。本仓库不提供可直接使用的公共 Client ID，也不能借用其他应用的 ID。

## 注册与权限

由具备权限的开发者或学校管理员注册公共原生客户端，选择合适的组织账号/租户类型。在应用 Authentication 设置登记准确回调：

```text
msauth.local.campusdesk.mac://auth
```

Bundle ID 为 `local.campusdesk.mac`。当前实现采用授权码 + PKCE，不使用客户端密钥。注册流程以 [Microsoft Entra 官方指南](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) 为准。

源码 `Sources/GraphAuth.swift` 当前声明的委托权限：

- `User.Read`
- `Team.ReadBasic.All`
- `Channel.ReadBasic.All`
- `ChannelMessage.Read.All`
- `Chat.Read`
- `EduAssignments.Read`
- `openid`、`profile`、`offline_access`

权限同意由 Microsoft 和组织策略决定，部分权限需要管理员批准。请按最小权限原则审查源码和 [Microsoft Graph 权限说明](https://learn.microsoft.com/en-us/graph/permissions-reference)，不要授予应用身份的全租户权限来替代此委托流程。个人确认不能代替学校审批。

## 配置

在“连接与设置”选择 Graph，填入自己的实际 Client ID 和 Tenant ID 后保存；或在编译前编辑 `Resources/MicrosoftGraphConfig.json`。单租户填写该目录 ID，多租户设置须与注册类型及学校审批一致。源码中的空 Client ID 表示尚未配置，不是程序错误。

Client ID 不是密码，但不要在该文件或 Issue 中放入客户端密钥、访问令牌、刷新令牌、Cookie 或验证码。Graph 令牌由原生客户端存入 macOS 钥匙串。

## 验证，不推断完整性

在 CampusDesk 登录自己的学校账号，确认账号信息和连接状态。核对具体频道与聊天、具体作业正文/截止时间/提交状态、已发布成绩和反馈，再测试权限不足、会话过期、退出和换账号的行为。程序显示“部分同步”时，不能视为全部数据已经读取。

[账号作业列表 API](https://learn.microsoft.com/en-us/graph/api/educationuser-list-assignments?view=graph-rest-1.0) 与具体作业详情并非同一响应；当前适配器会继续请求详情，但仍受账号权限和接口限制。

此路径当前使用全球 Microsoft Graph `graph.microsoft.com`。Graph 附件提供原件链接，**没有接入默认浏览器模式的 EC 二进制下载/OCR 管线**。不要将浏览器模式的附件能力推及 Graph。
