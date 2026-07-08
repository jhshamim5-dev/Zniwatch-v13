import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTaggerPlugin } from "./src/visual-edits/component-tagger-plugin.js";

const logErrorsPlugin = () => ({
  name: "log-errors-plugin",
  transformIndexHtml() {
    return {
      tags: [
        {
          tag: "script",
          injectTo: "head",
          children: `(() => {
            try {
              const logOverlay = () => {
                const el = document.querySelector('vite-error-overlay');
                if (!el) return;
                const root = (el.shadowRoot || el);
                let text = '';
                try { text = root.textContent || ''; } catch (_) {}
                if (text && text.trim()) {
                  const msg = text.trim();
                  console.error('[Vite Overlay]', msg);
                  try {
                    if (window.parent && window.parent !== window) {
                      window.parent.postMessage({
                        type: 'ERROR_CAPTURED',
                        error: { message: msg, stack: undefined, filename: undefined, lineno: undefined, colno: undefined, source: 'vite.overlay' },
                        timestamp: Date.now(),
                      }, '*');
                    }
                  } catch (_) {}
                }
              };
              const obs = new MutationObserver(() => logOverlay());
              obs.observe(document.documentElement, { childList: true, subtree: true });
              window.addEventListener('DOMContentLoaded', logOverlay);
              logOverlay();
            } catch (e) {
              console.warn('[Vite Overlay logger failed]', e);
            }
          })();`
        }
      ]
    };
  },
});

// Dev-only HLS stream plugin — handles /api/stream requests during local development
const hlsStreamPlugin = () => ({
  name: "hls-stream-plugin",
  apply: "serve" as const,
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(async (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => {
      if (req.url && req.url.startsWith('/api/stream')) {
        const urlObj = new URL(req.url, 'http://localhost');
        const targetUrl = urlObj.searchParams.get('url');
        const referer = urlObj.searchParams.get('referer');
        const origin = urlObj.searchParams.get('origin');

        if (!targetUrl) {
          res.statusCode = 400;
          res.end('Missing url parameter');
          return;
        }

        try {
          const headers: Record<string, string> = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          };

          if (referer) headers['Referer'] = referer;
          if (origin) headers['Origin'] = origin;

          const response = await fetch(targetUrl, { headers });
          
          const contentType = response.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }

          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');

          if (!response.ok) {
            res.statusCode = response.status;
            res.end(`Failed to fetch: ${response.statusText}`);
            return;
          }

          const isM3U8 = targetUrl.includes('.m3u8') || (contentType && contentType.includes('mpegurl'));
          if (isM3U8) {
            const text = await response.text();
            const targetUrlObj = new URL(targetUrl);
            const baseUrl = targetUrlObj.origin + targetUrlObj.pathname.substring(0, targetUrlObj.pathname.lastIndexOf('/') + 1);
            
            const lines = text.split(/\r?\n/);
            const rewrittenLines = lines.map(line => {
              const trimmed = line.trim();
              if (!trimmed) return line;

              if (!trimmed.startsWith('#')) {
                let absoluteUrl = trimmed;
                if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
                  if (absoluteUrl.startsWith('/')) {
                    absoluteUrl = targetUrlObj.origin + absoluteUrl;
                  } else {
                    absoluteUrl = baseUrl + absoluteUrl;
                  }
                }
                let newUrl = `/api/stream?url=${encodeURIComponent(absoluteUrl)}`;
                if (referer) newUrl += `&referer=${encodeURIComponent(referer)}`;
                if (origin) newUrl += `&origin=${encodeURIComponent(origin)}`;
                return newUrl;
              }

              if (trimmed.startsWith('#')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
                  let absoluteUri = uri;
                  if (!absoluteUri.startsWith('http://') && !absoluteUri.startsWith('https://')) {
                    if (absoluteUri.startsWith('/')) {
                      absoluteUri = targetUrlObj.origin + absoluteUri;
                    } else {
                      absoluteUri = baseUrl + absoluteUri;
                    }
                  }
                  let newUri = `/api/stream?url=${encodeURIComponent(absoluteUri)}`;
                  if (referer) newUri += `&referer=${encodeURIComponent(referer)}`;
                  if (origin) newUri += `&origin=${encodeURIComponent(origin)}`;
                  return `URI="${newUri}"`;
                });
              }

              return line;
            });

            res.end(rewrittenLines.join('\n'));
            return;
          }

          const arrayBuffer = await response.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        } catch (error: unknown) {
          const err = error as Error;
          console.error('Vite dev stream error:', err);
          res.statusCode = 500;
          res.end(err.message || String(error));
        }
        return;
      }
      next();
    });
  },
  configurePreviewServer(server: import('vite').PreviewServer) {
    this.configureServer(server as unknown as import('vite').ViteDevServer);
  }
});

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 3000,
  },
  plugins: [
    react(),
    logErrorsPlugin(),
    hlsStreamPlugin(),
    mode === 'development' && componentTaggerPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
// Orchids restart: 1768808338593
