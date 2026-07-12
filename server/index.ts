import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const handleProxy = async (req: express.Request, res: express.Response) => {
  const targetUrl = req.query.url as string;
  const referer = req.query.referer as string;
  const origin = req.query.origin as string;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const targetUrlObj = new URL(targetUrl);
    const headers: Record<string, string> = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // Auto-detect headers for specific domains
    if (targetUrlObj.hostname.includes('fxpy7.watching.onl') || targetUrlObj.hostname.includes('lookaround.click')) {
       headers['Referer'] = 'https://vidwish.live/';
       headers['Origin'] = 'https://vidwish.live';
    } else if (targetUrlObj.hostname.includes('streamzone1.site')) {
       headers['Referer'] = 'https://megaplay.buzz/';
       headers['Origin'] = 'https://megaplay.buzz';
    } else if (targetUrlObj.hostname.includes('mewstream.buzz')) {
       headers['Referer'] = 'https://megaplay.buzz/';
       headers['Origin'] = 'https://megaplay.buzz';
    } else if (targetUrlObj.hostname.includes('s2.cinewave2.site')) {
       headers['Referer'] = 'https://megaplay.buzz/';
       headers['Origin'] = 'https://megaplay.buzz';
    }

    if (referer) {
      headers['Referer'] = referer;
    }
    if (origin) {
      headers['Origin'] = origin;
    }

    if (headers['Origin']) {
       headers['Origin'] = headers['Origin'].replace(/\/$/, "");
    }

    const response = await fetch(targetUrl, { headers });
    
    // Copy content headers
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch: ${response.statusText}`);
    }

    // If it's an m3u8 playlist, rewrite the URLs to go through this direct route
    const isM3U8 = targetUrl.includes('.m3u8') || (contentType && contentType.includes('mpegurl'));
    if (isM3U8) {
      const text = await response.text();
      const baseUrl = targetUrlObj.origin + targetUrlObj.pathname.substring(0, targetUrlObj.pathname.lastIndexOf('/') + 1);
      
      const currentPath = req.path;
      let proxySelfUrl = `${currentPath}?url=`;
      const cfProxy = process.env.CLOUDFLARE_PROXY_URL;
      if (cfProxy) {
        proxySelfUrl = cfProxy.includes('?') ? `${cfProxy}&url=` : `${cfProxy}?url=`;
      }

      const lines = text.split(/\r?\n/);
      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (!trimmed.startsWith('#')) {
          // It's a URI segment
          let absoluteUrl = trimmed;
          if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
            if (absoluteUrl.startsWith('/')) {
              absoluteUrl = targetUrlObj.origin + absoluteUrl;
            } else {
              absoluteUrl = baseUrl + absoluteUrl;
            }
          }

          let newUrl = proxySelfUrl + encodeURIComponent(absoluteUrl);
          if (headers['Referer']) newUrl += `&referer=${encodeURIComponent(headers['Referer'])}`;
          if (headers['Origin']) newUrl += `&origin=${encodeURIComponent(headers['Origin'])}`;
          return newUrl;
        }

        // Handle URI attribute in lines like #EXT-X-KEY, #EXT-X-MAP
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

            let newUri = proxySelfUrl + encodeURIComponent(absoluteUri);
            if (headers['Referer']) newUri += `&referer=${encodeURIComponent(headers['Referer'])}`;
            if (headers['Origin']) newUri += `&origin=${encodeURIComponent(headers['Origin'])}`;
            return `URI="${newUri}"`;
          });
        }

        return line;
      });

      return res.send(rewrittenLines.join('\n'));
    }

    // Otherwise, stream the raw response (TS segment / Subtitle / Key)
    if (response.body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(response.body as any).pipe(res);
      return;
    } else {
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    console.error('Stream error:', error);
    return res.status(500).send((error as Error).message);
  }
};

app.get('/api/stream', handleProxy);
app.get('/api/proxy', handleProxy);

const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath, { maxAge: '1y', immutable: true, index: false }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
