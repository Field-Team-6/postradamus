// One-time Google approval. Open /.netlify/functions/google-auth in a browser while signed in as
// jason.berlin@gmail.com, approve Drive access, and the page shows the refresh token to put in
// Netlify's environment as GOOGLE_REFRESH_TOKEN.
const { reply, siteUrl } = require('./_lib');

exports.handler = async function (event) {
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return reply(500, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Netlify yet.', { 'Content-Type': 'text/plain' });
  const redirect = siteUrl(event) + '/.netlify/functions/google-auth';
  const code = (event.queryStringParameters || {}).code;
  if (!code) {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'https://www.googleapis.com/auth/drive');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    return { statusCode: 302, headers: { Location: u.toString() }, body: '' };
  }
  const body = new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.refresh_token) return reply(500, 'Google did not return a refresh token: ' + JSON.stringify(j), { 'Content-Type': 'text/plain' });
  const html = `<!doctype html><meta charset=utf-8><title>Google connected</title><body style="font:16px -apple-system,sans-serif;padding:24px;max-width:640px">
  <h2>Google is approved ✓</h2><p>Copy this value into Netlify → Site configuration → Environment variables as <b>GOOGLE_REFRESH_TOKEN</b>, then redeploy.</p>
  <textarea style="width:100%;height:90px;font:14px monospace">${j.refresh_token}</textarea></body>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
};
