const BASE = 'https://api.groq.com/openai/v1';
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fetch() against Groq with the API key added and retries on 429 / 5xx.
// makeBody is a function because a FormData body can only be sent once.
export async function groqFetch(
  path: string,
  makeBody: () => BodyInit,
  headers: Record<string, string> = {},
): Promise<any> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, ...headers },
      body: makeBody(),
    });
    if (res.ok) return res.json();

    // 429 = rate limited, 5xx = Groq-side problem: both are worth retrying.
    const retryable = res.status === 429 || res.status >= 500;
    const detail = await res.text();
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Groq ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
    console.warn(`groq ${path}: ${res.status}, retrying in ${wait} ms`);
    await sleep(wait);
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

// Groq retires models; override with GROQ_MODEL in .env without a code change.
export const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// One chat turn with tools available. Returns the assistant message, which
// holds either tool_calls to run or the final text in content.
export async function chatWithTools({ model = CHAT_MODEL, messages, tools }: {
  model?: string; messages: ChatMessage[]; tools: unknown[];
}): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const body = await groqFetch('/chat/completions', () => JSON.stringify({
    model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0,
  }), { 'Content-Type': 'application/json' });
  const { content, tool_calls } = body.choices[0].message;
  return { content, tool_calls };
}

export async function chatJson({ model = CHAT_MODEL, messages }: { model?: string; messages: ChatMessage[] }) {
  const body = await groqFetch('/chat/completions', () => JSON.stringify({
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  }), { 'Content-Type': 'application/json' });
  return JSON.parse(body.choices[0].message.content);
}
