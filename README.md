# CampusDesk Theme Edition · Super Orion

面向使用M系列 mac 的国际部学生打造的集中查看希悦课表、ManageBac课程总评和GPA估算、待办与可识别的教师反馈。同时，对北京101国际部特色活动English Corner（EC）有特别优化


**最新版本：v1.1.0 Super Orion · 主题版 · 构建 55。** 适用于 Apple Silicon（M 系列芯片）Mac，最低 macOS 12。

[下载 DMG 安装包](https://github.com/xuanqiwang645/CampusDesk/releases/download/v1.1.0/CampusDesk-Theme-v1.1.0-Super-Orion-build55-macOS-arm64.dmg) · [下载 ZIP 压缩包](https://github.com/xuanqiwang645/CampusDesk/releases/download/v1.1.0/CampusDesk-Theme-v1.1.0-Super-Orion-build55-macOS-arm64.zip) · [发布说明与 SHA-256 校验](https://github.com/xuanqiwang645/CampusDesk/releases/tag/v1.1.0)

打开 DMG 后，将 **CampusDesk Theme Edition.app** 拖入 Applications。更新时请替换原来的主题版安装位置；如果原应用位于个人 `~/Applications`，请仍放回该目录。应用使用本机持久签名，尚未经过 Apple Developer ID 公证。

-如果需要windows操作系统版本，移步到https://github.com/zhyunran/ManageBac-packer

如发现任何值得改进的地方，欢迎联系我！邮箱：xuanqiwang645@gmail.com

## Super Orion 主题版有什么

- **学习助手**：支持关闭、仅本机 Ollama、仅联网 DeepSeek、联网 DeepSeek／离线 Ollama 四种模式。对话页可直接点击“本机 Ollama”“联网 DeepSeek”“自动切换”；联网时也能选择本机模型，切换保留输入草稿，回复期间暂时锁定切换。
- **首次设置与配置教程**：引导连接学校平台、设置主题和学习助手；内置 DeepSeek API 注册与接入、Ollama 安装和模型下载教程，提供官网入口与下载命令复制。模型从可用列表选择。
- **课程与待办**：Teams、ManageBac 按来源和学科分组；任务小卡片显示明确截止日期的倒计时、紧迫度和可视化条。日期缺失或不确定时标注待核对；进度条表示截止紧迫度，不代表作业完成比例。
- **双 GPA 与双 K 线**：本地 Build 74 起，分档采用 A 至 F 的 12 档标准（93 分起 4.0、90 分起 3.7），同时保留每科百分比线性折算的 4.0 GPA；两套算法各有本机历史图表。成绩目标模拟与学期预测使用课程自己的类别权重。上方公开安装包仍为 Build 55。
- **成绩通知栏（本地 Build 75）**：顶部“成绩更新”铃铛显示未读数量，可查看 ManageBac 新公布或修改的作业成绩、科目、新旧分数，并逐条或全部标为已读。首次读取某个课程、学期或新页面只建立已有成绩基线；之后同步发现的明确成绩变化才提醒。可比较时显示本次同步的科目总评、分档及线性 GPA 前后值，标注“同期变化”，不冒充单份作业的独立贡献。缺少可比较总评时明确说明暂不能量化。最多保存 200 条通知，已读状态留在本机并随备份保存。
- **课表与校历**：支持单双周、节假日、一次性课程、临时调课、校历导入及当日事件；可识别受支持校历中的调休安排，导入后可核对预览。
- **主题与学习工具**：中英文界面、经典面板与卡片看板、多种主题配色、Liquid Glass 效果，以及全局搜索、今日学习计划、同步可信度、变化记录、EC、附件中心和专注模式。

两种 GPA 都是参考估算，不是学校官方 GPA。旧历史缺少线性数据时不会伪造回填。同步受账号权限、页面布局、限流及读取范围影响；界面会保留缓存并提示未完成范围，成绩、截止时间与 EC 安排以学校原平台为准。

### 本地 Build 74 分档标准

| 百分制成绩（下界包含，上界不包含） | 等级 | 绩点 |
| --- | --- | --- |
| 93–100（含 100） | A | 4.0 |
| 90–<93 | A− | 3.7 |
| 87–<90 | B+ | 3.3 |
| 83–<87 | B | 3.0 |
| 80–<83 | B− | 2.7 |
| 77–<80 | C+ | 2.3 |
| 73–<77 | C | 2.0 |
| 70–<73 | C− | 1.7 |
| 67–<70 | D+ | 1.3 |
| 63–<67 | D | 1.0 |
| 60–<63 | D− | 0.7 |
| 0–<60 | F | 0.0 |

每科百分比不提前取整，先转为分档绩点，再课程等权平均。线性公式仍为每科百分比 ÷ 100 × 4 后等权平均，历史线性值不变。有完整各科分数签名的旧分档历史可重算；无法重算的记录保留在数据与备份中，但不混入新分档图表。

### 学习助手与数据使用

仅本机 Ollama 模式将问题、当前对话及勾选资料交给本机模型；仅联网 DeepSeek 模式将这些内容发送给 DeepSeek，断网停用。自动切换模式联网时使用 DeepSeek，离线或网络请求失败时改用 Ollama；网络失败前请求可能已经到达 DeepSeek。发送前可调整资料范围，也可查看发送内容。

DeepSeek API 密钥通过原生组件保存在 macOS 钥匙串中。安装包不包含个人 API 密钥、学校配置、登录会话或学习数据。Ollama 模型需先下载完成；其系统和硬件要求以官方说明为准。

## 版本记录

本地开发版本的提交链、GPT 托管工作树和实机验收范围见[开发历史与工作树交接](docs/development-history.md)。下列公开版本记录保持原样，不等同于已发布最新本地构建。

- [v1.1.0 Super Orion · 主题版 · 构建 55](releases/v1.1.0.md) — 更新设置向导版本记录、可重复触发的向导重启，以及更具体的学校平台读取失败诊断；同步发布可复现主题版源码。
- [v1.0.0 Orion · 主题版 · 构建 54](https://github.com/xuanqiwang645/CampusDesk/releases/tag/v1.0.0) — 学习助手、对话页接入方式切换、配置向导与教程、密钥保存修复，以及任务卡片倒计时和紧迫度显示。
- [v0.5.13](releases/v0.5.13.md) — 双 GPA 算法与双 K 线；整合校历导入、连接体验及同步修正。
- [v0.5.8](releases/v0.5.8.md) — 每门课程读取自己的 ManageBac 成绩类别权重；成绩目标模拟、学期预测与 K 线悬停改进。
- [v0.5.7](releases/v0.5.7.md) — 修复英文界面残留中文；按 ManageBac Task Information 中的类别权重与成绩预测 GPA。
- [v0.5.6](releases/v0.5.6.md) — 修复学期日期输入与 GPA 预测，支持本机配置学校网址。
- [v0.5.5](releases/v0.5.5.md) — 学习中心、Liquid Glass 界面、课表规则和 GPA K 线。
- [v0.5.4](releases/v0.5.4.md) — 自编课表按节次/按时刻联动、自动补全与重叠归类，并纳入课程表和下节课提醒。
- [v0.4.4](releases/v0.4.4.md) — 卡片看板、课程时间表头与两位小数 GPA 展示。
- [v0.4.2](releases/v0.4.2.md) — 待办与提醒的可见性改进。
- [v0.4.1](releases/v0.4.1.md) — Teams、EC 与附件读取能力的公开源码版。
- [v0.1.0](releases/v0.4.1.md) — Managebac,希悦系统整合

## 当前能力与边界

| 来源 | 已实现 | 仍需注意 |
| --- | --- | --- |
| 希悦 | 从已登录的学校页面读取课表，显示课程与倒计时 | 页面适配器依赖布局；需配置学校入口 |
| ManageBac | 读取课程总评、任务、教师反馈及类别权重；目标模拟和学期预测共用类别情景，支持本机补充或粘贴类别表 | 权重须合计 100%；已评分不代表已结课。日期可选，仅显示日历进度。缺失类别不伪造结果；课程等权，不含 AP 或学分加权，也不是官方 GPA |
| Teams 浏览器模式（默认） | 自动发现本浏览器已有的会话索引，读取部分频道/聊天消息，定时更新 | 依赖 Chrome/Edge 登录与授权、网页布局和内部接口；不保证发现账号的全部会话 |
| English Corner | 优先同步 EC 消息，读取受支持附件文字，本地搜索和发布日期筛选 | 文字提取不是表格结构还原、个人名单匹配或活动改期识别 |
| Microsoft Graph（可选） | 独立登录与只读同步适配器 | 需要自行注册应用及组织批准；正式作业、成绩、反馈仍需实际租户验收 |

EC 自动附件读取支持 PDF、PNG/JPEG/GIF、TXT/CSV、DOCX、XLSX 的部分文字内容。PDF 混合图文页会尝试本机 Vision OCR，并记录逐页覆盖和置信信息。不支持所有格式、公式计算、旧式 Office 二进制文件或完整排版还原。

Teams 默认模式在 Teams 页面内使用当前账号会话访问内部服务，参考了 [teams-web-chat-exporter](https://github.com/gediz/teams-web-chat-exporter)。这不是稳定的公开 Microsoft API，也不绕过账号权限或学校策略。接口或页面升级可能让同步失效；请仅在获得相应使用许可时启用。

## 主题版源码构建

仓库现在包含主题版完整源码。默认 `bash build.sh` 仍构建原版 CampusDesk；构建主题版请使用：

```sh
CAMPUSDESK_INFO_PLIST="$PWD/Info-ThemeEdition.plist" bash build.sh
```

主题版使用独立应用标识和图标；安装到 `~/Applications/CampusDesk Theme Edition.app` 可与原版并存。安装包不含个人登录状态、API 密钥、学校网址或同步数据。

主题版构建产物为 `build/CampusDesk Theme Edition.app`（不会再使用原版的文件名）。从源码安装主题版：

```sh
CAMPUSDESK_INFO_PLIST="$PWD/Info-ThemeEdition.plist" bash Install.command
```

安装器只检查和备份所选版本，不要求另一版本退出；主题版数据目录为 `~/Library/Application Support/CampusDesk-local-campusdesk-mac-themeedition`。

本地生成 DMG、ZIP 与可移植的校验文件（不上传）：

```sh
CAMPUSDESK_INFO_PLIST="$PWD/Info-ThemeEdition.plist" bash scripts/package-macos.sh
# 进入脚本输出的安装包目录后，可校验下载/搬移后的文件：
shasum -a 256 -c SHA256SUMS.txt
```

当前源码包含 **v1.1.0 Build 77 本地更新**，尚未替换上方 Build 55 公开下载。新增学习助手本机历史、全文搜索、独立草稿和重启后续聊，旧聊天可继续追加问题。修复 DeepSeek 模型发现时序、连续对话失败后的重试与具体错误提示，明确关闭默认高强度思考。保留成绩通知栏和未读提醒；分档 GPA 按上方 12 档标准换算，线性算法不变。校园总览小组件固定分为课程提醒、行事历、作业提示三个区域；小／中尺寸各显示每类一项，大尺寸每类最多两项，并提示更多内容。课程结束后可查看后续日期的课程；作业包含无截止日期和超过七天的未完成任务，无日期时明确标注“截止待确认”。保留专用课程与作业小组件，点击作业直接打开待办事项。摘要按类别分配名额，避免课程过多挤掉其他内容。继续保留 Build 71 的系统扩展启动入口修复。个人待办表单保留年-月-日输入、今天/明天/不设截止快捷操作及独立小时、分钟数字滚轮；默认不设截止，仅填日期默认 23:59，按北京时间预览与保存。继续保留中文输入法及重复提交保护。

Build 76 同时修复连续追问时“第一次点击发送无反应”的失焦重绘问题。输入框到发送按钮的指针交互期间保留原控件，后台同步不会吞掉点击；失败重试保留已成功对话和问题草稿。新增真实浏览器回归，并在已安装的 macOS 版完成三轮 DeepSeek 连续对话验收。

Build 69 新增独立**行事历**：月视图与每日清单统一显示课程、明确截止时间的待办、校历和个人日程，支持分类筛选、全天/跨日事件的新增、编辑、删除。继续采用北京时间和已有假期、调休规则，不猜测缺失的截止日期；个人日程仅保存在本机，并纳入备份。

主题版附带原生 **macOS 桌面小组件**（macOS 14 或更新版本）：“校园总览”和“作业与待办提示”支持小/中/大尺寸；“下一节课”支持小/中尺寸，显示当前或后续课程、教室和开课/下课倒计时。截止紧迫度条不是完成进度。安装后打开 CampusDesk，在桌面右键 → 编辑小组件 → 搜索 CampusDesk 并添加。点击课程／日历事件返回对应日期，点击作业打开待办事项；小号总览整体打开行事历。应用保存后更新专用摘要，系统按 WidgetKit 刷新预算刷新，不能保证逐秒同步。摘要超过 24 小时会提示打开应用刷新，超出八个自然日的缓存有效期后停止展示。读取失败会区分尚未同步、权限不足和摘要损坏。专用文件 `~/Library/Application Support/CampusDesk Widgets/agenda.json` 仅包含最多 100 项日程展示字段（标题、日期时间、类别、地点），不含账号、API 密钥、原网页或附件正文；组件没有网络权限。仅允许当前用户读取该文件，小组件通过精确到文件的只读沙箱权限访问，不开放 CampusDesk 的主数据目录。旧版 macOS 仍可使用应用内行事历。

Build 68 优化 English Corner 搜索索引复用、界面翻译查找缓存和 GPA 悬停的逐帧更新；普通状态写盘改为串行后台合并，退出和导入前仍检查保存结果。UI 统一了间距、文字层级、圆角和键盘焦点，降低大面积阴影与悬停重绘，改善窄窗口和深色主题的可读性。总览分组保持不变：个人待办仍在左栏顶部，Teams 作业在其下，ManageBac 在右栏；保留完整截止时间、倒计时、紧急度条及 Liquid Glass 选项。

## 从源码安装（仓库原版）

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

默认原版产物是 `build/CampusDesk.app`，使用本机持久签名身份以保持升级后的钥匙串访问，**没有 Developer ID 公证**。请自行核对源码；不要全局关闭 Gatekeeper。

### 学校入口

首次安装后，在“连接与设置 → 学校连接”输入希悦和 ManageBac 的学校首页网址，点击“保存学校网址”即可登录。地址保存在本机 Application Support/CampusDesk/SchoolConfig.json，重启和升级后保留；不用的服务可以留空。省略 https:// 时会自动补齐。

公开源码不内置个人学校入口。开发者也可在编译前配置 `Resources/SchoolConfig.json`：

```json
{
  "seiue": "https://YOUR-SCHOOL.seiue.com/",
  "managebac": "https://YOUR-SCHOOL.managebac.cn/"
}
```

把占位地址替换为学校实际根地址；不用的服务保留空字符串。支持希悦 `*.seiue.com` 与 ManageBac `*.managebac.cn` / `*.managebac.com`，只接受 HTTPS 根地址，不接受凭据、查询参数、片段或非标准端口。提取仅允许配置的精确来源；在应用内保存后立即生效。不同学校的页面布局可能仍需适配。**不要把自己的学校配置或学习数据提交到公共仓库。**

### Teams 首次连接

1. 在“连接与设置”选择 Chrome 或 Edge 和浏览器同步模式，允许读取 Teams。
2. 在选定浏览器打开 Teams，并自行完成学校登录。
3. 按 macOS 提示允许 CampusDesk 控制所选浏览器；可在“系统设置 → 隐私与安全性 → 自动化”核对。
4. 在浏览器菜单启用 **Allow JavaScript from Apple Events**（Chrome 通常位于“显示 → 开发者”），然后在 CampusDesk 启动同步。

这些权限由你手动确认。它们允许自动化调用浏览器，请仅授权可信的软件。不要向维护者提供账号密码、Cookie、令牌或带认证信息的链接。

自动刷新要求 CampusDesk 运行、Mac 处于可运行状态、浏览器保持可用且会话未过期。关闭应用、睡眠、浏览器退出或重新登录要求都可能中断更新。遇到 `UNKNOWN_LAYOUT`、权限不足或部分同步，应查看未完成列表，不能视为“全部读取成功”。

官方 Graph 方案是可选的独立连接方式，参见 [Microsoft-Teams-Setup.md](Microsoft-Teams-Setup.md)。默认浏览器模式不需要填写 Graph Client ID。

## 数据与隐私

- 学习缓存、同步状态和提取的附件文字保存在本机应用数据目录；仓库原版使用 `~/Library/Application Support/CampusDesk/`，主题版使用独立数据目录。这些内容可能包含学生、教师或同学的个人信息，不应公开分享。
- 浏览器模式不把浏览器访问令牌导出给原生进程；可选 Graph 模式由原生客户端管理授权，令牌保存在 macOS 钥匙串，不在项目配置文件中。
- 本项目没有配套的开发者收集服务器。读取会访问 Microsoft 或你配置的学校平台；主题版启用联网学习助手后，发送内容也会交给 DeepSeek。本地缓存不代表所有功能完全离线。
- 没有发送 Teams 消息、提交作业或修改学校成绩的功能。
- 导出的备份也含学习数据。上传 Issue 前，删除姓名、学校、账号 ID、消息正文、文件名、链接、会话标识和凭据。
- 本次源码发布排除了本机缓存、构建产物、私人诊断脚本及真实成绩夹具。既有 Git 提交历史保持不变。

## 限制与待办

当前没有证实完整历史分页续传、索引外会话发现、独立回复链全覆盖，或正式教育数据的跨租户完整性。默认接口读取窗口为每会话最多 8 页、240 条消息及 45 秒；本地会话索引最多 500 项。EC 附件单个最多 12 MiB，每频道每轮最多 12 个新下载，整轮最多 40 个、48 MiB；PDF 最多 100 页，其中最多 12 页 OCR。超限/低置信度结果应保持部分状态。状态文件仍有 25 MiB 上限。

429/503 限流会停止当前读取，并尊重服务端冷却时间；不通过更换读取方式规避限流。附件只有在重新核对 SharePoint 元数据且版本一致时才复用正文。后续重点是可验证的覆盖、存储拆分和学校适配，而不是声称“已经全自动读取全部内容”。本仓库是 macOS 项目，尚无 iOS 版本。

## 开发与测试

原生壳：Swift / AppKit / WKWebView。界面和适配器：本地 HTML、CSS、JavaScript；Liquid Glass 使用随应用打包的 Three.js/WebGL2/GLSL 渲染。附件文字：PDFKit、Vision 与受限 Office ZIP/XML 解析。无 npm 或 SwiftPM 运行时依赖。

JavaScript 回归测试需要支持 `node:test` 的 Node.js（建议 22 或更新版本）：

```sh
node --test Tests/*.test.cjs
```

macOS 原生附件和事件协议测试使用合成数据，不读取真实账号：

```sh
bash test-native.sh
```

主题版小组件构建后，额外检查实际 Mach-O 启动入口（不仅检查编译参数或签名）：

```bash
CAMPUSDESK_WIDGET_BINARY="$PWD/build/CampusDesk Theme Edition.app/Contents/PlugIns/CampusDeskWidgets.appex/Contents/MacOS/CampusDeskWidgets" \
  node --test Tests/widget-packaging.test.cjs
```

扩展必须先进入系统的 `_NSExtensionMain`，再由系统调用 Swift `@main`。`-application-extension` 本身不会设置该入口。离线 SwiftUI 渲染、签名通过和 PlugInKit 注册均不能替代小组件图库添加、桌面显示和点击跳转验收。

源码构建与单元测试通过不等于真实账号、全部浏览器版本或全部学校验收通过。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)。

## 许可

[MIT License](LICENSE)。相关第三方声明保留在 [Resources/THIRD_PARTY_TEAMS_API.txt](Resources/THIRD_PARTY_TEAMS_API.txt)、[Resources/THIRD_PARTY_KLINECHART.txt](Resources/THIRD_PARTY_KLINECHART.txt) 与 [Resources/THIRD_PARTY_THREEJS.txt](Resources/THIRD_PARTY_THREEJS.txt)。MIT 许可只覆盖本项目可授权的代码，不授予学校数据、第三方服务或商标的使用权。



## 特别声明：
-我的同学@zhyunran，@hs89n5km86-coder 也为本软件提出了思路，代码和优化指导。在此特别鸣谢！

-同时，本软件的Microsoft Teams接口受到了以下3位开发者的启发：

-https://github.com/gediz/teams-web-chat-exporter

-https://github.com/Maxim-Mazurok/teams-api

-https://github.com/microsoftgraph

在此特别鸣谢！
