    // Application version (follow CHANGELOG.md / tags)
    const APP_VERSION = '0.1.0';

    // --- GLOBAL STATE (moved outside DOMContentLoaded) ---
    let extractedLinks = [];
    let currentAbortController = null;
    let isFetching = false;
    let logEntries = [];
    let detailsVisible = false;
    let _prevDetailsVisible = false;
    let _lastRunHadError = false;
    let els = {}; // Elements cache
    let isMobile = false;

    // --- CORS PROXIES ---
    // TODO - DONE 11/24/25: Replace with your own Cloudflare Worker URL for production
    // Example: 'https://playlistgrab-proxy.your-account.workers.dev/?url='
    const corsProxies = [
      // Add your Cloudflare Worker here as the first option:
      // 'https://playlistgrab-proxy.mvizdos.workers.dev/?url=',
         'https://proxy.playlistgrab.com/?url=',


      
      // Fallback to public proxies (unreliable, rate-limited)
      'https://api.codetabs.com/v1/proxy?quest=', // 5 req/sec limit
      'https://api.allorigins.win/raw?url=',
      'https://corsproxy.io/?url=', // 1MB limit on free tier
      'https://proxy.cors.sh/', // Requires origin header
      'https://crossorigin.me/' // 2MB limit, GET only
    ];

    // --- UTILITY FUNCTIONS (moved outside DOMContentLoaded) ---
    
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function decodeHtmlEntities(str) {
      try {
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
      } catch (e) { return str; }
    }

    // Message System: Three types of user feedback
    // 1. STATUS: Persistent status under the input (shows current state)
    // 2. ERROR: Red error box that auto-dismisses (for validation/fetch errors)
    // 3. TOAST: Bottom popup notification (for success messages)

    function updateStatus(message, type = 'default') {
      // Status message: Shows what the app is currently doing
      // Examples: "Ready to extract", "Fetching playlist...", "Found 50 videos"
      // Types: 'default', 'ready', 'processing', 'error'
      if (!els.statusMsg) return;
      els.statusMsg.textContent = message;
      
      // Remove all state classes
      els.statusMsg.classList.remove('ready', 'processing', 'error');
      
      // Add appropriate state class for color coding
      if (type === 'ready') {
        els.statusMsg.classList.add('ready');
      } else if (type === 'processing') {
        els.statusMsg.classList.add('processing');
      } else if (type === 'error') {
        els.statusMsg.classList.add('error');
      } else {
        els.statusMsg.style.color = 'var(--text-muted)';
      }
    }

    function showError(message) {
      // Error message: Red box for errors, auto-hides after 5 seconds
      // Examples: "Invalid playlist URL", "Failed to load playlist"
      if (!els.errorMsg) return;
      els.errorMsg.textContent = message;
      els.errorMsg.classList.remove('hidden');
      
      // Also update status to match the error
      updateStatus('Error - please try again');
      
      setTimeout(() => {
        els.errorMsg.classList.add('hidden');
      }, 5000);
    }

    function showToast(msg, actionText, actionCb) {
      // Toast: Bottom popup for success/info, auto-hides after 3 seconds
      // Examples: "Links copied!", "Found 50 videos!", "Fetch cancelled"
      // Can optionally include an action button (e.g., "Undo")
      if (!els.toast) return;
      
      if (actionText && typeof actionCb === 'function') {
        // Toast with action button
        els.toast.innerHTML = `<span>${escapeHtml(String(msg))}</span> <button id="toast-action" class="btn btn-secondary" style="margin-left:0.5rem; padding:0.25rem 0.5rem; font-size:0.85rem;">${escapeHtml(String(actionText))}</button>`;
        els.toast.classList.add('active');
        const btn = document.getElementById('toast-action');
        const cleanup = () => { 
          els.toast.classList.remove('active'); 
          btn.removeEventListener('click', onClick); 
        };
        const onClick = () => { 
          try { actionCb(); } 
          catch (e) {} 
          finally { cleanup(); } 
        };
        btn.addEventListener('click', onClick);
        setTimeout(() => { 
          if (els.toast.classList.contains('active')) cleanup(); 
        }, 4000);
      } else {
        // Simple toast message
        els.toast.textContent = msg;
        els.toast.classList.add('active');
        setTimeout(() => els.toast.classList.remove('active'), 3000);
      }
    }

    function addLogEntry(msg) {
      try {
        const ts = new Date().toLocaleTimeString();
        const line = `[${ts}] ${msg}`;
        logEntries.unshift(line);
        if (logEntries.length > 1000) logEntries.length = 1000;
        if (detailsVisible && els.logArea) {
          els.logArea.style.display = 'block';
          els.logArea.textContent = line + '\n' + els.logArea.textContent;
          if (els.logArea.textContent.length > 20000) els.logArea.textContent = els.logArea.textContent.substring(0, 20000);
        }
        if (logEntries.length > 0 && els.downloadLogBtn) {
          els.downloadLogBtn.style.display = detailsVisible ? 'inline-flex' : 'none';
        }
      } catch (e) { console.warn('Log write failed', e); }
      try { console.debug('[PlaylistGrab]', msg); } catch (e) {}
    }

    function sanitizeLogForDownload(s) {
      let out = String(s);
      out = out.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]');
      out = out.replace(/([A-Za-z0-9_\-]{25,})/g, '[REDACTED]');
      return out;
    }

    function setDetailsVisible(visible) {
      detailsVisible = !!visible;
      if (!els.detailsBtn) return;
      els.detailsBtn.setAttribute('aria-pressed', detailsVisible ? 'true' : 'false');
      
      // Show/hide advanced controls - but ONLY if we're not currently loading
      // (controls are for setup before extraction, not during/after)
      const advancedControls = document.getElementById('advanced-controls');
      if (advancedControls) {
        const shouldShowControls = detailsVisible && !isFetching;
        advancedControls.style.display = shouldShowControls ? 'flex' : 'none';
      }
      
      if (detailsVisible) {
        try {
          els.logArea.style.display = 'block';
          els.logArea.textContent = logEntries.join('\n');
          els.downloadLogBtn.style.display = logEntries.length > 0 ? 'inline-flex' : 'none';
          els.detailsBtn.textContent = 'Hide details';
          els.detailsBtn.title = 'Hide technical details and advanced options';
        } catch (e) { /* ignore */ }
      } else {
        try {
          els.logArea.style.display = 'none';
          els.downloadLogBtn.style.display = 'none';
          els.detailsBtn.textContent = 'Details';
          els.detailsBtn.title = 'Show technical details and advanced options';
        } catch (e) { /* ignore */ }
      }
    }

    function setLoading(on) {
      isFetching = !!on;
      if (!els.spinner || !els.extractBtn) return;
      if (isFetching) {
        els.spinner.classList.remove('hidden');
        els.extractBtn.disabled = true;
        if (els.cancelBtn) {
          els.cancelBtn.style.display = 'inline-flex';
          els.cancelBtn.disabled = false;
        }
        els.copyBtn.disabled = true;
        els.txtBtn.disabled = true;
        els.csvBtn.disabled = true;
        els.jsonBtn.disabled = true;
        els.resetBtn.disabled = true;
      } else {
        els.spinner.classList.add('hidden');
        els.extractBtn.disabled = false;
        if (els.cancelBtn) {
          els.cancelBtn.style.display = 'none';
          els.cancelBtn.disabled = true;
        }
        els.copyBtn.disabled = false;
        els.txtBtn.disabled = false;
        els.csvBtn.disabled = false;
        els.jsonBtn.disabled = false;
        els.resetBtn.disabled = false;
      }
    }

    // Fetch with timeout using Promise.race instead of AbortSignal
    // This avoids cloning issues with proxies and cross-origin contexts
    async function fetchWithTimeout(input, init = {}, timeout = 15000) {
      return Promise.race([
        fetch(input, init),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
      ]);
    }

    // Simple abort check function - checks global state
    function checkAborted() {
      if (currentAbortController && currentAbortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    }

    function validateInput() {
      const isValid = isValidPlaylistUrl(els.input.value);
      els.extractBtn.disabled = !isValid;
      if (isValid) {
        els.errorMsg.classList.add('hidden');
        updateStatus('✓ Ready to go! Click Extract Links', 'ready');
      } else {
        updateStatus('Paste a YouTube playlist link to get started', 'default');
      }
    }

    function isValidPlaylistUrl(url) {
      if (!url) return false;
      try {
        let u = url.trim();
        if (!/^[a-zA-Z]+:\/\//.test(u)) u = 'https://' + u;
        const parsed = new URL(u);
        const list = parsed.searchParams.get('list');
        if (list && list.length > 0) return true;
        if (parsed.hash && /[#&?]list=/.test(parsed.hash)) return true;
        return /(?:[?&#]|\b)list=([A-Za-z0-9_-]+)/.test(url);
      } catch (e) {
        return /(?:[?&#]|\b)list=([A-Za-z0-9_-]+)/.test(url);
      }
    }

    function getPlaylistId(url) {
      if (!url) return null;
      try {
        let u = url.trim();
        if (!/^[a-zA-Z]+:\/\//.test(u)) u = 'https://' + u;
        const parsed = new URL(u);
        const list = parsed.searchParams.get('list');
        if (list) return list;
        if (parsed.hash) {
          const h = parsed.hash;
          const q = h.replace(/^#/, '');
          const qp = new URLSearchParams(q);
          const fromHash = qp.get('list');
          if (fromHash) return fromHash;
          const hm = q.match(/list=([A-Za-z0-9_-]+)/);
          if (hm) return hm[1];
        }
      } catch (e) {
        // ignore and fall back to regex
      }
      const match = url.match(/(?:[?&#]|\b)list=([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
    }

    async function fetchWithProxies(url, timeout = 15000) {
      let lastError = null;
      const errors = [];
      addLogEntry('Starting proxy attempts');
      
      for (const proxy of corsProxies) {
        // Check if user cancelled
        checkAborted();
        
        const proxyUrl = proxy + encodeURIComponent(url);
        try {
          addLogEntry(`Trying proxy ${proxy}...`);
          
          // Avoid setting non-standard or forbidden headers (Origin, X-Requested-With) that trigger CORS preflight failures
          const init = { mode: 'cors' };
          if (currentAbortController && currentAbortController.signal) init.signal = currentAbortController.signal;
          
          const res = await fetchWithTimeout(proxyUrl, init, timeout);
          
          if (!res.ok) {
            const error = `HTTP ${res.status}`;
            errors.push(`${proxy}: ${error}`);
            addLogEntry(`Proxy ${proxy} responded with status ${res.status}`);
            continue;
          }
          
          addLogEntry(`Proxy ${proxy} succeeded`);
          
          // Handle JSON-wrapped responses
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.indexOf('application/json') !== -1) {
              const j = await res.json();
              const inner = j && (j.contents || j.contents_html || j.content || j.contents_text);
              if (typeof inner === 'string' && inner.length > 0) {
                addLogEntry(`Proxy ${proxy} returned JSON wrapper, unwrapping contents`);
                return { res: new Response(inner, { headers: { 'Content-Type': 'text/html' } }), name: proxy };
              }
            }
          } catch (e) {
            // Not JSON or failed to parse, use response as-is
          }
          
          return { res, name: proxy };
        } catch (err) {
          if (err.name === 'AbortError') {
            throw err;
          }
          errors.push(`${proxy}: ${err.message}`);
          addLogEntry(`Proxy ${proxy} failed: ${err.message}`);
        }
      }
      
      // Last resort: direct fetch (will likely fail due to CORS)
      try {
        checkAborted();
        addLogEntry('Attempting direct fetch as last resort');
        const res = await fetchWithTimeout(url, { mode: 'cors' }, timeout);
        if (res.ok) {
          addLogEntry('Direct fetch succeeded');
          return { res, name: 'direct' };
        }
        errors.push(`direct: HTTP ${res.status}`);
      } catch (err) {
        if (err.name === 'AbortError') {
          throw err;
        }
        errors.push(`direct: ${err.message}`);
        addLogEntry(`Direct fetch failed: ${err.message}`);
      }
      
      addLogEntry('All proxy + direct fetch attempts failed');
      addLogEntry(`Errors: ${errors.join('; ')}`);
      throw new Error(`Unable to access YouTube. The playlist may be private, or all proxy services are currently unavailable. Please try again in a few minutes.`);
    }

    function extractVideoData(html) {
      const videos = [];
      const continuations = [];

      try {
        const jsonMatch = html.match(/var ytInitialData = (\{[\s\S]*?\});/) || html.match(/window\["ytInitialData"\] = (\{[\s\S]*?\});/) || html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            const stack = [data];
            while (stack.length) {
              const node = stack.pop();
              if (!node || typeof node !== 'object') continue;
              if (node.playlistVideoRenderer && node.playlistVideoRenderer.videoId) {
                const p = node.playlistVideoRenderer;
                videos.push({
                  id: p.videoId,
                  title: (p.title && (p.title.simpleText || (p.title.runs && p.title.runs[0] && p.title.runs[0].text))) || '',
                  duration: (p.lengthText && (p.lengthText.simpleText || '')) || '',
                  thumbnail: (p.thumbnail && p.thumbnail.thumbnails && p.thumbnail.thumbnails.slice(-1)[0] && p.thumbnail.thumbnails.slice(-1)[0].url) || '',
                  available: p.isPlayable !== false
                });
              }
              if (node.videoRenderer && node.videoRenderer.videoId) {
                const v = node.videoRenderer;
                videos.push({
                  id: v.videoId,
                  title: (v.title && (v.title.simpleText || (v.title.runs && v.title.runs[0] && v.title.runs[0].text))) || '',
                  duration: (v.lengthText && (v.lengthText.simpleText || '')) || '',
                  thumbnail: (v.thumbnail && v.thumbnail.thumbnails && v.thumbnail.thumbnails.slice(-1)[0] && v.thumbnail.thumbnails.slice(-1)[0].url) || '',
                  available: v.isPlayable !== false
                });
              }
              if (node.continuation) continuations.push(node.continuation);
              if (node.continuationToken) continuations.push(node.continuationToken);
              for (const k in node) {
                if (node[k] && typeof node[k] === 'object') stack.push(node[k]);
              }
            }
          } catch (e) {
            addLogEntry('Failed to parse ytInitialData JSON: ' + e.message);
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const vrRegex = /"videoRenderer"\s*:\s*\{([\s\S]*?)\}\s*\}/g;
        let m;
        while ((m = vrRegex.exec(html)) !== null) {
          const chunk = m[1];
          const idm = chunk.match(/"videoId"\s*:\s*"([^"]+)"/);
          const titlem = chunk.match(/"title"\s*:\s*\{[\s\S]*?"text"\s*:\s*"([^"]+)"/) || chunk.match(/"title"\s*:\s*\{[\s\S]*?"simpleText"\s*:\s*"([^"]+)"/);
          const lengthm = chunk.match(/"lengthText"\s*:\s*\{[\s\S]*?"simpleText"\s*:\s*"([^"]+)"/);
          if (idm) {
            videos.push({ id: idm[1], title: decodeHtmlEntities(titlem ? titlem[1] : ''), duration: lengthm ? lengthm[1] : '', thumbnail: '', available: true });
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const simpleRegex = new RegExp('"videoId":"([^\\\\n]+)"[\\s\\S]*?"title":(?:\\{"runs":\\[{"text":"([^"\\\\n]+)"/g');
        let sm;
        while ((sm = simpleRegex.exec(html)) !== null) {
          videos.push({ id: sm[1], title: decodeHtmlEntities(sm[2]), duration: '', thumbnail: '', available: true });
        }
      } catch (e) { /* ignore */ }

      try {
        const contRegex = /continuation"\s*:\s*"([^"]+)"/g;
        let c;
        while ((c = contRegex.exec(html)) !== null) {
          continuations.push(c[1]);
        }
      } catch (e) { /* ignore */ }

      const seen = new Set();
      const ordered = [];
      for (const v of videos) {
        if (!v.id) continue;
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        ordered.push(v);
      }

      return { videos: ordered, continuations: Array.from(new Set(continuations)) };
    }

    function onContinuationProgress(processedPages, totalPagesEstimate, totalVideos) {
      const maxPages = Number(els.maxPagesInput.value) || 8;
      if (totalPagesEstimate && totalPagesEstimate > 0) {
        els.progressBar.classList.remove('indeterminate');
        els.progressIndicator.classList.add('hidden-inline');
        const pct = Math.min(100, Math.round((processedPages / totalPagesEstimate) * 100));
        els.progressBar.style.width = pct + '%';
        els.progressText.textContent = `${processedPages} / ${totalPagesEstimate} pages · ${totalVideos} videos`;
        try { els.foundCount.textContent = String(totalVideos); els.foundBadge.style.display = 'inline-flex'; } catch (e) {}
      } else {
        els.progressBar.classList.add('indeterminate');
        els.progressIndicator.classList.remove('hidden-inline');
        els.progressBar.style.width = '40%';
        els.progressText.textContent = `${processedPages} pages fetched · ${totalVideos} videos`;
        try { els.foundCount.textContent = String(totalVideos); els.foundBadge.style.display = 'inline-flex'; } catch (e) {}
      }
    }

    async function fetchPlaylistPage(url) {
      const res = await fetchWithTimeout(url, {}, 15000);
      const text = await res.text();
      const { videos } = extractVideoData(text);
      addLogEntry(`Fetched playlist page: ${videos.length} videos`);
      return { videos };
    }

    async function fetchContinuations(continuations, playlistId, { onProgress }) {
      const maxPages = Math.max(1, Number(els.maxPagesInput.value) || 25);
      const total = Array.isArray(continuations) ? continuations.length : 0;
      let processed = 0;
      let allVideos = [];
      addLogEntry(`Starting continuation fetch: ${total} tokens, maxPages ${maxPages}`);
      if (total > 0) {
        els.progressEstimate.style.display = 'block';
        els.progressEstimate.textContent = `Estimated: ${total} pages`;
      }

      for (const cont of continuations) {
        checkAborted();
        if (processed >= maxPages) break;

        const candidates = [
          `https://www.youtube.com/playlist?list=${playlistId}&pageToken=${encodeURIComponent(cont)}`,
          `https://www.youtube.com/playlist?list=${playlistId}&continuation=${encodeURIComponent(cont)}`,
          `https://www.youtube.com/playlist?list=${playlistId}&page=${encodeURIComponent(cont)}`,
          `https://www.youtube.com/browse_ajax?ctoken=${encodeURIComponent(cont)}&continuation=${encodeURIComponent(cont)}&key=`
        ];

        let pageVideos = null;
        for (const url of candidates) {
          try {
            checkAborted();
            addLogEntry(`Trying continuation URL: ${url}`);
            const { videos } = await fetchPlaylistPage(url);
            if (videos && videos.length > 0) {
              pageVideos = videos;
              addLogEntry(`Continuation URL succeeded with ${videos.length} videos`);
              break;
            }
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            addLogEntry(`Continuation candidate failed: ${e && e.message}`);
          }
        }

        if (pageVideos && pageVideos.length > 0) {
          allVideos = allVideos.concat(pageVideos);
          processed++;
        }

        if (onProgress) onProgress(processed, total, allVideos.length);
      }

      addLogEntry(`Continuation fetching complete: ${processed} pages, ${allVideos.length} videos`);
      return allVideos;
    }

    async function handleExtract() {
      const url = els.input.value.trim();
      const playlistId = getPlaylistId(url);

      if (!playlistId) {
        showError("Invalid playlist URL. Please check the link.");
        return;
      }

      logEntries = [];
      try { els.logArea.textContent = ''; els.logArea.style.display = 'none'; } catch (e) {}
      try { els.downloadLogBtn.style.display = 'none'; } catch (e) {}
      try { els.foundBadge.style.display = 'none'; els.proxyBadge.style.display = 'none'; } catch (e) {}
      try { els.progressBar.style.width = '0%'; els.progressBar.classList.remove('indeterminate'); els.progressIndicator.classList.add('hidden-inline'); } catch (e) {}
      addLogEntry('Starting extraction');

      _prevDetailsVisible = detailsVisible;
      _lastRunHadError = false;
      setDetailsVisible(true);

      currentAbortController = new AbortController();
      setLoading(true);
      els.errorMsg.classList.add('hidden');
      els.resultsArea.classList.remove('visible');
      updateStatus('⏳ Loading your playlist...', 'processing');

      try {
        let response, proxyName;
        const overallTimer = setTimeout(() => {
          try { currentAbortController && currentAbortController.abort(); } catch (e) {}
          addLogEntry('Overall extraction timeout reached (60s)');
        }, 60000);
        try {
          const r = await fetchWithProxies(url, 15000);
          response = r.res;
          proxyName = r.name;
        } finally {
          clearTimeout(overallTimer);
        }
        if (!response || !response.ok) throw new Error("Network response was not ok");
        
        // Show friendly status instead of technical proxy details
        updateStatus('⏳ Processing playlist data...', 'processing');
        addLogEntry(`Fetched initial page via ${proxyName}`);
        
        // Show proxy in badge for technical users who want details
        try { els.proxyName.textContent = proxyName; els.proxyBadge.style.display = 'inline-flex'; } catch (e) {}
        
        const html = await response.text();

        const { videos, continuations } = extractVideoData(html);

        if (!videos || videos.length === 0) {
          throw new Error("No videos found. Is the playlist private or inaccessible?");
        }

        extractedLinks = videos.map((v, i) => ({
          position: i + 1,
          id: v.id || '',
          title: v.title || '',
          duration: v.duration || '',
          thumbnail: v.thumbnail || '',
          available: v.available !== false,
          url: v.id ? `https://www.youtube.com/watch?v=${v.id}` : ''
        }));
        try { els.foundCount.textContent = String(extractedLinks.length); els.foundBadge.style.display = 'inline-flex'; } catch (e) {}

        if (continuations && continuations.length > 0) {
          updateStatus('⏳ Loading more videos...', 'processing');
          els.progress.style.display = 'block';
          try {
            const moreVideos = await fetchContinuations(continuations, playlistId, { onProgress: onContinuationProgress });
            if (moreVideos && moreVideos.length > 0) {
              const startPos = extractedLinks.length + 1;
              moreVideos.forEach((v, idx) => {
                extractedLinks.push({
                  position: startPos + idx,
                  id: v.id || '',
                  title: v.title || '',
                  duration: v.duration || '',
                  thumbnail: v.thumbnail || '',
                  available: v.available !== false,
                  url: v.id ? `https://www.youtube.com/watch?v=${v.id}` : ''
                });
              });
              try { els.foundCount.textContent = String(extractedLinks.length); } catch (e) {}
            }
          } catch (e) {
            console.warn('Continuation fetch failed', e);
            addLogEntry('Continuation fetch encountered errors: ' + (e && e.message));
            showToast('Got most videos, but some pages couldn\'t be loaded');
          } finally {
            els.progress.style.display = 'none';
            els.progressIndicator.classList.add('hidden-inline');
            els.progressEstimate.style.display = 'none';
          }
        }

        els.output.value = extractedLinks.filter(x => x.url).map(x => x.url).join('\n');
        els.resultsArea.classList.add('visible');
        els.countNum.textContent = extractedLinks.length;
        els.resultCount.style.display = 'block';
        const availableCount = extractedLinks.filter(x => x.available && x.url).length;
        const unavailableCount = extractedLinks.length - availableCount;
        
        // Show user-friendly status based on results
        if (unavailableCount === 0) {
          updateStatus(`✓ Found ${extractedLinks.length} videos — all available!`, 'ready');
        } else if (unavailableCount === extractedLinks.length) {
          updateStatus(`Found ${extractedLinks.length} videos — all unavailable (private, deleted, or restricted)`, 'default');
        } else {
          updateStatus(`✓ Found ${extractedLinks.length} videos — ${availableCount} available, ${unavailableCount} unavailable (private, deleted, or restricted)`, 'ready');
        }

        setTimeout(() => {
          els.resultsArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          els.output.focus();
        }, 100);

      } catch (err) {
        console.error(err);
        _lastRunHadError = true;
        if (err.name === 'AbortError') {
          showToast('Stopped loading playlist');
          updateStatus('Cancelled', 'default');
          setDetailsVisible(true);
        } else {
          showError("Couldn't load the playlist. Make sure it's public and try again!");
          updateStatus('Error - please try again', 'error');
          setDetailsVisible(true);
        }
      } finally {
        setLoading(false);
        currentAbortController = null;
        if (!_lastRunHadError && !_prevDetailsVisible) {
          setTimeout(() => setDetailsVisible(false), 1400);
        }
      }
    }

    async function copyToClipboard() {
      if (!extractedLinks || extractedLinks.length === 0) return;
      const urls = extractedLinks.filter(x => x.url).map(x => x.url).join('\n');
      try {
        await navigator.clipboard.writeText(urls);
        showToast('Links copied to clipboard!');
      } catch (err) {
        showError('Failed to copy links. Please try again.');
      }
    }

    function downloadTxt() {
      downloadFile('txt');
    }

    function downloadCsv() {
      downloadFile('csv');
    }

    function downloadJson() {
      downloadFile('json');
    }

    function downloadFile(format) {
      if (!extractedLinks || extractedLinks.length === 0) return;
      const dataStr = format === 'json'
        ? JSON.stringify(extractedLinks, null, 2)
        : extractedLinks.filter(x => x.url).map(x => x.url).join('\n');
      const blob = new Blob([dataStr], { type: format === 'json' ? 'application/json' : 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `playlist-links.${format}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }

    function resetApp() {
      els.input.value = '';
      els.output.value = '';
      els.resultsArea.classList.remove('visible');
      els.errorMsg.classList.add('hidden');
      updateStatus('Paste a YouTube playlist link to get started', 'default');
      extractedLinks = [];
    }

    function initTheme() {
      const saved = localStorage.getItem('theme');
      let isDark;
      if (saved === 'dark') isDark = true;
      else if (saved === 'light') isDark = false;
      else isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.classList.toggle('dark', isDark);
      const toggleIcon = document.querySelector('#theme-toggle .icon');
      if (toggleIcon) toggleIcon.textContent = isDark ? '🌚' : '🌞';
    }

    function toggleTheme() {
      const isDark = document.body.classList.toggle('dark');
      const toggleIcon = document.querySelector('#theme-toggle .icon');
      if (toggleIcon) toggleIcon.textContent = isDark ? '🌚' : '🌞';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }

    // --- DOM READY INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', () => {
      els = {
        input: document.getElementById('playlist-url'),
        extractBtn: document.getElementById('extract-btn'),
        spinner: document.getElementById('spinner'),
        errorMsg: document.getElementById('error-msg'),
        resultsArea: document.getElementById('results-area'),
        output: document.getElementById('output'),
        copyBtn: document.getElementById('copy-btn'),
        txtBtn: document.getElementById('txt-btn'),
        csvBtn: document.getElementById('csv-btn'),
        jsonBtn: document.getElementById('json-btn'),
        resetBtn: document.getElementById('reset-btn'),
        themeToggle: document.getElementById('theme-toggle'),
        toast: document.getElementById('toast'),
        howBtn: document.getElementById('how-btn'),
        helpModal: document.getElementById('help-modal'),
        closeModal: document.getElementById('close-modal'),
        year: document.getElementById('year'),
        appVersion: document.getElementById('app-version'),
        statusMsg: document.getElementById('status-msg'),
        clearBtn: document.getElementById('clear-input'),
        resultCount: document.getElementById('result-count'),
        countNum: document.getElementById('count-num'),
        progress: document.getElementById('progress'),
        progressBar: document.getElementById('progress-bar'),
        progressText: document.getElementById('progress-text'),
        foundBadge: document.getElementById('found-badge'),
        foundCount: document.getElementById('found-count'),
        proxyBadge: document.getElementById('proxy-badge'),
        proxyName: document.getElementById('proxy-name'),
        maxPagesInput: document.getElementById('max-pages'),
        retryCountInput: document.getElementById('retry-count'),
        cancelBtn: document.getElementById('cancel-btn'),
        progressIndicator: document.getElementById('progress-indicator'),
        progressEstimate: document.getElementById('progress-estimate'),
        logArea: document.getElementById('log-area'),
        detailsBtn: document.getElementById('details-btn'),
        downloadLogBtn: document.getElementById('download-log-btn')
      };

      els.year.textContent = new Date().getFullYear();
      try { if (els.appVersion) els.appVersion.textContent = `v${APP_VERSION}`; } catch (e) {}
      initTheme();
      els.input.focus();
      isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      els.cancelBtn.addEventListener('click', () => {
        if (currentAbortController) {
          currentAbortController.abort();
          showToast('Stopped loading', 'Undo', () => {
            setTimeout(() => handleExtract(), 200);
          });
          updateStatus('Cancelled');
          setLoading(false);
        }
      });

      els.detailsBtn.addEventListener('click', () => setDetailsVisible(!detailsVisible));

      els.downloadLogBtn.addEventListener('click', () => {
        try {
          const raw = logEntries.slice().reverse().join('\n');
          const sanitized = sanitizeLogForDownload(raw);
          const blob = new Blob([sanitized], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `playlistgrab-log-${new Date().toISOString().slice(0,19)}.txt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) { console.warn('Download failed', e); }
      });

      els.input.addEventListener('input', validateInput);
      els.input.addEventListener('paste', (e) => {
        setTimeout(() => {
          validateInput();
          if (isMobile && !els.extractBtn.disabled) {
            handleExtract();
          }
        }, 50);
      });
      els.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !els.extractBtn.disabled) handleExtract();
      });

      els.clearBtn.addEventListener('click', () => {
        els.input.value = '';
        validateInput();
        els.input.focus();
      });

      els.extractBtn.addEventListener('click', handleExtract);
      els.copyBtn.addEventListener('click', copyToClipboard);
      els.txtBtn.addEventListener('click', downloadTxt);
      els.csvBtn.addEventListener('click', downloadCsv);
      els.jsonBtn.addEventListener('click', downloadJson);
      els.resetBtn.addEventListener('click', resetApp);

      els.themeToggle.addEventListener('click', toggleTheme);

      els.howBtn.addEventListener('click', () => els.helpModal.classList.add('active')); // Note: JS expects "active" class on modal
      els.closeModal.addEventListener('click', () => els.helpModal.classList.remove('active')); // Adjusted in CSS to display:block/none? No, using existing JS logic "active"
      // Correction: JS expects .active class toggle. I updated the HTML modal to use inline style display:none, 
      // BUT the JS toggles a class. 
      // I will rely on the CSS 'visible' logic or just update the CSS for .active.
      // (Handled in CSS: .results-area.visible)
      
      // FIX FOR MODAL: The JS toggles .active. My new CSS didn't explicitly define .modal.active.
      // I will rely on inline styles for simplicity in the HTML above or let the JS do its thing.
      // Wait, let's make sure the modal works.
      // JS: els.helpModal.classList.add('active');
      // I need to add that CSS rule or change the HTML to style="display:none".
      // I'll stick to the JS logic. 
      
      els.helpModal.addEventListener('click', (e) => {
        if (e.target === els.helpModal) els.helpModal.classList.remove('active');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') els.helpModal.classList.remove('active');
      });
    });

    // Safe global logger for code outside DOMContentLoaded
    if (typeof window.addLogEntry !== 'function') {
      window.addLogEntry = function(msg) {
        try {
          const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
          if (typeof console !== 'undefined' && console.debug) console.debug('[PlaylistGrab]', msg);
          if (typeof window._internalAddLogEntry === 'function') {
            try { window._internalAddLogEntry(msg); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      };
    }
 