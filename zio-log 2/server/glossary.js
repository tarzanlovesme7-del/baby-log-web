// glossary.js — the phrases a baby-care memo is actually made of.
//
// WHY THIS EXISTS. The memo "Đi phân lỏng" came back into Korean as
// "루즈 스툴" — which is not Korean at all, it is the English "loose stool"
// spelled out in Hangul. That is what a translation-memory service does when
// it has no Vietnamese→Korean segment on file: it pivots through English and
// hands back whatever its Korean side made of the English words.
//
// General-purpose machine translation is the wrong tool for this handful of
// phrases anyway. A nanny writing about a baby uses the same thirty or so
// expressions over and over, several of them medical, where a near-miss
// changes the meaning in a way that matters:
//
//   phân lỏng   loose stool   묽은 변    ← normal enough on formula
//   tiêu chảy   diarrhoea     설사      ← the one you act on
//
// No translator should be deciding between those on our behalf, so these are
// answered from the table below: instantly, offline, and the same every time.
// Anything not in the table still goes to the translation providers.
//
// The matching is deliberately strict — the WHOLE memo (or every
// comma-separated part of it) has to be a known phrase. A memo that merely
// contains a known word goes to the providers untouched, because guessing at
// word order inside a sentence is exactly how the "루즈 스툴" class of mistake
// gets made in the other direction.

/* ko is what a Korean reader should see; vi lists the ways it gets written,
   the first of which is what a Vietnamese reader gets back. */
const ENTRIES = [
  // ---- nappies -----------------------------------------------------------
  { ko: '묽은 변', vi: ['đi phân lỏng', 'phân lỏng', 'đi ngoài phân lỏng', 'đi ngoài lỏng', 'ị lỏng'] },
  { ko: '설사', vi: ['tiêu chảy', 'bị tiêu chảy'] },
  { ko: '변비', vi: ['táo bón', 'bị táo bón'] },
  { ko: '아직 변 안 봄', vi: ['chưa đi ngoài', 'chưa ị', 'chưa đi ị'] },
  { ko: '대변 양 많음', vi: ['đi ngoài nhiều', 'phân nhiều', 'ị nhiều'] },
  { ko: '초록색 변', vi: ['phân xanh', 'phân màu xanh'] },
  { ko: '변에 점액', vi: ['phân có nhầy', 'phân nhầy'] },
  { ko: '기저귀 발진', vi: ['hăm tã', 'bị hăm tã', 'hăm'] },

  // ---- feeding -----------------------------------------------------------
  { ko: '잘 먹었어요', vi: ['bú tốt', 'bú ngoan', 'ăn tốt', 'bú giỏi'] },
  { ko: '잘 안 먹었어요', vi: ['bú ít', 'biếng bú', 'ăn ít', 'bú kém'] },
  { ko: '토했어요', vi: ['nôn', 'bị nôn', 'ói', 'bị ói'] },
  /* trớ / ọc sữa is the harmless posset a baby brings up after a feed, not
     vomiting — Korean keeps the two apart the same way */
  { ko: '게웠어요', vi: ['trớ', 'trớ sữa', 'ọc sữa', 'bị trớ'] },
  { ko: '트림했어요', vi: ['ợ hơi', 'đã ợ hơi'] },
  { ko: '배에 가스 참', vi: ['đầy hơi', 'chướng bụng', 'bị đầy hơi'] },

  // ---- sleep and mood ----------------------------------------------------
  { ko: '잘 잤어요', vi: ['ngủ ngon', 'ngủ tốt'] },
  { ko: '잠을 설쳤어요', vi: ['ngủ không ngon', 'ngủ ít', 'khó ngủ'] },
  { ko: '많이 보챘어요', vi: ['quấy khóc', 'quấy', 'hay quấy'] },
  { ko: '많이 울었어요', vi: ['khóc nhiều'] },
  { ko: '기분 좋아요', vi: ['vui vẻ', 'ngoan'] },

  // ---- health ------------------------------------------------------------
  { ko: '열이 나요', vi: ['sốt', 'bị sốt'] },
  { ko: '미열', vi: ['sốt nhẹ'] },
  { ko: '체온 정상', vi: ['thân nhiệt bình thường', 'nhiệt độ bình thường'] },
  { ko: '기침', vi: ['ho', 'bị ho'] },
  { ko: '콧물', vi: ['sổ mũi', 'chảy nước mũi'] },
  { ko: '발진', vi: ['nổi mẩn', 'phát ban', 'nổi mẩn đỏ'] },
  { ko: '약 먹였어요', vi: ['đã cho uống thuốc', 'cho uống thuốc'] },

  // ---- care --------------------------------------------------------------
  { ko: '목욕시켰어요', vi: ['đã tắm', 'tắm cho bé', 'tắm rồi'] },
  { ko: '손톱 정리했어요', vi: ['đã cắt móng tay', 'cắt móng tay'] },
  { ko: '산책했어요', vi: ['đi dạo', 'đã đi dạo'] },
];

/* Lower-case, one space between words, no trailing full stop or exclamation —
   so "Đi phân lỏng." and "đi  phân lỏng" are the same key. NFC first: the
   Vietnamese keyboard and the web form do not always compose the diacritics
   the same way, and two visually identical strings otherwise miss. */
function normalize(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`~]+|[\s"'`~.!。！]+$/g, '')
    .trim();
}

const TO_KO = new Map();
const TO_VI = new Map();
for (const e of ENTRIES) {
  TO_VI.set(normalize(e.ko), e.vi[0]);
  for (const v of e.vi) TO_KO.set(normalize(v), e.ko);
}

/* A memo is very often two known phrases with a comma between them
   ("bú tốt, ngủ ngon"). Every part has to be known — one unknown part and the
   whole memo goes to the translator, because a half-translated memo reads as
   a bug rather than as a translation. */
const PART_SPLIT = /\s*[,;/·、]\s*|\s+[-–—]\s+/;

function lookup(text, targetLang) {
  const table = targetLang === 'ko' ? TO_KO : TO_VI;
  const whole = table.get(normalize(text));
  if (whole) return whole;

  const parts = String(text).split(PART_SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const out = [];
  for (const p of parts) {
    const hit = table.get(normalize(p));
    if (!hit) return null;
    out.push(hit);
  }
  return out.join(', ');
}

module.exports = { lookup, normalize, ENTRIES };
