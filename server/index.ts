import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Simple direct route to fetch resources with custom headers to bypass browser restriction
app.get('/api/stream', async (req, res) => {
  const targetUrl = req.query.url as string;
  const referer = req.query.referer as string;
  const origin = req.query.origin as string;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (referer) {
      headers['Referer'] = referer;
    }
    if (origin) {
      headers['Origin'] = origin;
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
      const targetUrlObj = new URL(targetUrl);
      const baseUrl = targetUrlObj.origin + targetUrlObj.pathname.substring(0, targetUrlObj.pathname.lastIndexOf('/') + 1);
      
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

          const lowerSeg = absoluteUrl.toLowerCase();
          // DO NOT proxy heavy media segments (.ts, .mp4, .m4s, .m2ts). Fetching directly from CDN lowers latency and buffering!
          const shouldProxySegment = lowerSeg.includes('.m3u8') || (!lowerSeg.includes('.ts') && !lowerSeg.includes('.mp4') && !lowerSeg.includes('.m4s') && !lowerSeg.includes('.m2ts'));

          if (shouldProxySegment) {
            let newUrl = `/api/stream?url=${encodeURIComponent(absoluteUrl)}`;
            if (referer) newUrl += `&referer=${encodeURIComponent(referer)}`;
            if (origin) newUrl += `&origin=${encodeURIComponent(origin)}`;
            return newUrl;
          } else {
            return absoluteUrl;
          }
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

            const lowerUri = absoluteUri.toLowerCase();
            const shouldProxyUri = lowerUri.includes('.m3u8') || (!lowerUri.includes('.ts') && !lowerUri.includes('.mp4') && !lowerUri.includes('.m4s') && !lowerUri.includes('.m2ts'));

            if (shouldProxyUri) {
              let newUri = `/api/stream?url=${encodeURIComponent(absoluteUri)}`;
              if (referer) newUri += `&referer=${encodeURIComponent(referer)}`;
              if (origin) newUri += `&origin=${encodeURIComponent(origin)}`;
              return `URI="${newUri}"`;
            } else {
              return `URI="${absoluteUri}"`;
            }
          });
        }

        return line;
      });

      return res.send(rewrittenLines.join('\n'));
    }

    // Otherwise, stream the raw response (TS segment / Subtitle / Key)
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Stream error:', error);
    return res.status(500).send((error as Error).message);
  }
});

const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath, { maxAge: '1y', immutable: true, index: false }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
