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
/* comments are where the false positives live: "toss.im" in a CSS comment
   looks exactly like a class called .im */
const stripBlockComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');

const cssBody = /<style>([\s\S]*?)<\/style>/.exec(src)[1];
const scriptBody = /<script>\n\(function\(\)\{([\s\S]*?)\n<\/script>/.exec(src)[1];
const markup = src.slice(src.indexOf('<div id="app">'), src.indexOf('<script>'));

// ---- i18n -----------------------------------------------------------------
const iKo = src.indexOf('\nko: {'), iVi = src.indexOf('\nvi: {'), iEnd = src.indexOf('\n};', iVi);
const koBody = stripBlockComments(src.slice(iKo, iVi));
const viBody = stripBlockComments(src.slice(iVi, iEnd));
/* values are written with either kind of quote, and a few are arrays */
const keysOf = b => new Set([...b.matchAll(/(?:^|[\s,{])([a-zA-Z0-9_]+)\s*:\s*["'[]/gm)].map(m => m[1]));
const ko = keysOf(koBody), vi = keysOf(viBody);
const outside = stripBlockComments(src.slice(0, iKo) + src.slice(iEnd));

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
const elsewhere = stripBlockComments(markup + scriptBody);
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

// ---- the things a deploy needs --------------------------------------------
for (const f of ['zio.jpg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
                 'favicon.png', 'site.webmanifest']) {
  check('the page references a file that exists: ' + f,
    fs.existsSync(path.join(__dirname, 'public', f)), true);
}

const bad = R.filter(x => !x.ok);
console.log(bad.length ? '\n' + bad.length + ' FAILED' : '\nALL ' + R.length + ' PASSED');
process.exit(bad.length ? 1 : 0);
