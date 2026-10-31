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
