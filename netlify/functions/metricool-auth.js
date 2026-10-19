// One-time Metricool approval through Metricool's MCP door (OAuth with dynamic registration + PKCE).
// Open /.netlify/functions/metricool-auth?key=APP_KEY once, click Allow on Metricool, done. Tokens are kept in Netlify Blobs.
const crypto = require('crypto');
const { reply, store, siteUrl, mcpMeta, checkAppKey } = require('./_lib');

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

exports.handler = async function (event) {
  const s = store();
  const redirect = siteUrl(event) + '/.netlify/functions/metricool-auth';
  const q = event.queryStringParameters || {};
  const meta = await mcpMeta();

  if (!q.code) {
    if (!checkAppKey(event)) return reply(403, 'Open this from Postradamus Settings (it needs the app key).', { 'Content-Type': 'text/plain' });
    // Register this app with Metricool (once), then send the user to approve.
    let client = await s.get('metricool-client', { type: 'json' });
    if (!client || !client.client_id || !(client.redirect_uris || []).includes(redirect)) {
      const r = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        client_name: 'Postradamus', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
      client = await r.json();
      if (!client.client_id) return reply(500, 'Metricool registration failed: ' + JSON.stringify(client), { 'Content-Type': 'text/plain' });
      await s.setJSON('metricool-client', client);
    }
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    await s.setJSON('metricool-pkce', { verifier, state, at: Date.now() });
    const u = new URL(meta.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', client.client_id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);
    if (Array.isArray(meta.scopes_supported) && meta.scopes_supported.length) u.searchParams.set('scope', meta.scopes_supported.join(' '));
    return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
  }

  const pk = await s.get('metricool-pkce', { type: 'json' });
  const client = await s.get('metricool-client', { type: 'json' });
  if (!pk || !client || pk.state !== q.state) return reply(400, 'Approval didn\'t match. Open /.netlify/functions/metricool-auth again.', { 'Content-Type': 'text/plain' });
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirect, client_id: client.client_id, code_verifier: pk.verifier });
  if (client.client_secret) body.set('client_secret', client.client_secret);
  const r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.access_token) return reply(500, 'Metricool token exchange failed: ' + JSON.stringify(j), { 'Content-Type': 'text/plain' });
  await s.setJSON('metricool', { client_id: client.client_id, client_secret: client.client_secret || null, access_token: j.access_token, refresh_token: j.refresh_token || null, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  const html = `<!doctype html><meta charset=utf-8><title>Metricool connected</title><body style="font:16px -apple-system,sans-serif;padding:24px;max-width:640px">
  <h2>Metricool is connected ✓</h2><p>${j.refresh_token ? 'Postradamus can post from now on.' : 'Connected, but Metricool gave no refresh token; you may need to reconnect occasionally.'}</p><p><a href="/">Back to Postradamus</a></p></body>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
