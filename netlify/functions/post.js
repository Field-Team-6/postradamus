// Schedules the post(s) in Metricool via its MCP door. One call per brand; Bluesky gets a shortened copy if needed.
const { connect, reply, preflight, checkAppKey, mcpCall, googleAccessToken } = require('./_lib');

const TZ = 'America/Los_Angeles';
const BRANDS = { ft6: process.env.FT6_BLOG_ID || '7471146', personal: process.env.PERSONAL_BLOG_ID || '7506191' };
const BLUESKY_LIMIT = 300;

function laDate(minutesAhead) {
  const t = new Date(Date.now() + minutesAhead * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(t).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((asUTC - t.getTime()) / 60000), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return { local, iso: local + s + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0') };
}
function titleFrom(cap, fallback) { const first = cap.split(/\n/)[0].trim(); const t = first.length > 80 ? first.slice(0, 77) + '…' : first; return t || fallback; }
function shortTo(text, limit) { const cs = [...text]; if (cs.length <= limit) return text; return cs.slice(0, limit - 1).join('').trimEnd() + '…'; }

function buildInfo(nets, text, mediaUrl, when, cap, isVideo, label) {
  const info = { text, autoPublish: true, draft: false, providers: nets.map(n => ({ network: n })), publicationDate: { dateTime: when.local, timezone: TZ },
    media: [mediaUrl], mediaAltText: [isVideo ? label + ' video' : 'Practivist episode cover'], shortener: false, hasNotReadNotes: false, firstCommentText: '', descendants: [], smartLinkData: { ids: [] } };
  if (nets.includes('facebook')) info.facebookData = isVideo ? { type: 'REEL', title: titleFrom(cap, label) } : { type: 'POST' };
  if (nets.includes('instagram')) info.instagramData = isVideo ? { type: 'REEL', showReelOnFeed: true } : { type: 'POST' };
  if (nets.includes('threads')) info.threadsData = {};
  if (nets.includes('bluesky')) info.blueskyData = {};
  if (nets.includes('tiktok')) info.tiktokData = { disableComment: true, disableDuet: true, disableStitch: true, privacyOption: 'PUBLIC_TO_EVERYONE', title: titleFrom(cap, label) };
  if (nets.includes('youtube')) info.youtubeData = { title: titleFrom(cap, label), type: 'short', privacy: 'public', madeForKids: false, category: 'NONPROFITS_ACTIVISM' };
  return JSON.stringify(info);
}

exports.handler = async function (event) {
  connect(event);
  const pf = preflight(event); if (pf) return pf;
  if (!checkAppKey(event)) return reply(403, { error: 'Not allowed' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad JSON' }); }
  const { mode, caption, link, driveFileId, targets } = b; // targets: {ft6:["facebook",...], personal:[...]}
  if ((!driveFileId && !b.mediaUrl) || !caption || !targets) return reply(400, { error: 'Missing media, caption or targets' });
  const isVideo = mode !== 'practivist';
  const label = mode === 'dailyjason' ? 'Daily Jason' : mode === 'practivist' ? 'Practivist' : 'Personal';
  let mediaUrl = String(b.mediaUrl || '');
  if (driveFileId) {
    // Jason approved: make just this video viewable by link so Metricool can download it, then give a direct download URL.
    try {
      const token = await googleAccessToken();
      const pr = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(driveFileId) + '/permissions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
      if (!pr.ok) return reply(500, { error: 'Could not share the video for posting: ' + (await pr.text()).slice(0, 300) });
    } catch (e) { return reply(500, { error: 'Could not share the video for posting: ' + e.message }); }
    mediaUrl = 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(driveFileId) + '&export=download&confirm=t';
  }
  const when = laDate(1);
  const fullText = (mode === 'practivist' && link) ? caption + '\n\n' + link : caption;
  const results = [];
  for (const group of Object.keys(targets)) {
    const blogId = BRANDS[group]; const list = (targets[group] || []).filter(Boolean);
    if (!blogId || !list.length) continue;
    const tooLong = [...fullText].length > BLUESKY_LIMIT;
    const mainList = tooLong ? list.filter(x => x !== 'bluesky') : list;
    const jobs = [];
    if (mainList.length) jobs.push({ nets: mainList, text: fullText, tag: group + ' · ' + mainList.join(', ') });
    if (tooLong && list.includes('bluesky')) {
      const bsText = (mode === 'practivist' && link) ? shortTo(caption, BLUESKY_LIMIT - link.length - 2) + '\n\n' + link : shortTo(caption, BLUESKY_LIMIT);
      jobs.push({ nets: ['bluesky'], text: bsText, tag: group + ' · bluesky (shortened)' });
    }
    for (const j of jobs) {
      try {
        const payload = await mcpCall('createScheduledPost', { blogId, date: when.iso, info: buildInfo(j.nets, j.text, mediaUrl, when, caption, isVideo, label) });
        const pj = typeof payload === 'string' ? (() => { try { return JSON.parse(payload); } catch (e) { return {}; } })() : (payload || {});
        const plannerUrl = pj.plannerUrl || (pj.data && pj.data.plannerUrl) || (Array.isArray(pj) && pj[0] && pj[0].plannerUrl) || null;
        results.push({ tag: j.tag, ok: true, plannerUrl });
      } catch (e) { results.push({ tag: j.tag, ok: false, error: e.message }); }
    }
  }
  return reply(200, { when: when.local, results, allOk: results.length > 0 && results.every(r => r.ok) });
};
