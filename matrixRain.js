class MatrixRain {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100vh';
        this.canvas.style.zIndex = '-1';
        this.canvas.style.background = 'white';
        this.canvas.style.pointerEvents = 'none';
        document.body.appendChild(this.canvas);

        this.characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789!@#$%^&*()';
        this.finalText = ['S','p','e','e','c','h',' ','T','o',' ','T','e','x','t'];
        this.fontSize = 14;
        this.columns = 0;
        this.drops = [];
        this.letterOpacities = new Array(14).fill(0); // 14 letters in "Speech To Text"
        this.letterHitCounts = new Array(14).fill(0); // 追蹤每個字母被擊中的次數
        this.isGeneratingNew = true; // 控制是否生成新的字符雨

        window.addEventListener('resize', () => this.initializeCanvas());
        this.initializeCanvas();
        this.animate();
        
        // 開始時設置所有字母為隨機字符
        this.updateRandomCharacters();
    }

    updateRandomCharacters() {
        const titleLetters = document.querySelectorAll('.title span');
        titleLetters.forEach((letter, index) => {
            if (this.letterHitCounts[index] < 50) { // 只有在擊中次數小於50時才更新隨機字符
                if (this.finalText[index] === ' ') {
                    letter.textContent = ' ';
                    letter.style.width = '0.5em';
                    letter.style.display = 'inline-block';
                } else {
                    const randomChar = this.characters.charAt(Math.floor(Math.random() * this.characters.length));
                    letter.textContent = randomChar;
                }
            }
        });
    }

    initializeCanvas() {
        this.canvas.width = document.documentElement.clientWidth;
        this.canvas.height = document.documentElement.clientHeight;
        this.columns = Math.floor(this.canvas.width / this.fontSize);
        this.drops = Array(this.columns).fill(0).map(() => Math.floor(Math.random() * -100));
    }

    animate() {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.font = this.fontSize + 'px monospace';

        if (Math.random() > 0.8 && this.isGeneratingNew) {
            this.updateRandomCharacters();
        }

        let hasActiveDrops = false;
        for (let i = 0; i < this.drops.length; i++) {
            if (this.drops[i] > 0) {
                hasActiveDrops = true;
                const text = this.characters.charAt(Math.floor(Math.random() * this.characters.length));
                const y = this.drops[i] * this.fontSize;
                
                if (y <= this.canvas.height) {
                    this.ctx.fillText(text, i * this.fontSize, y);
                }

                const titleLetters = document.querySelectorAll('.title span');
                titleLetters.forEach((letter, index) => {
                    const rect = letter.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    
                    const rainX = i * this.fontSize;
                    const rainY = this.drops[i] * this.fontSize;
                    
                    if (Math.abs(rainX - centerX) < rect.width && 
                        Math.abs(rainY - centerY) < rect.height) {
                        this.letterHitCounts[index]++;
                        this.letterOpacities[index] = Math.min(1, this.letterHitCounts[index] / 50);
                        letter.style.color = `rgba(0, 0, 0, ${this.letterOpacities[index]})`;
                        
                        if (this.letterHitCounts[index] === 50) {
                            letter.textContent = this.finalText[index];
                            if (this.finalText[index] === ' ') {
                                letter.style.width = '0.5em';
                                letter.style.display = 'inline-block';
                            }
                        }
                    }
                });
            }

            if (this.drops[i] * this.fontSize > this.canvas.height) {
                if (Math.random() > 0.975) {
                    this.drops[i] = Math.floor(Math.random() * -20);
                }
            } else {
                this.drops[i]++;
            }
        }

        if (hasActiveDrops || this.isGeneratingNew) {
            requestAnimationFrame(() => this.animate());
        }
    }

    // 停止生成新的字符雨的方法
    stopGenerating() {
        this.isGeneratingNew = false;
    }

    // 檢查是否所有字符雨都已完成
    isFinished() {
        return this.drops.every(drop => drop * this.fontSize > this.canvas.height);
    }

    static init(containerId) {
        if (containerId === 'result-container') return null;
        const instance = new MatrixRain();
        
        // 移除監聽處理頁面的顯示，讓矩陣雨持續下著
        return instance;
    }
} 
