import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'StockPilot TW 台股投資助手', short_name: 'StockPilot',
    description: '個人台股持倉、收盤行情與風險試算', lang: 'zh-TW',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f5f7fa', theme_color: '#236b59',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
