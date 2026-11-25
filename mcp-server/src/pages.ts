import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 32px 20px; display: flex; justify-content: center; }
  main { max-width: 440px; width: 100%; }
  h1 { font-size: 22px; line-height: 1.3; margin: 0 0 16px; }
  p { margin: 0 0 12px; }
  ul { margin: 0 0 16px; padding-left: 20px; }
  .muted { opacity: .75; font-size: 14px; }
  .warn { border-left: 3px solid #b45309; padding-left: 12px; }
  .row { display: flex; gap: 12px; margin-top: 24px; }
  button { font: inherit; padding: 12px 20px; border-radius: 10px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; flex: 1; }
  button.primary { background: #0f5132; border-color: #0f5132; color: #fff; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** Step 1 of 2: per-assistant consent, before the member is sent to Hockia to sign in. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'This app registered itself, so its name is not verified.';
  const local = details.redirectIsLoopback
    ? '<p class="warn">This sends access to an app on your own computer. Continue only if you just started connecting Hockia from it.</p>'
    : '';
  return page(
    `Connect ${details.clientName} to Hockia`,
    `<h1>Connect ${name} to your Hockia account?</h1>
<p class="muted">${origin} Access goes to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${local}
<p>${name} will be able to read, as you:</p>
<ul>
  <li>your own profile and applications</li>
  <li>open opportunities on Hockia</li>
  <li>public profiles of other members</li>
  <li>for clubs and recruiting coaches: your opportunities and their applicants</li>
</ul>
<p>It cannot apply, send messages, post or change anything. You can disconnect it at any time.</p>
<p class="muted">Next you will sign in to Hockia.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <div class="row">
    <button name="decision" value="deny">Cancel</button>
    <button class="primary" name="decision" value="approve">Continue</button>
  </div>
</form>`,
  );
}

export function errorPage(message: string, status = 400): Response {
  return new Response(page('Hockia connector', `<h1>Something went wrong</h1><p>${escapeHtml(message)}</p><p class="muted">Close this window and start connecting Hockia again from your assistant.</p>`), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    },
  });
}

export function homePage(): Response {
  return new Response(
    page(
      'Hockia connector',
      '<h1>Hockia connector</h1><p>This address connects AI assistants to Hockia members\' own accounts, read only.</p><p class="muted">Learn more at <a href="https://inhockia.com">inhockia.com</a>.</p>',
    ),
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } },
  );
}
