import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaRegister from '@/components/pwa-register';
export const metadata: Metadata = {
  title: 'StockPilot TW｜投資，心中有數',
  description: '個人台股投資工具：官方收盤行情、持倉損益與風險試算。',
  applicationName: 'StockPilot TW',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'StockPilot', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' }
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f5f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#101821' }]
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hant"><body>{children}<PwaRegister /></body></html>;
}
