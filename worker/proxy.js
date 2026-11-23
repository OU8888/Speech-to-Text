/**
 * Cloudflare Worker：把 Groq 金鑰藏在伺服器端（備用，目前網頁還沒有使用）
 *
 * 部署步驟（約 10 分鐘，免費方案即可）：
 * 1. 到 https://console.groq.com/keys 把舊金鑰刪掉、建立一把新的（舊的已經公開在 GitHub 上）。
 * 2. 註冊 https://dash.cloudflare.com → Workers & Pages → Create → Worker，把這個檔案的內容整個貼上、Deploy。
 * 3. 在該 Worker 的 Settings → Variables and Secrets 新增一個 Secret：名稱 GROQ_API_KEY，值填新金鑰。
 * 4. 把下面 ALLOWED_ORIGINS 改成你的網站網址（預設已填 GitHub Pages）。
 * 5. 回到 script.js 最上面的 CONFIG：
 *      apiBase: 'https://你的名稱.workers.dev',
 *      apiKey: '',
 *
 * 注意：免費方案單次請求上限 100MB，本網頁每段音訊約 3–4MB，不會超過。
 */
const ALLOWED_ORIGINS = ['https://ou8888.github.io', 'http://localhost:8765'];
const ALLOWED_PATHS = ['/audio/transcriptions', '/chat/completions'];

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const cors = {
            'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Expose-Headers': 'Retry-After',
            'Vary': 'Origin',
        };
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        const path = new URL(request.url).pathname;
        if (request.method !== 'POST' || !ALLOWED_ORIGINS.includes(origin) || !ALLOWED_PATHS.includes(path)) {
            return new Response('Forbidden', { status: 403, headers: cors });
        }

        const upstream = await fetch('https://api.groq.com/openai/v1' + path, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                'Content-Type': request.headers.get('Content-Type'),
            },
            body: request.body,
        });
        const headers = new Headers(cors);
        for (const name of ['Content-Type', 'Retry-After']) {
            if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
        }
        return new Response(upstream.body, { status: upstream.status, headers });
    },
};
