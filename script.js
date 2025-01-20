const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const API_KEY = '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';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const GEMINI_API_KEY = 'AIzaSyBsdjECXNEyrw5f_kZvDcvreizhV2SF1ik';
const LLAMA_MODEL = 'llama-3.1-8b-instant';

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

// 添加全局變數
let selectedFile = null;
let frequentWords = new Set();
let matrixRain = null;
let currentTranscriptData = null;

// 修改檔案處理函數
function handleDrop(e) {
    e.preventDefault();
    dropArea.classList.remove('highlight');
    const file = e.dataTransfer.files[0];
    if (!file) {
        alert('請選擇檔案');
        return;
    }
    
    if (checkFileSize(file) && checkFileType(file)) {
        selectedFile = file;
        showConfirmPage(file);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (checkFileSize(file) && checkFileType(file)) {
        selectedFile = file;
        showConfirmPage(file);
    }
}

// 顯示確認頁面
function showConfirmPage(file) {
    document.getElementById('upload-container').style.display = 'none';
    document.getElementById('confirm-container').style.display = 'block';
    document.querySelector('#selected-filename span').textContent = file.name;
    if (!matrixRain) {
        matrixRain = MatrixRain.init('confirm-container');
    }
}

// 高頻詞相關功能
document.addEventListener('DOMContentLoaded', () => {
    // 高頻詞添加按鈕
    document.getElementById('addWordsBtn').addEventListener('click', () => {
        document.getElementById('words-modal').style.display = 'flex';
    });

    // 高頻詞對話框關閉按鈕
    document.querySelectorAll('#words-modal .close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('words-modal').style.display = 'none';
        });
    });

    // 點擊對話框外部關閉
    document.getElementById('words-modal').addEventListener('click', (e) => {
        if (e.target.id === 'words-modal') {
            document.getElementById('words-modal').style.display = 'none';
        }
    });

    // 確認添加高頻詞
    document.getElementById('confirmWordsBtn').addEventListener('click', () => {
        const input = document.getElementById('wordsInput');
        const words = input.value.split(',').map(word => word.trim()).filter(word => word);
        
        words.forEach(word => {
            if (!frequentWords.has(word)) {
                frequentWords.add(word);
                addWordTag(word);
            }
        });
        
        input.value = '';
        document.getElementById('words-modal').style.display = 'none';
    });

    // 查找替換對話框關閉按鈕
    document.getElementById('findReplaceCloseBtn').addEventListener('click', () => {
        document.getElementById('findReplaceModal').style.display = 'none';
    });
});

// 添加高頻詞標籤
function addWordTag(word) {
    const wordsList = document.getElementById('words-list');
    const tag = document.createElement('div');
    tag.className = 'word-tag';
    tag.innerHTML = `
        <span class="word-text">${word}</span>
        <button class="remove-word" title="刪除">×</button>
    `;
    
    const removeBtn = tag.querySelector('.remove-word');
    removeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        frequentWords.delete(word);
        tag.remove();
    };
    
    wordsList.appendChild(tag);
}

// 返回上傳頁面
document.getElementById('backToUploadBtn').addEventListener('click', () => {
    document.getElementById('confirm-container').style.display = 'none';
    document.getElementById('upload-container').style.display = 'block';
    selectedFile = null;
    frequentWords.clear();
    document.getElementById('words-list').innerHTML = '';
});

// 開始轉換
document.getElementById('startConversionBtn').addEventListener('click', () => {
    if (selectedFile) {
        processAudioFile(selectedFile, Array.from(frequentWords));
    }
});

async function transcribeAudio(file, retryCount = 3, retryDelay = 5000) {
    for (let i = 0; i < retryCount; i++) {
        try {
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

            if (response.status === 429) {
                console.log(`API 請求過於頻繁，等待 ${retryDelay/1000} 秒後重試...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            if (!response.ok) {
                throw new Error(`轉錄失敗: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            if (i === retryCount - 1) {
                throw error;
            }
            console.log(`嘗試第 ${i + 1} 次失敗，等待後重試...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
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
                { 
                    role: 'system', 
                    content: `請幫我使用心智圖方式做摘要總結，以「數字」為各個主要主題，細項以「・」顯示，請以繁體中文回覆。

請務必使用 Markdown 語法來標示重點：
- 所有主要主題必須用粗體：**主題**
- 重要關鍵字或特別提到的字句必須用粗體：**關鍵字**
- 使用縮排來表示層級關係

輸出格式範例：

1. **中心主題**
   ・**重要關鍵字1**
   ・一般描述
      ・**特別強調的內容**
      ・一般子項目

2. **次要主題**
   ・**關鍵描述**
   ・一般描述
      ・**重點內容**

請確保所有主題和重要內容都使用 **粗體** 標記，以提高可讀性。` 
                },
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

// 修改 displayTranscript 函數
function displayTranscript(transcriptData) {
    if (!transcriptData || !transcriptData.segments) return;
    
    currentTranscriptData = transcriptData;  // 保存當前的轉錄數據
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

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '<span class="iconify" data-icon="mingcute:close-line"></span>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSegment(index);
        };

        timeAndTextDiv.appendChild(timeSpan);
        timeAndTextDiv.appendChild(textSpan);
        timeAndTextDiv.appendChild(deleteBtn);
        entry.appendChild(timeAndTextDiv);
        container.appendChild(entry);
    });
}

// 刪除字幕段落
function deleteSegment(index) {
    currentTranscriptData.segments.splice(index, 1);
    displayTranscript(currentTranscriptData);
    updateDownloadLink();
}

// 合併字幕段落
function mergeSegments(index1, index2) {
    const segment1 = currentTranscriptData.segments[index1];
    const segment2 = currentTranscriptData.segments[index2];
    
    if (!segment1 || !segment2) return;
    
    // 合併文字並更新結束時間
    segment1.text = segment1.text + ' ' + segment2.text;
    segment1.end = segment2.end;
    
    // 從數組中刪除第二個段落
    currentTranscriptData.segments.splice(index2, 1);
    
    // 更新顯示
    displayTranscript(currentTranscriptData);
    updateDownloadLink();
}

// 拆分字幕段落
function splitSegment(index, currentText, cursorPosition) {
    const segment = currentTranscriptData.segments[index];
    if (!segment) return;
    
    // 根據游標位置拆分文字
    const text1 = currentText.slice(0, cursorPosition).trim();
    const text2 = currentText.slice(cursorPosition).trim();
    
    // 計算新的時間點
    const totalDuration = segment.end - segment.start;
    const splitPoint = segment.start + (totalDuration * (cursorPosition / currentText.length));
    
    // 創建新段落
    const newSegment = {
        text: text2,
        start: splitPoint,
        end: segment.end
    };
    
    // 更新原始段落
    segment.text = text1;
    segment.end = splitPoint;
    
    // 插入新段落到原始段落之後
    currentTranscriptData.segments.splice(index + 1, 0, newSegment);
    
    // 更新顯示
    displayTranscript(currentTranscriptData);
    updateDownloadLink();
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
    
    let isFirstEnter = true;
    let originalText = element.textContent;
    let isModified = false;
    let parentNode = element.parentNode;
    let isProcessing = false;
    
    input.onblur = () => {
        if (!isProcessing) {
            saveEdit(input, element, index);
        }
    };
    
    input.oninput = () => {
        isModified = input.value !== originalText;
    };
    
    input.onkeydown = (e) => {
        const cursorPosition = input.selectionStart;
        const isAtStart = cursorPosition === 0;
        const isAtEnd = cursorPosition === input.value.length;
        const isInMiddle = !isAtStart && !isAtEnd;
        
        if (e.key === 'Enter') {
            e.preventDefault();
            isProcessing = true;
            
            if (isModified) {
                if (isFirstEnter) {
                    isFirstEnter = false;
                    // 只保存編輯，不重新創建輸入框
                    currentTranscriptData.segments[index].text = input.value.trim();
                    // 保持輸入框的焦點和游標位置
                    input.selectionStart = cursorPosition;
                    input.selectionEnd = cursorPosition;
                    input.focus();
                } else {
                    if (isAtStart || isAtEnd) {
                        input.blur();
                    } else if (isInMiddle) {
                        // 先保存當前編輯的內容
                        saveEdit(input, element, index);
                        // 然後使用保存後的內容進行拆分
                        const currentText = currentTranscriptData.segments[index].text;
                        // 執行拆分
                        splitSegment(index, currentText, cursorPosition);
                    }
                }
            } else {
                if (isAtStart || isAtEnd) {
                    input.blur();
                } else if (isInMiddle) {
                    // 直接使用當前文字進行拆分
                    const currentText = input.value;
                    // 執行拆分
                    splitSegment(index, currentText, cursorPosition);
                }
            }
            isProcessing = false;
        } else if (e.key === 'Backspace') {
            if (isAtStart && index > 0) {
                e.preventDefault();
                isProcessing = true;
                // 執行合併
                mergeSegments(index - 1, index);
                isProcessing = false;
            }
        } else if (e.key === 'Escape') {
            isProcessing = true;
            element.textContent = originalText;
            if (input.parentNode) {
                input.parentNode.replaceChild(element, input);
            }
            isProcessing = false;
        }
    };
    
    parentNode.replaceChild(input, element);
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
}

// 保存編輯
function saveEdit(input, originalElement, index) {
    const newText = input.value.trim();
    
    // 更新數據
    currentTranscriptData.segments[index].text = newText;
    
    // 只有當輸入框還在 DOM 中時才進行替換
    if (input.parentNode) {
        originalElement.textContent = newText;
        input.parentNode.replaceChild(originalElement, input);
    }
    
    // 更新下載鏈接
    updateDownloadLink();
}

// 修改 updateDownloadLink 函數
function updateDownloadLink() {
    const downloadLink = document.getElementById('downloadLink');
    const filenameDisplay = document.getElementById('filename-display');
    const currentValue = document.querySelector('.select-value')?.textContent || 'srt';
    const filename = filenameDisplay.textContent || 'transcript';
    
    let content = '';
    let extension = '';
    
    if (currentValue === 'srt') {
        content = currentTranscriptData.segments.map((segment, index) => {
            return `${index + 1}\n${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}\n${segment.text}\n`;
        }).join('\n');
        extension = 'srt';
    } else {
        content = currentTranscriptData.segments.map(segment => segment.text).join('\n');
        extension = 'txt';
    }
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    downloadLink.href = url;
    downloadLink.download = `${filename}.${extension}`;
    
    // 清理之前的 URL
    const oldUrl = downloadLink.dataset.url;
    if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
    }
    downloadLink.dataset.url = url;
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
    
    // 隱藏結果和處理容器
    resultContainer.style.display = 'none';
    processingContainer.style.display = 'none';
    
    // 顯示上傳容器
    uploadContainer.style.display = 'block';
    
    // 初始化數字雨效果
    if (!matrixRain) {
        matrixRain = MatrixRain.init('upload-container');
    }
    
    // 清空之前的結果
    summaryText.textContent = '';
    summaryText.style.display = 'none';  // 隱藏摘要文字區域
    transcriptText.textContent = '';
    
    // 重置文件輸入
    fileInput.value = '';
    
    // 重置生成摘要按鈕和操作按鈕
    const generateSummaryBtn = document.getElementById('generateSummaryBtn');
    const summaryActions = document.querySelector('.summary-actions');
    
    if (generateSummaryBtn) {
        generateSummaryBtn.style.display = 'flex';  // 顯示生成摘要按鈕
        generateSummaryBtn.disabled = false;  // 啟用按鈕
        generateSummaryBtn.innerHTML = '<span class="iconify" data-icon="mingcute:magic-line"></span> 生成內容摘要';
    }
    
    if (summaryActions) {
        summaryActions.style.display = 'none';  // 隱藏操作按鈕
    }
    
    // 重置全局變數
    currentTranscriptData = null;
});

// 修改 extractAudio 函數
async function extractAudio(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // 在用戶操作後創建 AudioContext
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
                reject(new Error('轉換 MP3 失敗'));
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
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
        alert('文件大小不能超過 500MB');
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
        alert('不支援的文格式。\n支的格式：MP4, MOV, WebM, MKV, MP3, WAV, OGG, AAC, M4A, FLAC, WMA');
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
    
    // ... rest of the existing initialization code ...

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
            
            // 使用新的顯示函數
            displaySummary(summary);
            
            generateSummaryBtn.style.display = 'none';
            summaryActions.style.display = 'flex';
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

// 修改 initializeSelect 函數
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
            
            // 使用當前的 currentTranscriptData 重新顯示轉錄內容
            if (currentTranscriptData) {
                displayTranscript(currentTranscriptData);
            }
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

// 添加音頻分割函數
async function splitAudioBuffer(audioBuffer) {
    const chunkDuration = 30 * 60; // 30分鐘
    const sampleRate = audioBuffer.sampleRate;
    const samplesPerChunk = chunkDuration * sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const chunks = [];

    for (let offset = 0; offset < audioBuffer.length; offset += samplesPerChunk) {
        const chunkLength = Math.min(samplesPerChunk, audioBuffer.length - offset);
        const chunk = new AudioBuffer({
            length: chunkLength,
            numberOfChannels,
            sampleRate
        });

        for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            const chunkData = channelData.slice(offset, offset + chunkLength);
            chunk.copyToChannel(chunkData, channel);
        }

        chunks.push(chunk);
    }

    return chunks;
}

// 添加檢查文字長度並更新摘要按鈕的函數
function checkAndUpdateSummaryButton(transcriptData) {
    const summaryContainer = document.getElementById('summary-container');
    const generateSummaryBtn = document.getElementById('generateSummaryBtn');
    
    // 計算總字元數
    const totalText = transcriptData.segments.map(segment => segment.text).join('');
    const charCount = totalText.length;
    
    if (charCount > 20000) {
        // 移除生成摘要按鈕
        if (generateSummaryBtn) {
            generateSummaryBtn.remove();
        }
        
        // 創建提示文字
        const warningText = document.createElement('div');
        warningText.className = 'summary-warning';
        warningText.textContent = '內容超過20,000字元，請轉至ChatGPT生成摘要。';
        warningText.style.cssText = `
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-top: calc(50vh - 65px - 35px/2);
            white-space: nowrap;
        `;
        
        // 插入提示文字
        summaryContainer.appendChild(warningText);
    }
}

// 在生成摘要的函數中添加 Markdown 轉換
function displaySummary(summaryText) {
    const summaryContainer = document.getElementById('summary-text');
    
    // 將 Markdown 的粗體語法轉換為 HTML
    const htmlContent = summaryText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    
    summaryContainer.innerHTML = htmlContent;
    summaryContainer.style.display = 'block';
}

// 修改高頻詞修正函數
async function correctFrequentWords(text, frequentWords) {
    // 添加詳細的日誌
    console.log('開始處理高頻詞修正：', { text, frequentWords });

    // 改進空值檢查
    if (!frequentWords || !Array.isArray(frequentWords) || frequentWords.length === 0) {
        console.log('沒有高頻詞需要處理，返回原文');
        return text;
    }

    try {
        // 預處理文本，移除多餘的空行
        const cleanText = text.trim().replace(/\n+/g, '\n');
        
        // 計算每個高頻詞在原文中出現的次數
        const originalWordCounts = {};
        frequentWords.forEach(word => {
            const regex = new RegExp(word, 'g');
            const matches = cleanText.match(regex) || [];
            originalWordCounts[word] = matches.length;
            // 如果沒有找到完全匹配，設置為至少需要替換一次
            if (matches.length === 0) {
                originalWordCounts[word] = 1;
            }
        });
        console.log('原文中高頻詞出現次數（包含必需替換）：', originalWordCounts);
        
        console.log('準備調用 API 進行高頻詞修正');
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: LLAMA_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: `你是一個專門處理高頻詞修正的助手。

需求：
- 將文檔中出現的高頻詞（包括錯別字、同音錯字或類似詞）進行批量更改
- 每個提供的高頻詞都必須在文本中至少被替換一次
- 即使找不到完全匹配的詞，也要尋找相似或相關的詞進行替換
- 支援同音字、近似拼音、相似詞義的匹配
- 返回更改後的文檔，確認每個高頻詞均已正確更新
- 保持原文的換行格式，不要添加或刪除任何空行
- 不要在回應中包含任何說明或解釋文字

高頻詞替換規則：
1. 完全匹配：優先替換完全相同的詞
2. 同音字匹配：尋找發音相同或相似的詞
3. 相似詞匹配：尋找意思相近或相關的詞
4. 詞義延伸：如果找不到直接對應，尋找上下文相關的詞進行替換
5. 必要時可以調整句子結構，確保每個高頻詞都能被合理替換

執行步驟：
1. 分析文本：
   - 識別所有可能的替換位置
   - 包括完全匹配、同音字、相似詞
   - 確保每個高頻詞都能找到至少一個替換位置

2. 替換操作：
   - 對每個高頻詞進行至少一次替換
   - 優先選擇最合適的替換位置
   - 必要時調整句子以容納替換詞
   - 確保替換後的文本通順合理

3. 檢查與驗證：
   - 確認每個高頻詞都已被替換至少一次
   - 保持文本的整體連貫性
   - 維持原有的換行格式`
                    },
                    {
                        role: 'user',
                        content: `高頻詞列表（每個詞都必須至少替換一次）：${frequentWords.join('、')}

需要修正的文本：
${cleanText}

請嚴格執行以下要求：
1. 列表中的每個高頻詞都必須在文本中至少出現一次
2. 即使找不到完全匹配的詞，也要想辦法找到相似或相關的詞進行替換
3. 可以適當調整句子結構，但要確保文意通順
4. 如果實在找不到合適的替換位置，可以在適當位置添加新的描述來包含高頻詞
5. 保持原有的換行格式
6. 直接返回修正後的文本，不要包含任何解釋或說明`
                    }
                ],
                temperature: 0.3  // 增加一點創造性，以便找到更多可能的替換
            })
        });

        console.log('API 響應狀態：', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API 調用失敗:', errorText);
            return text;
        }

        const data = await response.json();
        console.log('API 返回數據：', data);
        
        if (!data.choices?.[0]?.message?.content) {
            console.error('無效的 API 回應格式:', data);
            return text;
        }

        // 清理 API 返回的文本
        let correctedText = data.choices[0].message.content
            .trim()  // 移除前後空白
            .replace(/\n{2,}/g, '\n')  // 將多個換行符替換為單個換行符
            .replace(/^\n+|\n+$/g, ''); // 移除開頭和結尾的換行符
            
        console.log('修正後的文本：', correctedText);
        
        // 檢查修正後的高頻詞數量
        let correctedWordCounts = {};
        let retryCount = 0;
        const maxRetries = 3;

        do {
            correctedWordCounts = {};
            frequentWords.forEach(word => {
                const regex = new RegExp(word, 'g');
                const matches = correctedText.match(regex) || [];
                correctedWordCounts[word] = matches.length;
            });
            console.log(`第 ${retryCount + 1} 次檢查，修正後高頻詞出現次數：`, correctedWordCounts);

            // 檢查是否所有高頻詞都至少出現一次
            let allWordsPresent = true;
            for (const word of frequentWords) {
                if (correctedWordCounts[word] < originalWordCounts[word]) {
                    console.error(`高頻詞 "${word}" 替換不完整，需要 ${originalWordCounts[word]} 次，目前只有 ${correctedWordCounts[word]} 次`);
                    allWordsPresent = false;
                }
            }

            if (allWordsPresent) {
                break;
            }

            if (retryCount < maxRetries) {
                console.log(`第 ${retryCount + 1} 次重試中...`);
                const retryResponse = await correctFrequentWords(text, frequentWords);
                if (retryResponse !== text) {
                    correctedText = retryResponse;
                }
            }

            retryCount++;
        } while (retryCount < maxRetries);

        // 分別檢查每一行
        const originalLines = cleanText.split('\n');
        const correctedLines = correctedText.split('\n');

        // 檢查行數是否相同
        if (originalLines.length !== correctedLines.length) {
            console.error('修正後的行數與原文不符，嘗試修復', {
                original: originalLines.length,
                corrected: correctedLines.length
            });
            // 如果行數不同，使用原始行數
            correctedText = correctedLines.slice(0, originalLines.length).join('\n');
        }

        console.log('高頻詞修正完成');
        return correctedText;
    } catch (error) {
        console.error('文字修正過程出錯:', error);
        return text;
    }
}

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
async function processAudioFile(file, frequentWords = []) {
    document.getElementById('confirm-container').style.display = 'none';
    processingContainer.style.display = 'block';
    if (!matrixRain) {
        matrixRain = MatrixRain.init('processing-container');
    }

    try {
        // 設置初始檔案名稱
        setInitialFilename(file);
        
        let audioFile = file;
        let allTranscriptionData = { segments: [] };
        let timeOffset = 0;
        
        if (file.type.startsWith('video/')) {
            updateProgress(0, '正在從影片中提取音頻...');
            const audioBuffer = await extractAudio(file);
            updateProgress(20, '正在分割音頻...');
            
            const chunks = await splitAudioBuffer(audioBuffer);
            let totalProgress = 20;
            const progressPerChunk = 70 / chunks.length;
            
            for (let i = 0; i < chunks.length; i++) {
                updateProgress(totalProgress, `正在處理第 ${i + 1}/${chunks.length} 段音頻...`);
                const mp3Blob = await convertToMp3(chunks[i]);
                const chunkFile = new File([mp3Blob], `chunk_${i}.mp3`, { type: 'audio/mp3' });
                
                if (i > 0) {
                    updateProgress(totalProgress, `等待 API 冷卻中...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                const transcriptionData = await transcribeAudio(chunkFile);
                allTranscriptionData.segments.push(...transcriptionData.segments);
                timeOffset += 1800;
                totalProgress += progressPerChunk;
            }
        } else {
            // 處理音頻文件的邏輯相似，只是不需要提取音頻步驟
            const audioBuffer = await extractAudio(file);
            const chunks = await splitAudioBuffer(audioBuffer);
            let totalProgress = 20;
            const progressPerChunk = 70 / chunks.length;
            
            for (let i = 0; i < chunks.length; i++) {
                updateProgress(totalProgress, `正在處理第 ${i + 1}/${chunks.length} 段音頻...`);
                const mp3Blob = await convertToMp3(chunks[i]);
                const chunkFile = new File([mp3Blob], `chunk_${i}.mp3`, { type: 'audio/mp3' });
                
                if (i > 0) {
                    updateProgress(totalProgress, `等待 API 冷卻中...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                const transcriptionData = await transcribeAudio(chunkFile);
                allTranscriptionData.segments.push(...transcriptionData.segments);
                timeOffset += 1800;
                totalProgress += progressPerChunk;
            }
        }

        // 確保時間戳按順序排序
        allTranscriptionData.segments.sort((a, b) => a.start - b.start);

        // 轉換為繁體中文
        allTranscriptionData.segments = await Promise.all(
            allTranscriptionData.segments.map(async (segment) => {
                segment.text = await converter(segment.text);
                return segment;
            })
        );

        // 一次性處理所有文字的高頻詞修正
        if (frequentWords && frequentWords.length > 0) {
            updateProgress(90, '正在進行高頻詞修正...');
            const allText = allTranscriptionData.segments.map(segment => segment.text).join('\n');
            const correctedText = await correctFrequentWords(allText, frequentWords);
            const correctedLines = correctedText.split('\n');
            
            // 確保每個段落都有對應的文字
            allTranscriptionData.segments = allTranscriptionData.segments.map((segment, index) => ({
                ...segment,
                text: index < correctedLines.length ? correctedLines[index] : segment.text
            }));
        }

        displayTranscript(allTranscriptionData);
        checkAndUpdateSummaryButton(allTranscriptionData);

        updateProgress(100, '處理完成！');
        setTimeout(() => {
            processingContainer.style.display = 'none';
            resultContainer.style.display = 'block';
            // 移除數字雨效果
            if (matrixRain) {
                matrixRain.canvas.remove();
                matrixRain = null;
            }
        }, 500);

        updateDownloadLink();
    } catch (error) {
        console.error('處理文件時出錯:', error);
        alert('處理文件時出錯: ' + error.message);
        document.getElementById('confirm-container').style.display = 'block';
        processingContainer.style.display = 'none';
    }
}

// 在文件加載完成後初始化數字雨效果
document.addEventListener('DOMContentLoaded', () => {
    // 初始化數字雨效果
    matrixRain = MatrixRain.init('upload-container');
    
    // ... rest of the existing initialization code ...
});

// 新增：初始化檔案名稱編輯功能
function setupFilenameEditing() {
    const filenameContainer = document.querySelector('.filename-container');
    const filenameDisplay = document.getElementById('filename-display');
    const filenameInput = document.getElementById('filename-input');
    
    if (!filenameContainer || !filenameDisplay || !filenameInput) {
        console.warn('找不到檔案名稱編輯所需的元素');
        return;
    }

    let isEditing = false;
    
    // 點擊顯示區域時啟用編輯
    filenameDisplay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (isEditing) return;
        isEditing = true;
        
        const currentText = filenameDisplay.textContent;
        
        // 設置輸入框的樣式以匹配顯示元素
        filenameInput.style.width = (filenameDisplay.offsetWidth + 20) + 'px';
        filenameInput.value = currentText;
        
        // 顯示輸入框
        filenameInput.style.display = 'inline-block';
        filenameInput.style.position = 'absolute';
        filenameInput.style.left = '0';
        filenameInput.style.top = '0';
        
        // 保持顯示元素可見，但透明
        filenameDisplay.style.opacity = '0';
        
        requestAnimationFrame(() => {
            filenameInput.focus();
            filenameInput.select();
        });
    });
    
    // 處理輸入完成
    filenameInput.addEventListener('blur', () => {
        if (!isEditing) return;
        
        const newValue = filenameInput.value.trim();
        
        if (newValue) {
            filenameDisplay.textContent = newValue;
            updateDownloadLink();
        }
        
        // 恢復顯示
        filenameInput.style.display = 'none';
        filenameDisplay.style.opacity = '1';
        isEditing = false;
    });
    
    // 處理按下 Enter 鍵
    filenameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            filenameInput.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            filenameInput.value = filenameDisplay.textContent;
            filenameInput.blur();
        }
    });
    
    // 處理點擊其他地方
    document.addEventListener('click', (e) => {
        if (!filenameContainer.contains(e.target) && isEditing) {
            filenameInput.blur();
        }
    });
    
    // 即時更新顯示
    filenameInput.addEventListener('input', () => {
        filenameDisplay.textContent = filenameInput.value;
    });
}

// 修改 setInitialFilename 函數
function setInitialFilename(file) {
    const filenameDisplay = document.getElementById('filename-display');
    if (filenameDisplay && file) {
        const filename = file.name.replace(/\.[^/.]+$/, ''); // 移除副檔名
        filenameDisplay.textContent = filename;
        setupFilenameEditing();
        // 只在有轉錄數據時更新下載連結
        if (currentTranscriptData) {
            updateDownloadLink();
        }
    }
}
