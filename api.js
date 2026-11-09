/**
 * Minimal client for the Server酱³ Bot API.
 *
 * The service exposes a Telegram-like surface:
 *   GET  /bot<TOKEN>/getMe
 *   POST /bot<TOKEN>/sendMessage      { chat_id, text, parse_mode?, silent? }
 *   POST /bot<TOKEN>/sendChatAction   { chat_id, action: 'typing' }
 *   GET  /bot<TOKEN>/getUpdates?timeout=<seconds>&offset=<update_id>
 *
 * `chat_id` is the Server酱³ uid shown next to the SendKey.
 */

export const DEFAULT_BASE_URL = 'https://bot-go.apijia.cn'

/** One failed Bot API call, with the service's own description when it sent one. */
export class BotApiError extends Error {
  /**
   * @param {string} message - human-readable failure
   * @param {{ status?: number, code?: number | string | null, method?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message)
    this.name = 'BotApiError'
    this.status = details.status ?? null
    this.code = details.code ?? null
    this.method = details.method ?? null
  }
}

/**
 * Build one Bot API client.
 * @param {{ token: string, baseUrl?: string, defaultTimeoutMs?: number }} options
 */
export function createBotApi({ token, baseUrl = DEFAULT_BASE_URL, defaultTimeoutMs = 30000 }) {
  const cleanToken = typeof token === 'string' ? token.trim() : ''
  if (cleanToken === '') throw new BotApiError('missing bot token')
  const root = `${String(baseUrl).replace(/\/+$/, '')}/bot${cleanToken}`

  /**
   * Perform one request and unwrap the `{ ok, result }` envelope.
   * @param {string} method
   * @param {{ query?: Record<string, unknown>, body?: unknown, timeoutMs?: number, signal?: AbortSignal }} [options]
   */
  async function request(method, { query, body, timeoutMs = defaultTimeoutMs, signal } = {}) {
    const url = new URL(`${root}/${method}`)
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue
        url.searchParams.set(key, String(value))
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error(`Server酱³ Bot ${method} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    timer.unref?.()

    const forwardAbort = () => controller.abort(signal?.reason)
    if (signal !== undefined) {
      if (signal.aborted) forwardAbort()
      else signal.addEventListener('abort', forwardAbort, { once: true })
    }

    try {
      const response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json;charset=utf-8' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const raw = await response.text()
      let payload = null
      try {
        payload = raw === '' ? null : JSON.parse(raw)
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const description = payload?.description
          ?? payload?.error
          ?? (raw.trim() === '' ? `HTTP ${response.status}` : raw.trim().slice(0, 300))
        throw new BotApiError(String(description), {
          status: response.status,
          code: payload?.error_code ?? null,
          method,
        })
      }
      return payload
    } catch (error) {
      if (error instanceof BotApiError) throw error
      if (signal?.aborted === true) {
        throw new BotApiError(`Server酱³ Bot ${method} was cancelled`, { method })
      }
      if (controller.signal.aborted) {
        throw new BotApiError(`Server酱³ Bot ${method} timed out`, { method })
      }
      throw new BotApiError(
        `Server酱³ Bot ${method} failed: ${error instanceof Error ? error.message : String(error)}`,
        { method },
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  /** Send a numeric chat id as a number, and anything else as its trimmed text. */
  function target(chatId) {
    if (typeof chatId === 'number' && Number.isFinite(chatId)) return chatId
    const text = String(chatId ?? '').trim()
    return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : text
  }

  return {
    token: cleanToken,

    /** Bot identity: `{ ok, result: { id, name?, username? } }`. */
    async getMe(options = {}) {
      return request('getMe', options)
    },

    /** Downlink: one chat message, markdown by default. */
    async sendMessage({ chatId, text, parseMode = 'markdown', silent = false, ...rest } = {}) {
      if (typeof text !== 'string' || text.trim() === '') {
        throw new BotApiError('sendMessage requires a non-empty text')
      }
      return request('sendMessage', {
        ...rest,
        body: {
          chat_id: target(chatId),
          text,
          parse_mode: parseMode,
          silent,
        },
      })
    },

    /** Show the "正在思考" typing hint in the chat. */
    async sendChatAction({ chatId, action = 'typing', ...rest } = {}) {
      return request('sendChatAction', {
        ...rest,
        body: { chat_id: target(chatId), action },
      })
    },

    /** Uplink: long-poll pending updates from `offset` (an update_id). */
    async getUpdates({ offset, timeout = 20, ...rest } = {}) {
      const seconds = Number.isFinite(timeout) ? Math.min(30, Math.max(0, Math.trunc(timeout))) : 20
      return request('getUpdates', {
        ...rest,
        timeoutMs: (seconds + 20) * 1000,
        query: { timeout: seconds, ...(offset === undefined ? {} : { offset }) },
      })
    },
  }
}
