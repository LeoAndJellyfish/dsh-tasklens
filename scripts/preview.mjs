import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const directory = new URL('../.local/preview-v2/', import.meta.url);
await mkdir(directory, { recursive: true });
await build({ entryPoints: ['examples/preview.tsx'], outfile: new URL('app.js', directory).pathname.replace(/^\/(\w:)/, '$1'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TaskLens · 界面验收</title><style>body{margin:0;font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;background:#f2f4f7}.example-page{min-height:100vh;padding:70px 0 36px}.example-page[data-theme=dark]{background:#0e131c;color:#edf2fa}.example-toolbar{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;background:#fff;border-bottom:1px solid #dce3ec;font-size:12px}.example-toolbar>span{color:#576579;margin-right:auto}.example-toolbar button{font:inherit;padding:5px 9px;border:1px solid #dce3ec;border-radius:5px;background:#fff;cursor:pointer}.example-toolbar button[aria-pressed=true]{color:#1d4ed8;background:#edf3ff}.example-page>main{max-width:100%;margin:0 auto;border:1px solid #dce3ec;border-radius:10px;overflow:hidden}.tl-panel{height:auto;min-height:calc(100vh - 120px)}</style><div id="root"></div><script src="/app.js"></script></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
  else if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(await readFile(new URL('app.js', directory))); }
  else { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.TASKLENS_PREVIEW_PORT ?? 19571), '127.0.0.1', () => process.stdout.write(`TaskLens preview: http://127.0.0.1:${server.address().port}\n`));
