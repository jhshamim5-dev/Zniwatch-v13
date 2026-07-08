export const config = {
  runtime: 'edge'
};

export default async function fetchHandler(request: Request) {
  const urlPattern = new URL(request.url);
  
  // Serve CORS headers for preflight requests
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Ensure the path is something like /api/stream
  if (!urlPattern.pathname.startsWith('/api/stream')) {
    return new Response('Use /api/stream?url=YOUR_M3U8_URL', { status: 400, headers: corsHeaders });
  }

  const targetUrl = urlPattern.searchParams.get('url');
  if (!targetUrl) {
    return new Response('URL parameter is required', { status: 400, headers: corsHeaders });
  }

  try {
    const targetUrlObj = new URL(targetUrl);
    
    const headers: Record<string, string> = {
      'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*, application/vnd.apple.mpegurl',
      'Accept-Language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
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
    }

    // Allow manual override via query parameters
    const reqReferer = urlPattern.searchParams.get('referer');
    if (reqReferer) {
      headers['Referer'] = reqReferer;
    }
    
    const reqOrigin = urlPattern.searchParams.get('origin');
    if (reqOrigin) {
      headers['Origin'] = reqOrigin;
    }

    // Ensure Origin never has a trailing slash
    if (headers['Origin']) {
       headers['Origin'] = headers['Origin'].replace(/\/$/, "");
    }

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'follow'
    });

    if (!response.ok) {
       return new Response(`Failed to fetch Target URL: ${response.statusText}`, { status: response.status, headers: corsHeaders });
    }

    const contentType = response.headers.get('content-type');
    
    // Determine if it's an m3u8 playlist
    const isM3U8 = response.url.toLowerCase().includes('.m3u8') || targetUrlObj.pathname.toLowerCase().endsWith('.m3u8') || (contentType && contentType.toLowerCase().includes('mpegurl'));

    const responseHeaders = new Headers(corsHeaders);
    
    // Pass through original response headers except the ones we override
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== 'content-type' && 
          lowerKey !== 'access-control-allow-origin' &&
          lowerKey !== 'access-control-allow-methods' &&
          lowerKey !== 'access-control-allow-headers' &&
          lowerKey !== 'content-encoding' &&
          lowerKey !== 'content-length' &&
          lowerKey !== 'transfer-encoding') {
         responseHeaders.set(key, value);
      }
    });
    
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }

    if (isM3U8) {
       const body = await response.text();
       
       const finalUrlObj = new URL(response.url);
       const baseUrl = finalUrlObj.origin + finalUrlObj.pathname.substring(0, finalUrlObj.pathname.lastIndexOf('/') + 1);
       const originalQuery = finalUrlObj.search;
       
       // Use the worker's own URL as proxy base
       const proxySelfUrl = `${urlPattern.origin}/api/stream?url=`;
       
       const lines = body.split(/\r?\n/);
       const rewrittenLines = lines.map(line => {
         const trimmedLine = line.trim();
         if (!trimmedLine) return line;

         if (!trimmedLine.startsWith('#')) {
           // URI Segment
           let absoluteSegmentUrl = trimmedLine;
           if (!absoluteSegmentUrl.startsWith('http://') && !absoluteSegmentUrl.startsWith('https://')) {
             if (absoluteSegmentUrl.startsWith('/')) {
               absoluteSegmentUrl = finalUrlObj.origin + absoluteSegmentUrl;
             } else {
               absoluteSegmentUrl = baseUrl + absoluteSegmentUrl;
             }
             if (!absoluteSegmentUrl.includes('?') && originalQuery) {
                absoluteSegmentUrl += originalQuery;
             }
           }
           
           let newUrl = "";
            const lowerSeg = absoluteSegmentUrl.toLowerCase();
            const shouldProxySegment = lowerSeg.includes('.m3u8') || (!lowerSeg.includes('.ts') && !lowerSeg.includes('.mp4') && !lowerSeg.includes('.m4s') && !lowerSeg.includes('.m2ts'));
            if (!shouldProxySegment) {
              return absoluteSegmentUrl;
            }
            newUrl = proxySelfUrl + encodeURIComponent(absoluteSegmentUrl);
           if (headers['Referer']) newUrl += `&referer=${encodeURIComponent(headers['Referer'])}`;
           if (headers['Origin']) newUrl += `&origin=${encodeURIComponent(headers['Origin'])}`;
           
           return newUrl;
         }
         
         if (trimmedLine.startsWith('#')) {
           return trimmedLine.replace(/URI="([^"]+)"/g, (match, uri) => {
             let absoluteUri = uri;
             if (!absoluteUri.startsWith('http://') && !absoluteUri.startsWith('https://')) {
               if (absoluteUri.startsWith('/')) {
                  absoluteUri = finalUrlObj.origin + absoluteUri;
               } else {
                  absoluteUri = baseUrl + absoluteUri;
               }
             }
             let newUri = "";
              const lowerUri = absoluteUri.toLowerCase();
              const shouldProxyUri = lowerUri.includes('.m3u8') || (!lowerUri.includes('.ts') && !lowerUri.includes('.mp4') && !lowerUri.includes('.m4s') && !lowerUri.includes('.m2ts'));
              if (!shouldProxyUri) {
                return `URI="${absoluteUri}"`;
              }
              newUri = proxySelfUrl + encodeURIComponent(absoluteUri);
             if (headers['Referer']) newUri += `&referer=${encodeURIComponent(headers['Referer'])}`;
             if (headers['Origin']) newUri += `&origin=${encodeURIComponent(headers['Origin'])}`;
             
             return `URI="${newUri}"`;
           });
         }
         
         return line; 
       });
       
       return new Response(rewrittenLines.join('\n'), {
         status: 200,
         headers: responseHeaders
       });
    } else {
       // Just return the raw segment (TS file or keys)
       return new Response(response.body, {
         status: 200,
         headers: responseHeaders
       });
    }

  } catch (error) {
    const err = error as Error;
    return new Response(`Proxy error: ${err.message || String(error)}`, { status: 500, headers: corsHeaders });
  }
}
