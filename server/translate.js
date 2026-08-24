// translate.js — server-side call to the unofficial Google Translate
// endpoint (the same one several open-source "google-translate-api" style
// libraries hit). No API key. This ONLY works from a real server: it's
// exactly the outbound request a published Claude Artifact's CSP forbids,
// which is the whole reason this app moved off the Artifact platform.
//
// This is unofficial and unsupported by Google — it can rate-limit or
// change shape without notice. If that becomes a problem in practice, swap
// this module for the official Google Cloud Translation API or DeepL API
// (both need an API key) without touching any caller.

async function translateText(text, targetLang) {
  if (!text || !text.trim()) return '';
  const url = 'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyLog/1.0)' },
  });
  if (!res.ok) {
    const err = new Error('translate upstream error: ' + res.status);
    err.status = 502;
    throw err;
  }
  const json = await res.json();
  // shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ]
  const chunks = (json && json[0]) || [];
  return chunks.map((c) => c[0]).join('');
}

module.exports = { translateText };
