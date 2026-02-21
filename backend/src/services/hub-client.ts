import { config } from '../config.js';

export class HubClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || config.hub.url;
    this.token = token || config.hub.token;
  }

  get isConfigured(): boolean {
    return !!this.token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `WorkerHub ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      // Rate limited — wait and retry once
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(method, path, body);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }
}

export const hubClient = new HubClient();
