import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock hub-client before importing email.ts so email.ts gets the mock
vi.mock('./hub-client.js', () => ({
  hubClient: {
    isConfigured: true,
    request: vi.fn().mockResolvedValue({}),
  },
}));

import { sendPin, sendInvitation, sendWelcome } from './email.js';

describe('Email Service', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── sendPin ───────────────────────────────────────────────────────────────

  describe('sendPin', () => {
    it('calls hub with correct endpoint, recipient, and PIN in subject/body', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendPin('user@example.com', '123456');

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledOnce();
      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/email/v1/send',
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Your login code: 123456',
          html: expect.stringContaining('123456'),
          text: expect.stringContaining('123456'),
        }),
      );
    });

    it('propagates hub errors to the caller', async () => {
      const { hubClient } = await import('./hub-client.js');
      vi.mocked(hubClient.request).mockRejectedValueOnce(new Error('Hub API error 500: Internal'));

      await expect(sendPin('user@example.com', '123456')).rejects.toThrow('Hub API error');
    });

    it('skips hub call and resolves when hub is not configured', async () => {
      const { hubClient } = await import('./hub-client.js');
      (hubClient as { isConfigured: boolean }).isConfigured = false;

      await expect(sendPin('user@example.com', '123456')).resolves.toBeUndefined();
      expect(vi.mocked(hubClient.request)).not.toHaveBeenCalled();

      // Restore for subsequent tests
      (hubClient as { isConfigured: boolean }).isConfigured = true;
    });
  });

  // ── sendInvitation ────────────────────────────────────────────────────────

  describe('sendInvitation', () => {
    it('escapes HTML special characters in org name (XSS protection)', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendInvitation(
        'victim@example.com',
        '<script>evil()</script>',
        'Alice',
        'https://example.com/invite/token',
      );

      const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
        string,
        string,
        { html: string },
      ];
      expect(payload.html).not.toContain('<script>');
      expect(payload.html).toContain('&lt;script&gt;');
      expect(payload.html).toContain('&lt;/script&gt;');
    });

    it('escapes HTML special characters in inviter name (XSS protection)', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendInvitation(
        'victim@example.com',
        'Acme Corp',
        'Bob" onmouseover="evil()',
        'https://example.com/invite/token',
      );

      const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
        string,
        string,
        { html: string },
      ];
      expect(payload.html).not.toContain('" onmouseover="');
      expect(payload.html).toContain('&quot;');
    });

    it('escapes & < > " \' characters in org name', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendInvitation(
        'user@example.com',
        "Acme & Co <Ltd> \"Partners\" 'Inc'",
        'Alice',
        'https://example.com/invite/token',
      );

      const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
        string,
        string,
        { html: string },
      ];
      expect(payload.html).toContain('&amp;');
      expect(payload.html).toContain('&lt;');
      expect(payload.html).toContain('&gt;');
      expect(payload.html).toContain('&quot;');
      expect(payload.html).toContain('&#039;');
    });

    it('calls hub with correct endpoint and recipient email', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendInvitation('invite@example.com', 'Acme Corp', 'Alice', 'https://example.com/invite/abc');

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/email/v1/send',
        expect.objectContaining({
          to: 'invite@example.com',
          subject: expect.stringContaining('Acme Corp'),
        }),
      );
    });
  });

  // ── sendWelcome ───────────────────────────────────────────────────────────

  describe('sendWelcome', () => {
    it('calls hub with correct endpoint and recipient email', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendWelcome('user@example.com', 'Alice');

      expect(vi.mocked(hubClient.request)).toHaveBeenCalledWith(
        'POST',
        '/hub/email/v1/send',
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Welcome!',
        }),
      );
    });

    it('escapes HTML special characters in user name', async () => {
      const { hubClient } = await import('./hub-client.js');

      await sendWelcome('user@example.com', '<b>Injected Name</b>');

      const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
        string,
        string,
        { html: string },
      ];
      expect(payload.html).not.toContain('<b>');
      expect(payload.html).toContain('&lt;b&gt;');
    });
  });
});

describe('sendInvitation XSS edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not render raw <script>alert(1)</script> in org name', async () => {
    const { hubClient } = await import('./hub-client.js');

    await sendInvitation(
      'victim@example.com',
      '<script>alert(1)</script>',
      'Alice',
      'https://example.com/invite/token',
    );

    const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
      string,
      string,
      { html: string; text: string },
    ];
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not render raw " onload="evil() in inviter name', async () => {
    const { hubClient } = await import('./hub-client.js');

    await sendInvitation(
      'victim@example.com',
      'Acme Corp',
      '" onload="evil()',
      'https://example.com/invite/token',
    );

    const [, , payload] = vi.mocked(hubClient.request).mock.calls[0] as [
      string,
      string,
      { html: string; text: string },
    ];
    expect(payload.html).not.toContain('" onload="evil()');
    expect(payload.html).toContain('&quot;');
  });
});
