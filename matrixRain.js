// 矩陣雨：平常是背景；reveal() 時變成遮罩，雨落下的地方把白色蓋板擦掉，露出底下的頁面。
class MatrixRain {
    static CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789!@#$%^&*()';
    static FONT = 14;          // 每格大小（px）
    static STEP = 1000 / 60;   // 每一步的毫秒數（固定速度，不受螢幕更新率影響）
    static HITS = 50;          // 標題字母被雨打中幾次後定型
    static FADE_ROWS = 10;     // 揭開時邊緣的漸層列數

    constructor(titleEl) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'rain';
        this.ctx = this.canvas.getContext('2d');
        document.body.appendChild(this.canvas);

        this.revealRows = null;   // 不是 null 時表示正在揭開
        this.setTitle(titleEl);
        this.onResize = () => this.layout();
        window.addEventListener('resize', this.onResize);
        this.layout();
        document.fonts?.ready.then(() => this.measure());

        this.last = performance.now();
        this.acc = 0;
        this.raf = requestAnimationFrame(t => this.frame(t));
    }

    randomChar() {
        const c = MatrixRain.CHARS;
        return c[Math.floor(Math.random() * c.length)];
    }

    // 標題：先全部是亂碼，被雨打中夠多次才變回 Speech To Text
    setTitle(el) {
        this.letters = [];
        if (!el) return;
        const text = el.getAttribute('aria-label') || '';
        el.textContent = '';
        for (const ch of text) {
            const span = document.createElement('span');
            if (ch === ' ') span.className = 'space';
            el.appendChild(span);
            this.letters.push({ el: span, final: ch, hits: 0 });
        }
        this.scramble();
    }

    scramble() {
        for (const l of this.letters) {
            if (l.final !== ' ' && l.hits < MatrixRain.HITS) l.el.textContent = this.randomChar();
        }
        this.measure();
    }

    // 只在字母內容或視窗改變時量位置（原本是每一幀、每一滴雨都量一次）
    measure() {
        for (const l of this.letters) {
            const r = l.el.getBoundingClientRect();
            l.cx = r.left + r.width / 2;
            l.cy = r.top + r.height / 2;
            l.w = r.width;
            l.h = r.height;
        }
    }

    layout() {
        const dpr = window.devicePixelRatio || 1;
        this.w = document.documentElement.clientWidth;
        this.h = document.documentElement.clientHeight;
        this.canvas.width = this.w * dpr;
        this.canvas.height = this.h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.w, this.h);
        this.cols = Math.floor(this.w / MatrixRain.FONT);
        this.rows = Math.ceil(this.h / MatrixRain.FONT);
        this.drops = Array.from({ length: this.cols }, () => Math.floor(Math.random() * -100));
        if (this.revealRows) this.revealRows = this.drops.map(() => Math.random() * -40);
        this.measure();
    }

    frame(now) {
        this.acc += Math.min(now - this.last, 100);
        this.last = now;
        while (this.acc >= MatrixRain.STEP) {
            this.step();
            this.acc -= MatrixRain.STEP;
        }
        if (this.canvas.isConnected) this.raf = requestAnimationFrame(t => this.frame(t));
    }

    step() {
        const { ctx, drops } = this;
        const F = MatrixRain.FONT;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.font = F + 'px monospace';

        const pending = this.letters.some(l => l.hits < MatrixRain.HITS);
        if (pending && Math.random() > 0.8) this.scramble();

        for (let i = 0; i < drops.length; i++) {
            const x = i * F;
            const y = drops[i] * F;
            if (drops[i] > 0 && y <= this.h) {
                ctx.fillText(this.randomChar(), x, y);
                if (pending) this.hitTitle(x, y);
            }
            if (y > this.h) {
                // 揭開階段不再生新的雨
                if (!this.revealRows && Math.random() > 0.975) drops[i] = Math.floor(Math.random() * -20);
            } else {
                drops[i]++;
            }
        }

        if (this.revealRows) this.stepReveal();
    }

    hitTitle(x, y) {
        for (const l of this.letters) {
            if (l.hits >= MatrixRain.HITS || Math.abs(x - l.cx) >= l.w || Math.abs(y - l.cy) >= l.h) continue;
            l.hits++;
            l.el.style.color = `rgba(0, 0, 0, ${l.hits / MatrixRain.HITS})`;
            if (l.hits === MatrixRain.HITS) l.el.textContent = l.final;
        }
    }

    // 揭開：每一欄有一顆「擦除雨滴」，它上方的白色蓋板被擦掉（邊緣是漸層），雨滴本身照樣畫字
    stepReveal() {
        const { ctx, revealRows } = this;
        const F = MatrixRain.FONT;
        const fade = MatrixRain.FADE_ROWS;
        let done = true;

        for (let i = 0; i < revealRows.length; i++) {
            revealRows[i] += 1.1;
            const head = revealRows[i];
            if (head < this.rows + fade + 1) done = false;
            if (head <= 0) continue;
            const x = i * F;

            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.fillText(this.randomChar(), x, head * F);

            ctx.globalCompositeOperation = 'destination-out';
            const solid = (head - fade) * F;
            if (solid > 0) {
                ctx.fillStyle = '#000';
                ctx.fillRect(x, 0, F, solid);
            }
            for (let k = 0; k < fade; k++) {
                ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * (1 - k / fade)})`;
                ctx.fillRect(x, solid + k * F, F, F);
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        if (done) {
            const cb = this.onRevealed;
            this.destroy();
            cb?.();
        }
    }

    // 把雨拉到最上層當蓋板（此時整片是不透明白色加上雨）
    cover() {
        this.canvas.classList.add('cover');
    }

    // 開始揭開底下的頁面，雨下完後呼叫 onDone
    reveal(onDone) {
        this.cover();
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.canvas.style.transition = 'opacity .4s';
            this.canvas.style.opacity = '0';
            setTimeout(() => { this.destroy(); onDone?.(); }, 400);
            return;
        }
        this.onRevealed = onDone;
        this.revealRows = this.drops.map(() => Math.random() * -40);
    }

    destroy() {
        cancelAnimationFrame(this.raf);
        window.removeEventListener('resize', this.onResize);
        this.canvas.remove();
    }
}
