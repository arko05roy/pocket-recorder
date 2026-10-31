import Anthropic from '@anthropic-ai/sdk';

// Claude does the reading and answering; Groq Whisper still does speech to
// text, because Claude takes text and images but not audio.
// Reads ANTHROPIC_API_KEY from the environment. Retries 429 / 5xx itself.
export const claude = new Anthropic();

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens' | 'betas' | 'fallbacks'> & { model?: string };

// Sonnet for quick, mechanical passes (cleaning a transcript).
export const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || 'claude-sonnet-5-5';

// One request with our defaults. If the model's safety classifier declines
// (stop_reason "refusal"), the API reruns it on a fallback model by itself.
export async function ask({ model = CLAUDE_MODEL, ...params }: Params) {
  const res = await claude.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...params,
    // Opus 5.5 defaults to medium; set it so a model change can't shift it.
    output_config: { effort: 'medium', ...params.output_config },
  });
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined: ${res.stop_details?.category ?? 'no category'}`);
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens');
  return res;
}

export const textOf = (res: Anthropic.Beta.BetaMessage) =>
  res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
