# CampusDesk

面向使用M系列 mac 的国际部学生打造的集中查看希悦课表、ManageBac课程总评和GPA估算、待办与可识别的教师反馈。-如果需要windows操作系统版本，移步到https://github.com/zhyunran/ManageBac-packer

**当前版本：0.4.6（本地预览，尚未发布） · MIT · 实验性软件。** 待办可按学科分组并特别关注，Teams 消息可按发件人与频道分组并关注频道；可在“连接与设置 → 面板样式”切换经典面板与卡片看板。自动读取不等于完整读取；遇到权限、布局、限流或数量限制时保留已有结果，并显示未完成范围。不要把看板作为成绩、截止时间或 EC 安排的唯一依据，请以学校原平台为准。

## 已发布版本

- [v0.4.4](releases/v0.4.4.md) — 卡片看板、课程时间表头与两位小数 GPA 展示。
- [v0.4.2](releases/v0.4.2.md) — 待办与提醒的可见性改进。
- [v0.4.1](releases/v0.4.1.md) — Teams、EC 与附件读取能力的公开源码版。

完整下载包见 [GitHub Releases](https://github.com/xuanqiwang645/CampusDesk/releases)。

## 当前能力与边界

| 来源 | 已实现 | 仍需注意 |
| --- | --- | --- |
| 希悦 | 从已登录的学校页面读取课表，显示课程与倒计时 | 页面适配器依赖布局；需配置学校入口 |
| ManageBac | 读取课程总评、任务、明确的教师反馈及原页入口 | 不把任务分数平均成总评，不猜官方 GPA；需配置学校入口 |
| Teams 浏览器模式（默认） | 自动发现本浏览器已有的会话索引，读取部分频道/聊天消息，定时更新 | 依赖 Chrome/Edge 登录与授权、网页布局和内部接口；不保证发现账号的全部会话 |
| English Corner | 优先同步 EC 消息，读取受支持附件文字，本地搜索和发布日期筛选 | 文字提取不是表格结构还原、个人名单匹配或活动改期识别 |
| Microsoft Graph（可选） | 独立登录与只读同步适配器 | 需要自行注册应用及组织批准；正式作业、成绩、反馈仍需实际租户验收 |

EC 自动附件读取支持 PDF、PNG/JPEG/GIF、TXT/CSV、DOCX、XLSX 的部分文字内容。PDF 混合图文页会尝试本机 Vision OCR，并记录逐页覆盖和置信信息。不支持所有格式、公式计算、旧式 Office 二进制文件或完整排版还原。

Teams 默认模式在 Teams 页面内使用当前账号会话访问内部服务，参考了 [teams-web-chat-exporter](https://github.com/gediz/teams-web-chat-exporter)。这不是稳定的公开 Microsoft API，也不绕过账号权限或学校策略。接口或页面升级可能让同步失效；请仅在获得相应使用许可时启用。

## 从源码安装

需要 macOS 12 或更新版本、可用的 Apple Command Line Tools，以及 Chrome 或 Edge（使用默认 Teams 模式时）。构建不需要 Node.js、Python、npm 或付费开发者账号。当前按本机架构构建；已在 Apple Silicon 上验证编译，未完成 Intel 实机验收。

1. 下载本仓库源码，或运行 `git clone https://github.com/xuanqiwang645/CampusDesk.git`。
2. 按需配置下方学校地址；只使用 Teams 时可以保持为空。
3. 退出正在运行的 CampusDesk，双击 `Install.command`，或在源码目录运行 `bash Install.command`。
4. 安装到 `~/Applications/CampusDesk.app` 后打开应用。安装器不需要管理员密码；编译工具本身需已正确安装。

安装器先构建、验证，再备份已有应用和 `~/Library/Application Support/CampusDesk` 中的数据后替换。备份路径会显示在终端。它不会清除浏览器登录，也不会代替你接受 Xcode 许可或修改系统开发工具选择。

只构建、不安装：

```sh
bash build.sh
# 可选：避免云同步文件夹重新附加扩展属性而影响本地签名
CAMPUSDESK_BUILD_DIR="$(mktemp -d /private/tmp/CampusDesk-build.XXXXXX)" bash build.sh
```

默认产物是 `build/CampusDesk.app`，使用本机临时签名，**没有 Developer ID 公证**。请自行核对源码；不要全局关闭 Gatekeeper。本次发布提供源码，不提供已公证的安装包。

### 学校入口

公开源码不内置某位学生的学校入口。编译前编辑 `Resources/SchoolConfig.json`：

```json
{
  "seiue": "https://YOUR-SCHOOL.seiue.com/",
  "managebac": "https://YOUR-SCHOOL.managebac.cn/"
}
```

把占位地址替换为学校实际根地址；不用的服务保留空字符串。支持希悦 `*.seiue.com` 与 ManageBac `*.managebac.cn` / `*.managebac.com`，只接受 HTTPS 根地址，不接受凭据、查询参数、片段或非标准端口。提取仅允许配置的精确来源；配置后需重新编译。不同学校的页面布局可能仍需适配。**不要把自己的学校配置或学习数据提交到公共仓库。**

### Teams 首次连接

1. 在“连接与设置”选择 Chrome 或 Edge 和浏览器同步模式，允许读取 Teams。
2. 在选定浏览器打开 Teams，并自行完成学校登录。
3. 按 macOS 提示允许 CampusDesk 控制所选浏览器；可在“系统设置 → 隐私与安全性 → 自动化”核对。
4. 在浏览器菜单启用 **Allow JavaScript from Apple Events**（Chrome 通常位于“显示 → 开发者”），然后在 CampusDesk 启动同步。

这些权限由你手动确认。它们允许自动化调用浏览器，请仅授权可信的软件。不要向维护者提供账号密码、Cookie、令牌或带认证信息的链接。

自动刷新要求 CampusDesk 运行、Mac 处于可运行状态、浏览器保持可用且会话未过期。关闭应用、睡眠、浏览器退出或重新登录要求都可能中断更新。遇到 `UNKNOWN_LAYOUT`、权限不足或部分同步，应查看未完成列表，不能视为“全部读取成功”。

官方 Graph 方案是可选的独立连接方式，参见 [Microsoft-Teams-Setup.md](Microsoft-Teams-Setup.md)。默认浏览器模式不需要填写 Graph Client ID。

## 数据与隐私

- 学习缓存、同步状态和提取的附件文字保存在本机 `~/Library/Application Support/CampusDesk/`。这些内容可能包含学生、教师或同学的个人信息，不应公开分享。
- 浏览器模式不把浏览器访问令牌导出给原生进程；可选 Graph 模式由原生客户端管理授权，令牌保存在 macOS 钥匙串，不在项目配置文件中。
- 本项目没有配套的开发者收集服务器。读取会访问 Microsoft 或你配置的学校平台；不要把“本地缓存”理解成完全离线。
- 没有发送 Teams 消息、提交作业或修改学校成绩的功能。
- 导出的备份也含学习数据。上传 Issue 前，删除姓名、学校、账号 ID、消息正文、文件名、链接、会话标识和凭据。
- 本次源码发布排除了本机缓存、构建产物、私人诊断脚本及真实成绩夹具。既有 Git 提交历史保持不变。

## 限制与待办

当前没有证实完整历史分页续传、索引外会话发现、独立回复链全覆盖，或正式教育数据的跨租户完整性。默认接口读取窗口为每会话最多 8 页、240 条消息及 45 秒；本地会话索引最多 500 项。EC 附件单个最多 12 MiB，每频道每轮最多 12 个新下载，整轮最多 40 个、48 MiB；PDF 最多 100 页，其中最多 12 页 OCR。超限/低置信度结果应保持部分状态。状态文件仍有 25 MiB 上限。

429/503 限流会停止当前读取，并尊重服务端冷却时间；不通过更换读取方式规避限流。附件只有在重新核对 SharePoint 元数据且版本一致时才复用正文。后续重点是可验证的覆盖、存储拆分和学校适配，而不是声称“已经全自动读取全部内容”。本仓库是 macOS 项目，尚无 iOS 版本。

## 开发与测试

原生壳：Swift / AppKit / WKWebView。界面和适配器：本地 HTML、CSS、JavaScript。附件文字：PDFKit、Vision 与受限 Office ZIP/XML 解析。无 npm 或 SwiftPM 运行时依赖。

JavaScript 回归测试需要支持 `node:test` 的 Node.js（建议 22 或更新版本）：

```sh
node --test Tests/*.test.cjs
```

macOS 原生附件和事件协议测试使用合成数据，不读取真实账号：

```sh
bash test-native.sh
```

源码构建与单元测试通过不等于真实账号、全部浏览器版本或全部学校验收通过。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)。

## 许可

[MIT License](LICENSE)。相关第三方 MIT 声明及参考提交保留在 [Resources/THIRD_PARTY_TEAMS_API.txt](Resources/THIRD_PARTY_TEAMS_API.txt)。MIT 许可只覆盖本项目可授权的代码，不授予学校数据、第三方服务或商标的使用权。



## 特别声明：
-我的同学@zhyunran，@hs89n5km86-coder 也为本软件提出了思路，代码和优化指导。在此特别鸣谢！

-同时，本软件的Microsoft Teams接口受到了以下3位开发者的启发：

-https://github.com/gediz/teams-web-chat-exporter

-https://github.com/Maxim-Mazurok/teams-api

-https://github.com/microsoftgraph

在此特别鸣谢！
