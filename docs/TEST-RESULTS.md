# 第一階段實際驗證紀錄

驗證日期：2026-10-28。此紀錄描述本次雲端執行結果，不代表已公開部署或完成真實 iPhone 驗收。

## 已完成

- Node.js 24.19.0、npm 11.9.0；從 lockfile 執行 `npm ci --no-audit --no-fund` 成功。
- `npm run build` 成功，保留 TypeScript 檢查；`npm run typecheck` 成功。
- `npm run start` 實際啟動 Next standalone，首頁、manifest 與 API 可請求。
- `npm test`：37 項通過、無跳過。21 項財務測試，16 項行情解析／匯入測試。
- `npm run test:e2e`：26 項通過、無跳過。正式建置後執行，使用環境既有 Chromium；本輪新增逐頁 UI/UX、對比、觸控區、鍵盤視窗、快取狀態與首次 PWA 安裝回歸。
- 375、390、393、430、440 CSS px 五種寬度皆走訪五個分頁，檢查水平溢出、內容與導覽尺寸；另測橫向、高字級、長名稱及大額負數。
- 實際操作測試涵蓋手動帶日期行情、買入、減碼、股利、損益即算、超賣拒絕、重新開啟保留資料、歷史費率快照、備份及 CSV 驗證、損壞儲存資料不覆寫、微小風險預算、圖表縮放、週月切換、主題及行情更新不移動捲動位置。
- PWA manifest、PNG 圖示、Service Worker、離線重新載入及離線導覽通過；確認市場 API 未進入 Service Worker 快取。
- 已人工檢視 430px 的實際啟動畫面、五個主要頁面的淺／深色截圖及縮小視窗對話框，詳見 [UI/UX 品質紀錄](UI-UX-AUDIT.md)。

## 未完成／受外部條件阻擋

- **真實官方行情整合成功尚未驗證。** 上游 TWSE 請求被雲端 HTTPS 代理 CONNECT 403 阻擋；目前實際 `/api/market` 是 HTTP 200、`quotes: []` 與錯誤訊息。HTTP 200 不代表有行情。官方文件、最新授權與實際欄位仍須在放行後核對。
- 沒有部署至公開主機，沒有可供手機開啟的 HTTPS 網址。Vercel 與 Docker 設定／操作文件已準備，Docker 映像未建置驗證。
- 雲端 `install_script`、`start_skill` 及三個官方網域已存入設定草稿；儲存不等於套用／發布或新任務恢復成功。

## 尚未驗證

- 真實 iPhone 15 Pro Max Safari、實機鍵盤、安全區域、主畫面安裝／升級與旋轉；也未執行 WebKit。Chromium 手機模擬不等於 Safari。
- 最新法規／稅務資格與實際券商成交對帳單逐筆核對。測試確認的是已明示的計算模型，不是券商結算認證。
- 跨裝置同步、正式流量、上游限流與部署後可用性；第一階段沒有雲端持倉資料庫。

## 截圖解讀

- `screenshots/iphone-430-actual.png`：本次正式伺服器實際啟動畫面，無 API 攔截，顯示來源不可用。視窗 CSS 430×932，DPR 3，因此 PNG 為 1290×2796。
- `iphone-430-overview.png`、`iphone-430-analysis.png`、`iphone-430-dark.png`：自動測試專用合成資料的完整頁面截圖，用來檢查數值、長名稱與 K 線排版。**不是本次取得的真實市場行情。** 合成資料只存在測試檔，不會由正式行情介面輸出。
- `audit-430-{overview,watchlist,analysis,portfolio,settings}-{light,dark}.png`：本輪五頁各兩種模式的 430×932 CSS px 視窗截圖；同名 `-full.png` 是完整捲動內容診斷圖。`audit-430-keyboard-viewport.png` 是縮至 430×500 的視窗測試，不是實體鍵盤。

依 [部署文件](DEPLOYMENT.md) 取得 HTTPS 網址後，再完成 [真機驗收清單](ACCEPTANCE.md)。
