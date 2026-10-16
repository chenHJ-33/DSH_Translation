# dsh-translate · DSH 划词翻译插件

在 DeepSeek Harness 的 Web 界面里划词即译：**鼠标左键选中单词或句子 → 点击浮出的小按钮 → 弹出翻译卡片**；也可以用**快捷键**直接翻译当前选中内容。卡片可以**按住顶部拖走**，**点卡片以外的任何地方即关闭**。

翻译引擎走**百度翻译开放平台**的「通用文本翻译」接口（`/api/trans/vip/translate`），密钥只存在于 Host 进程，浏览器端永远拿不到。

```
选中文字 ──┬─ 左键选择 → 浮出「翻译」按钮 → 翻译卡片（可拖动，点外部关闭）
          └─ Alt+T（设置页里可改） → 直接翻译卡片

设置     ──  DSH 设置 → 左侧导航「划词翻译」→ appid / 密钥 / 快捷键 / 其它开关
```

## 功能

| 能力 | 说明 |
| --- | --- |
| 划词翻译 | 左键选中后，鼠标旁浮出小按钮，点击即在选区下方展开卡片 |
| 拖动卡片 | 按住卡片顶部（抓取手柄）拖到任意位置；拖完后卡片留在原地，重新翻译同一段文字也不会跳回去 |
| 点外部关闭 | 点卡片以外的任何地方即收起卡片与浮出按钮（Esc 同样关闭），不必去点右上角的 ✕ |
| 快捷键翻译 | 默认 `Alt+T`，选中文字后按一下直接出结果（不用点按钮） |
| 设置页 | DSH 设置面板里独立一页：填 APP ID / 密钥、**按一下组合键即可换绑快捷键**、开关浮出按钮与总开关、改默认目标语言 |
| 词典与音标 | 单词查询自动带 `dict=1`：英/美音标、词性释义分行展示 |
| 发音 | 卡片右上角喇叭朗读原文，译文行喇叭朗读译文（百度 TTS） |
| 复制 / 跳转 | 一键复制译文；一键在百度翻译网页版打开 |
| 语言切换 | 卡片顶部 ⇄ 按钮在「译成中文 / 译成英文」之间来回切换重译 |
| 自动识别 | 源语言 `auto`；目标语言默认按文本内容判断（中文→英文，其它→中文） |
| 深色适配 | 跟随 DSH 界面主题自动切换卡片配色，不跟随系统 |
| 无配置可用性 | 没配 appid 时点翻译会直接在卡片里弹出配置表单，填完立即翻译 |

## 安装

插件包就是本仓库根目录（Host 半 `lib/index.js` + 浏览器半 `client/client.js`，**无需构建**）。

把仓库克隆到任意目录，再按「从本地目录安装 bundle」登记进某个 profile（下面以 `desktop` 为例）：

| 位置 | 值 |
| --- | --- |
| `<profile>/package.json` → `dependencies` | `"dsh-translate": "link:<本仓库绝对路径>"` |
| 同文件 → `dsh.profile.bundles` | 末尾追加 `"dsh-translate"` |
| `<profile>/node_modules/dsh-translate` | 符号链接 → `<本仓库绝对路径>` |

`<profile>` 默认位于 `%USERPROFILE%\.dsh\profiles\desktop`。因为登记方式是 profile 依赖 + bundle 层（而不是 profile 的 `cordis.patch.yml`），宿主**不用手改 profile 的 package.json / cordis.patch.yml**：本包自己的 `cordis.patch.yml` 贡献那一行 `insert`。

重装/迁移（换一台机器或换个 profile）时：

```powershell
$repo    = "<本仓库绝对路径>"                                   # 例：<...>/DSH_Translation
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

# 让宿主自己装（推荐，等价于插件市场的「从本地目录安装 bundle」）
# 在 DSH 里对 Agent 说：用 plugin_manager 的 install_bundle，target = $repo
# 或手工建符号链接：
New-Item -ItemType Junction -Path "$profile\node_modules\dsh-translate" -Target $repo
# 然后把 "dsh-translate": "link:$repo" 加进 dependencies，
# 并把 "dsh-translate" 追加到 dsh.profile.bundles
```

安装成功时返回 `application: applied`、`warnings: []`，**免重启**：Host 半立刻在运行中的宿主上挂上路由，浏览器半的两个条目也已 active（`Slots.listSubTree` 里 `shell.overlay` 与 `settings.section` 都能看到 `registrant: dsh-translate, id: dsh-translate, order: 60, active: true`）。若界面里没出现划词按钮或设置页，刷新一次页面即可。

## 配置百度翻译

1. 打开 <https://fanyi-api.baidu.com/> → 控制台 → 「通用文本翻译」→ 创建应用，拿到 **APP ID** 与**密钥**（开发者密钥）。
2. 在 DSH 里打开 **设置 → 划词翻译**，把 APP ID 与密钥填进去，点**保存并测试**（会真发一条 `Hello, world!` 验证连通性）。也可以第一次划词时点「翻译」，直接在翻译卡片里填。
3. 保存位置：`$DSH_HOME/dsh-translate.json`（默认 `%USERPROFILE%\.dsh\dsh-translate.json`），权限仅当前用户可读。密钥不会被任何接口回传，`GET /dsh-translate/config` 只回 `hasSecret: true|false`，设置页里密钥框也只显示「已保存」占位。

也可以直接在 profile 的 `cordis.patch.yml` 里给这个条目加 `config`：

```yaml
- id: dsh-translate
  name: "dsh-translate"
  config:
    appId: "你的 APP ID"
    secretKey: "你的密钥"
    shortcut: "Alt+T"      # 快捷键
    defaultTarget: "auto"  # auto | zh | en | jp | kor | fra | de | ...
    showButton: true       # 关掉就只保留快捷键
    enabled: true          # 总开关
```

> `dsh-translate.json`（弹窗里保存的）优先级高于 `cordis.patch.yml` 的 `config`。

## 快捷键

默认 **`Alt+T`**（避开 DSH 内建绑定；DSH 的快捷键系统只占用 `Ctrl/Cmd+…`）。

**改键（推荐）**：设置 → 划词翻译 → 「翻译快捷键」那一行的输入框上点一下，框里变成「按下组合键…」，直接按你要的组合键即完成换绑——不用重启、不用刷新，卡片底部的快捷键提示也会立刻跟着变。

| 在那个框里按 | 结果 |
| --- | --- |
| `Ctrl+Alt+Q`、`Alt+Shift+D`、`Ctrl+Shift+T` … | 立即保存为新快捷键 |
| 只按修饰键（`Ctrl`、`Alt`…） | 预览（`Ctrl+…`），继续等主键 |
| `Backspace` / `Delete` | 恢复默认 `Alt+T` |
| `Esc` | 放弃录入，恢复原来的值 |
| 不含修饰键的键（如 `T`） | 拒绝保存，并提示「请至少包含一个修饰键」 |

也可以改文件（后备路径，重启后生效）：`$DSH_HOME/dsh-translate.json` 里的 `shortcut`，或 profile `cordis.patch.yml` 里该条目的 `config.shortcut`。

- 匹配逻辑：`Alt` / `Ctrl` / `Shift` / `Cmd` 修饰键必须**完全一致**，主键接受 `KeyT` 或 `T` 写法。
- `Esc` 关闭卡片。快捷键在输入框里同样可用（翻译的是输入框里选中的文字）。
- 快捷键不会抢设置页自己的按键：焦点在设置页里时这个热键自动让路。

## HTTP 接口（同源，仅本机可用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-translate/config` | 读当前设置（密钥只回 `hasSecret`） |
| `POST` | `/dsh-translate/config` | 写设置；`secretKey: ""` 表示「保持原密钥不变」 |
| `POST` | `/dsh-translate/translate` | `{ text, from?, to? }` → 归一化结果 |

所有路由都会先过同源闸门（`Sec-Fetch-Site: cross-site` 或 Origin 与 Host 不一致直接 403），并限制请求体大小与文本长度（6000 字符，百度单次上限）。

## 目录结构

```
dsh-translate/
├─ package.json        # dsh.client.platform=web + immediately:true + exports["./client"]，声明浏览器半
├─ cordis.patch.yml    # 贡献一个 loader 条目（纯 insert，无 config/!!js）
├─ lib/index.js        # Host 半：同源 HTTP 桥 + 百度签名 + 设置持久化
├─ client/client.js    # 浏览器半：选区监听、浮出按钮、翻译卡片 + 设置页（window.__ModuleLoader__ 工厂）
└─ test/
   ├─ host.test.mjs    # 48 项：mock 百度端点 + 假 cordis 上下文
   └─ client.test.mjs  # 135 项：自带迷你 DOM/React，驱动真实交互与设置页
```

浏览器半只用平台基线模块（`react`），所以 `dsh.client.external` 为空；`dsh.client.inject` 也不需要（它依赖的 `slots` 是宿主自带服务）。它注册两个 slot 条目：`shell.overlay`（浮出按钮 + 翻译卡片）和 `settings.section`（设置导航页，`order: 60`，排在 dshmarket 之后），因此不需要改任何布局 slot。`shell.overlay` 整层是点击穿透的，所以卡片自己 opt-in 指针事件：卡片没被拖过时位置跟着选区/快捷键锚点走，一旦按住顶部（`.dsht-grip` 手柄）拖过，位置就固定在拖到的像素上，只有换一段新文字才会重新锚定。划词卡片里保存的设置会通过内部 `settingsStore` 立即推给正在看的卡片——改完快捷键就能马上用，不必刷新。

## 本地验证

无需 appid、不联网即可跑通两半（Host 半 48 项、浏览器半 135 项）：

```powershell
# 用 DSH 自带运行时里的 node，或任意 Node 22+ —— 路径以本机为准
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node test/host.test.mjs      # 48 passed, 0 failed
& $node test/client.test.mjs    # 135 passed, 0 failed
```

- `test/host.test.mjs`：起一个 mock 百度端点（断言 `md5(appid+q+salt+key)` 签名与 `dict=1&tts=1` 参数），再用假的 cordis 上下文加载 `lib/index.js`，走一遍 `GET /config`、`POST /config`、`POST /translate`、错误码与 403 闸门。生产调用地址可用 `DSH_TRANSLATE_ENDPOINT` 覆盖（仅供测试）。
- `test/client.test.mjs`：本机没有 react / jsdom，于是脚本自带一个极小的 DOM 与 React 假实现（含会走虚拟子树的 `ref`，用来测卡片的拖动与「点外部关闭」判定），把 `client/client.js` 塞进 `node:vm` 执行（`window.__ModuleLoader__.load` 被替换成「立刻调用 factory」），然后驱动真实交互：mouseup 选区 → 浮出按钮 → 点按钮 → `fetch` `/dsh-translate/translate` → 断言卡片内容/定位/翻转、按住顶部拖动后卡片跟随指针且松手不消失、拖动不会误触发浮出按钮、换一段文字重新锚定、点卡片内部不关闭而点外部同时收起卡片与按钮、快捷键路径、Escape、复制、语言切换、深色主题类、未配置时的设置表单与保存后重译；设置页那一组则断言两个 slot 都注册、导航栏自读配置、APP ID/密钥保存与「保存并测试」、总开关/浮出按钮开关/默认目标语言、以及**换绑快捷键**的全套（只按修饰键的预览、裸键被拒、`Backspace` 恢复默认、`Esc` 放弃、保存即刻生效且热键互斥）与「焦点在设置页时热键让路」。

## 排错

| 现象 | 原因 |
| --- | --- |
| 卡片显示「尚未配置百度翻译 appid / 密钥」 | 还没填密钥；点卡片里的设置图标填写 |
| 错误码 `52003` | APP ID 错，或该应用没开通「通用文本翻译」 |
| 错误码 `54001` | 密钥填错（签名不匹配） |
| 错误码 `54003` / `54005` | 频率限制，稍后再试 |
| 错误码 `58000` | 百度侧配了 IP 白名单，或需要关闭 |
| 错误码 `58001` | 目标语言不支持该源语言 |
| 划词没有小按钮 | 设置里 `showButton` 关掉了；或选中的是编辑器/画布里的非文本内容 |
| 卡片挡住要看的内容 | 按住卡片顶部拖走，或点卡片外任意处 / 按 `Esc` 关掉 |
| 快捷键没反应 | 与系统或其它软件冲突；到 **设置 → 划词翻译** 里重新按一个组合键 |
| 设置里找不到「划词翻译」页 | 浏览器半还没加载：刷新一次页面；若仍没有，检查 `dsh.profile.bundles` 是否登记了 `dsh-translate` |
| 重启后 GUI 里没有反应 | `dsh.profile.bundles` 没登记，或 `node_modules\dsh-translate` 不存在（宿主日志会报 orphan bundle） |

## License

MIT
