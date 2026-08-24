// translate.js — server-side memo translation (Korean <-> Vietnamese).
//
// Primary: MyMemory (api.mymemory.translated.net) — a free, keyless,
// documented public API (not a reverse-engineered endpoint), so it doesn't
// get IP-blocked the way scraping Google's internal endpoint does. No
// signup required; ~5,000 chars/day per source IP, or ~50,000/day if we
// tag requests with a contact email (the "de" param) — see
// https://mymemory.translated.net/doc/spec.php
//
// Fallback: the unofficial Google Translate endpoint, kept as a second
// attempt in case MyMemory has an outage or the daily quota is hit. This
// ONLY works from a real server (a published Claude Artifact's CSP blocks
// this exact outbound request, which is the whole reason this app moved
// off the Artifact platform).
//
// Both calls are best-effort: on total failure the caller (server.js)
// returns an error, and the frontend already saves the memo without a
// translation rather than blocking the user — see submitMemo() in
// public/index.html.

async function translateViaMyMemory(text, targetLang) {
  const url = 'https://api.mymemory.translated.net/get' +
    '?q=' + encodeURIComponent(text) +
    '&langpair=' + encodeURIComponent('auto|' + targetLang);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyLog/1.0)' },
  });
  if (!res.ok) throw new Error('mymemory upstream error: ' + res.status);
  const json = await res.json();
  const translated = json && json.responseData && json.responseData.translatedText;
  // MyMemory returns HTTP 200 even on quota/errors, with a status string
  // instead — treat anything that isn't a normal translated string as a
  // failure so the caller falls through to the backup provider.
  if (!translated || /^(QUERY LENGTH LIMIT|INVALID|NO QUERY)/i.test(translated)) {
    throw new Error('mymemory returned no usable translation');
  }
  return translated;
}

async function translateViaGoogleUnofficial(text, targetLang) {
  const url = 'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyLog/1.0)' },
  });
  if (!res.ok) throw new Error('google upstream error: ' + res.status);
  const json = await res.json();
  // shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
  const chunks = (json && json[0]) || [];
  const translated = chunks.map((c) => c[0]).join('');
  if (!translated) throw new Error('google returned no usable translation');
  return translated;
}

async function translateText(text, targetLang) {
  if (!text || !text.trim()) return '';
  try {
    return await translateViaMyMemory(text, targetLang);
  } catch (primaryErr) {
    try {
      return await translateViaGoogleUnofficial(text, targetLang);
    } catch (fallbackErr) {
      console.error('[baby-log] translate: both providers failed —', primaryErr.message, '/', fallbackErr.message);
      const err = new Error('translate upstream error: both providers failed');
      err.status = 502;
      throw err;
    }
  }
}

module.exports = { translateText };
