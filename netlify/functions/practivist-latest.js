// Latest Practivist episode from the podcast's public feed: link, title, caption (the post's first paragraph,
// the same text as the episode email), and a cover image (from the episode page if the feed has none).
const { reply, preflight } = require('./_lib');
const FEED = process.env.PRACTIVIST_FEED || 'https://practivistpod.substack.com/feed';

function pick(xml, tag) { const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i')); return m ? m[1].trim() : ''; }
function unCdata(s) { return s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim(); }
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function text(html) { return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim(); }

async function ogImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Postradamus/1.0' } });
    if (!r.ok) return '';
    const h = await r.text();
    const m = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? decode(m[1]) : '';
  } catch (e) { return ''; }
}

exports.handler = async function (event) {
  const pf = preflight(event); if (pf) return pf;
  try {
    const r = await fetch(FEED, { headers: { 'User-Agent': 'Postradamus/1.0' } });
    if (!r.ok) return reply(502, { error: 'Feed returned ' + r.status });
    const xml = await r.text();
    const item = (xml.match(/<item>[\s\S]*?<\/item>/i) || [])[0];
    if (!item) return reply(404, { error: 'No episodes in the feed' });
    const title = decode(unCdata(pick(item, 'title')));
    const link = unCdata(pick(item, 'link'));
    const body = unCdata(pick(item, 'content:encoded')) || unCdata(pick(item, 'description'));
    // First real paragraph of the post = the caption in the episode email.
    const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => text(m[1])).filter(t => t.length > 20);
    const firstPara = paras[0] || text(body).split(/\n\n/)[0] || '';
    let img = (item.match(/<itunes:image[^>]*href="([^"]+)"/i) || item.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) || item.match(/<media:content[^>]*url="([^"]+)"[^>]*medium="image"/i) || body.match(/<img[^>]*src="([^"]+)"/i) || [])[1] || '';
    if (!img && link) img = await ogImage(link);
    if (!img) img = (xml.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i) || [])[1] || '';
    const pubDate = unCdata(pick(item, 'pubDate'));
    const caption = 'New Practivist pod is out! ' + title + (firstPara ? '\n\n' + firstPara : '');
    return reply(200, { title, link, description: firstPara, image: decode(img), pubDate, caption }, { 'Cache-Control': 'public, max-age=300' });
  } catch (e) { return reply(500, { error: e.message }); }
};
