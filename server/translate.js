// translate.js — server-side memo translation (Korean <-> Vietnamese).
//
// Primary: MyMemory (api.mymemory.translated.net) — free, keyless, documented.
// Fallback: the unofficial Google Translate endpoint, for when MyMemory is
// down or the daily quota is spent.
//
// Two things this module has to defend against, both of which showed up in
// real use as a memo preview stuck on "번역중…" forever:
//
//   1. MyMemory rejects a query over ~500 BYTES. Korean is 3 bytes a
//      character, so that's only ~166 characters — an ordinary two-sentence
//      memo blows past it. Long text is therefore split on sentence
//      boundaries into under-limit pieces, translated piece by piece, and
//      rejoined.
//   2. Neither provider promises to answer promptly, and fetch() has no
//      default timeout, so a slow provider left the request hanging with no
//      error to show the user. Every request now has its own deadline.

// Render's free tier gives every service a SHARED outbound IP, and both free
// providers meter anonymous use by IP — so the daily quota is already spent by
// strangers before this app asks for anything, and both answer 429. Two ways
// out, in order of preference:
//   DEEPL_API_KEY      a real key, metered to the account, not the IP
//   MYMEMORY_EMAIL     free and signup-free: MyMemory meters by EMAIL when the
//                      `de` parameter is present, which sidesteps the shared IP
// With neither set the app still tries anonymously, which is what fails today.
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || '';
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL || '';

const MYMEMORY_MAX_BYTES = 450;   // under the documented 500, leaving headroom
const REQUEST_TIMEOUT_MS = 6000;  // per provider request; 2 providers => ~12s worst case,
                                  // which the browser's own 15s give-up sits just outside
const MAX_CHUNKS = 8;             // refuse to fan a single memo out forever

function byteLen(s) { return Buffer.byteLength(s, 'utf8'); }

/* Split text into pieces that each fit the byte budget, preferring to break
   where a reader would: sentence end, then clause, then whitespace, and only
   as a last resort mid-run (a very long unbroken string). */
function chunkByBytes(text, maxBytes) {
  if (byteLen(text) <= maxBytes) return [text];

  const pieces = [];
  // keep the delimiter attached to the sentence it ends
  const sentences = text.split(/(?<=[.!?。！？\n])\s*/).filter(Boolean);

  let buf = '';
  const flush = () => { if (buf.trim()) pieces.push(buf.trim()); buf = ''; };

  for (const sentence of sentences) {
    if (byteLen(sentence) > maxBytes) {
      flush();
      // sentence alone is too big: break it on spaces, then hard-slice
      let rest = sentence;
      while (byteLen(rest) > maxBytes) {
        let cut = rest.length;
        while (cut > 0 && byteLen(rest.slice(0, cut)) > maxBytes) cut--;
        const spaceAt = rest.lastIndexOf(' ', cut);
        const at = spaceAt > cut * 0.5 ? spaceAt : cut;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) buf = rest;
      continue;
    }
    if (byteLen(buf + sentence) > maxBytes) flush();
    buf += (buf ? ' ' : '') + sentence;
  }
  flush();
  return pieces.filter(Boolean);
}

async function fetchWithTimeout(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyLog/1.0)' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return res;
}

/* MyMemory needs a REAL source language in langpair — 'auto' comes back as
   "'AUTO' IS AN INVALID SOURCE LANGUAGE". This app only ever translates
   between Korean and Vietnamese, so the source is simply the other one. */
function sourceFor(targetLang) { return targetLang === 'ko' ? 'vi' : 'ko'; }

async function myMemoryOnce(text, targetLang) {
  const url = 'https://api.mymemory.translated.net/get' +
    '?q=' + encodeURIComponent(text) +
    '&langpair=' + encodeURIComponent(sourceFor(targetLang) + '|' + targetLang) +
    (MYMEMORY_EMAIL ? '&de=' + encodeURIComponent(MYMEMORY_EMAIL) : '');
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('mymemory upstream error: ' + res.status);
  const json = await res.json();
  const out = json && json.responseData && json.responseData.translatedText;
  // MyMemory answers 200 even for quota/'too long' errors, putting the
  // complaint where the translation should be — treat those as failures so
  // the caller falls through to the backup provider.
  if (!out || /^(QUERY LENGTH LIMIT|INVALID|NO QUERY|MYMEMORY WARNING|YOU USED ALL|'[A-Z-]+' IS AN INVALID)/i.test(out)) {
    throw new Error('mymemory returned no usable translation');
  }
  return out;
}

async function googleOnce(text, targetLang) {
  const url = 'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) +
    '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('google upstream error: ' + res.status);
  const json = await res.json();
  // shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
  const chunks = (json && json[0]) || [];
  const out = chunks.map((c) => c[0]).join('');
  if (!out) throw new Error('google returned no usable translation');
  return out;
}

/* DeepL, when a key is configured. Metered to the key, so a shared server IP
   doesn't matter — this is the only option that stays reliable. */
async function deeplOnce(text, targetLang) {
  const host = DEEPL_API_KEY.endsWith(':fx')
    ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(host + '/v2/translate', {
    method: 'POST',
    headers: {
      'Authorization': 'DeepL-Auth-Key ' + DEEPL_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      text, target_lang: targetLang.toUpperCase(),
      source_lang: sourceFor(targetLang).toUpperCase(),
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('deepl upstream error: ' + res.status);
  const json = await res.json();
  const out = json && json.translations && json.translations[0] && json.translations[0].text;
  if (!out) throw new Error('deepl returned no usable translation');
  return out;
}

/* one piece, best available provider first */
async function translatePiece(text, targetLang) {
  const errs = [];
  const chain = [];
  if (DEEPL_API_KEY) chain.push(['deepl', deeplOnce]);
  chain.push(['mymemory', myMemoryOnce], ['google', googleOnce]);

  for (const [name, fn] of chain) {
    try {
      return await fn(text, targetLang);
    } catch (err) {
      errs.push(name + ': ' + err.message);
    }
  }
  const e = new Error('translate upstream error: all providers failed');
  e.status = 502;
  e.detail = errs.join(' / ');
  throw e;
}

async function translateText(text, targetLang) {
  if (!text || !text.trim()) return '';

  // Google has no comparable length limit, so for long text try it first as a
  // single request — one call beats eight, and only if it fails do we fall
  // back to chunking through MyMemory.
  if (byteLen(text) > MYMEMORY_MAX_BYTES) {
    // neither of these has MyMemory's length limit, so try them whole first
    if (DEEPL_API_KEY) {
      try { return await deeplOnce(text, targetLang); } catch (e) { /* keep going */ }
    }
    try { return await googleOnce(text, targetLang); } catch (e) { /* chunk below */ }
  }

  const pieces = chunkByBytes(text, MYMEMORY_MAX_BYTES);
  if (pieces.length > MAX_CHUNKS) {
    const e = new Error('translate: text too long');
    e.status = 413;
    throw e;
  }

  try {
    const out = [];
    for (const piece of pieces) {
      out.push(await translatePiece(piece, targetLang));
    }
    return out.join(' ');
  } catch (err) {
    console.error('[baby-log] translate failed —', err.detail || err.message);
    throw err;
  }
}

module.exports = { translateText, chunkByBytes, MYMEMORY_MAX_BYTES };
