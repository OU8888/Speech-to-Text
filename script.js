'use strict';

/* ============================================================
 * 設定
 * 之後要把金鑰藏到 Cloudflare Worker：
 *   1. 照 worker/proxy.js 的說明部署
 *   2. 把 apiBase 改成 Worker 網址、apiKey 改成空字串 ''
 * ============================================================ */
const CONFIG = {
    apiBase: 'https://api.groq.com/openai/v1',
    apiKey: atob('Z3NrX2RaNGlGTklEQkFncTFNM3BiUnhmV0dkeWIzRllXOEdNVjBXVEdrT2JvNzRVUGs4Y2dOMEM='),
    whisperModel: 'whisper-large-v3-turbo',
    summaryModel: 'openai/gpt-oss-120b',
    correctionModel: 'openai/gpt-oss-20b',
    maxFileSize: 500 * 1024 * 1024,
    chunkSeconds: 600,   // 每段送去辨識的長度
    concurrency: 3,      // 同時辨識幾段
};

const FILE_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma'];
const LANGUAGES = ('zh auto en ja ko yue fr de es pt it ru nl pl tr ar hi th vi id ms tl sv da no fi el he uk cs ro hu bg hr sr sk sl lt lv et ' +
    'ca gl eu fa ur bn ta te ml kn mr gu pa ne si km lo my mn kk uz az hy ka sw af is mk bs sq be mt cy la').split(' ');
const LANGUAGE_LABELS = { zh: '繁體中文', auto: '自動偵測', en: 'English', ja: '日本語', ko: '한국어', yue: '粵語', fr: 'Français', de: 'Deutsch', es: 'Español' };
const PEAKS_PER_SEC = 50;
const MIN_DURATION = 0.1;

const SUMMARY_PROMPT = `你是專業的內容摘要與資料結構化專家。輸入是語音轉文字的逐字稿，每一行開頭的 [時:分:秒] 是該句的起始時間。
請輸出嚴格的 JSON（不要 Markdown 標記、不要解釋文字）：
{
  "summary": ["摘要重點 1", "摘要重點 2", "摘要重點 3"],
  "timeline": [
    { "time_display": "00:00 - 00:25", "start_seconds": 0, "content": "該時間段的詳細內容敘述..." }
  ]
}
規則：
1. summary：3-5 個關鍵重點，字串陣列，語氣精簡扼要。
2. timeline：依內容轉換切成數個時間段，按時間順序排列；時間必須依據逐字稿每行開頭的時間，不可自行編造；content 詳實保留該段資訊量，而非只是標題；start_seconds 必須是整數秒。
3. 一律使用繁體中文。`;

const MERGE_PROMPT = `以下 JSON 陣列是同一份逐字稿各段落的摘要重點。請整合成全篇的 3-5 個關鍵重點，使用繁體中文，只輸出 JSON：{"summary": ["重點 1", "重點 2", "重點 3"]}`;

const FIX_PROMPT = `你是逐字稿校對助手。使用者會提供「常用詞」清單與語音辨識出來的逐字稿。
請找出逐字稿中因為同音、近音或辨識錯誤而寫錯的常用詞（例如常用詞是「三得利」，逐字稿寫成「三德利」或「山得力」）。
規則：
1. 只回報確定是某個常用詞被聽錯的片段，不確定就不要回報。
2. wrong 必須是逐字稿中原封不動出現的文字；right 必須是清單中的常用詞。
3. 不要改寫句子、不要新增內容；沒有錯誤就回傳空陣列。
只輸出 JSON：{"pairs": [{"wrong": "三德利", "right": "三得利"}]}`;

const PROOF_PROMPT = `你是繁體中文字幕校對。輸入是語音辨識出來的逐字稿，每行開頭的 [編號] 是行號；內容已經移除標點並依字幕斷行。
請找出明顯的辨識錯誤：同音或近音的錯字、專有名詞寫錯或前後寫法不一致、明顯不通順的詞。
規則：
1. 只回報有把握的錯誤，寧可少報，不確定就不要回報。
2. 不要加標點、不要改寫語氣、不要調整斷行、不要刪口語贅字、不要把口語改成書面語。
3. wrong 必須是該行裡原封不動出現的文字，盡量短，但要包含完整的詞；right 是修正後的文字，不可以是空的。
4. 使用者提供的「常用詞」是正確寫法，可以當作依據。
只輸出 JSON：{"fixes": [{"line": 3, "wrong": "三德利", "right": "三得利", "reason": "品牌名稱"}]}，沒有錯誤就回傳 {"fixes": []}`;

/* ---------- 小工具 ---------- */
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = name => `<svg class="ic"><use href="#i-${name}"/></svg>`;
const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
const toTW = window.OpenCC ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : s => s;

function srtTime(sec, sep = ',') {
    const ms = Math.max(0, Math.round(sec * 1000));
    return `${pad(ms / 3600000)}:${pad(ms / 60000 % 60)}:${pad(ms / 1000 % 60)}${sep}${pad(ms % 1000, 3)}`;
}

// 列表用的短時間碼（匯出的 SRT 仍是完整格式）
function shortTime(sec) {
    const d = Math.max(0, Math.round(sec * 10));
    return (d >= 36000 ? Math.floor(d / 36000) + ':' : '') + pad(d / 600 % 60) + ':' + pad(d / 10 % 60) + '.' + d % 10;
}
const timeLabel = t => `${shortTime(t.start)} – ${shortTime(t.end)}`;

function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return (sec >= 3600 ? pad(sec / 3600) + ':' : '') + pad(sec / 60 % 60) + ':' + pad(sec % 60);
}

/* ---------- 狀態 ---------- */
const state = {
    file: null, lang: (() => { try { return localStorage.getItem('stt.lang') || 'zh'; } catch { return 'zh'; } })(),   // 記住上次選的語言
    segs: [],            // [{ start, end, text, words? }]，一律整個換新物件，不就地修改（復原才省記憶體）
    sel: -1, playing: -1,
    summary: null, peaks: null, duration: 0,
    undo: [], redo: [],
    markers: [], snap: true,   // 標記點（秒）與磁力吸附開關
    textLang: 'zh',             // 逐字稿實際的語言（選「自動偵測」時由辨識結果決定）
};
let rain = null;
let editing = null;      // 正在改字的那一句：{ i, orig }

const list = $('transcript-text');
const player = $('player');
const titleEl = document.querySelector('.title');
const PAGES = ['upload', 'confirm', 'processing', 'result'];

function show(name) {
    for (const p of PAGES) $(p + '-container').hidden = p !== name;
}

/* ---------- 本機儲存（IndexedDB：上次的專案與音檔） ---------- */
const store = {
    open() {
        return this.db ??= new Promise((res, rej) => {
            const req = indexedDB.open('stt', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    },
    async run(mode, fn) {
        const db = await this.open();
        return new Promise((res, rej) => {
            const req = fn(db.transaction('kv', mode).objectStore('kv'));
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    },
    get: key => store.run('readonly', s => s.get(key)).catch(() => undefined),
    set: (key, val) => store.run('readwrite', s => s.put(val, key)).catch(() => { }),
};

let saveTimer;
function saveProject() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('project', {
        name: $('filename-display').textContent, lang: state.textLang, segs: state.segs, markers: state.markers,
        summary: state.summary, peaks: state.peaks, duration: state.duration,
    }), 400);
}

/* ---------- 專屬詞庫（localStorage） ---------- */
const dict = {
    data: (() => {
        try {
            const d = JSON.parse(localStorage.getItem('stt.dict'));
            return { terms: d.terms || [], rules: d.rules || [] };
        } catch { return { terms: [], rules: [] }; }
    })(),
    save() {
        try { localStorage.setItem('stt.dict', JSON.stringify(this.data)); } catch { }
        renderDict();
    },
    addTerm(term) {
        term = term.trim();
        if (term && !this.data.terms.includes(term)) this.data.terms.push(term);
    },
    addRule(from, to) {
        from = from.trim(); to = to.trim();
        if (!from || !to || from === to) return false;
        this.data.rules = this.data.rules.filter(r => r.from !== from);
        this.data.rules.push({ from, to });
        this.addTerm(to);
        this.save();
        return true;
    },
    // 辨識後套用修正規則（長的先換，避免被短的規則截斷）
    apply(text) {
        for (const r of [...this.data.rules].sort((a, b) => b.from.length - a.from.length)) text = text.split(r.from).join(r.to);
        return text;
    },
    // 給 Whisper 的提示：讓它優先認得常用詞（Whisper 提示長度有限，取前面放得下的）
    prompt(lang) {
        const zh = lang === 'zh', terms = [];
        for (const t of this.data.terms) {
            if (terms.join('、').length + t.length > 160) break;
            terms.push(t);
        }
        return (zh ? '以下是繁體中文的逐字稿。' : '') +
            (terms.length ? (zh ? `常見詞彙：${terms.join('、')}。` : `Glossary: ${terms.join(', ')}.`) : '');
    },
};

function renderDict() {
    const { terms, rules } = dict.data;
    $('dictTerms').innerHTML = terms.map((t, i) => `<span class="chip">${esc(t)}<button data-term="${i}" aria-label="刪除">×</button></span>`).join('');
    $('dictRules').innerHTML = rules.map((r, i) => `<div class="rule"><span class="from">${esc(r.from)}</span><span>→</span><span class="to">${esc(r.to)}</span><button data-rule="${i}" aria-label="刪除">×</button></div>`).join('');
    $('dictSummary').textContent = `${terms.length} 個常用詞、${rules.length} 條修正規則`;
}

/* ---------- API ---------- */
async function api(path, init, tries = 4) {
    for (let i = 0; ; i++) {
        let res;
        try {
            res = await fetch(CONFIG.apiBase + path, {
                ...init,
                headers: { ...(CONFIG.apiKey && { Authorization: `Bearer ${CONFIG.apiKey}` }), ...init.headers },
            });
        } catch {
            if (i >= tries - 1) throw new Error('網路連線失敗，請稍後再試');
            await sleep(2000 * (i + 1));
            continue;
        }
        if (res.ok) return res.json();
        if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
            await sleep(clamp(Number(res.headers.get('retry-after')) || 5 * (i + 1), 1, 60) * 1000);
            continue;
        }
        const detail = await res.text().catch(() => '');
        throw new Error(`伺服器回應 ${res.status}${detail ? '：' + detail.slice(0, 200) : ''}`);
    }
}

async function chat(model, system, user) {
    const data = await api('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model, temperature: 0.2, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
    });
    return JSON.parse(data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
}

function transcribe(blob, lang, prompt) {
    const form = new FormData();
    form.append('file', blob, 'audio.mp3');
    form.append('model', CONFIG.whisperModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');   // 逐字時間戳：拆句時用來算精準的時間
    if (lang !== 'auto') form.append('language', lang);
    if (prompt) form.append('prompt', prompt);
    return api('/audio/transcriptions', { method: 'POST', body: form });
}

/* ---------- 音訊處理 ---------- */
// 直接解碼成 16kHz（Whisper 本來就只用 16kHz 單聲道），比原本用原始取樣率立體聲省數倍記憶體與轉檔時間
async function decodeAudio(file) {
    const buf = await file.arrayBuffer();
    let ctx;
    try { ctx = new OfflineAudioContext(1, 1, 16000); }
    catch { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    let audio;
    try { audio = await ctx.decodeAudioData(buf); }
    catch { throw new Error('無法讀取音訊，請確認檔案格式正確'); }
    ctx.close?.();

    const n = audio.length, chans = [];
    for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (const ch of chans) s += ch[i];
        pcm[i] = clamp(s / chans.length, -1, 1) * 32767;
    }
    return { pcm, rate: audio.sampleRate, duration: audio.duration };
}

function buildPeaks(pcm, rate) {
    const step = Math.round(rate / PEAKS_PER_SEC), n = Math.ceil(pcm.length / step);
    const raw = new Uint16Array(n);
    let max = 1;
    for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * step, end = Math.min(j + step, pcm.length); j < end; j += 4) {
            const v = Math.abs(pcm[j]);
            if (v > m) m = v;
        }
        raw[i] = m;
        if (m > max) max = m;
    }
    return Uint8Array.from(raw, v => v / max * 255);
}

// 分段點挑在附近最安靜的地方，避免把一個字切成兩半
function chunkCuts(pcm, rate) {
    const size = CONFIG.chunkSeconds * rate, win = 10 * rate, frame = Math.round(rate * 0.05);
    const cuts = [0];
    while (pcm.length - cuts.at(-1) > size * 1.25) {
        const target = cuts.at(-1) + size;
        let best = target, quietest = Infinity;
        for (let p = target - win; p < target + win; p += frame) {
            let energy = 0;
            for (let j = p; j < p + frame; j += 8) energy += Math.abs(pcm[j]);
            if (energy < quietest) { quietest = energy; best = p + (frame >> 1); }
        }
        cuts.push(best);
    }
    cuts.push(pcm.length);
    return cuts;
}

let encoder;
function encodeMp3(pcm, rate, onProgress) {
    encoder ??= new Worker(URL.createObjectURL(new Blob([
        "importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');" +
        "onmessage=function(e){var pcm=e.data.pcm,enc=new lamejs.Mp3Encoder(1,e.data.rate,48),out=[],block=1152*40,n=0;" +
        "for(var i=0;i<pcm.length;i+=block){var b=enc.encodeBuffer(pcm.subarray(i,i+block));if(b.length)out.push(b);if(++n%10===0)postMessage({p:i/pcm.length});}" +
        "var end=enc.flush();if(end.length)out.push(end);postMessage({blob:new Blob(out,{type:'audio/mpeg'})});};",
    ], { type: 'application/javascript' })));
    return new Promise((res, rej) => {
        encoder.onmessage = e => e.data.blob ? res(e.data.blob) : onProgress(e.data.p);
        encoder.onerror = () => rej(new Error('轉換 MP3 失敗'));
        encoder.postMessage({ pcm, rate }, [pcm.buffer]);
    });
}

function limiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || !queue.length) return;
        active++;
        const [fn, res, rej] = queue.shift();
        fn().then(res, rej).finally(() => { active--; next(); });
    };
    return fn => new Promise((res, rej) => { queue.push([fn, res, rej]); next(); });
}

function setProgress(percent, message) {
    $('progress').style.width = percent + '%';
    $('progress-percent').textContent = Math.round(percent) + '%';
    if (message) $('progress-text').textContent = message;
}

function assemble(results, cuts, rate, lang) {
    const conv = lang === 'zh' ? toTW : s => s;   // 只有中文才做簡轉繁（原本連日文也會被轉）
    const segs = [];
    results.forEach((r, c) => {
        const offset = cuts[c] / rate, words = r.words || [];
        let w = 0;
        for (const s of r.segments || []) {
            const text = conv(s.text.trim());
            const mine = [];
            while (w < words.length && words[w].start < s.end - 0.001) {
                const x = words[w++];
                mine.push({ word: conv(x.word), start: x.start + offset, end: x.end + offset });
            }
            if (!text) continue;
            for (const piece of resegment({ start: s.start + offset, end: s.end + offset, text, words: mine }, lang)) {
                segs.push({ ...piece, text: dict.apply(piece.text) });
            }
        }
    });
    segs.sort((a, b) => a.start - b.start);
    // 分段交界處可能有幾十毫秒的重疊，收齊讓字幕不互相壓到
    for (let i = 1; i < segs.length; i++) {
        if (segs[i].start < segs[i - 1].end) segs[i - 1].end = Math.max(segs[i].start, segs[i - 1].start + MIN_DURATION);
    }
    return segs;
}

// <斷句規則開始>
/* ---------- 字幕斷句規則（每次轉換都固定照這裡執行） ----------
 * 1. 遇到逗點、句號、問號、驚嘆號、分號、冒號就換行（頓號不換行）。
 * 2. 一行超過字數上限就再切開：不切在詞的中間，盡量切在正中間、停頓處或頓號後面。
 * 3. 最後把標點全部拿掉，行內的標點變成一個空格。
 * 字數以全形字計算，英數字算半個字：中日韓每行 16 字，其他語言每行 42 個英文字元。 */
const isCJK = lang => ['zh', 'yue', 'ja', 'ko'].includes(lang);
const lineLimit = lang => isCJK(lang) ? 16 : 21;
const visualLen = text => { let n = 0; for (const ch of text) n += ch.codePointAt(0) < 0x2e80 ? 0.5 : 1; return n; };

// 中文斷行的偏好：適合當行首的詞（在它前面切）、不該落在行首或行尾的字
const LINE_START = /^(所以|因為|但是|可是|不過|而且|然後|如果|雖然|或者|還是|還有|以及|就是|也就是|其實|只是|甚至|並且|來|去|在|和|跟|與|讓|把|被|對|從|向|給|為了|也|就|都|才|再|又|卻|而|但|或)/;
const LINE_START_BAD = /^[的了嗎呢吧啊呀嘛喔哦著過們地得]/;
const LINE_END_BAD = /(在|和|跟|與|把|被|對|從|向|為了|因為|所以|如果|但是|以及|一個|這個|那個|很|最|更|不|沒|要|會|想|能|可以|應該|正在|已經)$/;

function segmentWords(text, lang) {
    if (!window.Intl?.Segmenter) return text.split(/(\s+)/).filter(Boolean);
    return Array.from(new Intl.Segmenter(lang === 'yue' ? 'zh' : lang, { granularity: 'word' }).segment(text), p => p.segment);
}

// 移除標點；保留數字裡的小數點、千分位、時間冒號（3.5、1,000、12:30）與英文撇號（How's）
function stripPunct(text) {
    return text
        .replace(/(?<!\d)[.,:]|[.,:](?!\d)/g, ' ')
        .replace(/(?<!\p{L})['’]|['’](?!\p{L})/gu, ' ')
        .replace(/[，。、；：？！;?!「」『』（）()《》〈〉【】\[\]{}"“”‘…—–～~·]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function resegment(seg, lang) {
    const cjk = isCJK(lang), max = lineLimit(lang);
    // 有逐字時間戳就用它；對不上時改用斷詞結果，時間按字數比例估
    let units = seg.words || [];
    const timed = units.length && squash(units.map(u => u.word).join('')) === squash(seg.text);
    if (!timed) {
        const span = seg.end - seg.start, total = seg.text.length || 1;
        let pos = 0;
        units = segmentWords(seg.text, lang).map(p => {
            const u = { word: p, start: seg.start + span * pos / total, end: seg.start + span * (pos + p.length) / total };
            pos += p.length;
            return u;
        });
    }
    const textOf = line => line.map(u => u.word).join('');
    const lenOf = line => visualLen(stripPunct(textOf(line)));

    // 1. 遇到標點就換行
    let lines = [], cur = [];
    for (const u of units) {
        cur.push(u);
        const w = u.word.trim();
        const stop = /[。！？!?；;…]$/.test(w) || (cjk ? /[，,：:.]$/.test(w) : /\.$/.test(w) || (/[,:]$/.test(w) && lenOf(cur) >= 10));
        if (stop) { lines.push(cur); cur = []; }
    }
    if (cur.length) lines.push(cur);

    // 2. 太長的再切
    const split = line => {
        const total = lenOf(line);
        if (total <= max || line.length < 2) return [line];
        const whole = textOf(line), boundaries = new Set(), inTerm = new Set();
        let pos = 0;
        for (const p of segmentWords(whole, lang)) { pos += p.length; boundaries.add(pos); }
        // 詞庫裡的詞（常用詞、修正規則的兩邊）不能被切開
        for (const term of [...dict.data.terms, ...dict.data.rules.flatMap(r => [r.from, r.to])]) {
            for (let at = whole.indexOf(term); term && at >= 0; at = whole.indexOf(term, at + 1)) {
                for (let k = at + 1; k < at + term.length; k++) inTerm.add(k);
            }
        }
        let best = -1, bestScore = Infinity, offset = 0, acc = 0;
        for (let k = 1; k < line.length; k++) {
            const prev = line[k - 1];
            offset += prev.word.length;
            acc += visualLen(stripPunct(prev.word));
            if (acc <= 0 || acc >= total) continue;
            const pause = timed ? clamp(line[k].start - prev.end, 0, 0.5) : 0;
            const rest = whole.slice(offset).trimStart();
            const score = Math.abs(acc - total / 2)
                + (boundaries.has(offset) && !inTerm.has(offset) ? 0 : 100)            // 不切在詞中間
                - pause * 4                                                             // 有停頓的地方優先
                - (/[、\s]$/.test(prev.word) || /^\s/.test(line[k].word) ? 3 : 0)       // 頓號、空格後優先
                - (LINE_START.test(rest) ? 3 : 0)                                       // 連接詞、介詞前面是自然的斷點
                + (LINE_START_BAD.test(rest) || LINE_END_BAD.test(whole.slice(0, offset).trimEnd()) ? 6 : 0);
            if (score < bestScore) { bestScore = score; best = k; }
        }
        return best < 0 ? [line] : [...split(line.slice(0, best)), ...split(line.slice(best))];
    };
    lines = lines.flatMap(split);

    // 3. 去標點，組成字幕
    const out = [];
    for (const line of lines) {
        const text = stripPunct(textOf(line));
        if (!text) continue;
        const words = timed ? line.map(u => ({ ...u, word: stripPunct(u.word) })).filter(u => u.word) : [];
        out.push({ start: line[0].start, end: line.at(-1).end, text, words });
    }
    if (out.length) {
        out[0].start = seg.start;
        out.at(-1).end = seg.end;
    }
    return out;
}

// <斷句規則結束>

// 請模型只回報「哪個片段是哪個常用詞被聽錯」，再由程式替換；模型不能改寫逐字稿
async function fixHomophones(segs) {
    const terms = dict.data.terms;
    const text = segs.map(s => s.text).join('\n');
    const pairs = [];
    for (let i = 0; i < text.length; i += 8000) {
        try {
            const r = await chat(CONFIG.correctionModel, FIX_PROMPT, `常用詞：${terms.join('、')}\n\n逐字稿：\n${text.slice(i, i + 8000)}`);
            if (Array.isArray(r.pairs)) pairs.push(...r.pairs);
        } catch (e) { console.warn('詞庫校對略過：', e); }
    }
    const valid = pairs.filter(p => p && typeof p.wrong === 'string' && terms.includes(p.right) &&
        p.wrong.length >= 2 && p.wrong !== p.right && !terms.includes(p.wrong) && !p.right.includes(p.wrong) &&
        Math.abs(p.wrong.length - p.right.length) <= Math.max(2, p.right.length / 2) && text.includes(p.wrong));
    if (!valid.length) return segs;
    return segs.map(s => {
        let t = s.text;
        for (const p of valid) t = t.split(p.wrong).join(p.right);
        return t === s.text ? s : { ...s, text: t };
    });
}

async function processFile() {
    const file = state.file;
    show('processing');
    setProgress(3, '正在讀取音訊...');
    await sleep(30);
    try {
        const { pcm, rate, duration } = await decodeAudio(file);
        setProgress(15, '正在轉換音訊...');
        state.peaks = buildPeaks(pcm, rate);
        state.duration = duration;

        const cuts = chunkCuts(pcm, rate), n = cuts.length - 1;
        const prompt = dict.prompt(state.lang), limit = limiter(CONFIG.concurrency);
        const encoded = new Array(n).fill(0);
        let done = 0;
        const tick = () => setProgress(
            15 + 80 * (encoded.reduce((a, b) => a + b, 0) * 0.25 + done * 0.75) / n,
            n > 1 ? `正在轉錄（已完成 ${done}/${n} 段）...` : '正在轉錄...');

        const jobs = [];
        for (let i = 0; i < n; i++) {
            const mp3 = await encodeMp3(pcm.slice(cuts[i], cuts[i + 1]), rate, p => { encoded[i] = p; tick(); });
            encoded[i] = 1;
            tick();
            const job = limit(() => transcribe(mp3, state.lang, prompt)).then(r => { done++; tick(); return r; });
            job.catch(() => { });
            jobs.push(job);
        }
        const results = await Promise.all(jobs);
        let textLang = state.lang;
        if (textLang === 'auto') {
            const found = String(results[0]?.language || '').toLowerCase();
            textLang = /chinese|mandarin|^zh/.test(found) ? 'zh' : /cantonese|^yue/.test(found) ? 'yue'
                : /japanese|^ja/.test(found) ? 'ja' : /korean|^ko/.test(found) ? 'ko' : 'en';
        }
        let segs = assemble(results, cuts, rate, textLang);
        if (!segs.length) throw new Error('沒有辨識到任何語音');
        segs = alignToSound(segs);

        if (dict.data.terms.length) {
            setProgress(96, '正在套用專屬詞庫...');
            segs = await fixHomophones(segs);
        }

        Object.assign(state, { segs, textLang, sel: -1, playing: -1, summary: null, undo: [], redo: [], markers: [] });
        $('filename-display').textContent = file.name.replace(/\.[^/.]+$/, '');
        setProgress(100, '處理完成！');
        store.set('file', file);
        saveProject();
        await enterResult();
    } catch (error) {
        console.error('處理文件時出錯:', error);
        alert('處理文件時出錯：' + error.message);
        show('confirm');
    }
}

// 進結果頁：目前畫面淡出 → 矩陣雨蓋到最上層 → 底下換成結果頁 → 雨落下處揭開
async function enterResult() {
    if (player.src) URL.revokeObjectURL(player.src);
    if (state.file) player.src = URL.createObjectURL(state.file); else player.removeAttribute('src');
    wave.pps = 0;
    renderList();
    renderSummary();
    setSummaryOpen(!!state.summary);   // 生成過摘要的專案才預設展開

    const current = PAGES.map(p => $(p + '-container')).find(el => !el.hidden);
    if (rain) {
        current.classList.add('leaving');
        await sleep(400);
        rain.cover();
        current.classList.remove('leaving');
    }
    show('result');
    layoutWave();
    updateTime();
    if (rain) {
        rain.reveal();
        rain = null;
    }
}

/* ---------- 上傳與確認頁 ---------- */
function pickFile(file) {
    if (!file) return;
    if (file.size > CONFIG.maxFileSize) return alert('文件大小不能超過 500MB');
    const name = file.name.toLowerCase();
    if (!/^(audio|video)\//.test(file.type) && !FILE_EXTENSIONS.some(ext => name.endsWith(ext))) {
        return alert('不支援的檔案格式。\n支援的格式：MP4, MOV, WebM, MKV, MP3, WAV, OGG, AAC, M4A, FLAC, WMA');
    }
    state.file = file;
    $('selected-filename').lastElementChild.textContent = file.name;
    show('confirm');
}

async function refreshResume() {
    const p = await store.get('project');
    const btn = $('resumeBtn');
    btn.hidden = !p?.segs?.length;
    if (!btn.hidden) btn.textContent = `繼續上次：${p.name}`;
}

function initUpload() {
    const drop = $('drop-area'), input = $('fileInput');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('highlight'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('highlight'));
    drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('highlight');
        pickFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { pickFile(input.files[0]); input.value = ''; });

    $('resumeBtn').addEventListener('click', async e => {
        e.stopPropagation();
        const [p, file] = await Promise.all([store.get('project'), store.get('file')]);
        if (!p) return;
        Object.assign(state, {
            file: file || null, textLang: p.lang || 'zh', markers: p.markers || [], segs: p.segs, sel: -1, playing: -1,
            summary: p.summary || null, peaks: p.peaks || null, duration: p.duration || p.segs.at(-1).end, undo: [], redo: [],
        });
        $('filename-display').textContent = p.name;
        await enterResult();
        if (!file) toast('找不到上次的音檔，只能編輯文字', 4000);
    });

    // 語言選單：Whisper 支援的語言，名稱用瀏覽器內建的語言名
    const names = window.Intl?.DisplayNames ? new Intl.DisplayNames(['zh-Hant'], { type: 'language' }) : null;
    $('langSelect').querySelector('.select-content').innerHTML = LANGUAGES.map(code => {
        let label = LANGUAGE_LABELS[code];
        if (!label) { try { label = names?.of(code); } catch { } }
        return `<div class="select-item" data-value="${code}" role="option" aria-selected="${code === state.lang}">${esc(label || code)}</div>`;
    }).join('');
    const root = $('langSelect'), trigger = root.querySelector('.select-trigger'), menu = root.querySelector('.select-content');
    const setOpen = open => { menu.hidden = !open; trigger.setAttribute('aria-expanded', open); };
    root.querySelector('.select-value').textContent = menu.querySelector('[aria-selected="true"]')?.textContent || '繁體中文';
    trigger.addEventListener('click', e => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener('click', e => {
        const item = e.target.closest('.select-item');
        if (!item) return;
        state.lang = item.dataset.value;
        try { localStorage.setItem('stt.lang', state.lang); } catch { }
        for (const el of menu.children) el.setAttribute('aria-selected', el === item);
        root.querySelector('.select-value').textContent = item.textContent;
    });
    document.addEventListener('click', () => setOpen(false));

    $('startConversionBtn').addEventListener('click', () => state.file && processFile());
    $('backToUploadBtn').addEventListener('click', () => { state.file = null; show('upload'); });
}

/* ---------- 逐字稿列表 ---------- */
// 行尾的字數；超過每行上限就變色提醒
function countHTML(text) {
    const n = visualLen(text), over = n > lineLimit(state.textLang);
    return `<span class="count${over ? ' over' : ''}" title="${over ? '超過每行字數上限' : '這一行的字數'}">${Math.ceil(n)}</span>`;
}

function rowHTML(s, i) {
    return `<div class="row" data-i="${i}">` +
        `<button class="time" tabindex="-1" title="跳到這一句">${timeLabel(s)}</button>` +
        `<div class="txt" contenteditable="plaintext-only" spellcheck="false">${esc(s.text)}</div>` +
        countHTML(s.text) +
        `<button class="del" tabindex="-1" title="刪除">${icon('close')}</button>` +
        `<button class="merge" tabindex="-1" title="與下一句合併">${icon('merge')}</button>` +
        `<div class="gap"><button class="add" tabindex="-1" title="新增一句">${icon('plus')}</button></div></div>`;
}

const rowEl = i => list.children[i];
const txtEl = i => rowEl(i)?.querySelector('.txt');
const decorated = new Set();   // 目前顯示拆點的那些列

function renderList(focus) {
    editing = null;
    decorated.clear();
    list.innerHTML = state.segs.map(rowHTML).join('');
    markRows();
    drawWave();
    if (focus) focusRow(...focus);
    refreshDots();
}

function markRows() {
    for (const cls of ['selected', 'playing']) {
        list.querySelector('.row.' + cls)?.classList.remove(cls);
        rowEl(cls === 'selected' ? state.sel : state.playing)?.classList.add(cls);
    }
}

function select(i, scroll = false) {
    state.sel = clamp(i, -1, state.segs.length - 1);
    markRows();
    drawWave();
    if (scroll) rowEl(state.sel)?.scrollIntoView({ block: 'nearest' });
}

function caretOffset(el) {
    const sel = getSelection();
    if (!sel.rangeCount) return 0;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return range.toString().length;
}

function focusRow(i, offset) {
    const el = txtEl(i);
    if (!el) return;
    el.focus();
    const node = el.firstChild, range = document.createRange();
    if (node) range.setStart(node, clamp(offset ?? node.length, 0, node.length)); else range.setStart(el, 0);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.scrollIntoView({ block: 'nearest' });
}

/* ---------- 編輯動作（全部可復原） ---------- */
function commit(segs, { render = true, focus } = {}) {
    state.undo.push(state.segs);
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
    state.segs = segs;
    state.sel = Math.min(state.sel, segs.length - 1);
    if (render) renderList(focus); else drawWave();
    saveProject();
}

function timeTravel(from, to, emptyMessage) {
    if (!from.length) return toast(emptyMessage, 1500);
    to.push(state.segs);
    state.segs = from.pop();
    state.sel = Math.min(state.sel, state.segs.length - 1);
    renderList();
    saveProject();
}
const undo = () => timeTravel(state.undo, state.redo, '沒有可以復原的動作');
const redo = () => timeTravel(state.redo, state.undo, '沒有可以重做的動作');

const joinText = (a, b) => a + (/[A-Za-z0-9,.!?]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? ' ' : '') + b;
const squash = s => s.replace(/\s+/g, '');

// 拆句的時間：文字跟逐字時間戳對得上就用精準時間，對不上（改過字）才用字數比例估
function splitTime(seg, offset) {
    const words = seg.words || [];
    let t = seg.start + (seg.end - seg.start) * offset / seg.text.length;
    if (words.length && squash(words.map(w => w.word).join('')) === squash(seg.text)) {
        const target = squash(seg.text.slice(0, offset)).length;
        let acc = 0;
        for (let k = 0; k < words.length; k++) {
            const len = squash(words[k].word).length;
            if (acc + len > target) {
                const w = words[k];
                t = acc === target
                    ? (k ? (words[k - 1].end + w.start) / 2 : w.start)
                    : w.start + (w.end - w.start) * (target - acc) / len;
                break;
            }
            acc += len;
        }
    }
    return clamp(t, seg.start + 0.05, seg.end - 0.05);
}

function splitSeg(i, offset, text = state.segs[i].text, at) {
    const seg = { ...state.segs[i], text };
    const a = text.slice(0, offset).trim(), b = text.slice(offset).trim();
    if (!a || !b) return;
    const t = at ?? splitTime(seg, text.length - text.slice(offset).trimStart().length);
    const words = seg.words || [], mid = w => (w.start + w.end) / 2;
    const segs = state.segs.slice();
    segs.splice(i, 1,
        { start: seg.start, end: t, text: a, words: words.filter(w => mid(w) < t) },
        { start: t, end: seg.end, text: b, words: words.filter(w => mid(w) >= t) });
    state.sel = i + 1;
    commit(segs, { focus: at != null || document.body.classList.contains('alt') ? null : [i + 1, 0] });
}

// B：把選取的句子（沒選就用正在播的那句）在播放位置切成兩句，文字依逐字時間戳分配
function splitAtPlayhead() {
    const t = player.currentTime;
    const inside = s => s && t > s.start + MIN_DURATION && t < s.end - MIN_DURATION;
    const i = inside(state.segs[state.sel]) ? state.sel : state.segs.findIndex(inside);
    const seg = state.segs[i];
    if (!seg) return toast('播放位置不在任何一句裡面', 1800);
    const words = seg.words || [];
    const chars = words.length && squash(words.map(w => w.word).join('')) === squash(seg.text)
        ? words.filter(w => (w.start + w.end) / 2 < t).reduce((n, w) => n + squash(w.word).length, 0)
        : Math.round(squash(seg.text).length * (t - seg.start) / (seg.end - seg.start));
    let offset = 0;
    for (let n = 0; offset < seg.text.length && n < chars; offset++) if (!/\s/.test(seg.text[offset])) n++;
    if (!seg.text.slice(0, offset).trim() || !seg.text.slice(offset).trim()) return toast('這個位置切下去會有一邊沒有字', 1800);
    splitSeg(i, offset, seg.text, t);
}

function mergeSeg(i, secondText) {
    const a = state.segs[i], b = state.segs[i + 1];
    if (!a || !b) return;
    const segs = state.segs.slice();
    segs.splice(i, 2, {
        start: a.start, end: Math.max(a.end, b.end),
        text: joinText(a.text, secondText ?? b.text), words: [...(a.words || []), ...(b.words || [])],
    });
    state.sel = i;
    const alt = document.body.classList.contains('alt');
    commit(segs, { focus: alt ? null : [i, a.text.length] });
}

function removeSeg(i) {
    if (!state.segs[i]) return;
    commit(state.segs.filter((_, k) => k !== i));
}

function addSeg(i) {
    const cur = state.segs[i], next = state.segs[i + 1];
    const segs = state.segs.slice();
    let start = cur.end, end = next ? next.start : cur.end + 3;
    if (end - start < 0.3) {
        // 兩句之間沒有空隙：把目前這句的時間分一半給新的一句
        start = (cur.start + cur.end) / 2;
        end = cur.end;
        segs[i] = { ...cur, end: start };
    }
    segs.splice(i + 1, 0, { start, end, text: '', words: [] });
    state.sel = i + 1;
    commit(segs, { focus: [i + 1, 0] });
}

function setEdge(edge) {
    const i = state.sel, s = state.segs[i];
    if (!s) return;
    const t = player.currentTime;
    const prev = state.segs[i - 1]?.end ?? 0, next = state.segs[i + 1]?.start ?? state.duration;
    const segs = state.segs.slice();
    segs[i] = edge === 'start'
        ? { ...s, start: clamp(t, Math.min(prev, s.start), s.end - MIN_DURATION) }
        : { ...s, end: clamp(t, s.start + MIN_DURATION, Math.max(next, s.end)) };
    commit(segs);
}

function replaceAll(from, to) {
    let count = 0;
    const segs = state.segs.map(s => {
        if (!s.text.includes(from)) return s;
        count++;
        return { ...s, text: s.text.split(from).join(to) };
    });
    if (count) commit(segs);
    return count;
}

function commitEdit(el) {
    const { i, orig } = editing;
    editing = null;
    const text = el.textContent.replace(/\s*\n\s*/g, ' ').trim();
    if (text === orig) { el.textContent = orig; return; }
    if (!text) return removeSeg(i);
    el.textContent = text;
    el.parentNode.querySelector('.count').outerHTML = countHTML(text);
    const segs = state.segs.slice();
    segs[i] = { ...segs[i], text };
    commit(segs, { render: false });
    suggestRule(diffRule(orig, text));
}

/* ---------- Option(Alt) 拆點 ---------- */
// 拆點畫在文字上方（不塞進文字裡，按住 Option 時文字不會被撐開）
function decorate(row) {
    if (!row?.isConnected || decorated.has(row)) return;
    const el = row.querySelector('.txt'), node = el.firstChild;
    if (!node || el === document.activeElement) return;
    const base = row.getBoundingClientRect(), range = document.createRange();
    let html = '', offset = 0;
    for (const piece of segmentWords(node.data, state.textLang)) {
        if (offset && /[\p{L}\p{N}]/u.test(piece)) {
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const r = range.getClientRects()[0];
            if (r) html += `<i class="sp" data-o="${offset}" title="在這裡拆開" style="left:${r.left - base.left}px;top:${r.top - base.top}px;height:${r.height}px"></i>`;
        }
        offset += piece.length;
    }
    row.insertAdjacentHTML('beforeend', `<div class="dots">${html}</div>`);
    decorated.add(row);
}

// 只處理畫面上看得到的那幾列
function refreshDots() {
    if (!document.body.classList.contains('alt')) return;
    const rows = list.children, top = list.scrollTop, bottom = top + list.clientHeight;
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].offsetTop + rows[mid].offsetHeight < top) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < rows.length && rows[i].offsetTop < bottom; i++) decorate(rows[i]);
}

function setAlt(on) {
    if (document.body.classList.contains('alt') === on) return;
    document.body.classList.toggle('alt', on);
    updateWaveCursor(on);
    if (on) return refreshDots();
    for (const el of list.querySelectorAll('.dots')) el.remove();
    decorated.clear();
}

function initList() {
    list.addEventListener('mouseover', e => setAlt(e.altKey));
    list.addEventListener('scroll', refreshDots, { passive: true });
    list.addEventListener('mousedown', e => {
        if (document.body.classList.contains('alt') && e.target.closest('.txt')) e.preventDefault();
    });
    list.addEventListener('click', e => {
        const row = e.target.closest('.row');
        if (!row) return;
        const i = +row.dataset.i, hit = sel => e.target.closest(sel);
        if (hit('.sp')) return splitSeg(i, +hit('.sp').dataset.o);
        if (hit('.del')) return removeSeg(i);
        if (hit('.add')) return addSeg(i);
        if (hit('.merge')) return mergeSeg(i);
        if (hit('.time')) { select(i); seek(state.segs[i].start); }
        else if (!hit('.txt')) select(i);
    });
    list.addEventListener('focusin', e => {
        const el = e.target.closest('.txt');
        if (!el) return;
        const row = el.parentNode, i = +row.dataset.i;
        row.querySelector('.dots')?.remove();
        decorated.delete(row);
        editing = { i, orig: state.segs[i].text };
        select(i);
    });
    list.addEventListener('focusout', e => {
        if (editing && e.target.closest('.txt')) commitEdit(e.target);
    });
    list.addEventListener('paste', e => {   // 只貼純文字
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
    });
    // 改字時的按鍵：Enter 只結束改字。拆句與合併一律用 Option 的拆點與合併鈕（或 B 鍵）
    list.addEventListener('keydown', e => {
        const el = e.target.closest('.txt');
        if (!el || !editing || e.isComposing || e.keyCode === 229) return;   // 輸入法選字中不處理
        const i = editing.i;
        if (e.key === 'Enter') {
            e.preventDefault();
            el.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            el.textContent = editing.orig;
            el.blur();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const j = i + (e.shiftKey ? -1 : 1);
            el.blur();
            if (state.segs[j]) focusRow(Math.min(j, state.segs.length - 1));
        } else if (e.key === ' ' && e.shiftKey) {
            e.preventDefault();
            togglePlay();
        }
    });
}

/* ---------- 詞庫學習：改過字就在下方問要不要記住 ---------- */
// 比對改字前後，取出「錯字 → 正確字」。只改一個字時往左右各多帶一個字，避免規則太短誤傷
function diffRule(a, b) {
    let p = 0, s = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    let l = p, r = a.length - s, shift = b.length - a.length;
    if (r === l || r + shift === l) return null;   // 純新增或純刪除，不是修正
    const latin = c => /[A-Za-z0-9']/.test(c || ''), word = c => /[\p{L}\p{N}]/u.test(c || '');
    if (latin(a[l]) || latin(a[r - 1]) || latin(b[l])) {
        while (latin(a[l - 1])) l--;
        while (latin(a[r])) r++;
    } else if (r - l < 2 || r + shift - l < 2) {
        if (word(a[l - 1])) l--;
        if (word(a[r])) r++;
    }
    const from = a.slice(l, r), to = b.slice(l, r + shift);
    if (from.length > 20 || to.length > 20 || !word(from.match(/[\p{L}\p{N}]/u)?.[0]) || !/[\p{L}\p{N}]/u.test(to)) return null;
    return { from, to };
}

let toastTimer;
function toast(html, ms = 3000) {
    const el = $('toast');
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function suggestRule(rule) {
    if (!rule || dict.data.rules.some(r => r.from === rule.from && r.to === rule.to)) return;
    const others = state.segs.filter(s => s.text.includes(rule.from)).length;
    toast(`<span>加入詞庫？</span>` +
        `<input class="f" value="${esc(rule.from)}" aria-label="錯字"><span>→</span>` +
        `<input class="t" value="${esc(rule.to)}" aria-label="正確字">` +
        `<button class="main" data-act="add">加入</button>` +
        (others ? `<button data-act="all">加入並替換其餘 ${others} 處</button>` : '') +
        `<button class="x" data-act="skip" aria-label="略過">×</button>`, 12000);
}

function initToast() {
    const el = $('toast');
    el.addEventListener('focusin', () => clearTimeout(toastTimer));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('[data-act="add"]')?.click(); });
    el.addEventListener('click', e => {
        const act = e.target.dataset.act;
        if (!act) return;
        if (act === 'skip') { el.hidden = true; return; }
        const from = el.querySelector('.f').value, to = el.querySelector('.t').value;
        if (!dict.addRule(from, to)) return;
        const n = act === 'all' ? replaceAll(from.trim(), to.trim()) : 0;
        toast(`已加入詞庫：${esc(from)} → ${esc(to)}${n ? `，並替換了 ${n} 句` : ''}`, 2500);
    });
}

/* ---------- 播放 ---------- */
function seek(t) {
    player.currentTime = clamp(t, 0, state.duration);
    updateTime(t);
}

function togglePlay() {
    if (!player.src) return toast('沒有音檔可以播放', 2000);
    if (player.paused) player.play().catch(() => { }); else player.pause();
}

function updateTime(t = player.currentTime) {
    $('timeLabel').textContent = `${clock(t)} / ${clock(state.duration)}`;
    const i = state.segs.findIndex(s => t >= s.start && t < s.end);
    if (i !== state.playing) {
        state.playing = i;
        markRows();
        if (i >= 0 && !player.paused && !editing) rowEl(i).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // 播放位置跑出畫面就把波形捲過去
    const x = (t - wave.off) * wave.pps;
    if (!wave.drag && wave.w && (x < 0 || x > wave.w - 20)) {
        wave.off = t - 40 / wave.pps;
        clampOff();
    }
    wave.time = t;
    drawWave();
}

function initPlayer() {
    const loop = () => { updateTime(); if (!player.paused) requestAnimationFrame(loop); };
    player.addEventListener('play', () => { $('playBtn').innerHTML = icon('pause'); loop(); });
    player.addEventListener('pause', () => { $('playBtn').innerHTML = icon('play'); });
    player.addEventListener('seeked', () => updateTime());
    $('playBtn').addEventListener('click', togglePlay);
    $('speedSelect').addEventListener('change', e => { player.playbackRate = +e.target.value; });
}

/* ---------- 波形區 ---------- */
const RULER = 18;
const wave = { el: $('wave'), ctx: $('wave').getContext('2d'), w: 0, h: 0, pps: 0, off: 0, time: 0, hover: -1, hoverY: 0, drag: null, draft: null, draftNew: null, shift: null };

const fitPps = () => wave.w / Math.max(state.duration, 1);
function clampOff() { wave.off = clamp(wave.off, 0, Math.max(0, state.duration - wave.w / wave.pps)); }

function layoutWave() {
    const rect = wave.el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!rect.width) return;
    wave.w = rect.width;
    wave.h = rect.height;
    wave.el.width = rect.width * dpr;
    wave.el.height = rect.height * dpr;
    wave.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!wave.pps) { wave.pps = Math.max(fitPps(), 60); wave.off = 0; }
    wave.pps = Math.max(wave.pps, fitPps());
    clampOff();
    drawWave();
}

function zoomWave(pps, anchorX = wave.w / 2) {
    const t = wave.off + anchorX / wave.pps;
    wave.pps = clamp(pps, fitPps(), 400);
    wave.off = t - anchorX / wave.pps;
    clampOff();
    drawWave();
}

// 拖曳中的句子先用草稿的時間畫；連動推移時，from 之後的句子全部平移 dt
function segTimes(i) {
    const s = wave.draft?.[i] ?? state.segs[i], sh = wave.shift;
    return sh && i >= sh.from && !wave.draft?.[i] ? { start: s.start + sh.dt, end: s.end + sh.dt } : s;
}

function drawBars(from, to, color) {
    const { ctx, h, pps, off } = wave, peaks = state.peaks;
    const body = h - RULER, mid = RULER + body / 2, amp = body / 2 - 6;
    ctx.fillStyle = color;
    if (!peaks) return ctx.fillRect(from, mid, to - from, 1);
    for (let x = Math.max(0, Math.floor(from)); x < Math.min(wave.w, to); x++) {
        const a = Math.floor((off + x / pps) * PEAKS_PER_SEC);
        const b = Math.max(a + 1, Math.floor((off + (x + 1) / pps) * PEAKS_PER_SEC));
        let m = 0;
        for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > m) m = peaks[k];
        const y = Math.max(0.5, m / 255 * amp);
        ctx.fillRect(x, mid - y, 1, y * 2);
    }
}

function roundBox(x, y, w, h, r = 6) {
    const { ctx } = wave;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2)); else ctx.rect(x, y, w, h);
}

function drawWave() {
    const { ctx, w, h, pps, off } = wave;
    if (!w || $('result-container').hidden) return;
    ctx.clearRect(0, 0, w, h);
    const top = RULER + 2, body = h - top - 3;

    // 刻度尺
    const step = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800].find(s => s * pps >= 70) || 3600;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#999';
    for (let t = Math.ceil(off / step) * step; t < off + w / pps; t += step) {
        const x = (t - off) * pps;
        ctx.fillRect(x, 0, 1, 6);
        ctx.fillText(clock(t) + (step < 1 ? '.' + Math.round(t % 1 * 10) : ''), x + 3, 3);
    }

    // 每一句一個圓角框（框與框之間留 2px 的縫）
    const boxes = [];
    for (let i = 0; i < state.segs.length; i++) {
        const s = segTimes(i), x1 = (s.start - off) * pps + 1, x2 = (s.end - off) * pps - 1;
        if (x2 < 0 || x1 > w) continue;
        const selected = i === state.sel;
        boxes.push({ i, x1, bw: Math.max(x2 - x1, 2), selected });
        roundBox(x1, top, Math.max(x2 - x1, 2), body);
        ctx.fillStyle = selected ? '#e4e4e4' : i === state.playing ? '#efefef' : '#f6f6f6';
        ctx.fill();
    }

    // 波形：播過的深色、還沒播的淺色
    const px = (wave.time - off) * pps;
    drawBars(0, px, '#3a3a3a');
    drawBars(Math.max(px, 0), w, '#bcbcbc');

    // 外框、把手、左上角的文字標籤
    ctx.font = '11px sans-serif';
    for (const { i, x1, bw, selected } of boxes) {
        roundBox(x1 + 0.5, top + 0.5, bw - 1, body - 1);
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeStyle = selected ? '#111' : 'rgba(0, 0, 0, 0.22)';
        ctx.stroke();
        if (selected && bw > 24) {
            ctx.fillStyle = '#111';
            for (const hx of [x1 + 5, x1 + bw - 8]) { roundBox(hx, top + body / 2 - 12, 3, 24, 1.5); ctx.fill(); }
        }
        if (bw < 30) continue;
        const text = state.segs[i].text, pad = 5, lx = Math.max(x1, 0) + (selected ? 12 : 6);
        const room = x1 + bw - lx - 6;
        if (room < 16) continue;
        const lw = Math.min(ctx.measureText(text).width + pad * 2, room);
        ctx.save();
        roundBox(lx, top + 5, lw, 17, 3);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, lx + pad, top + 8);
        ctx.restore();
    }
    ctx.lineWidth = 1;

    // 正在拉出的新字幕
    if (wave.draftNew) {
        const x1 = (wave.draftNew.start - off) * pps, x2 = (wave.draftNew.end - off) * pps;
        roundBox(x1 + 0.5, top + 0.5, Math.max(x2 - x1 - 1, 1), body - 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 標記點
    for (const m of state.markers) {
        const x = (m - off) * pps;
        if (x < -6 || x > w + 6) continue;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(x - 1.5, RULER, 3, h - RULER);
        ctx.fillStyle = '#000';
        for (let y = RULER; y < h; y += 6) ctx.fillRect(x - 0.5, y, 1, 3);
        ctx.beginPath();
        ctx.moveTo(x, 5); ctx.lineTo(x + 5, 10); ctx.lineTo(x, 15); ctx.lineTo(x - 5, 10);
        ctx.fill();
    }

    // 滑鼠位置（灰）與播放位置（黑）
    if (wave.hover >= 0) {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.7)';
        ctx.fillRect(wave.hover, 0, 1, h);
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(px - 0.75, 0, 1.5, h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7);
    ctx.fill();
}

// 滑鼠在哪一句的頭、尾或中間
function hitWave(x, y) {
    if (y < RULER) return null;
    let found = null;
    for (let i = 0; i < state.segs.length; i++) {
        const s = state.segs[i], x1 = (s.start - wave.off) * wave.pps, x2 = (s.end - wave.off) * wave.pps;
        if (x < x1 - 5 || x > x2 + 5) continue;
        const mode = x2 - x1 < 14 ? 'move' : Math.abs(x - x1) <= 5 ? 'start' : Math.abs(x - x2) <= 5 ? 'end' : (x >= x1 && x <= x2 ? 'move' : null);
        if (!mode) continue;
        if (i === state.sel) return { i, mode };   // 兩句相鄰時優先抓已選取的那句
        found ??= { i, mode };
    }
    return found;
}

// 磁力：靠近播放位置、標記點或旁邊句子時自動貼齊；按住 Cmd(Ctrl) 拖曳時暫時關掉
function snapTime(t, extra, disabled) {
    if (!state.snap || disabled) return t;
    let best = t, gap = 8 / wave.pps;
    for (const c of [wave.time, ...state.markers, ...extra]) {
        if (Math.abs(c - t) < gap) { gap = Math.abs(c - t); best = c; }
    }
    return best;
}

function toggleMarker() {
    const t = player.currentTime, k = state.markers.findIndex(m => Math.abs(m - t) <= 6 / wave.pps);
    if (k >= 0) state.markers.splice(k, 1); else state.markers.push(t);
    drawWave();
    saveProject();
}

function toggleSnap() {
    state.snap = !state.snap;
    $('snapBtn').classList.toggle('active', state.snap);
    toast(`磁力吸附：${state.snap ? '開' : '關'}`, 1200);
}

// 像 Premiere 的滾動編輯游標：兩條直線加左右箭頭
const ROLL_CURSOR = (() => {
    const path = 'M12 3v18M16 3v18M9 12H2m3-3-3 3 3 3M19 12h7m-3-3 3 3-3 3';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="${path}" stroke="#fff" stroke-width="4.5"/><path d="${path}" stroke="#e5202e" stroke-width="2"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 12, ew-resize`;
})();

// 滑鼠所在的邊緣如果剛好是兩句相貼的交界，回傳 [前句, 後句]
function touchingPair(hit) {
    if (!hit || hit.mode === 'move') return null;
    const a = hit.mode === 'start' ? hit.i - 1 : hit.i, b = a + 1;
    return state.segs[a] && state.segs[b] && Math.abs(state.segs[b].start - state.segs[a].end) < 0.05 ? [a, b] : null;
}

function updateWaveCursor(alt) {
    if (wave.drag || wave.hover < 0) return;
    const hit = hitWave(wave.hover, wave.hoverY);
    wave.el.style.cursor = !hit ? (wave.hoverY < RULER ? 'default' : 'crosshair')
        : hit.mode === 'move' ? 'grab' : alt && touchingPair(hit) ? ROLL_CURSOR : 'ew-resize';
}

// 自動貼齊聲音：用波形找出每句實際有聲音的範圍，把頭尾多出來的靜音收掉
// （Whisper 會把講話前的停頓算進下一句，字幕才會在還沒開口時就出現）
function alignToSound(segs) {
    const peaks = state.peaks;
    if (!peaks?.length) return segs;
    const sorted = Array.from(peaks).sort((a, b) => a - b);
    const loud = Math.max(sorted[Math.floor(sorted.length * 0.15)] * 2 + 4, 10);   // 比底噪明顯大聲才算有聲音
    return segs.map(s => {
        const a = Math.floor(s.start * PEAKS_PER_SEC), b = Math.min(peaks.length, Math.ceil(s.end * PEAKS_PER_SEC));
        let first = a, last = b - 1;
        while (first < b - 1 && !(peaks[first] >= loud && peaks[first + 1] >= loud)) first++;   // 連續兩格才算，避免雜音
        while (last > first && !(peaks[last] >= loud && peaks[last - 1] >= loud)) last--;
        if (first >= last) return s;
        const voiceStart = first / PEAKS_PER_SEC, voiceEnd = (last + 1) / PEAKS_PER_SEC;
        const start = voiceStart - s.start > 0.15 ? voiceStart - 0.08 : s.start;   // 開頭留 0.08 秒
        const end = s.end - voiceEnd > 0.3 ? voiceEnd + 0.2 : s.end;                // 結尾留 0.2 秒，讓人來得及讀完
        return (start === s.start && end === s.end) || end - start < 0.3 ? s : { ...s, start, end };
    });
}

function initWave() {
    const el = wave.el;
    const showTimes = i => { rowEl(i).querySelector('.time').textContent = timeLabel(segTimes(i)); };
    const gap = k => Math.max(0, state.segs[k + 1].start - state.segs[k].end);
    el.addEventListener('mousemove', e => {
        if (wave.drag) return;
        wave.hover = e.offsetX;
        wave.hoverY = e.offsetY;
        updateWaveCursor(e.altKey);
        drawWave();
    });
    el.addEventListener('mouseleave', () => { wave.hover = -1; drawWave(); });
    el.addEventListener('mousedown', e => {
        e.preventDefault();
        document.activeElement?.blur?.();
        const segs = state.segs, n = segs.length;
        const hit = hitWave(e.offsetX, e.offsetY), t = wave.off + e.offsetX / wave.pps;
        const pair = e.altKey && touchingPair(hit);
        const base = { x0: e.clientX, t, moved: false };
        if (pair) {
            // 按住 Option 拖兩句的交界：前句的尾和後句的頭一起動；壓到最短後繼續拖，就推著旁邊的句子走
            const [a, b] = pair;
            let roomAfter = Math.max(0, state.duration - segs[n - 1].end), roomBefore = segs[0].start;
            for (let k = b; k < n - 1; k++) roomAfter += gap(k);
            for (let k = 0; k < a; k++) roomBefore += gap(k);
            const lo = segs[a].start + MIN_DURATION, hi = segs[b].end - MIN_DURATION;
            wave.drag = { ...base, mode: 'roll', a, b, t0: segs[b].start, lo, hi, min: lo - roomBefore, max: hi + roomAfter };
        } else if (hit && e.shiftKey) {
            // 按住 Shift 拖：這句之後的所有字幕一起平移（拖結尾＝只改這句的結尾，後面跟著移）
            const s = segs[hit.i], trimEnd = hit.mode === 'end';
            select(hit.i, true);
            wave.drag = {
                ...base, mode: 'ripple', i: hit.i, trimEnd, from: trimEnd ? hit.i + 1 : hit.i, anchor: trimEnd ? s.end : s.start,
                lo: trimEnd ? MIN_DURATION - (s.end - s.start) : Math.min((segs[hit.i - 1]?.end ?? 0) - s.start, 0),
                hi: Math.max(state.duration - segs[n - 1].start - MIN_DURATION, 0),   // 最後一句超出音檔的部分會被裁掉
            };
        } else if (hit) {
            const s = segs[hit.i];
            select(hit.i, true);
            wave.drag = { ...base, ...hit, s0: s.start, e0: s.end };
        } else if (e.offsetY < RULER) {
            wave.drag = { mode: 'seek' };
            seek(t);
        } else {
            // 空白處：點一下跳到那裡，按住拖曳拉出一句新字幕
            const k = segs.findIndex(s => s.start > t), at = k < 0 ? n : k;
            const lo = segs[at - 1]?.end ?? 0, hi = Math.max(lo, segs[at]?.start ?? state.duration);
            wave.drag = { ...base, mode: 'new', at, lo, hi, t: clamp(t, lo, hi) };
        }
    });
    window.addEventListener('mousemove', e => {
        const d = wave.drag;
        if (!d) return;
        if (d.mode === 'seek') return seek(wave.off + (e.clientX - el.getBoundingClientRect().left) / wave.pps);
        const dx = e.clientX - d.x0;
        if (Math.abs(dx) > 3) d.moved = true;
        if (!d.moved) return;
        const dt = dx / wave.pps, noSnap = e.metaKey || e.ctrlKey, segs = state.segs;
        if (d.mode === 'new') {
            const t2 = clamp(snapTime(d.t + dt, [d.lo, d.hi], noSnap), d.lo, d.hi);
            wave.draftNew = { start: Math.min(d.t, t2), end: Math.max(d.t, t2) };
            return drawWave();
        }
        if (d.mode === 'ripple') {
            const shift = clamp(snapTime(d.anchor + dt, [], noSnap) - d.anchor, d.lo, d.hi);
            wave.shift = { from: d.from, dt: shift };
            wave.draft = d.trimEnd ? { [d.i]: { start: segs[d.i].start, end: segs[d.i].end + shift } } : null;
            showTimes(d.i);
            return drawWave();
        }
        if (d.mode === 'roll') {
            const cut = clamp(snapTime(d.t0 + dt, [], noSnap), d.min, d.max);
            const A = segs[d.a], B = segs[d.b], draft = { [d.a]: { start: A.start, end: cut }, [d.b]: { start: cut, end: B.end } };
            if (cut > d.hi) {
                // 後句已經最短：整句往後，撞到誰就推誰
                let edge = B.end + (cut - d.hi);
                draft[d.b].end = edge;
                for (let k = d.b + 1; k < segs.length && segs[k].start < edge; k++) {
                    const push = edge - segs[k].start;
                    draft[k] = { start: segs[k].start + push, end: segs[k].end + push };
                    edge = draft[k].end;
                }
            } else if (cut < d.lo) {
                let edge = A.start - (d.lo - cut);
                draft[d.a].start = edge;
                for (let k = d.a - 1; k >= 0 && segs[k].end > edge; k--) {
                    const push = segs[k].end - edge;
                    draft[k] = { start: segs[k].start - push, end: segs[k].end - push };
                    edge = draft[k].start;
                }
            }
            wave.draft = draft;
            for (const k of Object.keys(draft)) showTimes(+k);
            return drawWave();
        }
        const prev = segs[d.i - 1]?.end ?? 0, next = segs[d.i + 1]?.start ?? state.duration;
        const snap = t => snapTime(t, [prev, next], noSnap);
        let start = d.s0, end = d.e0;   // 不跟前後句重疊
        if (d.mode === 'start') start = clamp(snap(d.s0 + dt), Math.min(prev, d.s0), d.e0 - MIN_DURATION);
        else if (d.mode === 'end') end = clamp(snap(d.e0 + dt), d.s0 + MIN_DURATION, Math.max(next, d.e0));
        else {
            // 整句移動：頭或尾其中一邊貼得上就貼
            const s1 = snap(d.s0 + dt), e1 = snap(d.e0 + dt);
            let shift = s1 !== d.s0 + dt ? s1 - d.s0 : e1 !== d.e0 + dt ? e1 - d.e0 : dt;
            shift = clamp(shift, Math.min(prev - d.s0, 0), Math.max(next - d.e0, 0));
            start += shift;
            end += shift;
        }
        wave.draft = { [d.i]: { start, end } };
        showTimes(d.i);
        drawWave();
    });
    window.addEventListener('mouseup', () => {
        const d = wave.drag, draft = wave.draft, fresh = wave.draftNew, shift = wave.shift;
        wave.drag = wave.draft = wave.draftNew = wave.shift = null;
        if (!d || d.mode === 'seek') return;
        let segs = state.segs.slice();
        if (d.mode === 'new') {
            if (!d.moved || !fresh) return seek(d.t);
            if (fresh.end - fresh.start < 0.2) return drawWave();
            segs.splice(d.at, 0, { start: fresh.start, end: fresh.end, text: '', words: [] });
            state.sel = d.at;
            return commit(segs, { focus: [d.at, 0] });   // 放開後直接打字
        }
        if (!d.moved || !(draft || shift)) return seek(d.t);
        for (const [i, times] of Object.entries(draft || {})) segs[i] = { ...segs[i], ...times };
        if (shift?.dt) {
            const move = x => ({ ...x, start: x.start + shift.dt, end: Math.min(x.end + shift.dt, Math.max(state.duration, x.start + shift.dt + MIN_DURATION)) });
            segs = segs.map((s, i) => i >= shift.from ? { ...move(s), words: (s.words || []).map(move) } : s);
        }
        commit(segs, { render: Object.keys(draft || {}).length + (shift ? 2 : 0) > 1 });
    });
    $('alignBtn').addEventListener('click', () => {
        if (!state.peaks) return toast('沒有波形資料，無法貼齊', 2000);
        const next = alignToSound(state.segs), changed = next.filter((s, i) => s !== state.segs[i]).length;
        if (changed) commit(next);
        toast(changed ? `已把 ${changed} 句的頭尾貼齊聲音（⌘Z 可復原）` : '每一句都已經貼齊聲音', 2500);
    });
    $('snapBtn').addEventListener('click', toggleSnap);
    $('markBtn').addEventListener('click', toggleMarker);
    el.addEventListener('wheel', e => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) return zoomWave(wave.pps * Math.exp(-e.deltaY * 0.01), e.offsetX);
        wave.off += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / wave.pps;
        clampOff();
        drawWave();
    }, { passive: false });
    $('zoomInBtn').addEventListener('click', () => zoomWave(wave.pps * 1.5));
    $('zoomOutBtn').addEventListener('click', () => zoomWave(wave.pps / 1.5));
    $('zoomFitBtn').addEventListener('click', () => zoomWave(0));
    window.addEventListener('resize', layoutWave);
}

/* ---------- 摘要 ---------- */
async function generateSummary() {
    // 帶上每句的時間，時間軸才不會是模型自己編的；太長就分批摘要再合併（原本超過 2 萬字直接放棄）
    const chunks = [''];
    for (const s of state.segs) {
        const line = `[${clock(s.start)}] ${s.text}\n`;
        if (chunks.at(-1).length + line.length > 6000) chunks.push('');
        chunks[chunks.length - 1] += line;
    }
    const parts = [];
    for (const chunk of chunks) {
        parts.push(await chat(CONFIG.summaryModel, SUMMARY_PROMPT, `音檔總長度：${clock(state.duration)}\n\n逐字稿：\n${chunk}`));
    }
    let result = parts[0];
    if (parts.length > 1) {
        const merged = await chat(CONFIG.summaryModel, MERGE_PROMPT, JSON.stringify(parts.flatMap(p => p.summary || [])));
        result = { summary: merged.summary, timeline: parts.flatMap(p => p.timeline || []) };
    }
    return JSON.parse(toTW(JSON.stringify(result)));
}

function setSummaryOpen(open) {
    $('content-area').classList.toggle('no-summary', !open);
    $('summaryToggle').classList.toggle('active', open);
}

function renderSummary() {
    const s = state.summary, box = $('summary-text');
    $('generateSummaryBtn').hidden = !!s;
    document.querySelector('.summary-actions').hidden = !s;
    box.hidden = !s;
    if (!s) return;
    box.innerHTML = `<h2>摘要</h2><ul>${(s.summary || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul><h2>時間軸</h2>` +
        (s.timeline || []).map(t => `<div class="timeline-entry"><a href="#" class="timeline-link" data-t="${Number(t.start_seconds) || 0}">[${esc(t.time_display)}]</a>` +
            `<span class="timeline-content">${esc(t.content)}</span></div>`).join('');
}

function initSummary() {
    const btn = $('generateSummaryBtn');
    const run = async () => {
        if (!state.segs.length) return;
        state.summary = null;
        renderSummary();
        btn.disabled = true;
        btn.textContent = '正在生成摘要…';
        try {
            state.summary = await generateSummary();
            saveProject();
        } catch (error) {
            console.error('生成摘要時出錯:', error);
            alert('生成摘要失敗：' + error.message);
        }
        btn.disabled = false;
        btn.innerHTML = icon('magic') + '生成內容摘要';
        renderSummary();
    };
    btn.addEventListener('click', run);
    $('regenerateSummaryBtn').addEventListener('click', run);
    $('summaryToggle').addEventListener('click', () => setSummaryOpen($('content-area').classList.contains('no-summary')));
    $('copySummaryBtn').addEventListener('click', async e => {
        const copyBtn = e.currentTarget;
        try {
            await navigator.clipboard.writeText($('summary-text').innerText);
            copyBtn.innerHTML = icon('check');
            setTimeout(() => { copyBtn.innerHTML = icon('copy'); }, 2000);
        } catch { alert('複製失敗，請手動複製'); }
    });
    $('summary-text').addEventListener('click', e => {
        const link = e.target.closest('.timeline-link');
        if (!link) return;
        e.preventDefault();
        const t = +link.dataset.t;
        let best = 0;
        state.segs.forEach((s, i) => { if (Math.abs(s.start - t) < Math.abs(state.segs[best].start - t)) best = i; });
        select(best);
        seek(state.segs[best].start);
        const row = rowEl(best);
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

/* ---------- 對話框：查找取代、詞庫、快捷鍵 ---------- */
const openModal = id => { $(id).hidden = false; };
const closeModals = () => { for (const m of document.querySelectorAll('.modal')) m.hidden = true; };
const modalOpen = () => !!document.querySelector('.modal:not([hidden])');

function updateSearchResults() {
    const term = $('searchInput').value, to = $('replaceInput').value;
    const rows = !term ? [] : state.segs.filter(s => s.text.includes(term)).map(s => {
        const parts = s.text.split(term).map(esc), t = esc(term);
        return `<tr><td>${srtTime(s.start)}</td><td>${parts.join(`<mark>${t}</mark>`)}</td>` +
            `<td>${parts.join(to ? `<ins>${esc(to)}</ins>` : `<del>${t}</del>`)}</td></tr>`;
    });
    $('searchResults').innerHTML = rows.join('');
    $('resultCount').textContent = rows.length;
}

function openFind() {
    closeModals();
    openModal('findReplaceModal');
    $('searchInput').focus();
    $('searchInput').select();
    updateSearchResults();
}

function initModals() {
    for (const m of document.querySelectorAll('.modal')) {
        m.addEventListener('mousedown', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); });
    }

    // 查找取代
    $('findReplaceBtn').addEventListener('click', openFind);
    $('searchInput').addEventListener('input', updateSearchResults);
    $('replaceInput').addEventListener('input', updateSearchResults);
    $('replaceAllBtn').addEventListener('click', e => {
        const from = $('searchInput').value, to = $('replaceInput').value, btn = e.currentTarget;
        if (!from || !replaceAll(from, to)) return;
        $('searchInput').value = $('replaceInput').value = '';
        updateSearchResults();
        btn.textContent = '替換完成';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = '替換'; btn.classList.remove('done'); }, 2000);
        if (to.trim()) { closeModals(); suggestRule({ from, to }); }
    });

    // 詞庫
    const openDict = () => openModal('dictModal');
    $('dictBtn').addEventListener('click', openDict);
    $('openDictFromConfirm').addEventListener('click', openDict);
    $('dictModal').addEventListener('click', e => {
        const { term, rule } = e.target.dataset;
        if (term !== undefined) dict.data.terms.splice(+term, 1);
        else if (rule !== undefined) dict.data.rules.splice(+rule, 1);
        else return;
        dict.save();
    });
    $('termForm').addEventListener('submit', e => {
        e.preventDefault();
        dict.addTerm($('termInput').value);
        dict.save();
        $('termInput').value = '';
    });
    $('ruleForm').addEventListener('submit', e => {
        e.preventDefault();
        if (dict.addRule($('ruleFrom').value, $('ruleTo').value)) $('ruleFrom').value = $('ruleTo').value = '';
        $('ruleFrom').focus();
    });
    $('dictExportBtn').addEventListener('click', () => download('我的詞庫.json', JSON.stringify(dict.data, null, 2), 'application/json'));
    $('dictImportBtn').addEventListener('click', () => $('dictFile').click());
    $('dictFile').addEventListener('change', async e => {
        try {
            const d = JSON.parse(await e.target.files[0].text());
            for (const t of d.terms || []) dict.addTerm(String(t));
            for (const r of d.rules || []) dict.addRule(String(r.from), String(r.to));
            dict.save();
            toast('詞庫已匯入', 2000);
        } catch { alert('匯入失敗：檔案格式不正確'); }
        e.target.value = '';
    });

    $('keysBtn').addEventListener('click', () => openModal('keysModal'));
}

/* ---------- AI 校對建議：模型只列出疑似錯字，要不要改由使用者逐條決定 ---------- */
let proofFixes = [];

async function runProof() {
    if (!state.segs.length) return;
    proofFixes = [];
    renderProof('正在校對，請稍候…');
    openModal('proofModal');
    const chunks = [''];
    state.segs.forEach((s, i) => {
        const line = `[${i + 1}] ${s.text}\n`;
        if (chunks.at(-1).length + line.length > 6000) chunks.push('');
        chunks[chunks.length - 1] += line;
    });
    try {
        for (const chunk of chunks) {
            const r = await chat(CONFIG.summaryModel, PROOF_PROMPT, `常用詞：${dict.data.terms.join('、') || '（無）'}\n\n逐字稿：\n${chunk}`);
            for (const f of Array.isArray(r.fixes) ? r.fixes : []) {
                const i = Number(f?.line) - 1, seg = state.segs[i];
                // 模型回報的內容要對得上原文才採用
                if (seg && typeof f.wrong === 'string' && typeof f.right === 'string' && f.wrong && f.right &&
                    f.wrong !== f.right && f.wrong.length <= 20 && seg.text.includes(f.wrong)) {
                    proofFixes.push({ i, wrong: f.wrong, right: f.right, reason: String(f.reason || '') });
                }
            }
            renderProof('正在校對，請稍候…');
        }
        renderProof(proofFixes.length ? '' : '沒有發現明顯的錯字。');
    } catch (error) {
        console.error('校對時出錯:', error);
        renderProof('校對失敗：' + error.message);
    }
}

function renderProof(status) {
    if (status !== undefined) $('proofStatus').textContent = status;
    $('proofStatus').hidden = !$('proofStatus').textContent;
    $('proofAcceptAll').hidden = proofFixes.length < 2;
    $('proofList').innerHTML = proofFixes.map((f, k) => {
        const seg = state.segs[f.i], parts = seg.text.split(f.wrong).map(esc);
        return `<tr><td>${shortTime(seg.start)}</td>` +
            `<td>${parts.join(`<del>${esc(f.wrong)}</del><ins>${esc(f.right)}</ins>`)}</td>` +
            `<td class="reason">${esc(f.reason)}</td>` +
            `<td class="acts"><button class="tool-btn sm active" data-accept="${k}">接受</button><button class="tool-btn sm" data-skip="${k}">略過</button></td></tr>`;
    }).join('');
}

function applyProof(fixes) {
    const segs = state.segs.slice();
    for (const f of fixes) {
        segs[f.i] = { ...segs[f.i], text: segs[f.i].text.split(f.wrong).join(f.right) };
        if ($('proofRemember').checked) dict.addRule(f.wrong, f.right);
    }
    proofFixes = proofFixes.filter(f => !fixes.includes(f) && segs[f.i].text.includes(f.wrong));
    commit(segs);
    if (proofFixes.length) renderProof(''); else { closeModals(); toast(`已套用 ${fixes.length} 條修正（⌘Z 可復原）`, 2500); }
}

function initProof() {
    $('proofBtn').addEventListener('click', runProof);
    $('proofAcceptAll').addEventListener('click', () => applyProof([...proofFixes]));
    $('proofList').addEventListener('click', e => {
        const { accept, skip } = e.target.dataset;
        if (accept !== undefined) applyProof([proofFixes[+accept]]);
        else if (skip !== undefined) {
            proofFixes.splice(+skip, 1);
            if (proofFixes.length) renderProof(''); else closeModals();
        }
    });
}

/* ---------- 下載 ---------- */
function download(filename, content, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXPORTERS = {
    srt: segs => segs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n'),
    vtt: segs => 'WEBVTT\n\n' + segs.map(s => `${srtTime(s.start, '.')} --> ${srtTime(s.end, '.')}\n${s.text}\n`).join('\n'),
    txt: segs => segs.map(s => s.text).join('\n'),
    json: segs => JSON.stringify({ segments: segs.map(({ start, end, text }) => ({ start, end, text })) }, null, 2),
    doc: segs => `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>` +
        `<head><meta charset='utf-8'><title>Transcript</title><style>body{font-family:Arial,sans-serif;line-height:1.5}p{margin-bottom:10px}strong{color:#555}</style></head>` +
        `<body><h1>Transcript</h1>${segs.map(s => `<p><strong>[${clock(s.start)} - ${clock(s.end)}]</strong> ${esc(s.text)}</p>`).join('')}</body></html>`,
};
const MIME = { srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain', json: 'application/json', doc: 'application/msword' };

/* ---------- 結果頁其他控制 ---------- */
function initResult() {
    $('backLink').addEventListener('click', () => {
        player.pause();
        closeModals();
        $('toast').hidden = true;
        show('upload');
        rain ??= new MatrixRain(titleEl);
        refreshResume();
    });

    const name = $('filename-display');
    name.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); name.blur(); } });
    name.addEventListener('blur', () => {
        name.textContent = name.textContent.trim() || 'transcript';
        saveProject();
    });

    const menu = $('downloadMenu'), btn = $('downloadBtn');
    const setMenu = open => { menu.classList.toggle('show', open); btn.setAttribute('aria-expanded', open); };
    btn.addEventListener('click', e => { e.stopPropagation(); setMenu(!menu.classList.contains('show')); });
    document.addEventListener('click', () => setMenu(false));
    menu.addEventListener('click', e => {
        const format = e.target.closest('.download-item')?.dataset.format;
        if (format) download(`${name.textContent || 'transcript'}.${format}`, EXPORTERS[format](state.segs), MIME[format]);
    });

    // 拖曳分隔線
    const resizer = $('resizer');
    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        resizer.classList.add('dragging');
        const move = ev => $('content-area').style.setProperty('--summary-w', clamp(ev.clientX, 200, window.innerWidth - 400) + 'px');
        const up = () => {
            resizer.classList.remove('dragging');
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    });
}

/* ---------- 快捷鍵 ---------- */
function initKeys() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Alt' && !$('result-container').hidden) setAlt(true);
        if ($('result-container').hidden) return;
        const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();

        if (mod && key === 'f') { e.preventDefault(); return openFind(); }
        if (e.key === 'Escape' && modalOpen()) return closeModals();
        if (modalOpen() || e.target.closest('input, textarea, select, [contenteditable]')) return;   // 打字中交給輸入框

        if (mod && key === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
        if (mod && key === 'y') { e.preventDefault(); return redo(); }
        if (mod || e.altKey) return;

        const actions = {
            ' ': () => {   // 滑鼠停在波形上時，從滑鼠位置開始播
                if (player.paused && player.src && wave.hover >= 0) seek(wave.off + wave.hover / wave.pps);
                togglePlay();
            },
            'b': splitAtPlayhead, 'B': splitAtPlayhead,
            'm': toggleMarker, 'M': toggleMarker,
            'n': toggleSnap, 'N': toggleSnap,
            'Home': () => seek(0),
            'End': () => seek(state.duration),
            'ArrowUp': () => stepSelect(-1),
            'ArrowDown': () => stepSelect(1),
            'Enter': () => focusRow(state.sel),
            'F2': () => focusRow(state.sel),
            'Delete': () => removeSeg(state.sel),
            'Backspace': () => removeSeg(state.sel),
            '[': () => setEdge('start'),
            ']': () => setEdge('end'),
            '?': () => openModal('keysModal'),
        };
        const action = actions[e.key];
        if (action) { e.preventDefault(); action(); }
    });
    document.addEventListener('keyup', e => { if (e.key === 'Alt') setAlt(false); });
    // 用滑鼠點過按鈕後把焦點放掉，空白鍵才不會又觸發那顆按鈕
    document.addEventListener('click', e => { if (e.detail) e.target.closest?.('button')?.blur(); });
    $('speedSelect').addEventListener('change', e => e.target.blur());
    window.addEventListener('blur', () => setAlt(false));
}

function stepSelect(delta) {
    if (!state.segs.length) return;
    select(clamp(state.sel + delta, 0, state.segs.length - 1), true);
    seek(state.segs[state.sel].start);
}

/* ---------- 啟動 ---------- */
initUpload();
initList();
initToast();
initPlayer();
initWave();
initSummary();
initModals();
initProof();
initResult();
initKeys();
renderDict();
refreshResume();
rain = new MatrixRain(titleEl);
