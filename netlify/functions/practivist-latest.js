// Latest Practivist episode from the podcast's public feed: link, title, description, cover image.
const { reply, preflight } = require('./_lib');
const FEED = process.env.PRACTIVIST_FEED || 'https://practivistpod.substack.com/feed';

function pick(xml, tag) { const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i')); return m ? m[1].trim() : ''; }
function unCdata(s) { return s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim(); }
function stripHtml(s) { return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }

exports.handler = async function (event) {
  const pf = preflight(event); if (pf) return pf;
  try {
    const r = await fetch(FEED, { headers: { 'User-Agent': 'Postradamus/1.0' } });
    if (!r.ok) return reply(502, { error: 'Feed returned ' + r.status });
    const xml = await r.text();
    const item = (xml.match(/<item>[\s\S]*?<\/item>/i) || [])[0];
    if (!item) return reply(404, { error: 'No episodes in the feed' });
    const title = unCdata(pick(item, 'title'));
    const link = unCdata(pick(item, 'link'));
    const descRaw = unCdata(pick(item, 'description')) || unCdata(pick(item, 'itunes:summary'));
    const description = stripHtml(descRaw);
    const img = (item.match(/<itunes:image[^>]*href="([^"]+)"/i) || item.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i) || item.match(/<media:content[^>]*url="([^"]+)"/i) || descRaw.match(/<img[^>]*src="([^"]+)"/i) || [])[1] || (xml.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || '';
    const pubDate = unCdata(pick(item, 'pubDate'));
    const firstPara = description.split(/\n\n/)[0] || '';
    const caption = 'New Practivist pod is out! ' + title + (firstPara && firstPara !== title ? '\n\n' + firstPara : '');
    return reply(200, { title, link, description, image: img, pubDate, caption }, { 'Cache-Control': 'public, max-age=300' });
  } catch (e) { return reply(500, { error: e.message }); }
};
