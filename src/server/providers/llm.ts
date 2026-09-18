import type { ServerConfig } from '../config'

const REQUEST_TIMEOUT_MS = 25_000

export type LlmJsonResult = {
  ok: true
  text: string
  provider: 'openai' | 'anthropic'
} | {
  ok: false
  error: string
}

/** Ask the configured LLM for a JSON object. Falls back across providers when unset. */
export async function completeJson(
  config: ServerConfig,
  input: { system: string; user: string }
): Promise<LlmJsonResult> {
  if (config.llm.anthropicApiKey) {
    const result = await completeAnthropic(config, input)
    if (result.ok) return result
    if (!config.llm.openaiApiKey) return result
  }
  if (config.llm.openaiApiKey) {
    return completeOpenAI(config, input)
  }
  return { ok: false, error: 'No LLM API key configured' }
}

export function llmCompileEnabled(config: ServerConfig): boolean {
  if (!config.llm.compileEnabled) return false
  return Boolean(config.llm.anthropicApiKey || config.llm.openaiApiKey)
}

async function completeOpenAI(
  config: ServerConfig,
  input: { system: string; user: string }
): Promise<LlmJsonResult> {
  const base = config.llm.openaiBaseUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.openaiApiKey}`
      },
      body: JSON.stringify({
        model: config.llm.openaiModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ]
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, error: `OpenAI ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return { ok: false, error: 'OpenAI returned empty content' }
    return { ok: true, text, provider: 'openai' }
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable'
    return { ok: false, error: `OpenAI ${reason}` }
  }
}

async function completeAnthropic(
  config: ServerConfig,
  input: { system: string; user: string }
): Promise<LlmJsonResult> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.llm.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.llm.anthropicModel,
        max_tokens: 2048,
        temperature: 0.2,
        system: `${input.system}\n\nRespond with a single JSON object only. No markdown.`,
        messages: [{ role: 'user', content: input.user }]
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        ok: false,
        error: `Anthropic ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
      }
    }
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const text = data.content?.find((part) => part.type === 'text')?.text?.trim()
    if (!text) return { ok: false, error: 'Anthropic returned empty content' }
    return { ok: true, text: extractJsonObject(text), provider: 'anthropic' }
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable'
    return { ok: false, error: `Anthropic ${reason}` }
  }
}

/** Pull the first JSON object out of model text (handles accidental fences). */
export function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}
