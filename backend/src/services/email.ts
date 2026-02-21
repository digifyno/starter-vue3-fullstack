import { hubClient } from './hub-client.js';

interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function sendEmail(payload: SendEmailPayload): Promise<void> {
  if (!hubClient.isConfigured) {
    console.log(`[Email] Hub not configured — would send to ${payload.to}: ${payload.subject}`);
    return;
  }
  await hubClient.request('POST', '/hub/email/v1/send', payload);
}

export async function sendPin(email: string, pin: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Your login code: ${pin}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 8px;">Your verification code</h2>
        <p style="color: #666; margin-bottom: 24px;">Enter this code to sign in. It expires in 5 minutes.</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f4f4f5; border-radius: 8px;">
          ${pin}
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `,
    text: `Your verification code is: ${pin} (expires in 5 minutes)`,
  });
}

export async function sendInvitation(
  email: string,
  orgName: string,
  inviterName: string,
  link: string,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `You're invited to join ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
        <h2>You've been invited!</h2>
        <p>${inviterName} invited you to join <strong>${orgName}</strong>.</p>
        <a href="${link}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 16px;">Accept Invitation</a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">This invitation expires in 7 days.</p>
      </div>
    `,
    text: `${inviterName} invited you to join ${orgName}. Accept here: ${link}`,
  });
}

export async function sendWelcome(email: string, name: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Welcome!',
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
        <h2>Welcome, ${name}!</h2>
        <p>Your account has been created. You're all set to get started.</p>
      </div>
    `,
    text: `Welcome, ${name}! Your account has been created.`,
  });
}
