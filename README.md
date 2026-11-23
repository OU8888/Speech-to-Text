# 語音轉文字工具 (Speech To Text)

純前端的語音轉文字與字幕編輯頁面，可直接放在 GitHub Pages。

## 功能
- **上傳**：點擊或拖曳音訊／影片（MP4, MOV, WebM, MKV, MP3, WAV, OGG, AAC, M4A, FLAC, WMA，最大 500MB）。
- **辨識**：Groq Whisper large-v3-turbo，73 種語言與自動偵測；中文會簡轉繁。
- **字幕格式**：遇到逗點、句號等標點就換行，中文每行最多 16 字，最後移除所有標點；頭尾自動貼齊實際有聲音的地方。
- **專屬詞庫**：常用詞會提示給模型並修正同音錯字；修正規則在辨識後自動套用。改字或查找取代後，下方會詢問是否加入詞庫。存在瀏覽器，可匯出／匯入。
- **AI 校對**：列出疑似錯字，逐條決定接受或略過。
- **編輯**：點文字直接改；按住 Option(Alt) 顯示拆點與合併鈕；B 在播放位置切句；全部可復原。
- **波形區**：
  - 拖字幕塊的頭尾調時間、拖中間移動整句；空白處拖曳拉出新字幕。
  - 按住 Option 拖兩句的交界，同時改兩句；按住 Shift 拖曳，後面所有字幕一起平移。
  - 標記點（M）與磁力吸附（N）。
- **摘要**：重點與時間軸，點時間跳到該句。
- **匯出**：SRT、VTT、TXT、JSON、Word。
- **繼續上次**：逐字稿與音檔自動存在瀏覽器，重新整理後可接著改。

## 快捷鍵
在結果頁按 `?` 可看完整列表。

## 設定
`script.js` 最上方的 `CONFIG`：模型、分段長度、同時辨識段數、API 位置。

## 金鑰
目前金鑰寫在 `script.js` 裡，只是 base64 編碼，等於公開。要藏到伺服器端請照 `worker/proxy.js` 開頭的步驟部署 Cloudflare Worker。

## 測試
斷句與去標點的規則有自動測試，調整規則後請執行：

```bash
node tests/segment.test.mjs
```

## 檔案
- `index.html`、`styles.css`、`script.js`、`matrixRain.js`：網站本體
- `INVASION2000.TTF`：標題字型
- `worker/proxy.js`：備用的 Cloudflare Worker
- `tests/segment.test.mjs`：斷句規則的測試
