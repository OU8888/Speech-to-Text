const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const API_KEY = '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';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const LLAMA_MODEL = 'llama-3.2-90b-text-preview';

const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');
const uploadContainer = document.getElementById('upload-container');
const processingContainer = document.getElementById('processing-container');
const resultContainer = document.getElementById('result-container');
const summaryText = document.getElementById('summary-text');
const transcriptText = document.getElementById('transcript-text');
const formatSelect = document.getElementById('format-select');
const downloadLink = document.getElementById('downloadLink');
const backLink = document.getElementById('backLink');

dropArea.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('highlight');
});
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('highlight'));
dropArea.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);
// formatSelect.addEventListener('change', updateTranscriptFormat);
// languageSelect.addEventListener('change', translateTranscript);

function handleDrop(e) {
    e.preventDefault();
    dropArea.classList.remove('highlight');
    const file = e.dataTransfer.files[0];
    if (!file) {
        alert('請選擇檔案');
        return;
    }
    
    if (checkFileSize(file) && checkFileType(file)) {
        processAudioFile(file);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (checkFileSize(file) && checkFileType(file)) {
        processAudioFile(file);
    }
}

async function transcribeAudio(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', WHISPER_MODEL);
    formData.append('response_format', 'verbose_json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error('轉錄失敗');
    }

    const data = await response.json();
    return data;
}

async function generateSummary(text) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: LLAMA_MODEL,
            messages: [
                { role: 'system', content: '請以心智圖筆記的方式，用繁體中文總結以下音檔內容。請精簡扼要地呈現重點，不需要很長的敘述。使用簡潔的條列式格式，突出主要概念和關鍵詞。' },
                { role: 'user', content: text }
            ]
        })
    });

    if (!response.ok) {
        throw new Error('生成摘要失敗');
    }

    const data = await response.json();
    return await converter(data.choices[0].message.content);
}

async function convertToTraditional(text) {
    const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
    return await converter(text);
}

// 添加全局變數來存儲轉錄數據
let currentTranscriptData = null;

// 修改 displayTranscript 函數
function displayTranscript(transcriptData) {
    currentTranscriptData = transcriptData;
    const transcriptContainer = document.getElementById('transcript-text');
    const currentValue = document.querySelector('.select-value')?.textContent || 'srt';
    
    if (currentValue === 'srt') {
        displaySRTFormat(transcriptContainer, currentTranscriptData);
    } else {
        displayTXTFormat(transcriptContainer, currentTranscriptData);
    }
    
    updateDownloadLink();
}

// SRT 格式顯示
function displaySRTFormat(container, data) {
    container.innerHTML = '';
    
    data.segments.forEach((segment, index) => {
        const entry = document.createElement('div');
        entry.className = 'transcript-entry';
        entry.dataset.index = index;

        const timeAndTextDiv = document.createElement('div');
        timeAndTextDiv.className = 'transcript-content';
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'transcript-time';
        timeSpan.textContent = `${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}`;

        const textSpan = document.createElement('span');
        textSpan.className = 'transcript-text';
        textSpan.textContent = segment.text;
        textSpan.onclick = () => makeEditable(textSpan, index);

        timeAndTextDiv.appendChild(timeSpan);
        timeAndTextDiv.appendChild(textSpan);
        entry.appendChild(timeAndTextDiv);
        container.appendChild(entry);
    });
}

// TXT 格式顯示
function displayTXTFormat(container, data) {
    container.innerHTML = '';
    
    data.segments.forEach((segment, index) => {
        const entry = document.createElement('div');
        entry.className = 'transcript-entry';
        entry.dataset.index = index;

        const textDiv = document.createElement('div');
        textDiv.className = 'transcript-text';
        textDiv.textContent = segment.text;
        textDiv.onclick = () => makeEditable(textDiv, index);

        entry.appendChild(textDiv);
        container.appendChild(entry);
    });
}

// 使文字可編輯
function makeEditable(element, index) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'transcript-input';
    input.value = element.textContent;
    
    input.onblur = () => saveEdit(input, element, index);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            element.parentNode.replaceChild(element, input);
        }
    };

    element.parentNode.replaceChild(input, element);
    input.focus();
}

// 保存編輯
function saveEdit(input, originalElement, index) {
    const newText = input.value.trim();
    originalElement.textContent = newText;
    
    // 更新數據
    currentTranscriptData.segments[index].text = newText;
    
    // 替換回原始元素
    input.parentNode.replaceChild(originalElement, input);
    
    // 更新下載鏈接
    updateDownloadLink();
}

// 修改 updateDownloadLink 函數
function updateDownloadLink() {
    const currentValue = document.querySelector('.select-value').textContent;
    let content;
    
    if (currentValue === 'srt') {
        content = currentTranscriptData.segments.map((segment, index) => {
            return `${index + 1}\n${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}\n${segment.text}\n`;
        }).join('\n');
    } else {
        content = currentTranscriptData.segments.map(segment => segment.text).join('\n');
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = `transcript.${currentValue}`;
}

async function updateTranscript(transcript) {
    // 假設 transcript 是一個包含轉錄文字的數組
    const convertedTranscript = await Promise.all(transcript.map(async (item) => {
        item.text = await converter(item.text);
        return item;
    }));

    // 更 DOM
    const transcriptContainer = document.getElementById('transcript-text');
    transcriptContainer.innerHTML = '';
    convertedTranscript.forEach(item => {
        const p = document.createElement('p');
        p.textContent = item.text;
        transcriptContainer.appendChild(p);
    });

    // 如果有摘要，也進行轉換
    if (summary) {
        const convertedSummary = await converter(summary);
        document.getElementById('summary-text').textContent = convertedSummary;
    }
}

backLink.addEventListener('click', (e) => {
    e.preventDefault();
    resultContainer.style.display = 'none';
    uploadContainer.style.display = 'block';
    processingContainer.style.display = 'none';
    // 清空之前的結果
    summaryText.textContent = '';
    transcriptText.textContent = '';
    // 重置文件輸入
    fileInput.value = '';
});

// 初始化音頻上下文
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// 創建 Web Worker 用於 MP3 轉換
const workerBlob = new Blob([`
    importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    
    self.onmessage = function(e) {
        const { audioData, sampleRate, channels } = e.data;
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 96);
        const mp3Data = [];
        
        const samples = audioData[0].length;
        const blockSize = 1152;
        
        for (let i = 0; i < samples; i += blockSize) {
            const left = audioData[0].slice(i, i + blockSize);
            const right = channels > 1 ? audioData[1].slice(i, i + blockSize) : left;
            
            const leftInt = new Int16Array(left.map(x => Math.max(-32768, Math.min(32767, x * 32768))));
            const rightInt = new Int16Array(right.map(x => Math.max(-32768, Math.min(32767, x * 32768))));
            
            const mp3buf = mp3encoder.encodeBuffer(leftInt, rightInt);
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }
        
        const end = mp3encoder.flush();
        if (end.length > 0) {
            mp3Data.push(end);
        }
        
        self.postMessage({
            type: 'complete',
            data: mp3Data
        });
    };
`], { type: 'application/javascript' });

const workerUrl = URL.createObjectURL(workerBlob);

// 修改處理文件的主要函數
async function processAudioFile(file) {
    uploadContainer.style.display = 'none';
    processingContainer.style.display = 'block';

    try {
        let audioFile = file;
        
        if (file.type.startsWith('video/')) {
            updateProgress(0, '正在從影片中提取音頻...');
            const audioBuffer = await extractAudio(file);
            updateProgress(40, '正在轉換為 MP3...');
            
            const mp3Blob = await convertToMp3(audioBuffer);
            audioFile = new File([mp3Blob], 'audio.mp3', { type: 'audio/mp3' });
            
            updateProgress(70, '正在進行語音識別...');
        } else {
            updateProgress(30, '正在進行語音識別...');
        }

        const transcriptionData = await transcribeAudio(audioFile);
        updateProgress(90, '正在處理最終結果...');

        // 轉換為繁體中文
        transcriptionData.segments = await Promise.all(
            transcriptionData.segments.map(async (segment) => {
                segment.text = await converter(segment.text);
                return segment;
            })
        );

        displayTranscript(transcriptionData);

        updateProgress(100, '處理完成！');
        setTimeout(() => {
            uploadContainer.style.display = 'none';
            processingContainer.style.display = 'none';
            resultContainer.style.display = 'block';
        }, 500);

        updateDownloadLink();
    } catch (error) {
        console.error('處理文件時出錯:', error);
        alert('處理文件時出錯: ' + error.message);
        uploadContainer.style.display = 'block';
        processingContainer.style.display = 'none';
    }
}

// 從文件中提取音頻
async function extractAudio(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                resolve(audioBuffer);
            } catch (error) {
                reject(new Error('無法提取音頻，請確保文件格式正確'));
            }
        };
        reader.onerror = () => reject(new Error('讀取文件失敗'));
        reader.readAsArrayBuffer(file);
    });
}

// 將 AudioBuffer 轉換為 MP3
async function convertToMp3(audioBuffer) {
    return new Promise((resolve, reject) => {
        try {
            const worker = new Worker(workerUrl);
            const channels = audioBuffer.numberOfChannels;
            const audioData = [];
            
            for (let i = 0; i < channels; i++) {
                audioData.push(audioBuffer.getChannelData(i));
            }
            
            worker.onmessage = function(e) {
                if (e.data.type === 'progress') {
                    // 更新 MP3 轉換進度（30-50%之間）
                    const progress = 30 + (e.data.progress * 0.2);
                    updateProgress(progress, '正在轉換為 MP3...');
                } else if (e.data.type === 'complete') {
                    const blob = new Blob(e.data.data, { type: 'audio/mp3' });
                    worker.terminate();
                    resolve(blob);
                }
            };
            
            worker.onerror = function(error) {
                worker.terminate();
                reject(new Error('��換 MP3 失敗'));
            };
            
            worker.postMessage({
                audioData: audioData,
                sampleRate: audioBuffer.sampleRate,
                channels: channels
            });
            
        } catch (error) {
            reject(new Error('轉換 MP3 時發生錯誤'));
        }
    });
}

// 修改進度顯示相關函數
function updateProgress(progress, message) {
    const progressBar = document.querySelector('#progress');
    const progressText = document.querySelector('#processing-container .upload-text');
    const progressPercent = document.querySelector('#progress-percent');
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    if (progressText) {
        progressText.textContent = message;
    }
    if (progressPercent) {
        progressPercent.textContent = `${Math.round(progress)}%`;
    }
}

// 檢查文件大小
function checkFileSize(file) {
    const maxSize = 300 * 1024 * 1024; // 300MB
    if (file.size > maxSize) {
        alert('文件大小不能超過 300MB');
        return false;
    }
    return true;
}

// 檢查文件類型
function checkFileType(file) {
    const validTypes = [
        // 視頻格式
        'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
        // 音頻格式
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 
        'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-ms-wma'
    ];
    
    // 檢查文件擴展名
    const validExtensions = [
        '.mp4', '.mov', '.webm', '.mkv', 
        '.mp3', '.wav', '.ogg', '.aac', 
        '.m4a', '.flac', '.wma'
    ];
    
    const fileName = file.name.toLowerCase();
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!validTypes.includes(file.type) && !hasValidExtension) {
        alert('不支援的文件格式。\n支援的格式：MP4, MOV, WebM, MKV, MP3, WAV, OGG, AAC, M4A, FLAC, WMA');
        return false;
    }
    return true;
}

// 更新事件監聽器
dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.add('highlight');
});

dropArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.remove('highlight');
});

dropArea.addEventListener('drop', handleDrop);

// 添加 formatSRTTime 函數
function formatSRTTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${secs},${ms}`;
}

// 添加 formatTime 函數（用於一般時間格式）
function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
}

// 添加一個轉義特殊字符的函數
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 修改 updateSearchResults 函數
function updateSearchResults() {
    const searchInput = document.getElementById('searchInput');
    const replaceInput = document.getElementById('replaceInput');
    const searchResults = document.getElementById('searchResults');
    const resultCount = document.getElementById('resultCount');
    
    const searchTerm = searchInput.value;
    const replaceTerm = replaceInput.value;
    searchResults.innerHTML = '';
    let count = 0;

    if (!searchTerm) {
        resultCount.textContent = '0';
        return;
    }

    if (!currentTranscriptData || !currentTranscriptData.segments) {
        return;
    }

    // 使用轉義後的搜索詞創建正則表達式
    const searchRegex = new RegExp(escapeRegExp(searchTerm), 'g');

    currentTranscriptData.segments.forEach((segment, index) => {
        if (segment.text.includes(searchTerm)) {
            count++;
            const row = document.createElement('tr');
            
            // 時間列
            const timeCell = document.createElement('td');
            timeCell.textContent = formatSRTTime(segment.start);
            
            // 原文列
            const originalCell = document.createElement('td');
            originalCell.innerHTML = segment.text.replace(
                searchRegex,
                `<span class="highlight">${searchTerm}</span>`
            );
            
            // 結果列
            const resultCell = document.createElement('td');
            if (replaceTerm === '') {
                // 如果替換文字為空，顯示刪除效果
                resultCell.innerHTML = segment.text.replace(
                    searchRegex,
                    '<span style="color: #ff4444; text-decoration: line-through;">' + searchTerm + '</span>'
                );
            } else {
                // 如果有替換文字，顯示替換效果
                resultCell.innerHTML = segment.text.replace(
                    searchRegex,
                    '<span style="color: #22c55e;">' + replaceTerm + '</span>'
                );
            }
            
            // 狀態列
            const statusCell = document.createElement('td');
            if (searchTerm && segment.text.includes(searchTerm)) {
                const checkIcon = document.createElement('span');
                checkIcon.className = 'iconify';
                checkIcon.setAttribute('data-icon', 'mingcute:check-line');
                checkIcon.style.color = '#22c55e';
                statusCell.appendChild(checkIcon);
            }
            
            row.appendChild(timeCell);
            row.appendChild(originalCell);
            row.appendChild(resultCell);
            row.appendChild(statusCell);
            searchResults.appendChild(row);
        }
    });

    resultCount.textContent = count;
}

// 將查找替換相關的初始化代碼移到 DOMContentLoaded 事件中
document.addEventListener('DOMContentLoaded', () => {
    // 初始化選單
    initializeSelect();
    
    // 原有的初始化代碼...

    // 查找替換相關的變數和函數
    const findReplaceBtn = document.getElementById('findReplaceBtn');
    const findReplaceModal = document.getElementById('findReplaceModal');
    const searchInput = document.getElementById('searchInput');
    const replaceInput = document.getElementById('replaceInput');
    const searchResults = document.getElementById('searchResults');
    const resultCount = document.getElementById('resultCount');
    const replaceAllBtn = document.getElementById('replaceAllBtn');
    const closeBtn = document.querySelector('.close-btn');

    // 打開查找替換對話框
    findReplaceBtn.addEventListener('click', (e) => {
        e.preventDefault(); // 添加這行防止默認行為
        findReplaceModal.style.display = 'flex';
        searchInput.focus();
        updateSearchResults();
    });

    // 關閉對話框
    closeBtn.addEventListener('click', () => {
        findReplaceModal.style.display = 'none';
    });

    // 點擊對話框外部關
    findReplaceModal.addEventListener('click', (e) => {
        if (e.target === findReplaceModal) {
            findReplaceModal.style.display = 'none';
        }
    });

    // 清除按鈕功能
    document.querySelectorAll('.clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            input.value = '';
            input.focus();
            updateSearchResults();
        });
    });

    // 搜索輸入更新
    searchInput.addEventListener('input', updateSearchResults);
    replaceInput.addEventListener('input', updateSearchResults);

    // 替換按鈕功能
    replaceAllBtn.addEventListener('click', () => {
        const searchTerm = document.getElementById('searchInput').value;
        const replaceTerm = document.getElementById('replaceInput').value;

        if (!searchTerm) return;

        // 使用轉義後的搜索詞創建正則表達式
        const searchRegex = new RegExp(escapeRegExp(searchTerm), 'g');

        // 執行替換
        currentTranscriptData.segments = currentTranscriptData.segments.map(segment => ({
            ...segment,
            text: segment.text.replace(searchRegex, replaceTerm || '')
        }));

        // 更新顯示
        displayTranscript(currentTranscriptData);
        
        // 關閉模態框
        document.getElementById('findReplaceModal').style.display = 'none';
        
        // 清空輸入框
        document.getElementById('searchInput').value = '';
        document.getElementById('replaceInput').value = '';
        
        // 更新下載鏈接
        updateDownloadLink();
    });

    const generateSummaryBtn = document.getElementById('generateSummaryBtn');
    const summaryText = document.getElementById('summary-text');
    const summaryActions = document.querySelector('.summary-actions');
    const regenerateSummaryBtn = document.getElementById('regenerateSummaryBtn');
    const copySummaryBtn = document.getElementById('copySummaryBtn');

    // 生成摘要的函數
    async function generateSummaryContent() {
        if (!currentTranscriptData || !currentTranscriptData.segments) {
            alert('請先上傳並轉錄音頻文件');
            return;
        }

        try {
            generateSummaryBtn.disabled = true;
            generateSummaryBtn.innerHTML = '<span class="iconify" data-icon="mingcute:loading-line"></span> 正在生成摘要...';

            const transcriptText = currentTranscriptData.segments.map(segment => segment.text).join(' ');
            const summary = await generateSummary(transcriptText);
            
            summaryText.style.display = 'block';
            summaryText.innerHTML = summary.replace(/\n/g, '<br>');
            generateSummaryBtn.style.display = 'none';
            summaryActions.style.display = 'flex'; // 顯示操作按鈕
        } catch (error) {
            console.error('生成摘要時出錯:', error);
            alert('生成摘要失敗: ' + error.message);
            generateSummaryBtn.disabled = false;
            generateSummaryBtn.innerHTML = '<span class="iconify" data-icon="mingcute:magic-line"></span> 生成內容摘要';
        }
    }

    // 初始生成摘要
    generateSummaryBtn.addEventListener('click', generateSummaryContent);

    // 重新生成摘要
    regenerateSummaryBtn.addEventListener('click', async () => {
        summaryText.style.display = 'none';
        await generateSummaryContent();
    });

    // 複製摘要內容
    copySummaryBtn.addEventListener('click', async () => {
        try {
            const summaryContent = summaryText.innerText;
            await navigator.clipboard.writeText(summaryContent);
            
            // 顯示複製成功的視覺反饋
            const originalIcon = copySummaryBtn.innerHTML;
            copySummaryBtn.innerHTML = '<span class="iconify" data-icon="mingcute:check-line"></span>';
            copySummaryBtn.style.color = '#22c55e';
            
            setTimeout(() => {
                copySummaryBtn.innerHTML = originalIcon;
                copySummaryBtn.style.color = '';
            }, 2000);
        } catch (error) {
            console.error('複製失敗:', error);
            alert('複製失敗，請手動複製');
        }
    });
});

// 將 initializeSelect 函數移到外部
function initializeSelect() {
    const trigger = document.querySelector('.select-trigger');
    const content = document.querySelector('.select-content');
    const items = document.querySelectorAll('.select-item');
    const valueSpan = document.querySelector('.select-value');
    
    if (!trigger || !content || !items.length || !valueSpan) {
        console.warn('Select elements not found');
        return;
    }
    
    let currentValue = 'srt';

    // 設置初始狀態
    items.forEach(item => {
        const isSrt = item.dataset.value === 'srt';
        item.setAttribute('aria-selected', isSrt ? 'true' : 'false');
    });

    trigger.addEventListener('click', () => {
        const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', !isExpanded);
        content.hidden = isExpanded;
    });

    items.forEach(item => {
        item.addEventListener('click', () => {
            const value = item.dataset.value;
            currentValue = value;
            valueSpan.textContent = value;
            
            // 更新選中狀態
            items.forEach(i => {
                i.setAttribute('aria-selected', i === item);
            });
            
            // 關閉選單
            trigger.setAttribute('aria-expanded', 'false');
            content.hidden = true;
            
            // 更新轉錄顯示格式
            if (currentTranscriptData) {
                displayTranscript(currentTranscriptData);
            }
            
            // 更新下載鏈接
            updateDownloadLink();
        });
    });

    // 點擊外部關閉選單
    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !content.contains(e.target)) {
            trigger.setAttribute('aria-expanded', 'false');
            content.hidden = true;
        }
    });
}
