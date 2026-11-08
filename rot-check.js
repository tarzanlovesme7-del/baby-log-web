/* THE ROT GUARD — no browser, just reads the file.

   Two of the bugs in this app came from the same thing: a screen was
   replaced and something belonging to the old one stayed behind. A helper
   got deleted along with the chart that used it (and the poo section threw
   on every render). A full-width divider outlived the screen it separated
   and floated in the gap between two days. Neither is visible in a diff and
   neither breaks the parser.

   So: everything defined must be used, everything used must be defined, and
   the two languages must say the same set of things — because a key missing
   from Vietnamese doesn't error, it silently shows Korean to the one person
   in the house who can't read it. */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'public', 'index.html');
const R = [];
function check(n, a, e) { const ok = JSON.stringify(a) === JSON.stringify(e); R.push({ n, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n        got=' + JSON.stringify(a) + '\n        want=' + JSON.stringify(e))); }

const src = fs.readFileSync(SRC, 'utf8');
/* Comments are where the false positives live: "toss.im" in a CSS comment
   looks exactly like a class called .im.

   But a comment is only a comment in the language it is written in, and this
   file is three languages in one. `accept="image/*"` is an ordinary HTML
   attribute — and reading it as the start of a /* block comment swallowed
   fifty kilobytes of markup up to the next */ /* in the script, after which
   this guard cheerfully reported that half the page's classes were unused.
   So each part is stripped as what it actually is. */
const stripBlockComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripHtmlComments = t => t.replace(/<!--[\s\S]*?-->/g, ' ');

const cssBody = /<style>([\s\S]*?)<\/style>/.exec(src)[1];
const scriptBody = /<script>\n\(function\(\)\{([\s\S]*?)\n<\/script>/.exec(src)[1];
/* <body> 부터 센다. 예전엔 <div id="app"> 부터 잘랐는데, 그 바깥에 서는
   화면이 생기면서(비번 화면은 #app 을 숨기고 그 자리에 선다) 거기 쓰인
   글과 클래스가 통째로 '아무도 안 쓴다'로 잡혔다. */
const markupRaw = src.slice(src.indexOf('<body'), src.indexOf('<script>'));
const markup = stripHtmlComments(markupRaw);

// ---- i18n -----------------------------------------------------------------
const iKo = src.indexOf('\nko: {'), iVi = src.indexOf('\nvi: {'), iEnd = src.indexOf('\n};', iVi);
const koBody = stripBlockComments(src.slice(iKo, iVi));
const viBody = stripBlockComments(src.slice(iVi, iEnd));
/* values are written with either kind of quote, and a few are arrays */
const keysOf = b => new Set([...b.matchAll(/(?:^|[\s,{])([a-zA-Z0-9_]+)\s*:\s*["'[]/gm)].map(m => m[1]));
const ko = keysOf(koBody), vi = keysOf(viBody);
/* everything that can ASK for a string: the markup (HTML comments gone) and
   the script (block comments gone), rather than the raw file */
const outside = markup + stripBlockComments(scriptBody);

console.log('       ' + ko.size + ' Korean strings, ' + vi.size + ' Vietnamese');
check('every Korean string has a Vietnamese twin', [...ko].filter(k => !vi.has(k)), []);
check('...and the other way round', [...vi].filter(k => !ko.has(k)), []);

/* a key can be reached three ways: written out, named in the markup, or
   built by hand ("t('t_' + type.id)") */
const prefixes = [...outside.matchAll(/['"]([a-zA-Z0-9_]{2,})['"]?\s*\+/g)].map(m => m[1])
  .concat([...outside.matchAll(/\+\s*['"]([a-zA-Z0-9_]{2,})['"]/g)].map(m => m[1]));
const reachable = k =>
  new RegExp("['\"]" + k + "['\"]").test(outside) ||
  new RegExp('data-i18n(?:-ph)?="' + k + '"').test(markup) ||
  prefixes.some(p => k.startsWith(p) && p.length > 1);
check('no string is defined and never used', [...ko].filter(k => !reachable(k)).sort(), []);

/* the opposite direction: a typo in t('...') doesn't throw, it quietly
   falls back to Korean — on the nanny's phone */
const asked = new Set([...outside.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+)'\s*\)/g)].map(m => m[1])
  .concat([...markup.matchAll(/data-i18n(?:-ph)?="([a-zA-Z0-9_]+)"/g)].map(m => m[1])));
check('every string the code asks for exists', [...asked].filter(k => !ko.has(k)).sort(), []);

// ---- CSS ------------------------------------------------------------------
const css = stripBlockComments(cssBody);
const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m => m[1]));
const elsewhere = markup + stripBlockComments(scriptBody);
const usedClasses = [...defined].filter(c => new RegExp('\\b' + c.replace(/-/g, '\\-') + '\\b').test(elsewhere));
console.log('       ' + defined.size + ' CSS classes defined, ' + usedClasses.length + ' referenced');
check('no CSS class is defined and never used',
  [...defined].filter(c => !usedClasses.includes(c)).sort(), []);

// ---- functions ------------------------------------------------------------
const js = stripBlockComments(scriptBody).replace(/(^|[^:])\/\/.*$/gm, '$1');
const fns = [...js.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map(m => m[1]);
const dupes = fns.filter((f, i) => fns.indexOf(f) !== i);
check('no two functions share a name', [...new Set(dupes)], []);

/* a function nobody calls is either dead or — worse — the live one was
   deleted and this is its replacement nobody wired up */
const orphans = fns.filter(f => {
  /* $ and $$ are not word characters, so \b would never match them */
  const esc = f.replace(/\$/g, '\\$');
  const pat = /^[$_]/.test(f) ? '(?<![A-Za-z0-9_$])' + esc + '(?![A-Za-z0-9_$])'
                              : '\\b' + esc + '\\b';
  const uses = (js.match(new RegExp(pat, 'g')) || []).length;
  return uses <= 1 && !new RegExp(pat).test(markup);
});
console.log('       ' + fns.length + ' functions');
check('no function is defined and never called', orphans.sort(), []);

/* ---- 용어집 두 벌이 같은가 ------------------------------------------------
   같은 표가 서버(server/glossary.js)와 폰(public/index.html) 양쪽에 있다.
   폰이 먼저 답하고 못 하면 서버로 가는 구조라, 둘이 어긋나면 같은 글이
   어디서 번역됐느냐에 따라 다른 말이 된다 — 읽는 사람은 그걸 알 길이 없다. */
{
  const { ENTRIES } = require('./server/glossary.js');
  const m = src.match(/var GLOSSARY = (\[[\s\S]*?\]);/);
  const client = m ? eval(m[1]) : null;
  const key = (e) => e.ko + '|' + e.vi.join(',');
  const a2 = ENTRIES.map(key).sort();
  const b2 = client ? client.map(key).sort() : [];
  check('the two glossaries say the same thing',
    [a2.filter((x) => !b2.includes(x)), b2.filter((x) => !a2.includes(x))], [[], []]);
}

// ---- the things a deploy needs --------------------------------------------
for (const f of ['zio.jpg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
                 'favicon.png', 'site.webmanifest']) {
  check('the page references a file that exists: ' + f,
    fs.existsSync(path.join(__dirname, 'public', f)), true);
}

// ---- 문법 ------------------------------------------------------------------
// 페이지 속 스크립트가 **파싱되는가**. 당연해 보이지만 2026-11-02 에 표 하나에
// 쉼표가 빠져 앱 전체가 뜨지 않는 파일을 만들 뻔했다 — 브라우저를 띄우는
// 스위트는 3초가 걸리고, 이 검사는 10ms다.
{
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  let err = null;
  try { new Function(m ? m[1] : ''); } catch (e) { err = e.message; }
  check('페이지 스크립트가 문법에 맞는다', err, null);
}

// ---- 재료 그림 ------------------------------------------------------------
// 두 표(WEAN_ICON_FILE: 재료 id → 파일, WEAN_ICON_BY_NAME: 한글 이름 → 파일)가
// 가리키는 svg 가 실제로 있어야 한다. 그림은 쓰기 전에 미리 넣어 두는 것이라
// (2026-11-02) 화면에서는 한참 뒤에야 빈칸으로 드러난다 — 여기서 먼저 잡는다.
{
  const pick = (name) => {
    const m = src.match(new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n\\});'));
    return m ? eval('(' + m[1].replace(/\/\*[\s\S]*?\*\//g, '') + ')') : null;
  };
  const byId = pick('WEAN_ICON_FILE'), byName = pick('WEAN_ICON_BY_NAME');
  check('재료 그림 표 둘 다 읽힌다', [!!byId, !!byName], [true, true]);
  const missing = [];
  for (const map of [byId, byName]) {
    for (const k of Object.keys(map || {})) {
      const f = path.join(__dirname, 'public', 'icons', map[k] + '.svg');
      if (!fs.existsSync(f)) missing.push(k + ' → ' + map[k] + '.svg');
    }
  }
  check('재료 그림 파일이 전부 있다', missing, []);
  // 반대쪽: 넣어 두고 아무 데서도 안 가리키는 그림 — 미리 넣어 두는 것이 목적이라
  // 오류는 아니지만, 이름을 적어 두지 않으면 영영 안 붙으므로 세어서 알려준다.
  const used = new Set([...Object.values(byId || {}), ...Object.values(byName || {})]);
  const orphan = fs.readdirSync(path.join(__dirname, 'public', 'icons'))
    .filter((f) => f.endsWith('.svg') && !used.has(f.replace('.svg', '')));
  if (orphan.length) console.log('NOTE  이름이 안 적힌 그림 ' + orphan.length + '장: ' + orphan.join(', '));
}

const bad = R.filter(x => !x.ok);
console.log(bad.length ? '\n' + bad.length + ' FAILED' : '\nALL ' + R.length + ' PASSED');
process.exit(bad.length ? 1 : 0);
