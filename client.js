window.__ModuleLoader__.load({
  id: 'dsh-serverchan-bot',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'serverchanBot'
    const SECTION_ID = 'serverchan-bot'
    const SECTION_ORDER = 60

    const CSS = `
.sc3-root{display:flex;flex-direction:column;gap:14px;width:100%;max-width:780px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.sc3-head{display:flex;flex-direction:column;gap:4px}
.sc3-title{margin:0;font-size:16px;font-weight:600;line-height:24px}
.sc3-lead{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.sc3-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sc3-notice{margin:0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.sc3-noticeError{color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.sc3-noticeOk{color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}
.sc3-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.sc3-card[data-open="true"]{border-color:var(--dsw-alias-border-l2)}
.sc3-cardHead{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sc3-cardHead:hover{background:var(--dsw-alias-bg-layer-2)}
.sc3-cardHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.sc3-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.sc3-dotOk{background:var(--dsw-alias-state-success-primary)}
.sc3-dotWarn{background:var(--dsw-alias-state-warn-primary)}
.sc3-dotError{background:var(--dsw-alias-state-error-primary)}
.sc3-cardTitle{flex:none;font-size:14px;font-weight:500;line-height:20px;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc3-cardSub{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc3-chevron{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc3-cardBody{display:flex;flex-direction:column;gap:12px;padding:0 14px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc3-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding-top:12px}
@media (max-width:640px){.sc3-grid{grid-template-columns:minmax(0,1fr)}}
.sc3-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.sc3-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sc3-input,.sc3-select{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.sc3-input:focus-visible,.sc3-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.sc3-input:disabled{opacity:.6}
.sc3-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.sc3-toggles{display:flex;flex-wrap:wrap;gap:14px}
.sc3-switch{display:inline-flex;align-items:center;gap:8px;padding:0;border:0;background:0 0;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.sc3-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:999px}
.sc3-track{position:relative;display:inline-block;width:32px;height:18px;border-radius:999px;background:var(--dsw-alias-state-idle-primary);transition:background .15s ease}
.sc3-track[data-on="true"]{background:var(--dsw-alias-state-success-primary)}
.sc3-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
.sc3-track[data-on="true"] .sc3-knob{transform:translateX(14px)}
.sc3-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sc3-rowEnd{margin-left:auto}
.sc3-btn{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.sc3-btn:hover{background:var(--dsw-alias-bg-overlay)}
.sc3-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sc3-btn:disabled{opacity:.5;cursor:default}
.sc3-btnPrimary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.sc3-btnDanger{color:var(--dsw-alias-state-error-primary)}
.sc3-advanced{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:10px}
.sc3-advanced summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc3-advancedBody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding-top:10px}
@media (max-width:640px){.sc3-advancedBody{grid-template-columns:minmax(0,1fr)}}
.sc3-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:2px}
.sc3-spacer{flex:1}
.sc3-sessionList{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc3-mono{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace)}
.sc3-copyRow{display:flex;align-items:center;gap:8px}
.sc3-copyRow .sc3-input{flex:1;min-width:0}
.sc3-webhook{display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:12px}
`

    const ZH = {
      'nav.label': 'Server酱³ Bot',
      'page.title': 'Server酱³ Bot 通道',
      'page.lead': '在这里添加 Bot、填写 Token 和 chatId，并选择每个 Bot 使用的会话与工作区。保存后插件会自动重启并立即生效。',
      'page.loading': '正在读取配置…',
      'page.retry': '重试',
      'page.save': '保存',
      'page.saving': '保存中…',
      'page.saved': '已保存，插件已重启，正在重新读取状态…',
      'page.reload': '重新读取',
      'page.add': '添加 Bot',
      'page.empty': '还没有配置任何 Bot。点“添加 Bot”开始。',
      'page.noSave': '当前 profile 不能持久化插件配置，只能在 cordis.patch.yml 里修改。',
      'page.tokenNote': 'Token 只保存在本机 profile 配置里，页面只会显示它是否已设置，不会回显内容。',
      'bot.id': 'Bot 名称（工具里用它指定）',
      'bot.idHint': '改名后需要重新填写 Token。',
      'bot.token': 'Bot Token',
      'bot.tokenSet': '已设置，留空保持不变',
      'bot.tokenEmpty': '从 App 的 Bot 编辑页复制',
      'bot.chatId': 'chatId（你的 uid）',
      'bot.chatIdHint': '主动推送的目标，同时进入允许列表。',
      'bot.allow': '允许的 chatId',
      'bot.allowHint': '逗号分隔；留空则首个发消息的聊天自动配对。',
      'bot.mode': '接入方式',
      'bot.modePoll': '轮询 getUpdates',
      'bot.modeWebhook': 'Webhook（公网回调）',
      'bot.modeHint': 'Webhook 需要公网地址，可用下面的 cloudflared 隧道。',
      'bot.webhookTitle': 'Webhook',
      'bot.webhookSecret': 'Webhook 密钥',
      'bot.webhookCopy': '复制',
      'bot.webhookCopied': '已复制',
      'bot.webhookUrl': '回调地址',
      'bot.webhookNotReady': '隧道未运行',
      'bot.tunnelStart': '启动 cloudflared 隧道',
      'bot.tunnelStop': '停止隧道',
      'bot.tunnelRunning': '隧道运行中',
      'bot.tunnelStarting': '正在启动隧道…',
      'bot.tunnelHint': '把「回调地址」和「Webhook 密钥」填进 Server酱³ App 的 Bot 编辑页并保存即可。',
      'bot.commandsHint': '聊天命令：/stop 停止当前回合 · /new 开启新会话 · /status 查看状态 · /help',
      'bot.workspace': 'Workspace',
      'bot.workspaceDefault': '默认目录（不指定）',
      'bot.sessionTitle': '会话标题',
      'bot.sessionId': '会话 id（可选）',
      'bot.sessionIdHint': '留空按 chatId 自动建会话。',
      'bot.cwd': '工作目录（可选）',
      'bot.poll': '轮询上行',
      'bot.autoReply': '自动回复',
      'bot.push': '推送模型主动消息',
      'bot.questions': '问题/批准卡片转到聊天',
      'bot.typing': '显示“正在思考”',
      'bot.test': '发送测试消息',
      'bot.testing': '发送中…',
      'bot.sent': '测试消息已发送',
      'bot.remove': '删除',
      'bot.removeConfirm': '删除这个 Bot 配置？（不影响已存在的会话）',
      'bot.advanced': '高级',
      'bot.pollTimeout': '长轮询秒数（0–30）',
      'bot.replyTimeout': '仍在处理提示（毫秒）',
      'bot.questionTimeout': '问题等待超时（毫秒）',
      'bot.cardDelay': '网页卡片延迟（毫秒）',
      'bot.cardDelayHint': '0 = 立即在网页显示（手机先答会留下无法关闭的卡片）；默认 8 秒内手机先答则网页不弹卡。',
      'bot.maxChars': '单条最大字符数',
      'bot.baseUrl': 'Bot API 地址',
      'status.connected': '已连接',
      'status.polling': '轮询中',
      'status.stopped': '未轮询',
      'status.noToken': '未填写 Token',
      'status.error': '错误',
      'status.replies': '已回复',
      'status.inbox': '收件箱',
      'status.servers': '会话',
      'status.lastError': '最近错误',
      'error.generic': '操作失败',
      'error.api': '页面没有拿到插件 API，请刷新页面。',
    }

    const EN = {
      'nav.label': 'Server酱³ Bot',
      'page.title': 'Server酱³ Bot bridge',
      'page.lead': 'Add bots, enter their Token and chat id, and pick the session and workspace each one uses. Saving restarts the plugin and applies immediately.',
      'page.loading': 'Reading configuration…',
      'page.retry': 'Retry',
      'page.save': 'Save',
      'page.saving': 'Saving…',
      'page.saved': 'Saved. The plugin restarted; reloading status…',
      'page.reload': 'Reload',
      'page.add': 'Add bot',
      'page.empty': 'No bot configured yet. Use “Add bot” to start.',
      'page.noSave': 'This profile cannot persist plugin configuration; edit cordis.patch.yml instead.',
      'page.tokenNote': 'Tokens stay in this machine\'s profile configuration; the page only reports whether one is set.',
      'bot.id': 'Bot id (used by the tool)',
      'bot.idHint': 'Renaming requires entering the Token again.',
      'bot.token': 'Bot Token',
      'bot.tokenSet': 'Set — leave blank to keep it',
      'bot.tokenEmpty': 'Copy it from the app\'s Bot editor',
      'bot.chatId': 'chatId (your uid)',
      'bot.chatIdHint': 'Default push target, also added to the allowlist.',
      'bot.allow': 'Allowed chat ids',
      'bot.allowHint': 'Comma separated; empty pairs with the first chat that writes.',
      'bot.mode': 'Inbound mode',
      'bot.modePoll': 'Poll getUpdates',
      'bot.modeWebhook': 'Webhook (public callback)',
      'bot.modeHint': 'Webhook needs a public URL; the cloudflared tunnel below provides one.',
      'bot.webhookTitle': 'Webhook',
      'bot.webhookSecret': 'Webhook secret',
      'bot.webhookCopy': 'Copy',
      'bot.webhookCopied': 'Copied',
      'bot.webhookUrl': 'Callback URL',
      'bot.webhookNotReady': 'Tunnel is not running',
      'bot.tunnelStart': 'Start cloudflared tunnel',
      'bot.tunnelStop': 'Stop tunnel',
      'bot.tunnelRunning': 'Tunnel running',
      'bot.tunnelStarting': 'Starting the tunnel…',
      'bot.tunnelHint': 'Paste the callback URL and webhook secret into the Server酱³ app Bot editor and save.',
      'bot.commandsHint': 'Chat commands: /stop cancels the turn · /new starts a session · /status shows state · /help',
      'bot.workspace': 'Workspace',
      'bot.workspaceDefault': 'Default directory (none)',
      'bot.sessionTitle': 'Session title',
      'bot.sessionId': 'Session id (optional)',
      'bot.sessionIdHint': 'Blank derives one from the chat id.',
      'bot.cwd': 'Working directory (optional)',
      'bot.poll': 'Poll inbound',
      'bot.autoReply': 'Auto reply',
      'bot.push': 'Push model-initiated output',
      'bot.questions': 'Forward question and approval cards',
      'bot.typing': 'Show “typing”',
      'bot.test': 'Send test message',
      'bot.testing': 'Sending…',
      'bot.sent': 'Test message sent',
      'bot.remove': 'Remove',
      'bot.removeConfirm': 'Remove this bot configuration? Existing sessions are kept.',
      'bot.advanced': 'Advanced',
      'bot.pollTimeout': 'Long-poll seconds (0–30)',
      'bot.replyTimeout': 'Still-working notice (ms)',
      'bot.questionTimeout': 'Question wait timeout (ms)',
      'bot.cardDelay': 'Web card delay (ms)',
      'bot.cardDelayHint': '0 = show the card immediately (a phone answer then leaves a card the host cannot close); by default the card appears only if the phone is silent for 8s.',
      'bot.maxChars': 'Max characters per message',
      'bot.baseUrl': 'Bot API base URL',
      'status.connected': 'Connected',
      'status.polling': 'Polling',
      'status.stopped': 'Not polling',
      'status.noToken': 'No token',
      'status.error': 'Error',
      'status.replies': 'Replies',
      'status.inbox': 'Inbox',
      'status.servers': 'Sessions',
      'status.lastError': 'Last error',
      'error.generic': 'The operation failed',
      'error.api': 'The page could not reach the plugin API. Refresh the page.',
    }

    function errorText(error) {
      if (error instanceof Error && error.message !== '') return error.message
      return String(error)
    }

    function boot() {
      const value = window.__DSH_SC3BOT__
      if (value === undefined || value === null || typeof value.api !== 'string' || typeof value.secret !== 'string') {
        throw new Error('api')
      }
      return value
    }

    async function request(method, suffix, body) {
      const value = boot()
      const response = await fetch(`${value.api}/${suffix}`, {
        method,
        headers: {
          'x-sc3bot-secret': value.secret,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload.data
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    function splitList(text) {
      return String(text ?? '')
        .split(/[,，\s]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
    }

    function numberOr(value, fallback) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
    }

    function toDraft(bot) {
      return {
        ...bot,
        token: '',
        tokenSet: bot.tokenSet === true,
        allowChatText: Array.isArray(bot.allowChatIds) ? bot.allowChatIds.join(', ') : '',
      }
    }

    function toPayload(bot) {
      return {
        id: bot.id,
        ...(bot.token === '' ? {} : { token: bot.token }),
        chatId: bot.chatId,
        allowChatIds: splitList(bot.allowChatText),
        sessionId: bot.sessionId,
        sessionTitle: bot.sessionTitle,
        workspaceId: bot.workspaceId,
        cwd: bot.cwd,
        baseUrl: bot.baseUrl,
        poll: bot.poll === true,
        mode: bot.mode === 'webhook' ? 'webhook' : 'poll',
        webhookSecret: bot.webhookSecret ?? '',
        autoReply: bot.autoReply === true,
        push: bot.push === true,
        questions: bot.questions === true,
        typing: bot.typing === true,
        pollTimeoutSeconds: numberOr(bot.pollTimeoutSeconds, 20),
        replyTimeoutMs: numberOr(bot.replyTimeoutMs, 180000),
        questionTimeoutMs: numberOr(bot.questionTimeoutMs, 600000),
        cardDelayMs: numberOr(bot.cardDelayMs, 8000),
        maxReplyChars: numberOr(bot.maxReplyChars, 8000),
      }
    }

    function statusTone(status) {
      if (status === undefined || status === null) return 'idle'
      if (status.configured !== true) return 'idle'
      if (status.lastError !== null && status.lastError !== undefined) return 'error'
      if (status.polling === true) return 'ok'
      return 'warn'
    }

    function summaryText(bot, status, t) {
      const parts = []
      if (status.configured !== true) parts.push(t('status.noToken'))
      else {
        if (status.bot?.username !== undefined) parts.push(`@${status.bot.username}`)
        else parts.push(t('status.connected'))
        parts.push(status.polling === true ? t('status.polling') : t('status.stopped'))
      }
      if (bot.chatId === '') parts.push('chatId —')
      else parts.push(`chatId ${bot.chatId}`)
      if (typeof status.replies === 'number' && status.replies > 0) parts.push(`${t('status.replies')} ${status.replies}`)
      return parts.join(' · ')
    }

    function Field(props) {
      return h('div', { className: 'sc3-field' },
        h('label', { className: 'sc3-label', htmlFor: props.id }, props.label),
        props.children,
        props.hint === undefined ? null : h('p', { className: 'sc3-hint' }, props.hint),
      )
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'sc3-switch',
        role: 'switch',
        'aria-checked': props.checked === true ? 'true' : 'false',
        disabled: props.disabled === true,
        onClick: () => props.onChange(props.checked !== true),
      },
        h('span', { className: 'sc3-track', 'data-on': props.checked === true ? 'true' : 'false' },
          h('span', { className: 'sc3-knob' })),
        h('span', null, props.label),
      )
    }

    function BotCard(props) {
      const { bot, index, t, workspaces, open, busy } = props
      const status = bot.status ?? {}
      const tunnel = bot.tunnel ?? {}
      const [copied, setCopied] = React.useState(false)
      const copy = async (value) => {
        try {
          await navigator.clipboard.writeText(String(value ?? ''))
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          setCopied(false)
        }
      }
      const tone = statusTone(status)
      const prefix = `sc3-${index}`
      const update = (patch) => props.onChange(patch)

      const field = (key, label, hint, child) => h(Field, { id: `${prefix}-${key}`, label, hint }, child)
      const input = (key, value, onChange, extra = {}) => h('input', {
        id: `${prefix}-${key}`,
        className: 'sc3-input',
        value: value ?? '',
        onChange: (event) => onChange(event.target.value),
        ...extra,
      })

      const workspaceOptions = [
        h('option', { key: 'none', value: '' }, t('bot.workspaceDefault')),
        ...workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, `${workspace.title} — ${workspace.path}`)),
      ]

      return h('section', { className: 'sc3-card', 'data-open': open ? 'true' : 'false' },
        h('button', {
          type: 'button',
          className: 'sc3-cardHead',
          'aria-expanded': open ? 'true' : 'false',
          onClick: props.onToggle,
        },
          h('span', { className: `sc3-dot sc3-dot${tone === 'ok' ? 'Ok' : tone === 'warn' ? 'Warn' : tone === 'error' ? 'Error' : 'Idle'}` }),
          h('span', { className: 'sc3-cardTitle' }, bot.id === '' ? t('page.add') : bot.id),
          h('span', { className: 'sc3-cardSub' }, summaryText(bot, status, t)),
          h('span', { className: 'sc3-chevron', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
        ),
        open ? h('div', { className: 'sc3-cardBody' },
          h('div', { className: 'sc3-grid' },
            field('id', t('bot.id'), t('bot.idHint'), input('id', bot.id, (value) => update({ id: value }))),
            field('token', t('bot.token'), status.configured ? t('bot.tokenSet') : t('bot.tokenEmpty'),
              input('token', bot.token, (value) => update({ token: value, tokenSet: value !== '' || bot.tokenSet }), {
                type: 'password',
                autoComplete: 'off',
                placeholder: status.configured ? t('bot.tokenSet') : t('bot.tokenEmpty'),
              })),
            field('chatId', t('bot.chatId'), t('bot.chatIdHint'), input('chatId', bot.chatId, (value) => update({ chatId: value }))),
            field('allow', t('bot.allow'), t('bot.allowHint'), input('allow', bot.allowChatText, (value) => update({ allowChatText: value }))),
            field('mode', t('bot.mode'), t('bot.modeHint'),
              h('select', {
                id: `${prefix}-mode`,
                className: 'sc3-select',
                value: bot.mode === 'webhook' ? 'webhook' : 'poll',
                onChange: (event) => update({ mode: event.target.value }),
              },
                h('option', { value: 'poll' }, t('bot.modePoll')),
                h('option', { value: 'webhook' }, t('bot.modeWebhook')),
              )),
            field('workspace', t('bot.workspace'), undefined,
              h('select', {
                id: `${prefix}-workspace`,
                className: 'sc3-select',
                value: bot.workspaceId ?? '',
                onChange: (event) => update({ workspaceId: event.target.value }),
              }, workspaceOptions)),
            field('sessionTitle', t('bot.sessionTitle'), undefined, input('sessionTitle', bot.sessionTitle, (value) => update({ sessionTitle: value }))),
            field('sessionId', t('bot.sessionId'), t('bot.sessionIdHint'), input('sessionId', bot.sessionId, (value) => update({ sessionId: value }))),
            field('cwd', t('bot.cwd'), undefined, input('cwd', bot.cwd, (value) => update({ cwd: value }))),
          ),
          h('div', { className: 'sc3-toggles' },
            h(Switch, { label: t('bot.poll'), checked: bot.poll === true, onChange: (value) => update({ poll: value }) }),
            h(Switch, { label: t('bot.autoReply'), checked: bot.autoReply === true, onChange: (value) => update({ autoReply: value }) }),
            h(Switch, { label: t('bot.push'), checked: bot.push === true, onChange: (value) => update({ push: value }) }),
            h(Switch, { label: t('bot.questions'), checked: bot.questions === true, onChange: (value) => update({ questions: value }) }),
            h(Switch, { label: t('bot.typing'), checked: bot.typing === true, onChange: (value) => update({ typing: value }) }),
          ),
          bot.mode === 'webhook'
            ? h('div', { className: 'sc3-webhook' },
              h('p', { className: 'sc3-label' }, t('bot.webhookTitle')),
              h('div', { className: 'sc3-field' },
                h('label', { className: 'sc3-label', htmlFor: `${prefix}-webhook-secret` }, t('bot.webhookSecret')),
                h('div', { className: 'sc3-copyRow' },
                  h('input', { id: `${prefix}-webhook-secret`, className: 'sc3-input sc3-mono', readOnly: true, value: bot.webhookSecret ?? '' }),
                  h('button', { type: 'button', className: 'sc3-btn', onClick: () => void copy(bot.webhookSecret ?? '') }, copied ? t('bot.webhookCopied') : t('bot.webhookCopy')),
                ),
              ),
              h('div', { className: 'sc3-field' },
                h('label', { className: 'sc3-label', htmlFor: `${prefix}-webhook-url` }, t('bot.webhookUrl')),
                h('div', { className: 'sc3-copyRow' },
                  h('input', {
                    id: `${prefix}-webhook-url`,
                    className: 'sc3-input sc3-mono',
                    readOnly: true,
                    value: tunnel.webhookUrl ?? t('bot.webhookNotReady'),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'sc3-btn',
                    disabled: tunnel.webhookUrl === null || tunnel.webhookUrl === undefined,
                    onClick: () => void copy(tunnel.webhookUrl ?? ''),
                  }, t('bot.webhookCopy')),
                ),
              ),
              h('div', { className: 'sc3-row' },
                h('button', {
                  type: 'button',
                  className: 'sc3-btn',
                  disabled: busy || tunnel.running === true,
                  onClick: () => props.onTunnel('start'),
                }, tunnel.running === true ? t('bot.tunnelRunning') : t('bot.tunnelStart')),
                h('button', {
                  type: 'button',
                  className: 'sc3-btn',
                  disabled: busy || tunnel.running !== true,
                  onClick: () => props.onTunnel('stop'),
                }, t('bot.tunnelStop')),
              ),
              tunnel.error ? h('p', { className: 'sc3-notice sc3-noticeError' }, tunnel.error) : null,
              h('p', { className: 'sc3-hint' }, t('bot.tunnelHint')),
            )
            : null,
          status.lockedBy
            ? h('p', { className: 'sc3-notice sc3-noticeError' }, `此 Token 正被另一个实例（pid ${status.lockedBy}）使用，本实例不轮询也不接收 Webhook。`)
            : null,
          h('details', { className: 'sc3-advanced' },
            h('summary', null, t('bot.advanced')),
            h('div', { className: 'sc3-advancedBody' },
              field('pollTimeout', t('bot.pollTimeout'), undefined,
                input('pollTimeout', String(bot.pollTimeoutSeconds ?? 20), (value) => update({ pollTimeoutSeconds: value }), { type: 'number', min: 0, max: 30, step: 1 })),
              field('replyTimeout', t('bot.replyTimeout'), undefined,
                input('replyTimeout', String(bot.replyTimeoutMs ?? 180000), (value) => update({ replyTimeoutMs: value }), { type: 'number', min: 5000, step: 1000 })),
              field('questionTimeout', t('bot.questionTimeout'), undefined,
                input('questionTimeout', String(bot.questionTimeoutMs ?? 600000), (value) => update({ questionTimeoutMs: value }), { type: 'number', min: 30000, step: 30000 })),
              field('cardDelay', t('bot.cardDelay'), t('bot.cardDelayHint'),
                input('cardDelay', String(bot.cardDelayMs ?? 8000), (value) => update({ cardDelayMs: value }), { type: 'number', min: 0, step: 1000 })),
              field('maxChars', t('bot.maxChars'), undefined,
                input('maxChars', String(bot.maxReplyChars ?? 8000), (value) => update({ maxReplyChars: value }), { type: 'number', min: 500, step: 500 })),
              field('baseUrl', t('bot.baseUrl'), undefined, input('baseUrl', bot.baseUrl, (value) => update({ baseUrl: value }))),
            ),
          ),
          Array.isArray(status.sessions) && status.sessions.length > 0
            ? h('ul', { className: 'sc3-sessionList' }, status.sessions.map((entry) => h('li', { key: entry.chatId, className: 'sc3-mono' }, `${entry.chatId} → ${entry.sessionId}`)))
            : null,
          status.lastError ? h('p', { className: 'sc3-notice sc3-noticeError' }, `${t('status.lastError')}: ${status.lastError}`) : null,
          h('div', { className: 'sc3-row' },
            h('button', {
              type: 'button',
              className: 'sc3-btn',
              disabled: busy || status.configured !== true || bot.chatId === '',
              onClick: () => props.onTest(),
            }, t('bot.test')),
            h('button', {
              type: 'button',
              className: 'sc3-btn sc3-btnDanger',
              disabled: busy,
              onClick: () => props.onRemove(),
            }, t('bot.remove')),
          ),
        ) : null,
      )
    }

    function SettingsPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      // Standard slot props carry the workspace store hook; keep a plain fallback
      // so a deployment without it still renders the page instead of blanking it.
      const readWorkspaces = typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces
        : (select) => select({ items: [] })
      const workspaceItems = readWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspaceItems) ? workspaceItems : []
      const [bots, setBots] = React.useState(null)
      const [canSave, setCanSave] = React.useState(true)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [open, setOpen] = React.useState({})

      const load = async (attempts = 3) => {
        setLoading(true)
        setError(null)
        try {
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
              const data = await request('GET', 'state')
              setBots(data.bots.map(toDraft))
              setCanSave(data.canSave === true)
              setOpen((current) => {
                if (Object.keys(current).length > 0 || data.bots.length === 0) return current
                return { 0: true }
              })
              setLoading(false)
              return
            } catch (failure) {
              if (attempt === attempts - 1) throw failure
              await delay(350)
            }
          }
        } catch (failure) {
          const message = errorText(failure)
          setError(message === 'api' ? t('error.api') : message)
        } finally {
          setLoading(false)
        }
      }

      React.useEffect(() => {
        void load()
      }, [])

      const patchBot = (index, patch) => {
        setBots((list) => list.map((bot, position) => (position === index ? { ...bot, ...patch } : bot)))
      }

      const addBot = () => {
        let addedAt = 0
        setBots((list) => {
          const next = list ?? []
          addedAt = next.length
          const used = new Set(next.map((bot) => bot.id.toLowerCase()))
          let index = next.length + 1
          let id = `bot${index}`
          while (used.has(id.toLowerCase())) {
            index += 1
            id = `bot${index}`
          }
          return [...next, toDraft({
            id,
            chatId: '',
            allowChatIds: [],
            sessionId: '',
            sessionTitle: '',
            workspaceId: '',
            cwd: '',
            baseUrl: '',
            poll: true,
            mode: 'poll',
            webhookSecret: '',
            tunnel: null,
            autoReply: true,
            push: true,
            questions: true,
            typing: true,
            pollTimeoutSeconds: 20,
            replyTimeoutMs: 180000,
            questionTimeoutMs: 600000,
            cardDelayMs: 8000,
            maxReplyChars: 8000,
            tokenSet: false,
          })]
        })
        setOpen((current) => ({ ...current, [String(addedAt)]: true }))
      }

      const removeBot = (index) => {
        let confirmed = true
        try {
          confirmed = window.confirm(t('bot.removeConfirm'))
        } catch {
          confirmed = true
        }
        if (!confirmed) return
        setBots((list) => list.filter((_, position) => position !== index))
      }

      const save = async () => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          await request('POST', 'config', { bots: (bots ?? []).map(toPayload) })
          setNotice(t('page.saved'))
          await delay(800)
          await load(5)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusy(false)
        }
      }

      const tunnelAction = async (bot, index, action) => {
        setBusy(true)
        setError(null)
        try {
          let info = await request('POST', 'tunnel', { bot: bot.id, action })
          patchBot(index, { tunnel: info })
          if (action === 'start') {
            for (let attempt = 0; attempt < 20 && info.running !== true && !info.error; attempt += 1) {
              await delay(1000)
              info = await request('POST', 'tunnel', { bot: bot.id, action: 'status' })
              patchBot(index, { tunnel: info })
            }
            if (info.error) setError(info.error)
          }
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusy(false)
        }
      }

      const testBot = async (bot) => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          await request('POST', 'test', { bot: bot.id, chatId: bot.chatId === '' ? undefined : bot.chatId })
          setNotice(`${t('bot.sent')} → ${bot.chatId === '' ? bot.id : bot.chatId}`)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusy(false)
        }
      }

      const children = [
        h('style', { key: 'style' }, CSS),
        h('header', { className: 'sc3-head', key: 'head' },
          h('h2', { className: 'sc3-title' }, t('page.title')),
          h('p', { className: 'sc3-lead' }, t('page.lead')),
          h('p', { className: 'sc3-note' }, t('page.tokenNote')),
          h('p', { className: 'sc3-hint' }, t('bot.commandsHint')),
        ),
      ]

      if (error !== null) children.push(h('p', { className: 'sc3-notice sc3-noticeError', role: 'alert', key: 'error' }, error))
      if (notice !== null) children.push(h('p', { className: 'sc3-notice sc3-noticeOk', role: 'status', key: 'notice' }, notice))
      if (loading && bots === null) children.push(h('p', { className: 'sc3-note', key: 'loading' }, t('page.loading')))

      if (bots !== null && bots.length === 0) children.push(h('p', { className: 'sc3-note', key: 'empty' }, t('page.empty')))

      if (bots !== null) {
        children.push(h('div', { className: 'sc3-root', key: 'cards' }, bots.map((bot, index) => h(BotCard, {
          key: String(index),
          bot,
          index,
          t,
          workspaces,
          busy,
          open: open[index] === true,
          onToggle: () => setOpen((current) => ({ ...current, [index]: current[index] !== true })),
          onChange: (patch) => patchBot(index, patch),
          onTest: () => void testBot(bot),
          onTunnel: (action) => void tunnelAction(bot, index, action),
          onRemove: () => removeBot(index),
        }))))
      }

      children.push(h('div', { className: 'sc3-footer', key: 'footer' },
        h('button', { type: 'button', className: 'sc3-btn', onClick: addBot, disabled: busy }, t('page.add')),
        h('span', { className: 'sc3-spacer' }),
        h('button', { type: 'button', className: 'sc3-btn', onClick: () => void load(), disabled: busy }, t('page.reload')),
        h('button', {
          type: 'button',
          className: 'sc3-btn sc3-btnPrimary',
          onClick: () => void save(),
          disabled: busy || bots === null || canSave !== true,
        }, busy ? t('page.saving') : t('page.save')),
      ))

      if (canSave !== true) children.push(h('p', { className: 'sc3-note', key: 'nosave' }, t('page.noSave')))

      return h('div', { className: 'sc3-root' }, children)
    }

    function SectionIcon({ size, active }) {
      const edge = typeof size === 'number' && Number.isFinite(size) && size > 0 ? Math.min(Math.max(size, 12), 32) : 18
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 24 24',
        role: 'presentation',
        focusable: 'false',
        'aria-hidden': 'true',
        style: { display: 'block', opacity: active === true ? 1 : 0.78 },
      },
        h('path', {
          d: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.8.8 0 0 1 4.5 19v-2.1A2.5 2.5 0 0 1 4 15.5v-9Z',
          fill: active === true ? 'currentColor' : 'none',
          fillOpacity: active === true ? 0.12 : 0,
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 9, cy: 10, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 12.5, cy: 10, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 16, cy: 10, r: 1.1, fill: 'currentColor' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'serverchan-bot: dictionaries')
        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: () => t('nav.label'),
            locale: NS,
            inject: () => ({ t }),
          }, SettingsPage)),
          'serverchan-bot: settings section',
        )
        ctx.effect(
          () => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: () => t('nav.label'),
            locale: NS,
          }, SectionIcon)),
          'serverchan-bot: settings icon',
        )
      },
    }
  },
})
