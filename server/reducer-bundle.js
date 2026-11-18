// reducer-bundle.js — server/mutations.js 를 폰이 읽을 수 있는 모양으로 싼다.
//
// 왜: 쓰기는 하나씩 서버로 간다. 앞 쓰기의 답이 오면 폰은 서버 문서로 상태를
// 갈아끼우는데, 그 문서에는 아직 줄에 선 뒤 쓰기들이 없다 — 분유를 찍고 바로
// 투약을 찍으면 분유 답이 오는 순간 투약 줄이 화면에서 사라졌다가 제 답이 와야
// 다시 나타났다("씹힌다", 2026-11-18). 폰이 서버와 **같은 reducer** 로 줄에 선
// 쓰기를 다시 얹으면 화면은 서버가 곧 갖게 될 모습 그대로 남는다.
//
// 파일을 두 벌(서버용/폰용) 두지 않고 서버가 부팅할 때 같은 소스를 싸서 내준다 —
// 한쪽만 고치고 다른 쪽을 잊는 일이 생길 수 없게.
const fs = require('fs');
const path = require('path');

function build() {
  const src = fs.readFileSync(path.join(__dirname, 'mutations.js'), 'utf8');
  return '/* generated from server/mutations.js — do not edit */\n' +
    '(function(){\n' +
    'var module = { exports: {} }; var exports = module.exports;\n' +
    'function require(name){\n' +
    '  if (name === "crypto") return { randomBytes: function(k){\n' +
    '    var a = new Uint8Array(k); (self.crypto || window.crypto).getRandomValues(a);\n' +
    '    return { toString: function(){ var s = ""; for (var i = 0; i < a.length; i++)\n' +
    '      s += (a[i] < 16 ? "0" : "") + a[i].toString(16); return s; } }; } };\n' +
    '  throw new Error("reducer bundle: no module " + name);\n' +
    '}\n' +
    src + '\n;window.zioReducer = module.exports;\n})();\n';
}
module.exports = { build };
