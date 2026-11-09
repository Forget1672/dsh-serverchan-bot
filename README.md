# Server酱³ Bot 通道（DSH 插件）

把 DeepSeek Harness 和一个或多个 [Server酱³ Bot](https://sc3.ft07.com/bot) 接起来，形成双向通道：

- **下行**：Agent 通过 `serverchan_bot` 工具把消息推送到手机上的 Server酱³ App。
- **上行**：插件为每个 Bot 单独轮询 `getUpdates`，把你在 App 里发给它的文字作为提示词送进该 Bot 对应的 DSH 会话；该轮结束时，Agent 的最后一条文字回复自动发回聊天。
- **多 Bot**：每个 Bot 有自己的 Token、chat、会话和工作目录，可以分别连到不同 Session（甚至不同 Workspace）。

## 准备

1. 登录 <https://sc3.ft07.com/>，在 SendKey 页面记下 **uid**（就是 Bot 的 `chat_id`）。
2. 在 Server酱³ App（1.1.0+）里点右上角机器人图标，新建或编辑一个 Bot，复制 **Bot Token**。
   Token 形如 `123456:AA...`，只保存在本机配置里。

## 安装

插件仓库：<https://github.com/Forget1672/dsh-serverchan-bot>（`dsh.bundle` + `cordis.patch.yml`）。

从 GitHub 安装（推荐）：

```
plugin_manager  action=install_bundle  target=github:Forget1672/dsh-serverchan-bot
# 或 CLI：dsh plugin --profile web add github:Forget1672/dsh-serverchan-bot
```

从本目录（源码）安装：

```
plugin_manager  action=install_bundle  target=/home/mark/dsh-fish/serverchan-bot
```

安装后补丁行进入当前 profile，条目 id 为 `serverchan-bot`。未填 Token 时插件处于「已加载但未连接」状态：工具可用，调用会提示配置，不会轮询。

> 从早期本地包 `@local/serverchan-bot` 升级：先 `plugin_manager action=remove_bundle target=@local/serverchan-bot`，再按上面的方式安装。配置行 id（`serverchan-bot`）与会话 id 都不变，历史会话和 Token 保留。

## 图形化配置（设置页）

插件带一个原生设置页：**设置（侧栏齿轮）→ Server酱³ Bot**。

- 列出所有 Bot，可增删；每个 Bot 可填 Bot 名称、Token、chatId、允许的 chatId、接入方式（轮询 / Webhook）、
  Workspace、会话标题、sessionId、cwd，并单独开关“轮询上行 / 自动回复 / 推送模型主动消息 / 问题与批准卡片 / 显示正在思考”。
- 高级项折叠在卡片里：长轮询秒数、回复超时、单条字符上限、Bot API 地址。
- Webhook 模式下卡片会显示 **回调地址** 与 **Webhook 密钥**（均可复制），以及 **启动/停止 cloudflared 隧道** 按钮；
  隧道起来后自动填好公网回调地址，照抄到 App 的 Bot 编辑页即可。
- 每张卡片显示实时状态（@用户名、轮询中/未连接、已回复数、绑定的会话、最近错误、最近失败的发送），
  并可**发送测试消息**；被其他实例锁定时也会显示占用者 pid。
- 保存走 Host 的 `configEditor`，写在 profile 的 `cordis.patch.yml` 里；保存后插件自动重启并立即生效。
- Token 是只写字段：页面只知道“已设置/未设置”和末 4 位，不会回显完整内容；留空保存表示保持原值。
  改名 Bot 会丢失已存的 Token，需要重新填写。
- 页面通过 `/__sc3bot/state|config|test` 三个本机路由读写，路由要求浏览器里注入的一次性 secret 请求头，
  其他网页拿不到。

设置页保存的是 `bots:` 形式；如果你原本用单 Bot 写法，第一次保存后会自动改写成 `bots: [{ id: "default", ... }]`，
**会话 id 仍是 `session-sc3bot-<chatId>`**，历史会话不会丢。

也可以继续直接改 YAML（两种写法都支持，**`bots` 非空时以它为准**，顶层的 `token`/`chatId`/`allowChatIds`/`sessionId` 会被忽略）。

### 单个 Bot（旧写法，继续有效）

```yaml
- id: serverchan-bot
  name: "dsh-serverchan-bot"
  config:
    token: "123456:AA..."   # 也可用 SERVERCHAN_BOT_TOKEN
    chatId: "1234567"       # 你的 uid，也可用 SERVERCHAN_BOT_CHAT_ID
    workspaceId: "d85960f4-79d3-43df-8978-b3db212be50b"   # 可选：挂在哪个 Workspace
```

### 多个 Bot（每个 Bot 一个会话）

```yaml
- id: serverchan-bot
  name: "dsh-serverchan-bot"
  config:
    typing: true                    # 顶层字段作为各 bot 的默认值
    pollTimeoutSeconds: 20
    workspaceId: "d85960f4-79d3-43df-8978-b3db212be50b"   # 各 bot 默认都挂这里
    bots:
      - id: work                    # 工具里用 bot: "work" 指定
        token: "111111:AAA..."
        chatId: "5755"              # 工作号 uid
        sessionId: "session-work"   # 固定会话：这个 bot 的所有聊天都进这里
      - id: home
        token: "222222:BBB..."
        chatId: "6600"              # 家庭号 uid
        # 不写 sessionId：按聊天自动建会话 session-sc3bot-home-6600
      - id: alerts                  # 只推送、不收消息也可以
        token: "333333:CCC..."
        chatId: "7001"
        autoReply: false
        sessionTitle: "告警通道"
```

### 字段

| 字段 | 说明 |
|---|---|
| `token` | Bot Token。留空只注册工具、不连网。 |
| `chatId` | 默认推送目标，同时进入允许列表。 |
| `allowChatIds` | 允许驱动 Agent 的聊天。为空时**首个**给该 Bot 发消息的聊天会被配对（trust on first use）并打警告日志。 |
| `sessionId` | 固定会话：该 Bot 的所有聊天都进这个会话。不写则按聊天自动建会话。 |
| `sessionTitle` | 新建会话的标题，默认单 Bot 是「Server酱³ Bot」，多 Bot 是「Server酱³ Bot (id)」。 |
| `workspaceId` | 新建会话挂在哪个 Workspace（UUID，见下）。子项可覆盖顶层。 |
| `cwd` | 没有 `workspaceId` 时的工作目录；两者都不填用默认目录。 |
| `poll` / `autoReply` | 关掉 `poll` 不再读上行；关掉 `autoReply` 时上行只进收件箱、不自动回复。 |
| `mode` | `poll`（默认）或 `webhook`。Webhook 模式不再轮询，由 Server酱³ 主动回调本机。 |
| `webhookSecret` | Webhook 密钥；留空时由 Token 派生（设置页会显示实际值）。 |
| `push` | 把 bot 会话里**每一轮**的输出都推到聊天，包括定时任务、其他插件或 Web UI 触发的回合（默认开）。 |
| `questions` | 把会话里的问题卡片和批准卡片转到聊天，并用聊天回复作答（默认开）。 |
| `cardDelayMs` | 网页卡片的出现延迟，默认 8000。0 = 立刻在网页显示（见下方「已知限制」）。 |
| `typing` | 处理期间在 App 里显示「正在思考」。 |
| `pollTimeoutSeconds` | 长轮询秒数（0–30，默认 20）。 |
| `replyTimeoutMs` | 一轮跑太久时发「仍在处理」提示的阈值，默认 180000。 |
| `questionTimeoutMs` | 问题/批准在聊天里等待回答的上限，默认 600000；超时后转回网页卡片。 |
| `maxReplyChars` | 单条消息截断长度，默认 8000。 |
| `baseUrl` | Bot API 根地址，默认 `https://bot-go.apijia.cn`；仅自建或本地 mock 时需要改。 |
| `bots[]` | 多 Bot 列表；每项支持上面除 `bots` 外的全部字段。 |

环境变量 `SERVERCHAN_BOT_TOKEN`、`SERVERCHAN_BOT_CHAT_ID` 只用于**单 Bot 写法**，多 Bot 时请逐项写 Token。

约束（违反时插件加载失败并给出原因）：

- `bots[].id` 不能重复（不区分大小写）。
- 不同 Bot 不能共用同一个 Token：两个轮询器会把每条消息各答一次。

## 会话与 Workspace

| 情况 | 会话 id |
|---|---|
| 单 Bot | `session-sc3bot-<chat_id>` |
| 多 Bot、未设 `sessionId` | `session-sc3bot-<bot_id>-<chat_id>` |
| 任意、设了 `sessionId` | 就是该值 |

`workspaceId` 是 Workspace 的主键 UUID（不是路径、不是标题）。查法：读 `~/.dsh/storages/workspace.json`，`global.workspaceIds` 是顺序，`tables.workspaces.<id>` 里有 `path`/`title`。填错会让这条上行消息失败（`workspace/not-found`，日志可见）。`workspaceId` 与 `cwd` 同时给出时以后者为准的写法不存在——`workspaceId` 优先。

bot 会话按 `cwd`/`workspaceId` 落在 Workspace 里；它额外注入一段提示词，要求 Agent 用适合手机阅读的方式作答，并且不要重复调用 `serverchan_bot` 发送回复。

## 使用

工具 `serverchan_bot`：

- `send`：`{ action: "send", text: "构建完成 ✅", bot?: "work", chatId?: "5755", silent?: false }`。
  单 Bot 时 `bot` 可省略；多 Bot 时必须指定，`chatId` 默认取该 Bot 的配置。
- `inbox`：`{ action: "inbox", bot?: "home", limit: 20, drain: true }` 读取 Bot 收到的上行消息（含未获允许的聊天），条目带 `bot` 字段。
- `status`：每个 Bot 的身份、轮询状态、绑定会话、允许列表、最近错误；`accounts[]` 列表，单 Bot 时同时平铺在顶层。

上行流程：App 发消息 → 该 Bot 的轮询取到更新 → 作为提示词进入它的会话 → Agent 跑完这一轮 → 该轮最后一条文字回复发回该聊天。期间显示「正在思考」。

### 主动消息也会推送

推送不再只发生在「你在 App 里发消息」之后：插件监听 bot 会话的回合事件，**任何来源**的回合在 `turn/end` 时都会把该轮最后一条文字回复发到聊天，包括：

- 定时任务（`schedule_create` 等）投递到该会话的回合；
- 其他插件/子代理向该会话 `followup` 的内容；
- 你在 Web UI 里对该会话说的话。

`push: false` 可以关掉这条路径（此时只有问题卡片和批准卡片还会到聊天）。回合进行中显示「正在思考」；超过 `replyTimeoutMs` 会先提示「仍在处理」，回合结束时仍会推送结果；回合出错会推送错误摘要。

### 问题卡片与批准卡片

会话里出现 `ask_user_question` 的问题卡片或工具批准卡片时，插件会把卡片内容转到聊天，并在聊天里等你的回答——**不会**在网页上再弹一张卡（插件在回答链最前面截获请求）：

- 问题卡片：按「1. / 2.」回复序号，或直接回复选项文字；多选用逗号分隔；没有选项时回复文字即作为自定义答案。多问题会逐条询问。
- 批准卡片：回复「允许」或「拒绝」。允许只对这一次生效（`allowed-once`），聊天里的回答不会改变会话的批准策略。
- 超过 `questionTimeoutMs` 没回答，会提示一句并把问题转回 DSH 网页上的卡片，之后仍可在网页作答。

`questions: false` 可以关掉这个转交，卡片回到只在网页上应答。

## Webhook 模式与 cloudflared 隧道

默认用轮询，进程重启时最多重放最后一批未确认更新。想做到近零延迟、也不重放，可以切到 Webhook：

1. 设置页把某个 Bot 的「接入方式」改成 **Webhook（公网回调）** 并保存。
2. 卡片里点「启动 cloudflared 隧道」——插件会执行 `cloudflared tunnel --url http://127.0.0.1:<端口> --no-autoupdate`，把分配到的 `https://xxx.trycloudflare.com` 回调地址显示出来（约 2–10 秒）。
3. 复制卡片上的 **回调地址**（`https://xxx.trycloudflare.com/__sc3bot/webhook`）和 **Webhook 密钥**，填进 Server酱³ App 的 Bot 编辑页并保存。
4. 之后用户消息由 Server酱³ 直接 POST 到该地址，插件校验 `X-Sc3Bot-Webhook-Secret` 后走与轮询相同的入站流程。

注意事项：

- 隧道是**进程内**的：插件重启或 Harness 退出即断开；重启后 quick tunnel 域名会变，需要重新填一次 App（或改用固定域名的 cloudflared named tunnel，把 `--url` 换成你的 hostname 即可）。
- 需要本机安装 `cloudflared`（当前环境为 2026.10.7）。没装时卡片会显示「cloudflared is not installed」，此时可以手动执行：
  ```bash
  cloudflared tunnel --url http://127.0.0.1:3080 --no-autoupdate
  ```
  然后同样把回调地址和密钥填进 App。
- 同一 Token 只允许一个实例接管（下面的单实例锁）；被锁定的实例返回 `ignored: locked`。
- 关掉隧道后 App 里的回调会失败，建议同时把接入方式切回轮询。

## 聊天命令

在聊天里直接发这些命令（不走模型）：

| 命令 | 作用 |
|---|---|
| `/stop` | 停止该会话当前回合（`sessionController.cancel`） |
| `/new` | 为这个聊天开一个新会话（旧会话保留） |
| `/status` | 回复 Bot、接入方式、绑定会话、偏移、收件箱、最近错误 |
| `/help` | 命令列表 |

## 可靠性与状态

- **状态持久化**：轮询偏移、已确认的 update id、chat↔session 绑定、每个会话最后推送的事件序号，写在 `<profile>/data/serverchan-bot/state.json`（0600）。重启不会重放已确认更新，也不会把已经推过的回合再推一遍。
- **单实例锁**：每个 Token 对应 `<profile>/data/serverchan-bot/locks/<hash>.lock`（记录 pid）。第二个实例不会轮询、也不会接收 Webhook，设置页与 `/status` 会显示被哪个 pid 占用；持有者退出后自动接管。
- **重启补推**：启动时扫描已绑定会话在 `pushed` 序号之后的事件，如果发现有已结束但没推送的回合，会补推一次。
- **发送重试与分片**：单条超过 `maxReplyChars` 会按段落/换行拆成多条（最多 8 条）；发送失败重试 3 次（0.3s/0.9s），仍失败则记入状态页的「最近失败」。
- **卡片时序**：聊天消息立刻发出；网页卡片在 `cardDelayMs`（默认 8 秒）后才出现。8 秒内手机先答，网页从头到尾不会弹卡，也就不会有残留。卡片出现后两端仍可作答，任意一端先答生效；网页先答会通知聊天。`questionTimeoutMs` 到点只发一条「两边都还能答」的提示。

### 已知限制：网页卡片无法由 Host 撤回

网页端的问题卡片和批准弹窗由**浏览器插件自己**的待答对象管理：它只在「本端作答」「请求 signal 中止」「插件卸载」三种情况下关闭。Host 侧没有任何 API 能让浏览器撤回一张已经弹出的卡片，所以只要网页卡片已经出现、而你先在手机上作答，那张卡就会留在网页上（点它不会有副作用：请求已经结算，点击结果会被丢弃）。

因此默认策略是「延迟出卡」：

- `cardDelayMs: 8000`（默认）：手机先答 → 网页不弹卡；手机 8 秒没动静 → 网页弹卡，之后任一端可答。
- `cardDelayMs: 0`：恢复「立刻双端同时显示」，代价就是上面说的残留。
- 也可以在网页上手动点掉残留卡片（允许/拒绝或关闭），或把 `questions` 关掉改为纯网页应答。

## 接口与实现

- 下行：`POST https://bot-go.apijia.cn/bot<TOKEN>/sendMessage`，字段 `chat_id`、`text`、`parse_mode`（默认 `markdown`）、`silent`。
- 状态：`POST .../sendChatAction`，`action: "typing"`。
- 上行：`GET .../getUpdates?timeout=<秒>&offset=<update_id>`，按 `update_id` 递增确认，已确认的不会重复投递。
- `getMe` 用于校验 Token。

代码结构：

- `index.js`：插件主体（多 Bot 链接、工具、轮询、会话桥接、提示词段落）。
- `api.js`：Bot API 客户端（超时、错误信封、long-poll）。
- `client.js`：设置页（`settings.section` 槽 + 单色导航图标），带 zh/en 词典与主题令牌样式。
- `icon.svg`：插件清单与市场卡片共用的彩色图标（交付源文件）；`assets/icon-180.png` 是市场卡片位图，由 `scripts/render-icon.mjs` 从该 SVG 渲染。
- `test/bridge.test.mjs`：不联网的冒烟测试，伪造 Bot API 与 Host 服务，覆盖单 Bot、多 Bot、允许列表、首聊配对、未配置、重复 Token、提示词注入、主动回合推送、问题/批准双端应答、聊天命令、Webhook 入站、状态持久化与单实例锁、重启补推，以及设置页 API（鉴权、脱敏、保存、测试消息）。

```
node test/bridge.test.mjs
```

## 注意

- 能向 Bot 发消息的人就能驱动对应会话里的 Agent。请给每个 Bot 设置 `chatId` 或 `allowChatIds` 收紧范围，并保管好 Token。
- 采用轮询（不依赖公网 Webhook）。进程重启时，每个 Bot 最多把最后一批未确认的更新再处理一次。
- 上行只处理文字消息；图片、语音等会被忽略并记日志。
- 归档的 bot 会话在收到新消息时会**自动取消归档**并继续回答（日志有记录）；想彻底静音请关掉该 bot 的 `poll`，或设 `autoReply: false`，或直接删除该 bot 配置。

## 卸载

```
plugin_manager  action=remove_bundle  target=dsh-serverchan-bot
```

bot 会话本身是普通 DSH 会话，卸载插件后仍可在 Web UI 中打开、归档或删除。
