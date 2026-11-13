# v2.0.2 Tarantula 通用升级补丁

一个原生更新器匹配普通版和主题版的历史安装，内置两套 v2.0.2 应用文件。升级保持各自原来的应用标识、路径及资料目录，不要求先卸载旧版。

## 安装与自动清理

打开 DMG 或解压 ZIP，双击「CampusDesk 更新补丁.app」，核对原应用后点击「安装更新」。成功后自动打开新版，更新器自动退出并移入废纸篓。若从只含更新器和说明的 DMG 运行，会卸载并清理该镜像；ZIP 解压运行只清理更新器应用，不猜测或遍历删除原 ZIP。主程序和完整备份一直保留。

失败不触发自清理。来源不唯一、镜像被其他程序占用或权限不足时保留文件，不强制删除。清理结果写入本次备份的 `Cleanup-Result.json`。废纸篓中的更新器或镜像可恢复。

## 旧版兼容与数据保留

| 原版本 | 新版保持的标识 | 保持的资料目录 |
| --- | --- | --- |
| CampusDesk 普通版 | `local.campusdesk.mac` | `Application Support/CampusDesk` |
| CampusDesk Theme Edition | `local.campusdesk.mac.themeedition` | `Application Support/CampusDesk-local-campusdesk-mac-themeedition` |

普通版升级后也提供新界面与 AI 功能；桌面小组件仍由主题版提供。已发布的旧普通版、旧主题版及临时签名／缺少稳定密钥组件的早期构建均可识别，较新的版本不会被降级。

补丁先正常退出所选版本，再备份应用及本机学习数据、WebKit、HTTPStorages、Cookies、Preferences、Caches、Saved Application State 与既有容器。按内容、权限和链接核验，在同盘执行原子交换，替换后复验；失败只回退应用，不把旧备份覆盖回用户资料。缺失的可选目录保持缺失，另一版的资料不被修改。

原凭据条目、账户指针与网页会话保留，不跨应用标识搬迁，不读取或删除实际密钥。主题版当前稳定密钥组件保持逐字节一致。普通版使用自己的独立凭据组件；很早的签名身份或访问控制可能要求一次 macOS 既有凭据访问授权，程序提供「恢复访问」。服务器令牌到期不由补丁延长。

旧版嵌入应用的学校网址和 Microsoft 公共客户端配置通过备份收据中的白名单元数据保留，新程序只读使用这些兼容信息；本机明确配置（包括关闭某个平台）优先。不会将 client secret、令牌或用户学习数据嵌入发布包。已移除过去可能在首次启动标记缺失时重置登录的流程。

重新打开后的正常同步和用户操作仍会保存新记录。核验不把访问时间、修改时间或 Finder 元数据算作文件内容变化。

## 构建

```sh
CAMPUSDESK_BUILD_DIR="$PWD/build/v2.0.2-Theme" CAMPUSDESK_INFO_PLIST="$PWD/Info-ThemeEdition.plist" bash build.sh
CAMPUSDESK_BUILD_DIR="$PWD/build/v2.0.2-Classic" CAMPUSDESK_INFO_PLIST="$PWD/Info.plist" bash build.sh
bash scripts/package-patch-macos.sh
```

默认产物目录 `build/releases/v2.0.2-Patch1`。可用 `CAMPUSDESK_PATCH_APP`、`CAMPUSDESK_PATCH_CLASSIC_APP` 指定两版构建，用 `CAMPUSDESK_PATCH_OUTPUT` 指定输出。已有同名产物会拒绝覆盖。

## 验证

```sh
bash scripts/test-patch-macos.sh
bash scripts/test-upgrade-compatibility.sh
bash scripts/test-patch-cleanup.sh
bash scripts/test-classic-credential-scope.sh
```

事务检查覆盖原位更新、数据一致、损坏、并发、取消退出、重复安装及回退。55 个历史版本／构建组合覆盖普通版已发布版本及主题版 Build 54–100，验证标识、会话、资料、另一版隔离与配置延续。清理检查实际验证废纸篓恢复、只读镜像卸载、拒绝混有个人文件的镜像和主程序保护。凭据探测只查询随机的不存在账户，不创建、读取或删除真实密钥。

安装包适用于 Apple Silicon、macOS 12 起；尚未完成 Apple Developer ID 公证。
