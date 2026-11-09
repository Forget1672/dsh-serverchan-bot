/**
 * Offline smoke test for the Server酱³ Bot bridge.
 *
 * It fakes the Bot API (global fetch) and the Host services the plugin uses, so
 * the downlink tool and the uplink poll → prompt → reply loops can be checked
 * without a real Bot Token or a running Harness — including several Bots at once.
 *
 *   node test/bridge.test.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const bot = {
  calls: [],
  queues: new Map(), // token -> pending updates
  nextMessageId: 100,
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url))
  const segments = target.pathname.split('/')
  const method = segments.pop()
  const token = segments.pop().replace(/^bot/, '')
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  bot.calls.push({ token, method, url: String(url), body })

  if (method === 'getMe') {
    return jsonResponse({ ok: true, result: { id: 1, name: `DSH ${token}`, username: `dsh_${token}` } })
  }
  if (method === 'sendChatAction') return jsonResponse({ ok: true, result: true })
  if (method === 'sendMessage') {
    return jsonResponse({ ok: true, result: { message_id: bot.nextMessageId++, chat_id: body.chat_id, text: body.text } })
  }
  if (method === 'getUpdates') {
    const offset = Number(target.searchParams.get('offset') ?? 0)
    const pending = bot.queues.get(token) ?? []
    return jsonResponse({ ok: true, result: pending.filter((update) => update.update_id >= offset) })
  }
  return jsonResponse({ ok: false, error_code: 404, description: `unknown method ${method}` }, 404)
}

function resetBot() {
  bot.calls.length = 0
  bot.queues.clear()
  bot.nextMessageId = 100
}

function queueUpdates(token, updates) {
  bot.queues.set(token, updates)
}

function callsOf(method) {
  return bot.calls.filter((call) => call.method === method)
}

function createHarness({ archived = [], dir = null, events = null } = {}) {
  const tools = new Map()
  const unarchived = []
  const cancels = []
  const routes = new Map()
  const edits = []
  const listeners = new Map()
  const sessions = new Map()
  const prompts = []
  const created = []
  const renamed = []
  const cleanups = []

  const sessionState = (sessionId) => {
    const session = sessions.get(sessionId)
    if (session === undefined) {
      const error = new Error(`session "${sessionId}" not found`)
      error.code = 'session/not-found'
      throw error
    }
    return { cursor: session.cursor }
  }

  const emitSession = (sessionId, events) => {
    for (const event of events) {
      for (const listener of listeners.get('session/event') ?? []) listener({ id: sessionId }, event)
    }
  }

  const sessionController = {
    async state({ sessionId }) {
      return sessionState(sessionId)
    },
    async create(request) {
      created.push(request)
      sessions.set(request.sessionId, { cursor: 100 })
      return { sessionId: request.sessionId }
    },
    async rename(request) {
      renamed.push(request)
      return { title: request.title, seq: 1 }
    },
    async prompt(request) {
      prompts.push(request)
      const session = sessions.get(request.sessionId)
      session.cursor += 2
      emitSession(request.sessionId, [
        { type: 'turn/start', seq: session.cursor, time: Date.now(), data: { turn: 1 } },
        {
          type: 'assistant/message',
          seq: session.cursor + 1,
          time: Date.now(),
          data: {
            turn: 1,
            step: 1,
            message: { role: 'assistant', content: [{ type: 'text', text: '你好，我在。' }] },
            stream: [],
          },
        },
        { type: 'turn/end', seq: session.cursor + 2, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } },
      ])
    },
    async events(request) {
      if (events !== null) return events(request)
      return { records: [], hasMore: false, cursor: 0 }
    },
    cancel(request) {
      cancels.push(request)
      return { accepted: true }
    },
    async wait() {
      return {
        reason: 'idle',
        state: { cursor: 110 },
        output: {
          records: [{
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 110,
              data: {
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: '你好，我在。' }],
                },
              },
            },
          }],
          truncated: false,
        },
      }
    },
  }

  const webServer = {
    getOrigin() {
      return 'http://127.0.0.1:3080'
    },
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const workspaceRegistry = {
    archivedSessionIds: archived,
    async unarchiveSession(sessionId) {
      unarchived.push(sessionId)
      const index = archived.indexOf(sessionId)
      if (index >= 0) archived.splice(index, 1)
    },
  }

  const configEditor = {
    async edit(entry, change) {
      edits.push({ entry, next: change({ token: 'stored-token', chatId: '777', typing: true, bots: [] }, {}) })
    },
  }

  const ctx = {
    fiber: { entry: { id: 'serverchan-bot', name: '@local/serverchan-bot' } },
    logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(fn) {
      const cleanup = fn()
      cleanups.push(cleanup)
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
    get: (name) => {
      if (name === 'workspaceRegistry') return workspaceRegistry
      if (name === 'configEditor') return configEditor
      if (name === 'profileContext') return dir === null ? undefined : { dir }
      if (name === 'webServer') return webServer
      return undefined
    },
    inject(names, callback) {
      if (!names.includes('webServer')) return
      callback({
        effect(fn, _label) {
          const cleanup = fn()
          return () => {
            if (typeof cleanup === 'function') cleanup()
          }
        },
        webServer,
      })
    },
    agents: { get: () => undefined },
    sessionController,
  }

  const dispose = () => {
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') cleanup()
    }
    cleanups.length = 0
  }

  return { ctx, tools, sessions, prompts, created, renamed, listeners, sessionController, unarchived, workspaceRegistry, edits, routes, cancels, emitSession, dispose }
}

async function waitFor(predicate, label, timeoutMs = 2000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function testSingleBot() {
  resetBot()
  queueUpdates('test-one', [{ update_id: 5, message: { message_id: 10, chat_id: 777, text: '你好' } }])
  const harness = createHarness()
  apply(harness.ctx, {
    token: 'test-one',
    chatId: '777',
    typing: false,
    pollTimeoutSeconds: 0,
    replyTimeoutMs: 5000,
  })

  try {
    const tool = harness.tools.get('serverchan_bot')
    assert.ok(tool, 'tool registered')
    assert.equal(tool.parameters.type, 'object')
    assert.deepEqual(tool.parameters.required, ['action'])
    assert.ok(tool.parameters.properties.bot, 'bot selector is part of the schema')

    // Uplink: poll delivers the chat text as a prompt, then the reply goes back.
    await waitFor(() => harness.created.length === 1, 'bot session creation')
    assert.equal(harness.created[0].sessionId, 'session-sc3bot-777')
    assert.equal(harness.renamed[0].title, 'Server酱³ Bot')

    await waitFor(() => harness.prompts.length === 1, 'prompt admission')
    assert.equal(harness.prompts[0].sessionId, 'session-sc3bot-777')
    assert.equal(harness.prompts[0].content[0].text, '你好')
    assert.equal(harness.prompts[0].mode, 'queue')

    await waitFor(() => callsOf('sendMessage').length >= 1, 'reply delivery')
    const reply = callsOf('sendMessage')[0]
    assert.equal(reply.token, 'test-one')
    assert.equal(reply.body.chat_id, 777)
    assert.equal(reply.body.parse_mode, 'markdown')
    assert.match(reply.body.text, /你好，我在。/)

    // Downlink tool: status and send.
    const status = await tool.execute({ action: 'status' })
    assert.equal(status.ok, true)
    assert.equal(status.configured, true)
    assert.equal(status.bot.name, 'DSH test-one')
    assert.deepEqual(status.allowChatIds, ['777'])
    assert.equal(status.sessions[0].sessionId, 'session-sc3bot-777')
    assert.equal(status.accounts.length, 1)
    assert.equal(status.accounts[0].id, 'default')

    const sent = await tool.execute({ action: 'send', text: '构建完成 ✅' })
    assert.equal(sent.ok, true)
    assert.equal(sent.bot, 'default')
    assert.equal(sent.chatId, '777')
    assert.equal(callsOf('sendMessage').at(-1).token, 'test-one')

    // Inbox keeps what arrived, and records the bridge outcome.
    const inbox = await tool.execute({ action: 'inbox' })
    assert.equal(inbox.count, 1)
    assert.equal(inbox.messages[0].bot, 'default')
    assert.equal(inbox.messages[0].chatId, '777')
    assert.equal(inbox.messages[0].text, '你好')
    assert.equal(inbox.messages[0].status, 'replied')

    // A chat outside the allowlist is rejected.
    await assert.rejects(
      () => tool.execute({ action: 'send', chatId: '999', text: 'nope' }),
      /not allowed/,
    )
  } finally {
    harness.dispose()
  }
}

async function testMultiBot() {
  resetBot()
  queueUpdates('tok-work', [{ update_id: 5, message: { message_id: 10, chat_id: 111, text: '工作号消息' } }])
  queueUpdates('tok-home', [{ update_id: 7, message: { message_id: 20, chat_id: 222, text: '家庭号消息' } }])
  const harness = createHarness()
  apply(harness.ctx, {
    bots: [
      { id: 'work', token: 'tok-work', chatId: '111' },
      { id: 'home', token: 'tok-home', chatId: '222', sessionId: 'session-home-chat' },
    ],
    typing: false,
    pollTimeoutSeconds: 0,
    replyTimeoutMs: 5000,
  })

  try {
    const tool = harness.tools.get('serverchan_bot')

    // Each bot gets its own session: per-bot per-chat id, or the pinned one.
    await waitFor(() => harness.created.length === 2, 'two bot sessions')
    const createdIds = harness.created.map((request) => request.sessionId).sort()
    assert.deepEqual(createdIds, ['session-home-chat', 'session-sc3bot-work-111'])
    assert.equal(harness.renamed.find((entry) => entry.sessionId === 'session-sc3bot-work-111').title, 'Server酱³ Bot (work)')

    await waitFor(() => harness.prompts.length === 2, 'two prompts')
    await waitFor(() => callsOf('sendMessage').length >= 2, 'two replies')
    const replies = callsOf('sendMessage').filter((call) => !call.body.text.includes('DSH 本轮'))
    const workReply = replies.find((call) => call.token === 'tok-work')
    const homeReply = replies.find((call) => call.token === 'tok-home')
    assert.equal(workReply.body.chat_id, 111)
    assert.equal(homeReply.body.chat_id, 222)

    // Status lists both accounts, and the tool needs a selector for send.
    const status = await tool.execute({ action: 'status' })
    assert.equal(status.accounts.length, 2)
    assert.deepEqual(status.accounts.map((account) => account.id), ['work', 'home'])
    assert.equal(status.accounts[0].bot.name, 'DSH tok-work')
    await assert.rejects(() => tool.execute({ action: 'send', text: 'x' }), /multiple bots/)
    await assert.rejects(() => tool.execute({ action: 'send', bot: 'nope', text: 'x' }), /unknown bot/)

    const sent = await tool.execute({ action: 'send', bot: 'home', text: '只发给家庭号' })
    assert.equal(sent.bot, 'home')
    assert.equal(callsOf('sendMessage').at(-1).token, 'tok-home')
    assert.equal(callsOf('sendMessage').at(-1).body.chat_id, 222)

    // Inbox aggregates across bots and can be filtered by bot.
    const inbox = await tool.execute({ action: 'inbox', drain: false })
    assert.equal(inbox.count, 2)
    assert.deepEqual(inbox.messages.map((message) => message.bot).sort(), ['home', 'work'])
    const homeInbox = await tool.execute({ action: 'inbox', bot: 'home', drain: false })
    assert.equal(homeInbox.count, 1)
    assert.equal(homeInbox.messages[0].chatId, '222')
  } finally {
    harness.dispose()
  }
}

async function testAllowlistRejection() {
  resetBot()
  queueUpdates('test-one', [{ update_id: 9, message: { message_id: 30, chat_id: 888, text: 'hi' } }])
  const harness = createHarness()
  apply(harness.ctx, {
    token: 'test-one',
    chatId: '777',
    typing: false,
    pollTimeoutSeconds: 0,
    replyTimeoutMs: 1000,
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(harness.prompts.length, 0, 'unlisted chat must not drive the agent')
    assert.equal(harness.created.length, 0)
    const inbox = await harness.tools.get('serverchan_bot').execute({ action: 'inbox' })
    assert.equal(inbox.count, 1)
    assert.equal(inbox.messages[0].status, 'rejected')
  } finally {
    harness.dispose()
  }
}

async function testFirstContactPairing() {
  resetBot()
  queueUpdates('test-one', [{ update_id: 12, message: { message_id: 40, chat_id: 555, text: 'ping' } }])
  const harness = createHarness()
  apply(harness.ctx, {
    token: 'test-one',
    typing: false,
    pollTimeoutSeconds: 0,
    replyTimeoutMs: 1000,
  })
  try {
    await waitFor(() => harness.prompts.length === 1, 'pairing prompt')
    assert.equal(harness.created[0].sessionId, 'session-sc3bot-555')
    await waitFor(() => callsOf('sendMessage').length >= 1, 'pairing reply')
    const status = await harness.tools.get('serverchan_bot').execute({ action: 'status' })
    assert.deepEqual(status.allowChatIds, ['555'])
  } finally {
    harness.dispose()
  }
}

async function testArchivedRevival() {
  resetBot()
  queueUpdates('test-one', [{ update_id: 15, message: { message_id: 50, chat_id: 501, text: '在吗' } }])
  const harness = createHarness({ archived: ['session-sc3bot-501'] })
  harness.sessions.set('session-sc3bot-501', { cursor: 50 })
  apply(harness.ctx, {
    token: 'test-one',
    chatId: '501',
    typing: false,
    pollTimeoutSeconds: 0,
    replyTimeoutMs: 1000,
  })
  try {
    await waitFor(() => harness.prompts.length === 1, 'prompt after revival')
    assert.deepEqual(harness.unarchived, ['session-sc3bot-501'], 'archived bot session is lifted before the prompt')
    assert.equal(harness.created.length, 0, 'the archived session is resumed, not replaced')
    await waitFor(() => callsOf('sendMessage').length >= 1, 'reply after revival')
  } finally {
    harness.dispose()
  }
}

async function testUnconfigured() {
  resetBot()
  const harness = createHarness()
  apply(harness.ctx, { token: '', chatId: '' })
  try {
    const tool = harness.tools.get('serverchan_bot')
    const status = await tool.execute({ action: 'status' })
    assert.equal(status.ok, true)
    assert.equal(status.configured, false)
    assert.equal(status.bridge, false)
    await assert.rejects(() => tool.execute({ action: 'send', text: 'x' }), /not configured/)
    await assert.rejects(() => tool.execute({ action: 'nonsense' }), /unknown action/)
  } finally {
    harness.dispose()
  }
}

async function testDuplicateTokens() {
  resetBot()
  const harness = createHarness()
  assert.throws(
    () => apply(harness.ctx, { bots: [{ id: 'a', token: 'same' }, { id: 'b', token: 'same' }] }),
    /reuses another bot's token/,
  )
  assert.throws(
    () => apply(harness.ctx, { bots: [{ id: 'a', token: 't1' }, { id: 'A', token: 't2' }] }),
    /duplicate bot id/,
  )
  harness.dispose()
}

function fakeRequest(method, secret, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers: { ...(secret === undefined ? {} : { 'x-sc3bot-secret': secret }), ...headers },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text
    },
  }
}

async function callRoute(harness, path, method, secret, body, headers = {}) {
  const handler = harness.routes.get(path)
  assert.ok(handler, `route ${path} registered`)
  const res = fakeResponse()
  await handler.handler(fakeRequest(method, secret, body, headers), res)
  return { status: res.status, payload: JSON.parse(res.body) }
}

async function testSettingsApi() {
  resetBot()
  const harness = createHarness({})
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false })
  try {
    // The boot global carries the route base and a per-process secret.
    let boot = null
    for (const listener of harness.listeners.get('webserver/index-inject') ?? []) {
      const table = []
      listener(table)
      const row = table.find((entry) => entry.kind === 'global')
      if (row !== undefined) boot = row.value
    }
    assert.ok(boot, 'index injection row')
    assert.equal(boot.api, '/__sc3bot')
    assert.match(boot.secret, /^[0-9a-f]{36}$/)

    // Unauthenticated and wrong-method requests are refused.
    const forbidden = await callRoute(harness, '/__sc3bot/state', 'GET', 'wrong')
    assert.equal(forbidden.status, 403)
    const wrongMethod = await callRoute(harness, '/__sc3bot/state', 'POST', boot.secret)
    assert.equal(wrongMethod.status, 405)

    // State redacts the stored token and reports live status.
    const state = await callRoute(harness, '/__sc3bot/state', 'GET', boot.secret)
    assert.equal(state.status, 200)
    assert.equal(state.payload.ok, true)
    const bot = state.payload.data.bots[0]
    assert.equal(bot.id, 'default')
    assert.equal(bot.chatId, '777')
    assert.equal(bot.tokenSet, true)
    assert.equal(bot.tokenHint, '…-one')
    assert.equal(Object.hasOwn(bot, 'token'), false, 'the page never receives the token')
    assert.equal(bot.status.configured, true)
    assert.equal(state.payload.data.canSave, true)

    // Saving keeps the stored token when the form leaves it blank.
    const saved = await callRoute(harness, '/__sc3bot/config', 'POST', boot.secret, {
      bots: [{ id: 'default', chatId: '777', typing: false, autoReply: true, poll: true }],
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.payload.data.saved, true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(harness.edits.length, 1)
    const next = harness.edits[0].next
    assert.equal(next.bots[0].token, 'test-one', 'a blank token keeps the token the live bot already holds')
    assert.equal(next.bots[0].typing, false)
    assert.equal(Object.hasOwn(next, 'token'), false, 'legacy singular fields are dropped')
    assert.equal(next.typing, true, 'unrelated top-level fields survive')

    // Duplicate bot ids are rejected before anything is persisted.
    const duplicate = await callRoute(harness, '/__sc3bot/config', 'POST', boot.secret, {
      bots: [{ id: 'a', token: 'x', chatId: '1' }, { id: 'A', token: 'y', chatId: '2' }],
    })
    assert.equal(duplicate.status, 400)
    assert.match(duplicate.payload.error, /duplicate bot id/)
    assert.equal(harness.edits.length, 1, 'a rejected save writes nothing')

    // The probe message goes through the bot's own token.
    const tested = await callRoute(harness, '/__sc3bot/test', 'POST', boot.secret, { bot: 'default', text: 'hello' })
    assert.equal(tested.status, 200)
    assert.equal(tested.payload.data.chatId, '777')
    assert.equal(callsOf('sendMessage').at(-1).token, 'test-one')
  } finally {
    harness.dispose()
  }
}

async function testProactivePush() {
  resetBot()
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false })
  try {
    // A scheduled or model-initiated turn in the bot session, with no chat prompt.
    harness.emitSession('session-sc3bot-777', [
      { type: 'turn/start', seq: 1, time: Date.now(), data: { turn: 4 } },
      { type: 'assistant/message', seq: 2, time: Date.now(), data: { turn: 4, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '定时提醒：喝水' }] }, stream: [] } },
    ])
    assert.equal(callsOf('sendMessage').length, 0, 'nothing is pushed before the turn ends')
    harness.emitSession('session-sc3bot-777', [
      { type: 'turn/end', seq: 3, time: Date.now(), data: { turn: 4, reason: { kind: 'completed' } } },
    ])
    await waitFor(() => callsOf('sendMessage').length === 1, 'proactive push')
    const pushed = callsOf('sendMessage')[0]
    assert.equal(pushed.token, 'test-one')
    assert.equal(pushed.body.chat_id, 777)
    assert.match(pushed.body.text, /定时提醒：喝水/)

    // Sessions that do not belong to a bot are ignored.
    harness.emitSession('session-ordinary', [
      { type: 'turn/start', seq: 4, time: Date.now(), data: { turn: 1 } },
      { type: 'assistant/message', seq: 5, time: Date.now(), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '不该推送' }] }, stream: [] } },
      { type: 'turn/end', seq: 6, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(callsOf('sendMessage').length, 1)
  } finally {
    harness.dispose()
  }
}

async function testQuestionForwarding() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, pollTimeoutSeconds: 1, questionTimeoutMs: 60000, cardDelayMs: 0 })
  try {
    const listener = (harness.listeners.get('user-questions/request') ?? [])[0]
    assert.ok(listener, 'question listener registered')
    let nextCalled = false
    const pending = listener({
      agent: { id: 'session-sc3bot-777' },
      questions: [{
        id: 'q1',
        header: '部署',
        question: '选哪个环境？',
        options: [{ label: 'Alpha' }, { label: 'Beta', description: '生产' }],
      }],
    }, async () => {
      nextCalled = true
      // A browser card that is shown but never clicked.
      return new Promise(() => {})
    })

    await waitFor(() => callsOf('sendMessage').some((call) => /选哪个环境/.test(call.body.text)), 'question delivered')
    const questionMessage = callsOf('sendMessage').find((call) => /选哪个环境/.test(call.body.text))
    assert.match(questionMessage.body.text, /1\. Alpha/)
    assert.match(questionMessage.body.text, /2\. Beta — 生产/)

    // The next chat message answers the question instead of becoming a prompt.
    queueUpdates('test-one', [{ update_id: 30, message: { message_id: 40, chat_id: 777, text: '2' } }])
    const answer = await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('the question was never answered')), 4000)),
    ])
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['Beta'] }] })
    assert.equal(nextCalled, true, 'the browser card is shown too')
    assert.equal(harness.prompts.length, 0, 'an answer is not a new prompt')
  } finally {
    harness.dispose()
  }
}

async function testApprovalForwarding() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, pollTimeoutSeconds: 1, questionTimeoutMs: 60000, cardDelayMs: 0 })
  try {
    const listener = (harness.listeners.get('approval/request') ?? [])[0]
    assert.ok(listener, 'approval listener registered')
    let nextCalled = false
    const pending = listener({
      agent: { id: 'session-sc3bot-777' },
      toolName: 'bash',
      reason: 'escalate sandbox to danger-full-access',
    }, async () => {
      nextCalled = true
      return new Promise(() => {})
    })

    await waitFor(() => callsOf('sendMessage').some((call) => /需要你的批准/.test(call.body.text)), 'approval delivered')
    const approvalMessage = callsOf('sendMessage').find((call) => /需要你的批准/.test(call.body.text))
    assert.match(approvalMessage.body.text, /工具：bash/)
    assert.match(approvalMessage.body.text, /escalate sandbox/)

    queueUpdates('test-one', [{ update_id: 31, message: { message_id: 41, chat_id: 777, text: '允许' } }])
    const outcome = await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('the approval was never answered')), 4000)),
    ])
    assert.equal(outcome, 'allowed-once')
    assert.equal(nextCalled, true, 'the browser card is shown too')
  } finally {
    harness.dispose()
  }
}

async function testWebWins() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false, cardDelayMs: 0 })
  try {
    const listener = (harness.listeners.get('user-questions/request') ?? [])[0]
    const answer = await listener({
      agent: { id: 'session-sc3bot-777' },
      questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'Alpha' }, { label: 'Beta' }] }],
    }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return { answers: [{ id: 'q1', selected: ['Alpha'] }] }
    })
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['Alpha'] }] }, 'the browser answer wins')
    await waitFor(
      () => callsOf('sendMessage').some((call) => /已经在网页上作答/.test(call.body.text)),
      'the chat is told the web answered',
    )
    assert.equal(harness.prompts.length, 0)
  } finally {
    harness.dispose()
  }
}

async function testChatCommands() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, pollTimeoutSeconds: 1 })
  try {
    queueUpdates('test-one', [{ update_id: 40, message: { message_id: 40, chat_id: 777, text: '/help' } }])
    await waitFor(() => callsOf('sendMessage').some((call) => /\/stop 停止当前回合/.test(call.body.text)), 'help reply')
    assert.equal(harness.prompts.length, 0, 'commands never reach the model')

    queueUpdates('test-one', [{ update_id: 41, message: { message_id: 41, chat_id: 777, text: '你好' } }])
    await waitFor(() => harness.prompts.length === 1, 'session created by a prompt')

    queueUpdates('test-one', [{ update_id: 42, message: { message_id: 42, chat_id: 777, text: '/stop' } }])
    await waitFor(() => harness.cancels.length === 1, 'stop reaches the session controller')
    assert.equal(harness.cancels[0].sessionId, 'session-sc3bot-777')

    queueUpdates('test-one', [{ update_id: 43, message: { message_id: 43, chat_id: 777, text: '/status' } }])
    await waitFor(() => callsOf('sendMessage').some((call) => /偏移：/.test(call.body.text)), 'status reply')
  } finally {
    harness.dispose()
  }
}

async function testWebhookIngest() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false, mode: 'webhook' })
  try {
    const secret = createHash('sha256').update('serverchan-bot:test-one').digest('hex').slice(0, 32)
    const denied = await callRoute(
      harness,
      '/__sc3bot/webhook',
      'POST',
      undefined,
      { update_id: 50, message: { chat_id: 777, text: 'x' } },
      { 'x-sc3bot-webhook-secret': 'wrong' },
    )
    assert.equal(denied.status, 401)

    const accepted = await callRoute(
      harness,
      '/__sc3bot/webhook',
      'POST',
      undefined,
      { ok: true, update_id: 50, message: { message_id: 50, chat_id: 777, text: 'webhook 来了' } },
      { 'x-sc3bot-webhook-secret': secret },
    )
    assert.equal(accepted.status, 200)
    await waitFor(() => harness.prompts.length === 1, 'webhook prompt admission')
    assert.equal(harness.prompts[0].content[0].text, 'webhook 来了')
    await waitFor(() => callsOf('sendMessage').some((call) => /你好，我在。/.test(call.body.text)), 'webhook turn reply')
  } finally {
    harness.dispose()
  }
}

async function testPersistenceAndLock() {
  resetBot()
  const dir = mkdtempSync(join(tmpdir(), 'sc3bot-test-'))
  try {
    queueUpdates('test-one', [{ update_id: 60, message: { message_id: 60, chat_id: 777, text: '记一下' } }])
    const first = createHarness({ dir })
    apply(first.ctx, { token: 'test-one', chatId: '777', typing: false, pollTimeoutSeconds: 1 })
    await waitFor(() => first.created.length === 1, 'first session')
    await waitFor(() => callsOf('sendMessage').length >= 1, 'first reply')

    // A second live instance for the same token must stand down.
    const second = createHarness({ dir })
    apply(second.ctx, { token: 'test-one', chatId: '777', typing: false, pollTimeoutSeconds: 1 })
    const lockedStatus = await second.tools.get('serverchan_bot').execute({ action: 'status' })
    assert.equal(lockedStatus.lockedBy, process.pid, 'the token is locked by the first instance')
    assert.equal(lockedStatus.polling, false)
    second.dispose()

    first.dispose()

    // A fresh instance restores its offset and binding from the state file.
    const third = createHarness({ dir })
    apply(third.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false })
    const status = await third.tools.get('serverchan_bot').execute({ action: 'status' })
    assert.equal(status.offset, 61, 'confirmed updates are not replayed')
    assert.deepEqual(status.sessions, [{ chatId: '777', sessionId: 'session-sc3bot-777' }])
    third.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function testRecoveryAfterRestart() {
  resetBot()
  const dir = mkdtempSync(join(tmpdir(), 'sc3bot-recover-'))
  try {
    mkdirSync(join(dir, 'data', 'serverchan-bot'), { recursive: true })
    writeFileSync(join(dir, 'data', 'serverchan-bot', 'state.json'), JSON.stringify({
      version: 1,
      bots: {
        default: {
          offset: 0,
          seen: [],
          sessions: { 777: 'session-sc3bot-777' },
          pushed: { 'session-sc3bot-777': 10 },
        },
      },
    }))
    const harness = createHarness({
      dir,
      events: () => ({
        records: [
          { type: 'event', event: { type: 'assistant/message', seq: 11, data: { message: { role: 'assistant', content: [{ type: 'text', text: '这是重启前没推出去的结果' }] } } } },
          { type: 'event', event: { type: 'turn/end', seq: 12, data: { reason: { kind: 'completed' } } } },
        ],
        hasMore: false,
        cursor: 12,
      }),
    })
    apply(harness.ctx, { token: 'test-one', chatId: '777', typing: false, poll: false })
    await waitFor(
      () => callsOf('sendMessage').some((call) => /重启前没推出去的结果/.test(call.body.text)),
      'recovered push',
    )
    assert.equal(callsOf('sendMessage').filter((call) => /重启前没推出去的结果/.test(call.body.text)).length, 1)
    harness.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function testCardDelay() {
  resetBot()
  queueUpdates('test-one', [])
  const harness = createHarness()
  apply(harness.ctx, {
    token: 'test-one',
    chatId: '777',
    typing: false,
    pollTimeoutSeconds: 1,
    questionTimeoutMs: 60000,
    cardDelayMs: 5000,
  })
  try {
    let nextCalled = false
    const listener = (harness.listeners.get('user-questions/request') ?? [])[0]
    const pending = listener({
      agent: { id: 'session-sc3bot-777' },
      questions: [{ id: 'q1', question: '现在选？', options: [{ label: 'A' }, { label: 'B' }] }],
    }, async () => {
      nextCalled = true
      return new Promise(() => {})
    })
    await waitFor(() => callsOf('sendMessage').some((call) => /现在选/.test(call.body.text)), 'question delivered')
    queueUpdates('test-one', [{ update_id: 70, message: { message_id: 70, chat_id: 777, text: 'A' } }])
    const answer = await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('the chat answer was not used')), 4000)),
    ])
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['A'] }] })
    assert.equal(nextCalled, false, 'a quick chat answer never publishes the web card')
  } finally {
    harness.dispose()
  }
}

async function testPromptSection() {
  resetBot()
  const harness = createHarness()
  apply(harness.ctx, { token: '', chatId: '' })
  try {
    const registered = []
    const agent = {
      id: 'session-sc3bot-work-42',
      ctx: {
        effect(fn) {
          return fn()
        },
        systemPrompt: {
          section(definition) {
            registered.push(definition)
            return () => {}
          },
        },
      },
    }
    for (const listener of harness.listeners.get('agent/created') ?? []) listener({ agent })
    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'serverchan-bot')
    assert.match(registered[0].text, /Server酱³ Bot/)

    // A session that is not a bot session gets no extra prompt section.
    const other = { ...agent, id: 'session-ordinary' }
    for (const listener of harness.listeners.get('agent/created') ?? []) listener({ agent: other })
    assert.equal(registered.length, 1)
  } finally {
    harness.dispose()
  }
}

await testSingleBot()
await testMultiBot()
await testAllowlistRejection()
await testFirstContactPairing()
await testArchivedRevival()
await testUnconfigured()
await testDuplicateTokens()
await testSettingsApi()
await testProactivePush()
await testQuestionForwarding()
await testApprovalForwarding()
await testWebWins()
await testCardDelay()
await testChatCommands()
await testWebhookIngest()
await testPersistenceAndLock()
await testRecoveryAfterRestart()
await testPromptSection()
console.log('bridge tests passed')
process.exit(0)
