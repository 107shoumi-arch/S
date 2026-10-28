# 部署與取得 iPhone 網址

本文件提供部署設定與操作步驟，不代表專案已上線。iPhone 必須使用自己實際部署後取得的網址；雲端開發環境的 localhost 無法直接由手機開啟。

## 建議方案：Vercel

第一階段使用 Next.js 伺服器路由查詢官方資料，本機保存個人持倉，不需要先建立 PostgreSQL。請使用可執行伺服器路由的部署方式；GitHub Pages 等純靜態網站無法直接執行本專案的市場 API。

1. 本專案的 GitHub 儲存庫是 [107shoumi-arch/S](https://github.com/107shoumi-arch/S)。使用已推送至 `main` 的完整專案，不要只上傳單一 HTML 檔。
2. 登入 [Vercel 新增專案](https://vercel.com/new)，連接自己的 GitHub，選 **Import Git Repository**，找到 `107shoumi-arch/S` 並按 Import。若看不到，從 GitHub App 權限允許 Vercel 存取這個儲存庫，無須在聊天中提供金鑰。
3. Framework 選 **Next.js**；**Root Directory 保持儲存庫根目錄（不要填 S 或 src）**。Node.js 選 **24.x**，Production Branch 使用 **main**。
4. 安裝指令使用 `npm ci`；建置指令使用 `npm run build`；輸出目錄由 Next.js 預設處理。
5. 本階段不需要 AI 金鑰、FinMind token 或資料庫密碼。不要把個人持倉檔或任何憑證放進公開儲存庫。
6. 執行 Deploy。成功後，在 Vercel 專案頁按 Visit，複製**實際顯示的 HTTPS 網址**。
7. 用電腦先確認「搜尋」及行情日期，再用 iPhone Safari 開啟同一網址，依 README 加入主畫面。
8. 按 [驗收清單](ACCEPTANCE.md) 檢查持倉、費用設定、備份、圖表及離線行為。

儲存庫的 `vercel.json` 已指定 Next.js、鎖檔安裝及建置命令，不需設定靜態輸出目錄，也不需輸入任何 API 金鑰。Vercel 會自動提供 HTTPS；實際網址只能在部署成功後從專案頁取得，本文件沒有宣稱網站已部署。

部署後先檢查：首頁可以操作；自選能搜尋 `2330` 和 `0050` 並顯示正確來源／日期；官方來源無法取得時仍明確顯示錯誤；新增一筆自己的交易後重新開啟仍在。再用 Safari 加入主畫面，檢查鍵盤、旋轉、安全區域與離線重開。如果市場 API 沒有真實資料，勿只因首頁能開啟就認定行情驗證成功。

Vercel 方案的費用與使用限制以當時官網及帳號方案為準；個人使用可先核對免費方案，無需為本專案購買付費行情。超出免費主機配額時，應先降低刷新頻率或改用自己的 Node.js 主機，再決定是否付費。伺服器快取在無伺服器平台可能隨執行個體重建而消失，不能將其當成備份。

## 自有主機：Docker

儲存庫提供多階段 Dockerfile，使用 Next.js standalone 輸出。先在專案根目錄執行：

```bash
docker build -t stockpilot-tw .
docker run --rm --name stockpilot-tw -p 3000:3000 stockpilot-tw
```

這只會啟動 HTTP 服務。正式提供 iPhone 使用前，還需要：

1. 將容器放在自己的伺服器上，確保 3000 埠僅暴露給反向代理。
2. 設定自己的網域與 DNS。
3. 使用主機平台提供的 HTTPS，或透過 Caddy／Nginx 加可信任的 TLS 憑證。
4. 從外部裝置實際開啟 HTTPS 網址，再測試官方 API 連線與 PWA 安裝。

未部署到公開主機前，不會憑空產生可供 iPhone 開啟的網址。Docker 建置及部署需要 Docker daemon；安裝檔存在不等於容器已成功建置或已上線。

## 連線需求

伺服器須能透過 HTTPS 存取下列資料來源；應保留 TLS 驗證：

- `openapi.twse.com.tw`
- `www.twse.com.tw`
- `www.tpex.org.tw`

FinMind 為後續適配來源，若未使用不需要 token 或額外設定。套件安裝另需 npm registry 等正常套件來源。

若雲端環境回報官方網域被網路政策阻擋，請在環境設定檢視已保存的允許網域、保存並發布環境，再重試。保存設定草稿不會立即變更目前執行中的網路。不要停用 HTTPS 驗證、使用未知鏡像或將模擬報價改標為正式行情。

若部署平台可連線但來源回傳錯誤，先查閱伺服器日誌及 [資料來源說明](DATA-SOURCES.md)，確認實際來源回應、資料日期及欄位格式。行情不可用時保留清楚的錯誤提示，使用者可採有日期標記的手動價格做試算。

## 上線後維護

- 每次改版先執行單元測試、建置及手機瀏覽器測試，再部署。
- 更新可能使 PWA 需要重新開啟；驗證新版本後再清理舊快取。
- App 網址改變時，本機持倉不會自動搬移：先匯出舊網址資料，再到新網址匯入。
- 持倉不在伺服器資料庫，重新部署不會替使用者備份。務必定期匯出。
- 第一階段沒有背景行情監控與推播；關閉 App 不會持續分析或發送交易提醒。
