// Called before an upload. Returns a short-lived Google token (the phone uploads straight to Drive),
// the right folder for this mode, and the next file name like 2026_10_18_1_DailyJason.mp4.
const { reply, preflight, checkAppKey, googleAccessToken, driveList, driveFindFolder, driveEnsureFolder } = require('./_lib');

const TZ = 'America/Los_Angeles';
const DAILY_JASON_FOLDER_ID = process.env.DAILY_JASON_FOLDER_ID || '1jOFUHGQAaUf_YC2-N-YYBlFjdzskebvN';
const NON_FT6_FOLDER_NAME = process.env.NON_FT6_FOLDER_NAME || 'Non-Field Team 6';
const MODES = {
  dailyjason: { suffix: 'DailyJason', folder: 'daily' },
  practivist: { suffix: 'Practivist', folder: 'Practivist' },
  personal:   { suffix: 'Personal',   folder: 'Personal Videos' }
};
function dayKey() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}_${p.month}_${p.day}`;
}

exports.handler = async function (event) {
  const pf = preflight(event); if (pf) return pf;
  if (!checkAppKey(event)) return reply(403, { error: 'Not allowed' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad JSON' }); }
  const M = MODES[body.mode];
  if (!M) return reply(400, { error: 'Unknown mode' });
  const ext = (body.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase();
  try {
    const token = await googleAccessToken();
    let folderId;
    if (M.folder === 'daily') folderId = DAILY_JASON_FOLDER_ID;
    else {
      const parent = await driveFindFolder(token, NON_FT6_FOLDER_NAME, null);
      if (!parent) return reply(500, { error: `Couldn't find a folder named "${NON_FT6_FOLDER_NAME}" in Google Drive.` });
      folderId = (await driveEnsureFolder(token, M.folder, parent.id)).id;
    }
    const day = dayKey();
    const existing = await driveList(token, `'${folderId}' in parents and trashed = false and name contains '${day}_'`, 'files(id,name)');
    const used = existing.map(f => { const m = f.name.match(new RegExp('^' + day + '_(\\d+)_' + M.suffix)); return m ? +m[1] : 0; });
    const n = (used.length ? Math.max(...used) : 0) + 1;
    const filename = `${day}_${n}_${M.suffix}.${ext}`;
    return reply(200, { accessToken: token, folderId, filename, number: n, day });
  } catch (e) { return reply(500, { error: e.message }); }
};
