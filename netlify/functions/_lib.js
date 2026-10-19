// Shared helpers for Postradamus functions.
const { getStore, connectLambda } = require('@netlify/blobs');
// Classic-style functions must hand their event to Blobs before using it.
function connect(event) { try { if (event && event.blobs) connectLambda(event); } catch (e) {} }

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Key'
};
function reply(statusCode, body, extra) {
  return { statusCode, headers: { ...JSON_HEADERS, ...(extra || {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}
function preflight(event) {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  return null;
}
// A simple shared secret so only Jason's installed app can call the posting functions.
function checkAppKey(event) {
  const want = process.env.APP_KEY;
  if (!want) return false; // locked until APP_KEY is set
  const got = (event.headers['x-app-key'] || event.headers['X-App-Key'] || (event.queryStringParameters || {}).key || '');
  return got === want;
}
function store() { return getStore({ name: 'postradamus', consistency: 'strong' }); }
function siteUrl(event) {
  return process.env.URL || ('https://' + event.headers.host);
}

// ---------- Google ----------
async function googleAccessToken() {
  let refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refresh) { const g = await store().get('google', { type: 'json' }); refresh = g && g.refresh_token; }
  if (!refresh) throw new Error('Google Drive is not approved yet. Open Settings → Google Drive once.');
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refresh,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token failed: ' + JSON.stringify(j));
  return j.access_token;
}
async function driveList(token, q, fields) {
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', q);
  u.searchParams.set('fields', fields || 'files(id,name,mimeType)');
  u.searchParams.set('pageSize', '100');
  u.searchParams.set('supportsAllDrives', 'true');
  u.searchParams.set('includeItemsFromAllDrives', 'true');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  if (j.error) throw new Error('Drive list failed: ' + JSON.stringify(j.error));
  return j.files || [];
}
async function driveFindFolder(token, name, parentId) {
  const esc = name.replace(/'/g, "\\'");
  const q = `name = '${esc}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` + (parentId ? ` and '${parentId}' in parents` : '');
  const f = await driveList(token, q);
  return f[0] || null;
}
async function driveEnsureFolder(token, name, parentId) {
  const found = await driveFindFolder(token, name, parentId);
  if (found) return found;
  const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined }) });
  const j = await r.json();
  if (j.error) throw new Error('Drive mkdir failed: ' + JSON.stringify(j.error));
  return j;
}

// ---------- Metricool MCP (OAuth + JSON-RPC over HTTP) ----------
const MCP_URL = 'https://ai.metricool.com/mcp';
async function mcpMeta() {
  const r = await fetch('https://ai.metricool.com/.well-known/oauth-authorization-server');
  return r.json();
}
async function metricoolTokens() {
  const s = store();
  const saved = await s.get('metricool', { type: 'json' });
  if (!saved || !saved.refresh_token) throw new Error('Metricool is not connected yet. Open /.netlify/functions/metricool-auth once.');
  if (saved.access_token && saved.expires_at && Date.now() < saved.expires_at - 60000) return saved;
  const meta = await mcpMeta();
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.client_id });
  if (saved.client_secret) body.set('client_secret', saved.client_secret);
  const r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Metricool refresh failed: ' + JSON.stringify(j));
  const next = { ...saved, access_token: j.access_token, refresh_token: j.refresh_token || saved.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  await s.setJSON('metricool', next);
  return next;
}
function parseMcpBody(text) {
  // Streamable HTTP may answer as JSON or as SSE ("data: {...}" lines).
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  const msgs = [];
  for (const line of t.split('\n')) { if (line.startsWith('data:')) { try { msgs.push(JSON.parse(line.slice(5).trim())); } catch (e) {} } }
  return msgs.find(m => m && m.result !== undefined || m && m.error) || msgs[msgs.length - 1] || null;
}
async function mcpCall(toolName, args) {
  const tok = await metricoolTokens();
  const base = { 'Authorization': 'Bearer ' + tok.access_token, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  // 1) initialize
  const init = await fetch(MCP_URL, { method: 'POST', headers: base, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Postradamus', version: '1.0' } } }) });
  if (init.status === 401) throw new Error('Metricool rejected the login (401). Reconnect at /.netlify/functions/metricool-auth');
  const sid = init.headers.get('mcp-session-id');
  const hdr = sid ? { ...base, 'Mcp-Session-Id': sid } : base;
  await init.text();
  await fetch(MCP_URL, { method: 'POST', headers: hdr, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {});
  // 2) tools/call
  const r = await fetch(MCP_URL, { method: 'POST', headers: hdr, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }) });
  const text = await r.text();
  const msg = parseMcpBody(text);
  if (!msg) throw new Error('Metricool gave no answer (' + r.status + '): ' + text.slice(0, 300));
  if (msg.error) throw new Error('Metricool error: ' + (msg.error.message || JSON.stringify(msg.error)));
  const res = msg.result || {};
  const textBlock = (res.content || []).find(c => c.type === 'text');
  let payload = res.structuredContent;
  if (payload === undefined && textBlock) { try { payload = JSON.parse(textBlock.text); } catch (e) { payload = textBlock.text; } }
  if (res.isError) throw new Error('Metricool said: ' + (textBlock ? textBlock.text : JSON.stringify(res)));
  return payload;
}

module.exports = { connect, reply, preflight, checkAppKey, store, siteUrl, googleAccessToken, driveList, driveFindFolder, driveEnsureFolder, mcpMeta, metricoolTokens, mcpCall, MCP_URL };
