import { ask } from '@/lib/server/agent';

export const dynamic = 'force-dynamic';

// POST {messages: [{role: 'user'|'assistant', content}], focus?: recording id} → Answer.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const raw = Array.isArray(body?.messages) ? body.messages : null;
  const messages = raw?.filter((m: any) =>
    (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 4000,
  ).map((m: any) => ({ role: m.role, content: m.content }));
  if (!messages?.length || messages.at(-1).role !== 'user') {
    return Response.json({ error: 'messages must end with a user question' }, { status: 400 });
  }
  try {
    const focus = typeof body.focus === 'string' ? body.focus.slice(0, 200) : undefined;
    return Response.json(await ask(messages, focus));
  } catch (err) {
    console.error('ask failed', err);
    return Response.json({ error: 'The assistant is unavailable right now. Try again.' }, { status: 502 });
  }
}
