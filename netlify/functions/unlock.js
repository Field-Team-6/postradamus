// "Remember me" for the app key. POST with the key (header) → sets a year-long cookie on this device and says ok.
// GET → says whether this device is already unlocked (header, link or cookie). Never reveals the key itself.
const { reply, preflight, checkAppKey, rememberKeyHeader } = require('./_lib');

exports.handler = async function (event) {
  const pf = preflight(event); if (pf) return pf;
  if (!checkAppKey(event)) return reply(401, { ok: false });
  return reply(200, { ok: true }, rememberKeyHeader());
};
