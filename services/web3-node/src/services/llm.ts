/**
 * A tiny server-side LLM client so the node can run a hosted agent's "brain" in-process. Mirrors
 * the Python SDK's client: OpenAI-compatible providers plus native Anthropic, provider presets, and
 * an IPv4-loopback fix (localhost → 127.0.0.1) so local Ollama/LM Studio calls don't hang on IPv6.
 */
export interface LlmConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  system?: string;
}

const PRESETS: Record<string, { baseUrl: string; kind: 'openai' | 'anthropic' }> = {
  local: { baseUrl: 'http://127.0.0.1:11434/v1', kind: 'openai' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', kind: 'openai' },
  openai: { baseUrl: 'https://api.openai.com/v1', kind: 'openai' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', kind: 'openai' },
  together: { baseUrl: 'https://api.together.xyz/v1', kind: 'openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com', kind: 'anthropic' },
};

function preferIpv4(url: string): string {
  return url.replace('//localhost:', '//127.0.0.1:').replace('//localhost/', '//127.0.0.1/');
}

export async function llmChat(config: LlmConfig, prompt: string): Promise<string> {
  const preset = PRESETS[config.provider] ?? PRESETS.local!;
  const base = preferIpv4((config.baseUrl || preset.baseUrl).replace(/\/$/, ''));
  const key = config.apiKey || 'ollama';
  return preset.kind === 'anthropic'
    ? chatAnthropic(base, key, config, prompt)
    : chatOpenai(base, key, config, prompt);
}

async function chatOpenai(
  base: string,
  key: string,
  config: LlmConfig,
  prompt: string,
): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (config.system) messages.push({ role: 'system', content: config.system });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.4, stream: false }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error(`unexpected LLM response: ${JSON.stringify(data).slice(0, 200)}`);
  return answer.trim();
}

async function chatAnthropic(
  base: string,
  key: string,
  config: LlmConfig,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      temperature: 0.4,
      system: config.system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const answer = data.content?.[0]?.text;
  if (!answer) throw new Error(`unexpected LLM response: ${JSON.stringify(data).slice(0, 200)}`);
  return answer.trim();
}
