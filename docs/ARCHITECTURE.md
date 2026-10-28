# 第一階段架構與後續邊界

本專案採 Next.js App Router、React、TypeScript、原生 CSS 與 Lightweight Charts。前端與行情代理同一個專案，減少個人部署時需維護的服務。第一階段沒有使用者登入、跨裝置同步、FastAPI 或 PostgreSQL；持倉只在目前瀏覽器 localStorage，定期 JSON 備份很重要。

## 已實作的責任

- `src/lib/finance.ts`：純函式費稅、依序交易、加權成本、股利與風險情境計算。與 UI、行情、AI 分離，由單元測試驗證。
- `src/lib/market-types.ts`：行情與 OHLCV 共用契約；價格、來源、資料時間均必填。
- `src/lib/market.ts`：僅伺服器使用的官方來源適配層，來源失敗與快取有明確狀態。市場資料快取 15 分鐘，非即時串流。
- `src/lib/market-import.ts`：嚴格檢查使用者 CSV，來源一律標示使用者匯入，不混充官方資料。
- `src/app/api/market`、`api/history`：同源 API。秘密金鑰不可放進 client component。
- `src/components/stockpilot.tsx`：五個分頁、狀態與互動元件；卡片、表單及圖表分開處理。後續可再拆檔，先保持可追蹤的資料流。
- `public/sw.js`：只快取 App 殼與指紋靜態資源；API 不進 Service Worker 快取。報價快取由應用層保留原時間與來源。新版本需遞增 shell 版本。

## 後續階段（尚未實作）

1. **EntryExitEngine**：另建獨立純函式模組，輸入具時間與調整方式的歷史資料、策略參數；輸出 `觀望 / 資料不足 / 條件成立`、觸發依據、區間、失效條件與風險，不呼叫 AI 產生價格。先完成指標與無前視偏誤測試，再接 UI。
2. **ETF 與回測**：額外獨立的還原價、配息、成分、費用適配層。未還原 OHLCV 不得用來宣稱含息報酬，配息率不得當作總報酬。回測需處理存活者偏誤與交易成本。
3. **AI 報告**：只接收已驗證數值及時間戳的結構化上下文；無金鑰時保留規則式摘要。模型不得回填缺漏行情。
4. **同步與提醒**：需要登入後才能接 PostgreSQL；伺服器排程、Web Push 與 iOS 權限另行設計。現階段沒有背景監控或自動下單。

目前的「觀望」表示沒有完成策略判斷，不能解讀為已驗證的進出場訊號。
