// OpenAI 兼容的大模型调用封装（支持 DeepSeek 官方及三方中转）
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmStreamHandlers {
  onChunk?: (delta: string) => void;
}

/**
 * 规范化接口地址：兼容
 *   - https://api.deepseek.com
 *   - https://api.deepseek.com/v1
 *   - https://api.deepseek.com/v1/chat/completions（已带完整路径则不再拼接）
 */
export function normalizeLlmBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function buildRequestBody(options: LlmChatOptions, stream: boolean): Record<string, unknown> {
  return {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature,
    stream,
  };
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
}

async function throwOnHttpError(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const text = await response.text().catch(() => '');
  throw new Error(`LLM 请求失败（${response.status}）：${text.slice(0, 400)}`);
}

export interface ResponsesOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  tools?: Array<{ type: string }>;
  timeoutMs?: number;
}

/**
 * 规范化 Responses API 地址。
 */
export function normalizeResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/responses$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/responses`;
}

/**
 * 调用 Responses API（服务端 web_search 工具），流式返回。
 * 事件流以 `event:`/`data:` 行分隔，`response.output_text.delta` 为增量文本。
 */
export async function responsesCompletionStream(
  options: ResponsesOptions,
  onDelta: (delta: string) => void,
): Promise<string> {
  const url = normalizeResponsesUrl(options.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options.apiKey),
    body: JSON.stringify({
      model: options.model,
      instructions: options.instructions,
      input: options.input,
      tools: options.tools ?? [{ type: 'web_search' }],
      stream: true,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 600000),
  });

  await throwOnHttpError(response);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('LLM 流式响应不可用');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }
      try {
        const json = JSON.parse(data) as { type?: string; delta?: unknown };
        if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
          fullText += json.delta;
          onDelta(json.delta);
        }
      } catch {
        // 忽略无法解析的行
      }
    }
  }

  return fullText;
}

/**
 * 非流式对话，返回完整文本。
 */
export async function chatCompletion(options: LlmChatOptions): Promise<string> {
  const url = normalizeLlmBaseUrl(options.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options.apiKey),
    body: JSON.stringify(buildRequestBody(options, false)),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });

  await throwOnHttpError(response);

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM 返回格式异常');
  }
  return content;
}

/**
 * 流式对话，逐段回调 onChunk，最终返回完整文本。
 * 解析 OpenAI 兼容的 SSE 格式（data: {...}\n\n，data: [DONE] 结束）。
 */
export async function chatCompletionStream(
  options: LlmChatOptions,
  handlers: LlmStreamHandlers = {},
): Promise<string> {
  const url = normalizeLlmBaseUrl(options.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options.apiKey),
    body: JSON.stringify(buildRequestBody(options, true)),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120000),
  });

  await throwOnHttpError(response);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('LLM 流式响应不可用');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        continue;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          fullText += delta;
          handlers.onChunk?.(delta);
        }
      } catch {
        // 忽略无法解析的行
      }
    }
  }

  return fullText;
}
