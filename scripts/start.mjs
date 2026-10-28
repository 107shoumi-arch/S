import { cp, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const standalone = path.join(root, '.next/standalone');
try {
  await access(path.join(standalone, 'server.js'));
} catch {
  console.error('尚未建置 StockPilot TW，請先執行 npm run build。');
  process.exit(1);
}
// Next's standalone output intentionally omits these assets. Retain one tested
// start command for Windows/macOS/Linux without shell-specific copy commands.
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
await cp(path.join(root, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
process.env.HOSTNAME ||= '0.0.0.0';
await import(new URL('../.next/standalone/server.js', import.meta.url).href);
