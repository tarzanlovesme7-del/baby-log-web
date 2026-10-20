// translate.js — server-side memo translation (Korean <-> Vietnamese).
//
// Order: the glossary (see glossary.js) answers the everyday baby-care
// phrases outright, then DeepL if a key is configured, then Google, then
// MyMemory.
//
// MYMEMORY IS LAST, AND THAT IS THE POINT. It is a translation MEMORY: it
// looks the text up in a store of segments other people have translated. For
// a pair as thin as Vietnamese→Korean it usually has nothing, so it pivots
// through English and returns whatever its Korean side made of the English —
// which is how the memo "Đi phân lỏng" reached her phone as "루즈 스툴", the
// English "loose stool" spelled out in Hangul. It stays in the chain because
// it is keyless and documented and beats showing nothing, but it should only
// ever be reached when both real engines have refused.
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
const { lookup } = require('./glossary');

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
  /* real engines first, translation memory last — see the note at the top */
  chain.push(['google', googleOnce], ['mymemory', myMemoryOnce]);

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

/* ── 숫자는 번역하지 않는다 ─────────────────────────────────────
   베트남어는 소수점이 쉼표다(3.4 → 3,4). 번역기는 그게 친절이라고 생각하고
   숫자 표기를 현지식으로 바꿔 주는데, 약 용량에서는 그게 친절이 아니다 —
   한국어 원문에 '헤만지올 3.4'라고 적은 것이 내니 폰에서 'Hemangiol 3,4'로
   보이면, 둘이 같은 값인지 세 자리 구분인지 읽는 사람이 판단해야 한다.
   그래서 원문에 있던 숫자를 번역문에 그대로 돌려놓는다.

   원문에서 숫자를 순서대로 뽑고, 번역문의 숫자도 순서대로 뽑아서, 같은 자리
   것끼리 짝을 지어 '구분기호만 다르고 자릿수는 같은' 경우에만 되돌린다.
   개수가 다르거나(번역기가 숫자를 지우거나 더한 경우) 값 자체가 다르면
   손대지 않는다 — 틀린 추측으로 숫자를 바꾸느니 그대로 두는 쪽이 낫다. */
const NUM_RE = /\d[\d.,]*\d|\d/g;
function sameDigits(a, b) {
  return a.replace(/[.,]/g, '') === b.replace(/[.,]/g, '');
}
function restoreNumbers(src, out) {
  if (!src || !out) return out;
  const from = out.match(NUM_RE);
  const to = src.match(NUM_RE);
  if (!from || !to || from.length !== to.length) return out;
  /* 자릿수가 하나라도 어긋나면 통째로 포기한다 */
  for (let i = 0; i < from.length; i++) if (!sameDigits(from[i], to[i])) return out;
  let i = 0;
  return out.replace(NUM_RE, () => to[i++]);
}

/* ── 약 이름은 번역하지 않는다 ───────────────────────────────────
   지오가 먹는 약 이름이 번역기를 거치면 'Hemangio'(끝 글자가 떨어짐),
   'Hemangiole', '헤만지올' 세 가지로 갈렸다. 실제로 기록 19건이 그렇게
   쌓여서 손으로 고쳤다. 같은 약이 표기만 달라 두 가지로 쌓이면 통계도
   검색도 둘로 갈린다.

   앞머리만 맞으면 통째로 제 이름으로 돌려놓는다 — 번역기가 어디를 어떻게
   깎든 앞머리는 거의 늘 남는다. 한글로 옮겨 놓은 것도 같이 되돌린다. */
const DRUG_TERMS = [
  { name: 'Hemangiol', pats: [/Hemang[\p{L}]*/giu, /헤만지[가-힣]*/g] },
];
function restoreDrugNames(src, out) {
  if (!src || !out) return out;
  let s2 = out;
  for (const d of DRUG_TERMS) {
    /* 원문에 없던 이름을 만들어 넣지 않는다 — 고치는 것은 원문에 있던 것뿐 */
    const inSrc = d.pats.some((re) => { re.lastIndex = 0; return re.test(src); });
    if (!inSrc) continue;
    for (const re of d.pats) { re.lastIndex = 0; s2 = s2.replace(re, d.name); }
  }
  return s2;
}

async function translateText(text, targetLang) {
  if (!text || !text.trim()) return '';

  /* the phrases this app is actually made of: answered from the table,
     instantly, offline, and identically every time */
  const known = lookup(text, targetLang);
  if (known) return known;

  // Google has no comparable length limit, so for long text try it whole —
  // one call beats eight, and only if it fails do we fall back to chunking
  // through MyMemory.
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

/* 어느 엔진을 거쳤든 나가는 길은 여기 하나다.

   되돌리기(숫자·약 이름)는 **다듬는 일**이다. 그게 실패했다고 번역문을
   통째로 날려서는 안 된다 — 번역이 아예 안 된 것과 소수점이 쉼표인 것은
   같은 크기의 사고가 아니다. 그래서 여기만 try 로 감싼다. */
async function translate(text, targetLang) {
  const out = await translateText(text, targetLang);
  try {
    return restoreDrugNames(text, restoreNumbers(text, out));
  } catch (err) {
    console.error('[baby-log] restore failed —', err && err.message);
    return out;
  }
}

module.exports = { translateText: translate, chunkByBytes, MYMEMORY_MAX_BYTES,
  restoreNumbers, restoreDrugNames,
  hasGoodEngine: () => !!DEEPL_API_KEY };
