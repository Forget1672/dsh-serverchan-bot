/**
 * Server酱³ Bot bridge — Host half.
 *
 * Downlink: the agent gets a `serverchan_bot` tool that pushes messages to the
 * owner's phone through one or more Server酱³ Bots.
 *
 * Uplink: every configured Bot is long-polled with `getUpdates`; each chat
 * message is admitted as a prompt into that Bot's session and the assistant's
 * final reply of the turn is sent back to the chat.
 *
 * Configuration accepts either one Bot at the top level (token/chatId/…) or a
 * `bots` list, where every entry carries its own token, chat and session.
 *
 * The Bot API is documented at https://sc3.ft07.com/bot and served from
 * https://bot-go.apijia.cn.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createBotApi } from './api.js'

export const name = 'serverchan-bot'
export const inject = ['sessionController', 'tools']

const TOOL_NAME = 'serverchan_bot'
const PROMPT_SECTION = 'serverchan-bot'
const BOT_SESSION_PREFIX = 'session-sc3bot-'
const DEFAULT_BOT_ID = 'default'
const API_PREFIX = '/__sc3bot'
const SECRET_GLOBAL = '__DSH_SC3BOT_SECRET__'
const BOOT_GLOBAL = '__DSH_SC3BOT__'
const INBOX_LIMIT = 50
const SEEN_LIMIT = 1000
const EXPECT_TURN_WINDOW_MS = 120000

const BRIDGE_PROMPT = [
  'This conversation is bridged to the user\'s phone through Server酱³ Bot.',
  'Each user message here was typed in that chat app, and your final assistant reply is delivered back to it automatically.',
  'Answer for a phone screen: direct, reasonably short, without wide tables or huge code blocks.',
  'Do not call the serverchan_bot tool to deliver the reply itself; use it only for extra notifications the user explicitly asked for.',
].join(' ')

const EMPTY_REPLY_NOTICE = '（DSH 本轮没有文字回复，过程可在 Web UI 中查看。）'
const TIMEOUT_NOTICE = '⏳ 这一轮仍在处理中，完成后可在 DSH Web UI 查看结果。'
const QUESTION_TIMEOUT_NOTICE = '⌛ 在聊天里等太久了；网页上已经有这张卡片，两个地方都还能作答。'
const ANSWERED_ON_WEB_NOTICE = '✅ 已经在网页上作答了，聊天里不用再回。'
const HELP_TEXT = [
  '可用命令：',
  '/stop 停止当前回合',
  '/new 开启新会话',
  '/status 查看通道状态',
  '/help 显示这条说明',
].join('\n')

const TOOL_DESCRIPTION = [
  'Push a message to the owner\'s phone through Server酱³ Bot, or inspect the bot bridge.',
  'action=send delivers one markdown chat message; when several bots are configured, pass "bot" to choose one, and chatId defaults to that bot\'s chat.',
  'action=inbox returns inbound messages the bots received, including chats that were not answered.',
  'action=status reports every configured bot: identity, polling health, bound sessions, and allowlists.',
  'In a bot-bridged session the final reply is already delivered to the chat, so do not send it again.',
].join(' ')

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['send', 'inbox', 'status'],
      description: 'What to do: send a new message, read inbound messages, or inspect the bridge status.',
    },
    bot: {
      type: 'string',
      description: 'Bot account id from config.bots (the single-bot form uses "default"). Required when more than one bot is configured.',
    },
    text: {
      type: 'string',
      description: 'Message body for action=send. The app renders markdown.',
    },
    chatId: {
      type: 'string',
      description: 'Target chat id (the Server酱³ uid). Defaults to the chosen bot\'s chatId.',
    },
    parseMode: {
      type: 'string',
      enum: ['markdown', 'text'],
      description: 'How the app parses text for action=send (default markdown).',
    },
    silent: {
      type: 'boolean',
      description: 'When true the app stores the message without a notification.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum inbound messages returned for action=inbox across the selected bots (default 20, max 100).',
    },
    drain: {
      type: 'boolean',
      description: 'For action=inbox: remove the returned messages from the buffer (default true).',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean', description: 'Whether the action succeeded.' },
    action: { type: 'string', description: 'The action that ran.' },
  },
}

export function apply(ctx, config) {
  const log = ctx.logger('serverchan-bot')
  const store = openStateStore(ctx, log)
  const links = normalizeConfig(config).accounts.map((account) => {
    const allowedChats = new Set([
      ...account.allowChatIds,
      ...(account.chatId === '' ? [] : [account.chatId]),
    ])
    const record = store.bot(account.id)
    const link = {
      id: account.id,
      settings: account,
      api: account.token === '' ? undefined : createBotApi({ token: account.token, baseUrl: account.baseUrl }),
      record,
      inbox: [],
      queues: new Map(),
      sessions: new Map(),
      sessionChats: new Map(),
      pending: new Map(),
      timeouts: new Map(),
      expectTurn: new Map(),
      pushed: new Map(),
      allowedChats,
      seen: new Set(),
      lock: null,
      lockedBy: null,
      state: {
        offset: 0,
        polling: false,
        pumping: false,
        lastError: null,
        replies: 0,
        bot: null,
        paired: allowedChats.size === 0 ? null : 'configured',
        failed: [],
      },
    }

    // Restore persisted progress before anything can observe the link.
    if (Number.isSafeInteger(record.offset) && record.offset > 0) link.state.offset = record.offset
    if (Array.isArray(record.seen)) {
      for (const id of record.seen) if (Number.isSafeInteger(id)) link.seen.add(id)
    }
    if (record.pushed !== null && typeof record.pushed === 'object') {
      for (const [sessionId, seq] of Object.entries(record.pushed)) {
        if (Number.isSafeInteger(seq)) link.pushed.set(sessionId, seq)
      }
    }
    if (record.sessions !== null && typeof record.sessions === 'object') {
      for (const [chatId, sessionId] of Object.entries(record.sessions)) {
        if (typeof sessionId !== 'string' || sessionId === '') continue
        link.sessions.set(chatId, sessionId)
        link.sessionChats.set(sessionId, chatId)
      }
    }
    if (link.api !== undefined) {
      const lock = acquireTokenLock(store.dir, account.token, log)
      link.lock = lock
      link.lockedBy = lock.heldBy
    }
    return link
  })
  const bridgeAbort = new AbortController()
  const promptSections = new Map()
  const turns = new Map()

  for (const link of links) {
    if (link.api === undefined) {
      log.warn('bot "%s" has no token: set config.bots[].token (or config.token) to connect it', link.id)
    } else if (link.settings.mode === 'webhook') {
      log.info('bot "%s" uses the webhook; point the app at %s and paste the webhook secret', link.id, `${API_PREFIX}/webhook`)
    } else if (!link.settings.poll) {
      log.info('bot "%s" polling is disabled; it can push but inbound chat messages are not read', link.id)
    }
  }

  ctx.tools.register({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render(_args, value) {
        return [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }]
      },
    },
    execute(args) {
      return runAction(args)
    },
  })

  if (links.some((link) => link.api !== undefined && link.settings.poll && link.settings.mode !== 'webhook' && link.lockedBy === null)) {
    ctx.effect(() => {
      const controllers = []
      for (const link of links) {
        if (link.api === undefined || !link.settings.poll || link.settings.mode === 'webhook' || link.lockedBy !== null) continue
        const controller = new AbortController()
        controllers.push(controller)
        link.state.polling = true
        void pollLoop(link, controller.signal)
          .catch((error) => {
            if (!controller.signal.aborted) log.error('poller for bot "%s" stopped: %s', link.id, describeError(error))
          })
          .finally(() => {
            link.state.polling = false
          })
      }
      return () => {
        for (const controller of controllers) controller.abort()
        for (const link of links) link.state.polling = false
      }
    })
  }

  const secret = (globalThis[SECRET_GLOBAL] ??= randomBytes(18).toString('hex'))

  // The settings page reads its bootstrap (route + per-process secret) from this
  // injected global; the secret keeps the admin routes off limits to other origins.
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: BOOT_GLOBAL, value: { api: API_PREFIX, secret } })
  })

  ctx.inject(['webServer'], (webCtx) => {
    try {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path: `${API_PREFIX}/webhook`,
          handler: (req, res) => handleWebhook(req, res),
        }),
        'serverchan-bot: webhook',
      )
    } catch (error) {
      if (!/duplicate/i.test(describeError(error))) log.error('could not serve the webhook: %s', describeError(error))
    }
    const routes = [
      [`${API_PREFIX}/state`, 'GET', () => readState()],
      [`${API_PREFIX}/config`, 'POST', (req) => saveConfig(req)],
      [`${API_PREFIX}/test`, 'POST', (req) => testBot(req)],
      [`${API_PREFIX}/tunnel`, 'POST', (req) => tunnelAction(req)],
    ]
    for (const [path, method, operation] of routes) {
      try {
        webCtx.effect(
          () => webCtx.webServer.register({ kind: 'exact', path, handler: (req, res) => respond(req, res, method, operation) }),
          `serverchan-bot: ${path}`,
        )
      } catch (error) {
        if (/duplicate/i.test(describeError(error))) log.info('route %s is already served; leaving that instance in place', path)
        else log.error('could not serve %s: %s', path, describeError(error))
      }
    }
  })

  // A turn that finished while the process was away is pushed once on startup.
  ctx.effect(() => {
    const controller = new AbortController()
    void recoverUnpushed(controller.signal)
    return () => controller.abort()
  })

  async function recoverUnpushed(signal) {
    for (const link of links) {
      if (signal.aborted) return
      if (link.api === undefined || link.lockedBy !== null || link.sessions.size === 0) continue
      for (const [chatId, sessionId] of link.sessions) {
        if (signal.aborted) return
        const lastSeq = link.pushed.get(sessionId) ?? 0
        try {
          const page = await ctx.sessionController.events({
            address: { kind: 'session', sessionId },
            maxMessages: 60,
          }, signal)
          let text = ''
          let ended = false
          let endSeq = 0
          const records = Array.isArray(page?.records) ? page.records : []
          for (const record of records) {
            if (record?.type !== 'event') continue
            const event = record.event
            if (!Number.isSafeInteger(event?.seq) || event.seq <= lastSeq) continue
            if (event.type === 'assistant/message') {
              const value = textOfContent(event.data?.message?.content)
              if (value !== '') text = value
            } else if (event.type === 'turn/end') {
              ended = true
              endSeq = event.seq
            }
          }
          if (!ended) continue
          if (text === '') {
            link.pushed.set(sessionId, endSeq)
            link.record.pushed[sessionId] = endSeq
            store.saveNow()
            continue
          }
          if (await sendToChat(link, chatId, text)) {
            link.pushed.set(sessionId, endSeq)
            link.record.pushed[sessionId] = endSeq
            store.saveNow()
            log.info('bot "%s" recovered an unpushed turn from %s', link.id, sessionId)
          }
        } catch (error) {
          log.info('bot "%s" could not recover %s: %s', link.id, sessionId, describeError(error))
        }
      }
    }
  }

  // Per-agent prompt section: only bot-bridged sessions get the phone-friendly reply hint.
  ctx.on('agent/created', ({ agent }) => {
    const sessionId = String(agent.id)
    if (!isBotSession(sessionId) || promptSections.has(agent)) return
    try {
      const dispose = agent.ctx.effect(() => {
        const disposeSection = agent.ctx.systemPrompt.section({
          name: PROMPT_SECTION,
          order: 3000,
          text: BRIDGE_PROMPT,
        })
        return () => {
          disposeSection()
        }
      })
      promptSections.set(agent, dispose)
    } catch (error) {
      log.warn('could not add the bot prompt section to %s: %s', sessionId, describeError(error))
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    promptSections.delete(agent)
  })

  ctx.effect(() => () => {
    bridgeAbort.abort()
    for (const link of links) {
      for (const list of [...link.pending.values()]) {
        for (const entry of [...list]) entry.finish(null)
      }
      link.pending.clear()
      for (const timer of link.timeouts.values()) clearTimeout(timer)
      link.timeouts.clear()
    }
    for (const record of turns.values()) {
      clearTimeout(record.timer)
      record.stopTyping()
    }
    turns.clear()
    store.saveNow()
    for (const link of links) {
      stopTunnel(link)
      try {
        link.lock?.release()
      } catch {
        // The lock may already be gone.
      }
    }
    for (const [agent, dispose] of promptSections) {
      try {
        dispose()
      } catch (error) {
        log.warn('could not remove the bot prompt section from %s: %s', agent?.id ?? '?', describeError(error))
      }
    }
    promptSections.clear()
  })

  // ---------------------------------------------------------------- settings API

  /** Answer one admin request; every route shares this envelope and secret check. */
  async function respond(req, res, method, operation) {
    const send = (status, payload) => {
      const text = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(text),
      })
      res.end(text)
    }
    try {
      if (req.headers['x-sc3bot-secret'] !== secret) return send(403, { ok: false, error: 'forbidden' })
      if (req.method !== method) return send(405, { ok: false, error: 'method not allowed' })
      const data = await operation(req)
      send(200, { ok: true, data })
    } catch (error) {
      send(400, { ok: false, error: describeError(error) })
    }
  }

  async function readJsonBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 256 * 1024) throw new Error('request body is too large')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('request body must be JSON')
    }
  }

  /** Everything the settings page edits, with the token reduced to set/hint. */
  async function readState() {
    const bots = []
    for (const link of links) {
      const status = await accountStatus(link)
      bots.push({
        id: link.id,
        chatId: link.settings.chatId,
        allowChatIds: [...link.settings.allowChatIds],
        sessionId: link.settings.sessionId,
        sessionTitle: link.settings.sessionTitle,
        workspaceId: link.settings.workspaceId,
        cwd: link.settings.cwd,
        baseUrl: link.settings.baseUrl,
        poll: link.settings.poll,
        mode: link.settings.mode,
        webhookSecret: webhookSecretOf(link),
        webhookPath: `${API_PREFIX}/webhook`,
        tunnel: tunnelInfo(link),
        autoReply: link.settings.autoReply,
        push: link.settings.push,
        questions: link.settings.questions,
        typing: link.settings.typing,
        pollTimeoutSeconds: link.settings.pollTimeoutSeconds,
        replyTimeoutMs: link.settings.replyTimeoutMs,
        questionTimeoutMs: link.settings.questionTimeoutMs,
        cardDelayMs: link.settings.cardDelayMs,
        maxReplyChars: link.settings.maxReplyChars,
        tokenSet: link.settings.token !== '',
        tokenHint: link.settings.token === '' ? null : `…${link.settings.token.slice(-4)}`,
        status: {
          configured: status.configured,
          bridge: status.bridge,
          bot: status.bot,
          botError: status.botError ?? null,
          polling: status.polling,
          pairMode: status.pairMode,
          offset: status.offset,
          inboxCount: status.inboxCount,
          replies: status.replies,
          sessions: status.sessions,
          lastError: status.lastError,
          failed: status.failed,
        },
      })
    }
    return { bots, canSave: canSaveConfig() }
  }

  /** Persist the edited bot list through the config editor, then let the row restart. */
  async function saveConfig(req) {
    const body = await readJsonBody(req)
    if (!Array.isArray(body?.bots)) throw new Error('"bots" must be an array')
    const entry = ctx.fiber?.entry
    const editor = ctx.get('configEditor')
    if (entry === undefined) throw new Error('this plugin row is not addressable for configuration')
    if (editor === undefined) throw new Error('this profile has no configuration editor')
    const knownTokens = new Map(links.map((link) => [link.id.toLowerCase(), link.settings.token]))
    const next = body.bots.map((raw, index) => sanitizeBot(raw, index, knownTokens))
    normalizeConfig({ bots: next })
    const write = () => editor.edit(entry, (current) => {
      const clean = { ...current }
      delete clean.token
      delete clean.chatId
      delete clean.allowChatIds
      delete clean.sessionId
      return { ...clean, bots: next }
    })
    // The write restarts this plugin row, which would abort the response; answer
    // first and let the Loader reconcile right after the page has its receipt.
    setImmediate(() => {
      write().catch((error) => log.error('could not save settings: %s', describeError(error)))
    })
    return { saved: true }
  }

  /** Send one probe message through a configured Bot. */
  async function testBot(req) {
    const body = await readJsonBody(req)
    const link = resolveLink(body?.bot)
    const client = requireApi(link)
    const chatId = asText(body?.chatId) || link.settings.chatId
    if (chatId === '') throw new Error(`bot "${link.id}" has no chatId yet; save one first`)
    const text = asText(body?.text) || 'Server酱³ Bot ↔ DSH 测试消息 ✅'
    const payload = await client.sendMessage({ chatId, text, parseMode: 'markdown', silent: false })
    return { bot: link.id, chatId, result: payload.result ?? null }
  }

  /** The value the Server酱³ app must send as `X-Sc3Bot-Webhook-Secret`. */
  function webhookSecretOf(link) {
    if (link.settings.webhookSecret !== '') return link.settings.webhookSecret
    if (link.settings.token === '') return ''
    return createHash('sha256').update(`serverchan-bot:${link.settings.token}`).digest('hex').slice(0, 32)
  }

  /**
   * Public webhook entry: the Server酱³ service POSTs the same update object the
   * poller receives. It authenticates with the Bot's webhook secret, not the
   * admin secret, and answers fast because the service times out after 10s.
   */
  async function handleWebhook(req, res) {
    const send = (status, payload) => {
      const text = JSON.stringify(payload)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(text)
    }
    if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
    const presented = asText(req.headers['x-sc3bot-webhook-secret'])
    let link
    if (presented !== '') {
      for (const candidate of links) {
        if (webhookSecretOf(candidate) === presented) {
          link = candidate
          break
        }
      }
    }
    if (link === undefined) return send(401, { ok: false, error: 'invalid webhook secret' })
    if (link.lockedBy !== null) return send(200, { ok: true, ignored: 'locked' })
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return send(400, { ok: false, error: describeError(error) })
    }
    const update = body?.update_id === undefined && body?.message !== undefined
      ? { ...body, update_id: Math.floor(Date.now() / 1000) }
      : body
    if (!Number.isSafeInteger(Number(update?.update_id))) return send(400, { ok: false, error: 'update_id is required' })
    try {
      ingest(link, [update])
    } catch (error) {
      return send(500, { ok: false, error: describeError(error) })
    }
    return send(200, { ok: true })
  }

  /** Start or stop a cloudflared quick tunnel that exposes this web server. */
  async function tunnelAction(req) {
    const body = await readJsonBody(req)
    const link = resolveLink(body?.bot)
    const action = asText(body?.action) || 'status'
    if (action === 'start') return startTunnel(link)
    if (action === 'stop') {
      stopTunnel(link)
      return tunnelInfo(link)
    }
    return tunnelInfo(link)
  }

  function localOrigin() {
    try {
      const server = ctx.get('webServer')
      if (server !== undefined) return server.getOrigin()
    } catch {
      // No web server in this profile.
    }
    return null
  }

  async function startTunnel(link) {
    const existing = link.state.tunnel
    if (existing !== undefined && existing.child !== undefined && existing.exited !== true) return tunnelInfo(link)
    const origin = localOrigin()
    if (origin === null) throw new Error('the local web server is unavailable')
    let child
    try {
      child = spawn('cloudflared', ['tunnel', '--url', origin, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      throw new Error(`could not start cloudflared: ${describeError(error)}`)
    }
    const tunnel = { child, url: null, localUrl: origin, error: null, exited: false }
    link.state.tunnel = tunnel
    const timer = setTimeout(() => {
      if (tunnel.url === null && tunnel.error === null) tunnel.error = 'cloudflared did not report a URL within 30s'
    }, 30000)
    timer.unref?.()
    const onData = (chunk) => {
      const text = String(chunk)
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text)
      if (match !== null && tunnel.url === null) {
        tunnel.url = match[0]
        tunnel.error = null
        clearTimeout(timer)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (error) => {
      tunnel.error = /ENOENT/.test(describeError(error)) ? 'cloudflared is not installed or not on PATH' : describeError(error)
      tunnel.exited = true
      clearTimeout(timer)
    })
    child.on('exit', (code) => {
      tunnel.exited = true
      if (tunnel.url === null && tunnel.error === null) tunnel.error = `cloudflared exited with code ${String(code)}`
      clearTimeout(timer)
    })
    return tunnelInfo(link)
  }

  function stopTunnel(link) {
    const tunnel = link.state.tunnel
    if (tunnel?.child !== undefined) {
      try {
        tunnel.child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    }
    link.state.tunnel = undefined
  }

  function tunnelInfo(link) {
    const tunnel = link.state.tunnel
    const running = tunnel !== undefined && tunnel.exited !== true && tunnel.error === null
    const url = tunnel?.url ?? null
    return {
      running,
      url,
      localUrl: tunnel?.localUrl ?? localOrigin(),
      webhookPath: `${API_PREFIX}/webhook`,
      webhookUrl: url === null ? null : `${url}${API_PREFIX}/webhook`,
      error: tunnel?.error ?? null,
    }
  }

  function canSaveConfig() {
    try {
      return ctx.fiber?.entry !== undefined && ctx.get('configEditor') !== undefined
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------- tool actions

  async function runAction(args) {
    const action = typeof args?.action === 'string' ? args.action.trim() : ''
    if (action === 'send') return sendAction(args ?? {})
    if (action === 'inbox') return inboxAction(args ?? {})
    if (action === 'status') return statusAction()
    throw new Error(`${TOOL_NAME}: unknown action ${JSON.stringify(action)}; use send, inbox, or status`)
  }

  async function sendAction(args) {
    const link = resolveLink(args.bot)
    const client = requireApi(link)
    const body = typeof args.text === 'string' ? args.text : ''
    if (body.trim() === '') throw new Error(`${TOOL_NAME} send requires a non-empty "text"`)
    const chatId = resolveChat(link, args.chatId)
    const payload = await client.sendMessage({
      chatId,
      text: clip(body, link.settings.maxReplyChars),
      parseMode: args.parseMode === 'text' ? 'text' : 'markdown',
      silent: args.silent === true,
    })
    return { ok: true, action: 'send', bot: link.id, chatId, result: payload.result ?? null }
  }

  function inboxAction(args) {
    const limit = clamp(Number(args.limit), 1, 100, 20)
    const drain = args.drain !== false
    const targets = selectLinks(args.bot)
    const messages = []
    for (const link of targets) {
      const room = limit - messages.length
      if (room <= 0) break
      const taken = drain ? link.inbox.splice(0, room) : link.inbox.slice(0, room)
      for (const entry of taken) messages.push(publicMessage(link, entry))
    }
    return { ok: true, action: 'inbox', count: messages.length, messages }
  }

  async function statusAction() {
    const accounts = []
    for (const link of links) accounts.push(await accountStatus(link))
    const status = { ok: true, action: 'status', accounts }
    // Keep the single-bot shape readable for the common case.
    if (accounts.length === 1) Object.assign(status, accounts[0])
    return status
  }

  async function accountStatus(link) {
    const status = {
      id: link.id,
      configured: link.api !== undefined,
      bridge: link.api !== undefined && (link.settings.mode === 'webhook' || link.settings.poll),
      bot: link.state.bot,
      polling: link.state.polling,
      pairMode: link.state.paired,
      lockedBy: link.lockedBy,
      offset: link.state.offset,
      inboxCount: link.inbox.length,
      queuedChats: link.queues.size,
      replies: link.state.replies,
      allowChatIds: [...link.allowedChats],
      sessions: [...link.sessions].map(([chatId, sessionId]) => ({ chatId, sessionId })),
      lastError: link.state.lastError,
      failed: link.state.failed.slice(-5),
      config: {
        chatId: link.settings.chatId === '' ? null : link.settings.chatId,
        autoReply: link.settings.autoReply,
        push: link.settings.push,
        questions: link.settings.questions,
        typing: link.settings.typing,
        poll: link.settings.poll,
        mode: link.settings.mode,
        pollTimeoutSeconds: link.settings.pollTimeoutSeconds,
        replyTimeoutMs: link.settings.replyTimeoutMs,
        questionTimeoutMs: link.settings.questionTimeoutMs,
        cardDelayMs: link.settings.cardDelayMs,
        workspaceId: link.settings.workspaceId === '' ? null : link.settings.workspaceId,
        cwd: link.settings.cwd === '' ? null : link.settings.cwd,
        sessionId: link.settings.sessionId === '' ? null : link.settings.sessionId,
        sessionTitle: link.settings.sessionTitle,
      },
    }
    if (link.api !== undefined) {
      try {
        const payload = await link.api.getMe()
        link.state.bot = payload.result ?? null
        status.bot = link.state.bot
      } catch (error) {
        status.botError = describeError(error)
      }
    }
    return status
  }

  function requireApi(link) {
    if (link.api === undefined) {
      throw new Error(
        `bot "${link.id}" is not configured: set config.bots[].token (or config.token for the single-bot form) `
        + 'or the SERVERCHAN_BOT_TOKEN environment variable, then reload the plugin',
      )
    }
    return link.api
  }

  function resolveChat(link, value) {
    const candidate = asText(value) || link.settings.chatId
    if (candidate === '') {
      throw new Error(`bot "${link.id}" has no chat id: set its chatId, or pass chatId`)
    }
    if (link.allowedChats.size > 0 && !link.allowedChats.has(candidate)) {
      throw new Error(`chat ${candidate} is not allowed for bot "${link.id}"; add it to that bot's allowChatIds`)
    }
    return candidate
  }

  function selectLinks(value) {
    const name = asText(value)
    if (name === '') return links
    const lower = name.toLowerCase()
    const found = links.filter((link) => link.id.toLowerCase() === lower)
    if (found.length === 0) {
      throw new Error(`unknown bot ${JSON.stringify(name)}; configured bots: ${linkIds()}`)
    }
    return found
  }

  function resolveLink(value) {
    if (asText(value) !== '') return selectLinks(value)[0]
    if (links.length === 1) return links[0]
    throw new Error(`multiple bots are configured (${linkIds()}); pass "bot" to choose one`)
  }

  function linkIds() {
    return links.map((link) => link.id).join(', ')
  }

  function publicMessage(link, entry) {
    return {
      bot: link.id,
      updateId: entry.updateId,
      messageId: entry.messageId,
      chatId: entry.chatId,
      text: entry.text,
      status: entry.status,
      receivedAt: new Date(entry.receivedAt).toISOString(),
    }
  }

  // -------------------------------------------------------------------- polling

  async function pollLoop(link, signal) {
    let backoff = 0
    while (!signal.aborted) {
      try {
        const payload = await link.api.getUpdates({
          offset: link.state.offset,
          timeout: link.settings.pollTimeoutSeconds,
          signal,
        })
        backoff = 0
        if (link.state.lastError !== null) {
          log.info('bot "%s" getUpdates recovered', link.id)
          link.state.lastError = null
        }
        const updates = Array.isArray(payload?.result) ? payload.result : []
        if (updates.length > 0) {
          const before = link.state.offset
          ingest(link, updates)
          // A batch of already-confirmed updates must not spin the loop.
          if (link.state.offset === before) await delay(1000, signal)
        } else await delay(link.settings.pollTimeoutSeconds > 0 ? 250 : 3000, signal)
      } catch (error) {
        if (signal.aborted) return
        const message = describeError(error)
        if (link.state.lastError !== message) log.warn('bot "%s" getUpdates failed: %s', link.id, message)
        link.state.lastError = message
        backoff = backoff === 0 ? 3000 : Math.min(backoff * 2, 60000)
        await delay(backoff, signal)
      }
    }
  }

  function ingest(link, updates) {
    for (const update of updates) {
      const updateId = Number(update?.update_id)
      if (!Number.isSafeInteger(updateId)) continue
      link.state.offset = Math.max(link.state.offset, updateId + 1)
      if (link.seen.has(updateId)) continue
      remember(link, updateId)

      const message = update?.message
      const rawChat = message?.chat_id ?? message?.chat?.id
      const body = typeof message?.text === 'string' ? message.text.trim() : ''
      if (rawChat === undefined || rawChat === null || body === '') {
        log.info('bot "%s" ignored update %s without chat_id/text', link.id, updateId)
        continue
      }
      const chatId = String(rawChat)
      const messageId = Number(message?.message_id)
      const entry = {
        updateId,
        messageId: Number.isSafeInteger(messageId) ? messageId : null,
        chatId,
        text: body,
        receivedAt: Date.now(),
        status: 'received',
      }
      link.inbox.push(entry)
      if (link.inbox.length > INBOX_LIMIT) link.inbox.splice(0, link.inbox.length - INBOX_LIMIT)

      if (!acceptChat(link, chatId)) {
        entry.status = 'rejected'
        continue
      }
      if (handleCommand(link, chatId, entry.text)) {
        entry.status = 'command'
        continue
      }
      const waiting = link.pending.get(chatId)
      const next = waiting === undefined ? undefined : waiting[0]
      if (next !== undefined) {
        entry.status = 'question-answer'
        next.finish(entry.text)
        continue
      }
      if (!link.settings.autoReply) {
        entry.status = 'stored'
        continue
      }
      entry.status = 'queued'
      enqueue(link, chatId, entry)
    }
    link.record.offset = link.state.offset
    link.record.seen = [...link.seen]
    store.saveSoon()
  }

  function remember(link, updateId) {
    link.seen.add(updateId)
    if (link.seen.size <= SEEN_LIMIT) return
    const oldest = link.seen.values().next().value
    link.seen.delete(oldest)
  }

  /**
   * Decide whether a chat may drive this agent through one Bot. With no
   * configured allowlist the first chat that messages that Bot is paired, so a
   * fresh install works without a prior round-trip; configuring chatId or
   * allowChatIds pins the decision.
   */
  function acceptChat(link, chatId) {
    if (link.allowedChats.size === 0) {
      link.allowedChats.add(chatId)
      link.state.paired = chatId
      log.warn('bot "%s" paired with chat %s on first contact; set its chatId or allowChatIds to restrict inbound chats', link.id, chatId)
      return true
    }
    if (!link.allowedChats.has(chatId)) {
      log.warn('bot "%s" ignored a message from chat %s, which is not in its allowlist', link.id, chatId)
      return false
    }
    return true
  }

  // ------------------------------------------------------------- chat commands

  function handleCommand(link, chatId, text) {
    const command = String(text).trim().toLowerCase().split(/\s+/)[0]
    if (command === '/stop') {
      void stopCurrentTurn(link, chatId)
      return true
    }
    if (command === '/new') {
      void startNewSession(link, chatId)
      return true
    }
    if (command === '/status') {
      void sendBridgeStatus(link, chatId)
      return true
    }
    if (command === '/help') {
      void sendToChat(link, chatId, HELP_TEXT)
      return true
    }
    return false
  }

  async function stopCurrentTurn(link, chatId) {
    const sessionId = link.sessions.get(chatId)
    if (sessionId === undefined) {
      await sendToChat(link, chatId, '当前没有进行中的会话。')
      return
    }
    try {
      ctx.sessionController.cancel({ sessionId })
      await sendToChat(link, chatId, '⏹ 已请求停止当前回合。')
    } catch (error) {
      await sendToChat(link, chatId, `停止失败：${describeError(error)}`)
    }
  }

  async function startNewSession(link, chatId) {
    const base = preferredSessionId(link, chatId)
    const next = `${base}-${Date.now().toString(36)}`
    try {
      const location = link.settings.workspaceId !== ''
        ? { workspaceId: link.settings.workspaceId }
        : link.settings.cwd !== ''
          ? { cwd: link.settings.cwd }
          : {}
      const created = await ctx.sessionController.create({ sessionId: next, ...location })
      const sessionId = String(created?.sessionId ?? next)
      const previous = link.sessions.get(chatId)
      if (previous !== undefined) forgetSession(link, chatId, previous)
      rememberSession(link, chatId, sessionId)
      try {
        await ctx.sessionController.rename({ sessionId, title: link.settings.sessionTitle })
      } catch {
        // A title is optional.
      }
      await sendToChat(link, chatId, `🆕 已开启新会话：${sessionId}`)
    } catch (error) {
      await sendToChat(link, chatId, `新建会话失败：${describeError(error)}`)
    }
  }

  async function sendBridgeStatus(link, chatId) {
    const lines = [
      `🤖 ${link.state.bot?.username === undefined ? link.id : `@${link.state.bot.username}`}`,
      `接入：${link.lockedBy === null ? (link.settings.mode === 'webhook' ? 'Webhook' : '轮询') : `锁定（pid ${link.lockedBy}）`}`,
      `会话：${link.sessions.get(chatId) ?? '（尚未创建）'}`,
      `偏移：${link.state.offset}`,
      `收件箱：${link.inbox.length} 条`,
    ]
    if (link.state.lastError !== null) lines.push(`最近错误：${link.state.lastError}`)
    await sendToChat(link, chatId, lines.join('\n'))
  }

  // --------------------------------------------------------------------- bridge

  function enqueue(link, chatId, entry) {
    const queue = link.queues.get(chatId)
    if (queue === undefined) link.queues.set(chatId, [entry])
    else queue.push(entry)
    void pump(link)
  }

  async function pump(link) {
    if (link.state.pumping) return
    link.state.pumping = true
    try {
      while (!bridgeAbort.signal.aborted) {
        const first = link.queues.entries().next()
        if (first.done === true) break
        const [chatId, queue] = first.value
        const batch = queue.splice(0, queue.length)
        if (queue.length === 0) link.queues.delete(chatId)
        try {
          await bridgeChat(link, chatId, batch)
        } catch (error) {
          for (const entry of batch) entry.status = 'failed'
          log.error('bot "%s" could not answer chat %s: %s', link.id, chatId, describeError(error))
          link.state.lastError = describeError(error)
        }
      }
    } finally {
      link.state.pumping = false
    }
  }

  /**
   * Admit one chat message as a prompt. The reply is not collected here: the
   * session watcher delivers whatever the turn produces, so a scheduled or
   * model-initiated turn in the same session reaches the chat too.
   */
  async function bridgeChat(link, chatId, batch) {
    if (link.api === undefined || batch.length === 0) return
    if (!link.settings.autoReply) return
    const signal = bridgeAbort.signal
    if (signal.aborted) return
    const text = batch.map((entry) => entry.text).join('\n\n')
    let sessionId = await ensureSession(link, chatId, signal)
    await reviveArchivedSession(link, sessionId)
    link.expectTurn.set(sessionId, { at: Date.now(), entries: batch })
    for (const entry of batch) entry.status = 'admitted'
    try {
      await admitPrompt(sessionId, text, signal)
    } catch (error) {
      if (!isSessionNotFound(error)) {
        link.expectTurn.delete(sessionId)
        throw error
      }
      forgetSession(link, chatId, sessionId)
      sessionId = await ensureSession(link, chatId, signal)
      link.expectTurn.set(sessionId, { at: Date.now(), entries: batch })
      await admitPrompt(sessionId, text, signal)
    }
  }

  /**
   * An archived Session rejects every wake at `agent/pre-step`, so an inbound
   * message would be admitted and then blocked with no reply. The bridge owns
   * its bot Sessions, so it lifts the archive before admitting the prompt; a
   * chat that should stay silent is configured with `autoReply: false` instead.
   */
  async function reviveArchivedSession(link, sessionId) {
    let registry
    try {
      registry = ctx.get('workspaceRegistry')
    } catch {
      return
    }
    if (registry === undefined) return
    let archived = false
    try {
      const ids = registry.archivedSessionIds
      archived = Array.isArray(ids) && ids.includes(sessionId)
    } catch {
      return
    }
    if (!archived) return
    try {
      await registry.unarchiveSession(sessionId)
      log.info('bot "%s" unarchived session %s to answer an inbound chat message', link.id, sessionId)
    } catch (error) {
      log.warn('bot "%s" could not unarchive session %s: %s', link.id, sessionId, describeError(error))
    }
  }

  async function ensureSession(link, chatId, signal) {
    const cached = link.sessions.get(chatId)
    if (cached !== undefined) return cached
    const preferred = preferredSessionId(link, chatId)

    try {
      await ctx.sessionController.state({ sessionId: preferred }, signal)
      rememberSession(link, chatId, preferred)
      return preferred
    } catch (error) {
      if (!isSessionNotFound(error)) throw error
    }

    const location = link.settings.workspaceId !== ''
      ? { workspaceId: link.settings.workspaceId }
      : link.settings.cwd !== ''
        ? { cwd: link.settings.cwd }
        : {}
    const created = await ctx.sessionController.create({ sessionId: preferred, ...location })
    const sessionId = String(created?.sessionId ?? preferred)
    rememberSession(link, chatId, sessionId)
    log.info('bot "%s" created session %s for chat %s', link.id, sessionId, chatId)
    try {
      await ctx.sessionController.rename({ sessionId, title: link.settings.sessionTitle })
    } catch (error) {
      log.warn('could not title bot session %s: %s', sessionId, describeError(error))
    }
    return sessionId
  }

  function rememberSession(link, chatId, sessionId) {
    link.sessions.set(chatId, sessionId)
    link.sessionChats.set(sessionId, chatId)
    link.record.sessions[chatId] = sessionId
    store.saveSoon()
  }

  function forgetSession(link, chatId, sessionId) {
    link.sessions.delete(chatId)
    link.sessionChats.delete(sessionId)
    delete link.record.sessions[chatId]
    store.saveSoon()
  }

  async function admitPrompt(sessionId, text, signal) {
    await ctx.sessionController.prompt({
      requestId: `sc3bot-${randomUUID()}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, signal)
  }

  // ------------------------------------------------------- session output watcher

  /**
   * Deliver whatever a bot-bridged Session produces, whoever started the turn:
   * an inbound chat prompt, a scheduled task, or another plugin's follow-up.
   */
  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const owner = sessionOwner(sessionId)
    if (owner === undefined) return
    if (event.type === 'turn/start') onTurnStart(owner, sessionId)
    else if (event.type === 'assistant/message') onAssistantMessage(sessionId, event)
    else if (event.type === 'turn/end') onTurnEnd(sessionId, event)
  })

  function onTurnStart(owner, sessionId) {
    if (owner.link.settings.push !== true || owner.link.api === undefined) return
    const previous = turns.get(sessionId)
    if (previous !== undefined) finishTurn(previous, 'completed', undefined)
    const expected = owner.link.expectTurn.get(sessionId)
    const prompted = expected !== undefined && Date.now() - expected.at <= EXPECT_TURN_WINDOW_MS
    owner.link.expectTurn.delete(sessionId)
    const record = {
      link: owner.link,
      chatId: owner.chatId,
      sessionId,
      text: '',
      prompted,
      entries: prompted ? expected.entries : [],
      stopTyping: startTyping(owner.link, owner.chatId),
      timer: null,
    }
    record.timer = setTimeout(() => {
      if (turns.get(sessionId) !== record) return
      void sendToChat(owner.link, owner.chatId, TIMEOUT_NOTICE)
    }, owner.link.settings.replyTimeoutMs)
    record.timer.unref?.()
    turns.set(sessionId, record)
  }

  function onAssistantMessage(sessionId, event) {
    const record = turns.get(sessionId)
    if (record === undefined) return
    const text = textOfContent(event?.data?.message?.content)
    if (text !== '') record.text = text
  }

  function onTurnEnd(sessionId, event) {
    const record = turns.get(sessionId)
    if (record === undefined) return
    const reason = event?.data?.reason ?? { kind: 'completed' }
    finishTurn(record, reason.kind, reason?.error?.message, Number(event?.seq))
  }

  function finishTurn(record, kind, errorText, endSeq) {
    const active = turns.get(record.sessionId)
    if (active === record) turns.delete(record.sessionId)
    clearTimeout(record.timer)
    record.stopTyping()
    const link = record.link
    if (link.settings.push !== true || link.api === undefined) return
    if (record.text !== '') {
      link.state.replies += 1
      for (const entry of record.entries) entry.status = 'replied'
      if (Number.isSafeInteger(endSeq)) {
        link.pushed.set(record.sessionId, endSeq)
        link.record.pushed[record.sessionId] = endSeq
        store.saveNow()
      }
      void sendToChat(link, record.chatId, record.text)
      return
    }
    for (const entry of record.entries) entry.status = 'empty'
    if (kind === 'error') {
      const detail = typeof errorText === 'string' && errorText !== '' ? `：${errorText}` : '。'
      void sendToChat(link, record.chatId, `⚠️ 这一轮出错${detail}`)
      return
    }
    if (record.prompted && kind !== 'aborted') void sendToChat(link, record.chatId, EMPTY_REPLY_NOTICE)
  }

  /** Which bot owns a Session, and which chat it speaks to. */
  function sessionOwner(sessionId) {
    for (const link of links) {
      const chatId = link.sessionChats.get(sessionId)
      if (chatId !== undefined) return { link, chatId }
    }
    for (const link of links) {
      if (link.settings.sessionId === '' || link.settings.sessionId !== sessionId) continue
      const chatId = link.settings.chatId || [...link.allowedChats][0] || ''
      if (chatId !== '') return { link, chatId }
    }
    const ordered = [...links].sort((a, b) => b.id.length - a.id.length)
    for (const link of ordered) {
      const chatId = chatFromSessionId(link, sessionId)
      if (chatId !== null) return { link, chatId }
    }
    return undefined
  }

  function chatFromSessionId(link, sessionId) {
    if (!sessionId.startsWith(BOT_SESSION_PREFIX)) return null
    if (link.id !== DEFAULT_BOT_ID) {
      const prefix = `${BOT_SESSION_PREFIX}${link.id.replace(/[^0-9A-Za-z_-]/g, '_')}-`
      if (!sessionId.startsWith(prefix)) return null
      const rest = sessionId.slice(prefix.length)
      return rest === '' ? null : rest
    }
    const rest = sessionId.slice(BOT_SESSION_PREFIX.length)
    return /^\d+$/.test(rest) ? rest : null
  }

  // ------------------------------------------------------ question & approval cards

  /**
   * Question and approval cards block the turn until someone answers. The bridge
   * shows them in both places at once — the chat message and the Web UI card —
   * and the first answer wins. The chat keeps its pending entry after the
   * "still on the web" notice, so a late chat answer still counts.
   *
   * The listeners are prepended so the chat gets the request before the
   * browser's answerer claims it, yet they still call next() immediately so the
   * card renders.
   */
  ctx.on('user-questions/request', (request, next) => {
    const owner = botOwnerOf(request?.agent)
    if (owner === undefined) return next()
    const questions = Array.isArray(request?.questions) ? request.questions : []
    if (questions.length === 0) return next()
    return forwardQuestions(owner, questions, request, next)
  }, { prepend: true })

  ctx.on('approval/request', (request, next) => {
    const owner = botOwnerOf(request?.agent)
    if (owner === undefined) return next()
    return forwardApproval(owner, request, next)
  }, { prepend: true })

  function botOwnerOf(agent) {
    if (agent === undefined) return undefined
    const owner = sessionOwner(String(agent.id))
    if (owner === undefined || owner.link.api === undefined) return undefined
    if (owner.link.settings.questions !== true) return undefined
    return owner
  }

  async function forwardQuestions(owner, questions, request, handOff) {
    const { link, chatId } = owner
    const batch = `q-${randomUUID()}`
    const run = async () => {
      const answers = []
      for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index]
        if (!(await sendToChat(link, chatId, formatQuestion(question, index, questions.length)))) return null
        armTimeoutNotice(link, chatId, batch)
        const reply = await waitForChatAnswer(link, chatId, batch, request?.signal)
        if (reply === null) return null
        answers.push(answerItem(question, reply))
      }
      return { answers }
    }
    return settle(owner, batch, handOff, run, request?.signal)
  }

  async function forwardApproval(owner, request, handOff) {
    const { link, chatId } = owner
    const batch = `a-${randomUUID()}`
    const run = async () => {
      const reason = request?.displayReason?.zh ?? request?.displayReason?.en ?? request?.reason
      const lines = ['🔐 需要你的批准', `工具：${request?.toolName ?? '未知'}`]
      if (typeof reason === 'string' && reason !== '') lines.push(`原因：${reason}`)
      lines.push('', '回复「允许」或「拒绝」；允许只对这一次生效。')
      if (!(await sendToChat(link, chatId, lines.join('\n')))) return null
      armTimeoutNotice(link, chatId, batch)
      for (;;) {
        const reply = await waitForChatAnswer(link, chatId, batch, request?.signal)
        if (reply === null) return null
        const outcome = approvalOutcome(reply)
        if (outcome !== null) return outcome
        await sendToChat(link, chatId, '没看懂，请回复「允许」或「拒绝」。')
      }
    }
    return settle(owner, batch, handOff, run, request?.signal)
  }

  /**
   * Race the chat answer against the browser card. `handOff` is the rest of the
   * waterfall chain: its rejection means no browser answerer exists, so the chat
   * keeps the question. The losing side is cancelled; the chat is told when the
   * web wins.
   */
  async function settle(owner, batch, handOff, run, signal) {
    const { link, chatId } = owner
    let webPromise = null
    const startWeb = () => {
      if (webPromise === null) {
        webPromise = Promise.resolve()
          .then(() => handOff())
          .then((value) => ({ kind: 'web', value }))
          .catch((error) => ({ kind: 'web-error', error }))
      }
      return webPromise
    }
    const chat = Promise.resolve()
      .then(run)
      .then((value) => ({ kind: 'chat', value }))
      .catch((error) => ({ kind: 'chat-error', error }))

    // The client card cannot be withdrawn from the host: its pending interaction
    // only settles through its own answer, the request abort, or plugin teardown.
    // So the card is published after a grace window — if the chat answered inside
    // it, no card is ever created and nothing can be left behind.
    if (link.settings.cardDelayMs > 0) {
      const early = await Promise.race([
        chat,
        delay(link.settings.cardDelayMs, signal).then(() => ({ kind: 'delay' })),
      ])
      if (early.kind === 'chat' && early.value !== null) {
        clearBatch(link, batch)
        return early.value
      }
      if (early.kind === 'chat') {
        const fallback = await startWeb()
        if (fallback.kind === 'web') return fallback.value
        throw fallback.error
      }
    }

    const web = startWeb()
    const winner = await Promise.race([web, chat])
    if (winner.kind === 'web') {
      const hadPending = hasBatch(link, batch)
      clearBatch(link, batch)
      if (hadPending) void sendToChat(link, chatId, ANSWERED_ON_WEB_NOTICE)
      return winner.value
    }
    if (winner.kind === 'chat' && winner.value !== null) {
      clearBatch(link, batch)
      return winner.value
    }
    if (signal?.aborted === true) throw new Error('the card request was cancelled')
    const remaining = await web
    if (remaining.kind === 'web') return remaining.value
    throw remaining.error
  }

  function waitForChatAnswer(link, chatId, batch, signal) {
    return new Promise((resolve) => {
      const entry = { batch, finish: null }
      const finish = (value) => {
        const list = link.pending.get(chatId)
        if (list !== undefined) {
          const index = list.indexOf(entry)
          if (index >= 0) list.splice(index, 1)
          if (list.length === 0) link.pending.delete(chatId)
        }
        resolve(value)
      }
      entry.finish = finish
      const list = link.pending.get(chatId)
      if (list === undefined) link.pending.set(chatId, [entry])
      else list.push(entry)
      if (signal !== undefined) {
        if (signal.aborted) finish(null)
        else signal.addEventListener('abort', () => finish(null), { once: true })
      }
    })
  }

  function hasBatch(link, batch) {
    for (const list of link.pending.values()) {
      if (list.some((entry) => entry.batch === batch)) return true
    }
    return false
  }

  function clearBatch(link, batch) {
    const timer = link.timeouts.get(batch)
    if (timer !== undefined) {
      clearTimeout(timer)
      link.timeouts.delete(batch)
    }
    for (const list of [...link.pending.values()]) {
      for (const entry of [...list]) {
        if (entry.batch === batch) entry.finish(null)
      }
    }
  }

  function armTimeoutNotice(link, chatId, batch) {
    if (link.timeouts.has(batch)) return
    const timer = setTimeout(() => {
      link.timeouts.delete(batch)
      if (!hasBatch(link, batch)) return
      void sendToChat(link, chatId, QUESTION_TIMEOUT_NOTICE)
    }, link.settings.questionTimeoutMs)
    timer.unref?.()
    link.timeouts.set(batch, timer)
  }

  function approvalOutcome(text) {
    const value = String(text).trim().toLowerCase()
    if (/^(允许|同意|批准|可以|是|y|yes|ok|allow|approve|1)$/.test(value)) return 'allowed-once'
    if (/^(拒绝|不允许|否|不|n|no|deny|reject|2)$/.test(value)) return 'rejected'
    return null
  }

  function formatQuestion(question, index, total) {
    const lines = [total > 1 ? `❓ 需要你的回答（${index + 1}/${total}）` : '❓ 需要你的回答']
    if (typeof question.header === 'string' && question.header !== '') lines.push(`**${question.header}**`)
    lines.push(question.question)
    if (typeof question.detail === 'string' && question.detail !== '') lines.push('', question.detail)
    const options = Array.isArray(question.options) ? question.options : []
    if (options.length === 0) {
      lines.push('', '直接回复文字即可。')
    } else {
      lines.push('', '选项：')
      options.forEach((option, position) => {
        const description = typeof option.description === 'string' && option.description !== '' ? ` — ${option.description}` : ''
        lines.push(`${position + 1}. ${option.label}${description}`)
      })
      lines.push('', question.multiSelect === true ? '回复序号或文字，多选用逗号分隔。' : '回复序号或文字。')
    }
    return lines.join('\n')
  }

  /** Map one chat reply onto the question's option labels, or keep it as free text. */
  function answerItem(question, text) {
    const options = Array.isArray(question.options) ? question.options : []
    const parts = question.multiSelect === true ? String(text).split(/[,，、;；\s]+/) : [String(text)]
    const selected = []
    let custom
    for (const part of parts) {
      const value = part.trim()
      if (value === '') continue
      const numeric = Number(value)
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
        selected.push(options[numeric - 1].label)
        continue
      }
      const lower = value.toLowerCase()
      const exact = options.find((option) => option.label.trim().toLowerCase() === lower)
      if (exact !== undefined) {
        selected.push(exact.label)
        continue
      }
      const partial = options.find((option) => option.label.trim().toLowerCase().startsWith(lower))
      if (partial !== undefined) {
        selected.push(partial.label)
        continue
      }
      if (custom === undefined) custom = value
    }
    if (selected.length === 0 && custom === undefined && String(text).trim() !== '') custom = String(text).trim()
    const unique = [...new Set(selected)]
    return {
      id: question.id,
      selected: question.multiSelect === true ? unique : unique.slice(0, 1),
      ...(custom === undefined ? {} : { custom }),
    }
  }

  /**
   * Deliver one logical message: split long text on paragraph boundaries and
   * retry each chunk a few times before recording the failure.
   */
  async function sendToChat(link, chatId, text) {
    if (link.api === undefined) return false
    let ok = true
    for (const chunk of chunkText(text, link.settings.maxReplyChars)) {
      if (!(await deliver(link, chatId, chunk))) ok = false
    }
    return ok
  }

  async function deliver(link, chatId, text) {
    let failure
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await link.api.sendMessage({ chatId, text, parseMode: 'markdown', silent: false })
        return true
      } catch (error) {
        failure = error
        if (attempt < 2) await delay(300 * 3 ** attempt, bridgeAbort.signal)
      }
    }
    const message = describeError(failure)
    link.state.lastError = message
    link.state.failed.push({ at: Date.now(), chatId, error: message, text: text.slice(0, 200) })
    if (link.state.failed.length > 10) link.state.failed.shift()
    log.error('bot "%s" could not deliver a message to chat %s: %s', link.id, chatId, message)
    return false
  }

  function startTyping(link, chatId) {
    if (link.api === undefined || !link.settings.typing) return () => {}
    let stopped = false
    const tick = () => {
      if (stopped || link.api === undefined) return
      void link.api.sendChatAction({ chatId, action: 'typing' }).catch(() => {})
    }
    tick()
    const timer = setInterval(tick, 5000)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  function isBotSession(sessionId) {
    if (sessionId.startsWith(BOT_SESSION_PREFIX)) return true
    for (const link of links) {
      if (link.sessionChats.has(sessionId)) return true
      if (link.settings.sessionId !== '' && link.settings.sessionId === sessionId) return true
    }
    return false
  }
}

// ----------------------------------------------------------------------- helpers

/**
 * Small JSON store under the profile's data directory. It holds the poll offset,
 * the confirmed update ids, chat→session bindings, and the last pushed sequence
 * per session, so a restart neither replays confirmed updates nor re-sends a
 * turn that was already delivered.
 */
function openStateStore(ctx, log) {
  let dir = null
  try {
    const profile = ctx.get('profileContext')
    if (profile !== undefined && typeof profile.dir === 'string') {
      dir = join(profile.dir, 'data', 'serverchan-bot')
    }
  } catch {
    dir = null
  }
  const data = { version: 1, bots: {} }
  if (dir !== null) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.bots !== null && typeof parsed.bots === 'object') {
        data.bots = parsed.bots
      }
    } catch {
      // Missing or unreadable state is simply an empty state.
    }
  }
  let timer = null
  const readFileState = () => {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.bots !== null && typeof parsed.bots === 'object') return parsed
    } catch {
      // No readable state.
    }
    return { version: 1, bots: {} }
  }
  const saveNow = () => {
    if (dir === null) return
    try {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'state.json')
      // Two plugin generations can briefly overlap (a reload), and each holds its
      // own snapshot; merge on write so neither loses the other's progress.
      const merged = mergeState(data, readFileState())
      const temporary = `${file}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(merged)}\n`, { mode: 0o600 })
      renameSync(temporary, file)
    } catch (error) {
      log.warn('could not persist bridge state: %s', error instanceof Error ? error.message : String(error))
    }
  }
  return {
    dir,
    data,
    bot(id) {
      const record = data.bots[id]
      if (record !== null && typeof record === 'object') return record
      const created = { offset: 0, seen: [], sessions: {}, pushed: {} }
      data.bots[id] = created
      return created
    },
    saveSoon() {
      if (dir === null) return
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        saveNow()
      }, 500)
      timer.unref?.()
    },
    saveNow,
  }
}

const heldLocks = new Set()

/** Merge two state documents, keeping the union of progress (offset/seen/pushed). */
function mergeState(mine, other) {
  const bots = {}
  const ids = new Set([...Object.keys(mine.bots ?? {}), ...Object.keys(other?.bots ?? {})])
  for (const id of ids) {
    const a = mine.bots?.[id] ?? {}
    const b = other?.bots?.[id] ?? {}
    const seen = [...new Set([...(Array.isArray(a.seen) ? a.seen : []), ...(Array.isArray(b.seen) ? b.seen : [])])]
    const sessions = { ...(b.sessions ?? {}), ...(a.sessions ?? {}) }
    const pushed = { ...(b.pushed ?? {}), ...(a.pushed ?? {}) }
    bots[id] = {
      offset: Math.max(Number.isSafeInteger(a.offset) ? a.offset : 0, Number.isSafeInteger(b.offset) ? b.offset : 0),
      seen,
      sessions,
      pushed,
    }
  }
  return { version: 1, bots }
}

/**
 * One process may poll a Bot token at a time, otherwise every instance answers
 * the same message. The lock is a pid file; a dead holder is taken over, while
 * a lock this process still holds is respected.
 */
function acquireTokenLock(dir, token, log) {
  if (dir === null || token === '') return { release() {}, heldBy: null }
  const locks = join(dir, 'locks')
  try {
    mkdirSync(locks, { recursive: true })
  } catch (error) {
    log.warn('could not create the lock directory: %s', error instanceof Error ? error.message : String(error))
    return { release() {}, heldBy: null }
  }
  const name = createHash('sha1').update(token).digest('hex').slice(0, 16)
  const file = join(locks, `${name}.lock`)
  if (heldLocks.has(file)) {
    log.warn('bot token is already used by another plugin instance in this process; this instance will not answer for it')
    return { release() {}, heldBy: process.pid }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
      closeSync(fd)
      heldLocks.add(file)
      return {
        heldBy: null,
        release() {
          heldLocks.delete(file)
          try {
            unlinkSync(file)
          } catch {
            // Already gone.
          }
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') break
      let holder = null
      try {
        holder = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        holder = null
      }
      const pid = Number(holder?.pid)
      let alive = false
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          alive = true
        } catch {
          alive = false
        }
      }
      if (alive && pid === process.pid && !heldLocks.has(file)) alive = false
      if (alive) {
        log.warn('bot token is already polled by pid %s; this instance will not answer for it', pid)
        return { release() {}, heldBy: pid }
      }
      try {
        unlinkSync(file)
      } catch {
        // Retry the exclusive create below.
      }
    }
  }
  return { release() {}, heldBy: null }
}

/** Session id for one bot chat: explicit sessionId, or a per-bot per-chat id. */
function preferredSessionId(link, chatId) {
  if (link.settings.sessionId !== '') return link.settings.sessionId
  const chat = String(chatId).replace(/[^0-9A-Za-z_-]/g, '_')
  if (link.id === DEFAULT_BOT_ID) return `${BOT_SESSION_PREFIX}${chat}`
  const bot = link.id.replace(/[^0-9A-Za-z_-]/g, '_')
  return `${BOT_SESSION_PREFIX}${bot}-${chat}`
}

/**
 * Whitelist one settings form submission into a stored bot row. An empty token
 * keeps the token already stored for that bot id, so the page never needs to
 * receive a secret back.
 */
function sanitizeBot(raw, index, knownTokens) {
  const bot = raw !== null && typeof raw === 'object' ? raw : {}
  const id = asText(bot.id) || `bot${index + 1}`
  const token = asText(bot.token) || knownTokens.get(id.toLowerCase()) || ''
  return {
    id,
    token,
    chatId: asText(bot.chatId),
    allowChatIds: stringList(bot.allowChatIds),
    sessionId: asText(bot.sessionId),
    sessionTitle: asText(bot.sessionTitle),
    workspaceId: asText(bot.workspaceId),
    cwd: asText(bot.cwd),
    baseUrl: asText(bot.baseUrl),
    poll: bool(bot.poll, true),
    mode: asText(bot.mode) === 'webhook' ? 'webhook' : 'poll',
    webhookSecret: asText(bot.webhookSecret),
    autoReply: bool(bot.autoReply, true),
    push: bool(bot.push, true),
    questions: bool(bot.questions, true),
    typing: bool(bot.typing, true),
    pollTimeoutSeconds: integer(bot.pollTimeoutSeconds, 20, 0, 30),
    replyTimeoutMs: integer(bot.replyTimeoutMs, 180000, 5000, 1800000),
    questionTimeoutMs: integer(bot.questionTimeoutMs, 600000, 30000, 3600000),
    cardDelayMs: integer(bot.cardDelayMs, 8000, 0, 120000),
    maxReplyChars: integer(bot.maxReplyChars, 8000, 500, 30000),
  }
}

/**
 * Normalize the two accepted shapes into one account list:
 *  - single Bot: top-level token/chatId/…, as before;
 *  - `bots`: one entry per Bot, each with its own token, chat and session.
 */
function normalizeConfig(config) {
  const input = config !== null && typeof config === 'object' ? config : {}
  const shared = {
    baseUrl: asText(input.baseUrl) || 'https://bot-go.apijia.cn',
    poll: bool(input.poll, true),
    mode: asText(input.mode) === 'webhook' ? 'webhook' : 'poll',
    webhookSecret: asText(input.webhookSecret),
    autoReply: bool(input.autoReply, true),
    push: bool(input.push, true),
    questions: bool(input.questions, true),
    typing: bool(input.typing, true),
    pollTimeoutSeconds: integer(input.pollTimeoutSeconds, 20, 0, 30),
    replyTimeoutMs: integer(input.replyTimeoutMs, 180000, 5000, 1800000),
    questionTimeoutMs: integer(input.questionTimeoutMs, 600000, 30000, 3600000),
    cardDelayMs: integer(input.cardDelayMs, 8000, 0, 120000),
    maxReplyChars: integer(input.maxReplyChars, 8000, 500, 30000),
    workspaceId: asText(input.workspaceId),
    cwd: asText(input.cwd),
  }
  const bots = Array.isArray(input.bots) ? input.bots : []
  const accounts = []

  if (bots.length === 0) {
    accounts.push({
      id: DEFAULT_BOT_ID,
      baseUrl: shared.baseUrl,
      token: asText(input.token)
        || asText(process.env.SERVERCHAN_BOT_TOKEN)
        || asText(process.env.DSH_SERVERCHAN_BOT_TOKEN),
      chatId: asText(input.chatId) || asText(process.env.SERVERCHAN_BOT_CHAT_ID),
      allowChatIds: stringList(input.allowChatIds),
      sessionId: asText(input.sessionId),
      poll: shared.poll,
      mode: shared.mode,
      webhookSecret: shared.webhookSecret,
      autoReply: shared.autoReply,
      push: shared.push,
      questions: shared.questions,
      typing: shared.typing,
      pollTimeoutSeconds: shared.pollTimeoutSeconds,
      replyTimeoutMs: shared.replyTimeoutMs,
      questionTimeoutMs: shared.questionTimeoutMs,
      cardDelayMs: shared.cardDelayMs,
      maxReplyChars: shared.maxReplyChars,
      workspaceId: shared.workspaceId,
      cwd: shared.cwd,
      sessionTitle: asText(input.sessionTitle) || 'Server酱³ Bot',
    })
  } else {
    bots.forEach((raw, index) => {
      const bot = raw !== null && typeof raw === 'object' ? raw : {}
      const id = asText(bot.id) || `bot${index + 1}`
      accounts.push({
        id,
        baseUrl: asText(bot.baseUrl) || shared.baseUrl,
        token: asText(bot.token),
        chatId: asText(bot.chatId),
        allowChatIds: stringList(bot.allowChatIds),
        sessionId: asText(bot.sessionId),
        poll: bool(bot.poll, shared.poll),
        mode: asText(bot.mode) === 'webhook' ? 'webhook' : shared.mode,
        webhookSecret: asText(bot.webhookSecret) || shared.webhookSecret,
        autoReply: bool(bot.autoReply, shared.autoReply),
        push: bool(bot.push, shared.push),
        questions: bool(bot.questions, shared.questions),
        typing: bool(bot.typing, shared.typing),
        pollTimeoutSeconds: integer(bot.pollTimeoutSeconds, shared.pollTimeoutSeconds, 0, 30),
        replyTimeoutMs: integer(bot.replyTimeoutMs, shared.replyTimeoutMs, 5000, 1800000),
        questionTimeoutMs: integer(bot.questionTimeoutMs, shared.questionTimeoutMs, 30000, 3600000),
        cardDelayMs: integer(bot.cardDelayMs, shared.cardDelayMs, 0, 120000),
        maxReplyChars: integer(bot.maxReplyChars, shared.maxReplyChars, 500, 30000),
        workspaceId: asText(bot.workspaceId) || shared.workspaceId,
        cwd: asText(bot.cwd) || shared.cwd,
        sessionTitle: asText(bot.sessionTitle)
          || (id === DEFAULT_BOT_ID ? 'Server酱³ Bot' : `Server酱³ Bot (${id})`),
      })
    })
  }

  const seenIds = new Set()
  const seenTokens = new Set()
  for (const account of accounts) {
    const id = account.id.toLowerCase()
    if (seenIds.has(id)) {
      throw new Error(`serverchan-bot: duplicate bot id "${account.id}" in config.bots`)
    }
    seenIds.add(id)
    if (account.token === '') continue
    if (seenTokens.has(account.token)) {
      throw new Error(
        `serverchan-bot: bot "${account.id}" reuses another bot's token; two pollers on one token would answer every message twice`,
      )
    }
    seenTokens.add(account.token)
  }
  return { accounts }
}

function asText(value) {
  if (typeof value === 'string') return value.trim()
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function integer(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => asText(entry)).filter((entry) => entry !== '')
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Split long text on paragraph, line, or space boundaries, keeping order. */
function chunkText(text, max) {
  const clean = String(text).trim()
  if (clean.length <= max) return clean === '' ? [] : [clean]
  const chunks = []
  let rest = clean
  while (rest.length > 0 && chunks.length < 8) {
    if (rest.length <= max) {
      chunks.push(rest)
      rest = ''
      break
    }
    let cut = rest.lastIndexOf('\n\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut < max * 0.5) cut = max
    chunks.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest.length > 0) chunks.push(`${rest.slice(0, Math.max(0, max - 40))}\n\n…（内容过长已截断）`)
  return chunks.filter((chunk) => chunk !== '')
}

function clip(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 40))}\n\n…（内容过长已截断，完整内容见 DSH）`
}

function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('').trim()
}

function isSessionNotFound(error) {
  if (error?.code === 'session/not-found') return true
  const message = error instanceof Error ? error.message : String(error)
  return /session\/not-found/i.test(message)
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    timer.unref?.()
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}
