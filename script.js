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
    if (file && file.type.startsWith('audio/')) {
        processAudioFile(file);
    } else {
        alert('請上傳音訊檔案');
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
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

function displayTranscript(transcript) {
    const transcriptContainer = document.getElementById('transcript-text');
    const formatSelect = document.getElementById('format-select');

    function updateTranscriptDisplay() {
        const selectedFormat = formatSelect.value;
        let formattedTranscript = '';

        if (selectedFormat === 'srt') {
            formattedTranscript = convertToSRT(transcript);
        } else if (selectedFormat === 'txt') {
            formattedTranscript = convertToTXT(transcript);
        } else {
            formattedTranscript = formatJSONTranscript(transcript);
        }

        transcriptContainer.innerHTML = `<pre>${formattedTranscript}</pre>`;
        updateDownloadLink();
    }

    formatSelect.addEventListener('change', updateTranscriptDisplay);

    updateTranscriptDisplay();
}

function formatJSONTranscript(transcript) {
    return transcript.segments.map(segment => {
        const startTime = formatTime(segment.start);
        return `${startTime}\n${segment.text}\n`;
    }).join('\n');
}

function convertToSRT(transcript) {
    return transcript.segments.map((segment, index) => {
        const startTime = formatSRTTime(segment.start);
        const endTime = formatSRTTime(segment.end);
        return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n`;
    }).join('\n');
}

function convertToTXT(transcript) {
    return transcript.segments.map(segment => segment.text).join('\n');
}

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${secs}s`;
}

function formatSRTTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${secs},${ms}`;
}

function updateDownloadLink() {
    const format = formatSelect.value;
    const content = transcriptText.textContent;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = `transcript.${format}`;
}

async function updateTranscript(transcript) {
    // 假設 transcript 是一個包含轉錄文字的數組
    const convertedTranscript = await Promise.all(transcript.map(async (item) => {
        item.text = await converter(item.text);
        return item;
    }));

    // 更新 DOM
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

async function processAudioFile(file) {
    uploadContainer.style.display = 'none';
    processingContainer.style.display = 'block';

    try {
        const transcriptionData = await transcribeAudio(file);
        const transcriptText = transcriptionData.segments.map(segment => segment.text).join(' ');
        const traditionalText = await converter(transcriptText); // 使用 converter 轉換
        const summary = await generateSummary(traditionalText);

        // 修改這裡來更好地呈現心智圖筆記式摘要
        const summaryContainer = document.getElementById('summary-text');
        summaryContainer.innerHTML = summary.replace(/\n/g, '<br>');

        // 轉換轉錄文本為繁體中文
        transcriptionData.segments = await Promise.all(transcriptionData.segments.map(async (segment) => {
            segment.text = await converter(segment.text);
            return segment;
        }));

        displayTranscript(transcriptionData);

        uploadContainer.style.display = 'none';
        processingContainer.style.display = 'none';
        resultContainer.style.display = 'block';

        updateDownloadLink();
    } catch (error) {
        console.error('處理音頻文件時出錯:', error);
        alert('處理音頻文件時出錯: ' + error.message);
        uploadContainer.style.display = 'block';
        processingContainer.style.display = 'none';
    }
}
