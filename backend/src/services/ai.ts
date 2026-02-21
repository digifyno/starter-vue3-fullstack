import { hubClient } from './hub-client.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatResponse {
  reply: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function chat(messages: ChatMessage[]): Promise<ChatResponse> {
  const res = await hubClient.request<{ content: string; model?: string; usage?: { input_tokens: number; output_tokens: number } }>(
    'POST',
    '/hub/ai/v1/chat',
    { messages, model: 'claude' },
  );
  return { reply: res.content, model: res.model, usage: res.usage };
}

export async function complete(prompt: string): Promise<string> {
  const res = await hubClient.request<{ content: string }>(
    'POST',
    '/hub/ai/v1/complete',
    { prompt },
  );
  return res.content;
}

export async function json<T = unknown>(prompt: string): Promise<T> {
  const res = await hubClient.request<{ data: T }>(
    'POST',
    '/hub/ai/v1/json',
    { prompt },
  );
  return res.data;
}
