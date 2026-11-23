// 斷句與去標點規則的測試。執行：node tests/segment.test.mjs
// 會從 script.js 抽出「<斷句規則開始>」到「<斷句規則結束>」之間的程式來跑，所以測的就是網站實際用的那一份。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const rules = source.slice(source.indexOf('// <斷句規則開始>'), source.indexOf('// <斷句規則結束>'));
assert.ok(rules.length > 500, '在 script.js 找不到斷句規則的區段標記');

const dict = { data: { terms: [], rules: [] } };
const { stripPunct, resegment, visualLen } = new Function('dict', 'window', `
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const squash = s => s.replace(/\\s+/g, '');
    ${rules}
    return { stripPunct, resegment, visualLen };
`)(dict, globalThis);

// 把一句話切成每個字一個時間（模擬 Whisper 的逐字時間戳）
const timed = (text, start = 0, perChar = 0.2) => ({
    start, end: start + text.length * perChar, text,
    words: [...text].map((ch, i) => ({ word: ch, start: start + i * perChar, end: start + (i + 1) * perChar })),
});
const lines = (text, lang = 'zh', withWords = true) =>
    resegment(withWords ? timed(text) : { start: 0, end: 10, text, words: [] }, lang).map(s => s.text);

let passed = 0;
const test = (name, fn) => {
    try { fn(); passed++; console.log('  通過  ' + name); }
    catch (e) { process.exitCode = 1; console.log('  失敗  ' + name + '\n        ' + e.message.split('\n').join('\n        ')); }
};

console.log('去標點');
test('中文標點全部移除，行內的頓號變成一個空格', () =>
    assert.equal(stripPunct('啤酒、茶飲和礦泉水。'), '啤酒 茶飲和礦泉水'));
test('引號、冒號、驚嘆號', () =>
    assert.equal(stripPunct('「你好」，他說：走吧！'), '你好 他說 走吧'));
test('保留英文撇號、小數點、時間、百分比', () =>
    assert.equal(stripPunct("How's it going? It costs 3.5%, at 12:30."), "How's it going It costs 3.5% at 12:30"));
test('保留千分位', () => assert.equal(stripPunct('總共1,000元。'), '總共1,000元'));

console.log('遇到標點就換行');
test('逗點與句號都換行，再短也自成一行', () =>
    assert.deepEqual(lines('大家好,歡迎收聽今天的節目。謝謝收聽,我們下次見。'),
        ['大家好', '歡迎收聽今天的節目', '謝謝收聽', '我們下次見']));
test('全形逗點、問號、驚嘆號', () =>
    assert.deepEqual(lines('你好嗎？我很好！真的，沒問題'), ['你好嗎', '我很好', '真的', '沒問題']));
test('頓號不換行', () =>
    assert.deepEqual(lines('三得利也生產啤酒、茶飲和礦泉水。'), ['三得利也生產啤酒 茶飲和礦泉水']));
test('沒有逐字時間戳時規則相同', () =>
    assert.deepEqual(lines('大家好,歡迎收聽今天的節目。', 'zh', false), ['大家好', '歡迎收聽今天的節目']));

console.log('每行字數上限');
const long = '接下來我們會介紹機器學習在飲料產業的應用很多公司開始使用深度學習來預測市場需求今天我們要來聊聊三得利這個品牌的歷史';
test('中文每行不超過 16 字', () => {
    for (const l of lines(long)) assert.ok(visualLen(l) <= 16, `「${l}」有 ${visualLen(l)} 字`);
});
test('切完之後一個字都沒少', () =>
    assert.equal(lines(long).join(''), long));
test('英文每行不超過 42 個字元', () => {
    const text = ' The quick brown fox jumps over the lazy dog and keeps running through the forest until the sun goes down.';
    const seg = { start: 0, end: 10, text: text.trim(), words: text.trim().split(' ').map((w, i) => ({ word: ' ' + w, start: i, end: i + 1 })) };
    const out = resegment(seg, 'en').map(s => s.text);
    for (const l of out) assert.ok(l.length <= 42, `"${l}" 有 ${l.length} 個字元`);
    assert.equal(out.join(' '), stripPunct(text));
});

console.log('長句的切點');
test('不把「在」留在行尾，優先在介詞前換行', () =>
    assert.deepEqual(lines('接下來我們會介紹機器學習在飲料產業的應用'), ['接下來我們會介紹機器學習', '在飲料產業的應用']));
test('不把「要」留在行尾', () =>
    assert.deepEqual(lines('今天我們要來聊聊三得利這個品牌的歷史'), ['今天我們要來聊聊', '三得利這個品牌的歷史']));
test('詞庫裡的詞不會被切開', () => {
    dict.data.terms = ['蜜露珂娜膠原蛋白'];
    const out = lines('我每天早上都會喝蜜露珂娜膠原蛋白補充營養');
    dict.data.terms = [];
    assert.ok(out.some(l => l.includes('蜜露珂娜膠原蛋白')), out.join(' / '));
});

console.log('時間');
test('每行的時間來自逐字時間戳，頭尾等於原句', () => {
    const out = resegment(timed('大家好,歡迎收聽。', 5), 'zh');
    assert.equal(out[0].start, 5);
    assert.ok(Math.abs(out[0].end - 5.8) < 1e-9, `第一行結尾 ${out[0].end}`);
    assert.ok(Math.abs(out[1].start - 5.8) < 1e-9, `第二行開頭 ${out[1].start}`);
    assert.ok(Math.abs(out.at(-1).end - (5 + 9 * 0.2)) < 1e-9);
});
test('逐字時間戳也一起去標點，之後拆句才對得上', () => {
    for (const s of resegment(timed('大家好,歡迎收聽。'), 'zh')) assert.equal(s.words.map(w => w.word).join(''), s.text);
});

console.log(`\n${passed} 項通過${process.exitCode ? '，有失敗的項目' : ''}`);
