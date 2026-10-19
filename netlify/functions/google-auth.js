// One-time Google approval. Open /.netlify/functions/google-auth?key=APP_KEY in a browser while signed in as
// jason.berlin@gmail.com and approve Drive access. The approval is saved in Netlify Blobs automatically.
const crypto = require('crypto');
const { reply, store, siteUrl, checkAppKey } = require('./_lib');
const TEXT = { 'Content-Type': 'text/plain' };

exports.handler = async function (event) {
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return reply(500, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Netlify yet.', TEXT);
  const s = store();
  const redirect = siteUrl(event) + '/.netlify/functions/google-auth';
  const q = event.queryStringParameters || {};
  if (!q.code) {
    if (!checkAppKey(event)) return reply(403, 'Open this from Postradamus Settings (it needs the app key).', TEXT);
    const state = crypto.randomBytes(16).toString('hex');
    await s.setJSON('google-state', { state, at: Date.now() });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'https://www.googleapis.com/auth/drive');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', state);
    return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
  }
  const st = await s.get('google-state', { type: 'json' });
  if (!st || st.state !== q.state || Date.now() - st.at > 15 * 60000) return reply(400, "Approval didn't match. Start again from Postradamus Settings.", TEXT);
  await s.delete('google-state');
  const body = new URLSearchParams({ code: q.code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.refresh_token) return reply(500, 'Google did not return a refresh token: ' + JSON.stringify(j), TEXT);
  let who = '';
  try { const a = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + j.access_token } }); who = ((await a.json()).user || {}).emailAddress || ''; } catch (e) {}
  await s.setJSON('google', { refresh_token: j.refresh_token, email: who, at: Date.now() });
  const html = `<!doctype html><meta charset=utf-8><title>Google connected</title><body style="font:16px -apple-system,sans-serif;padding:24px;max-width:640px">
  <h2>Google Drive is connected ✓</h2><p>${who ? 'Signed in as <b>' + who + '</b>.' : ''} Postradamus will save videos to Drive from now on.</p><p><a href="/">Back to Postradamus</a></p></body>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
