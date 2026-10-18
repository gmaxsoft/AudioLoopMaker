(() => {
      const $ = (id) => document.getElementById(id);

      const state = {
        filename: null,
        originalName: null,
        duration: 0,
        start: 0,
        end: 0,
        crossfadeMs: 140,
        repeats: 1,
        looping: false,
        audioBuffer: null,
        uploading: false,
        generating: false,
        suggesting: false,
        suggestedStart: 0,
        suggestedEnd: 0,
        suggestedCrossfade: 140,
        suggestionNote: null,
      };

      const player = $('player');
      const dropzone = $('dropzone');
      const fileInput = $('fileInput');

      // --- Theme ---
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('alm-theme', theme);
        $('iconSun').classList.toggle('hidden', theme !== 'light');
        $('iconMoon').classList.toggle('hidden', theme !== 'dark');
        drawWaveform();
      }
      $('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      });
      applyTheme(localStorage.getItem('alm-theme') || 'dark');

      function formatTime(sec) {
        if (!Number.isFinite(sec)) return '0.000';
        return sec.toFixed(3);
      }

      function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
      }

      function formatDuration(sec) {
        const m = Math.floor(sec / 60);
        const s = (sec % 60).toFixed(2);
        return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${Number(s).toFixed(2)} s`;
      }

      function enableEditor(on) {
        $('editorSection').classList.toggle('opacity-50', !on);
        $('editorSection').classList.toggle('pointer-events-none', !on);
        $('generateSection').classList.toggle('opacity-50', !on);
        $('generateSection').classList.toggle('pointer-events-none', !on);
      }

      function updateSegmentInfo() {
        const len = Math.max(0, state.end - state.start);
        const cf = state.crossfadeMs / 1000;
        const outLen = Math.max(0, len - (cf > 0.001 ? cf : 0)) * state.repeats;
        $('segmentInfo').textContent =
          `Segment: ${formatDuration(len)} → wyjście ≈ ${formatDuration(outLen)}`;
        updateRegionUI();
      }

      function updateRegionUI() {
        if (!state.duration) return;
        const region = $('region');
        const left = (state.start / state.duration) * 100;
        const width = ((state.end - state.start) / state.duration) * 100;
        region.style.left = left + '%';
        region.style.width = Math.max(0, width) + '%';
      }

      function syncSlidersFromState() {
        const d = state.duration || 1;
        $('startSlider').max = d;
        $('endSlider').max = d;
        $('startSlider').value = state.start;
        $('endSlider').value = state.end;
        $('startInput').value = formatTime(state.start);
        $('endInput').value = formatTime(state.end);
        $('crossfadeSlider').value = state.crossfadeMs;
        $('crossfadeInput').value = state.crossfadeMs;
        $('repeatsSlider').value = Math.min(20, state.repeats);
        $('repeatsInput').value = state.repeats;
        updateSegmentInfo();
      }

      function clampRegion() {
        const d = state.duration;
        state.start = Math.max(0, Math.min(state.start, d));
        state.end = Math.max(0, Math.min(state.end, d));
        if (state.end <= state.start) {
          state.end = Math.min(d, state.start + 0.05);
        }
        const maxCf = Math.max(0, Math.floor(((state.end - state.start) / 2 - 0.01) * 1000));
        if (state.crossfadeMs > maxCf) {
          state.crossfadeMs = Math.max(0, maxCf);
        }
      }

      function updateSuggestInfo() {
        const box = $('suggestInfo');
        if (!state.filename || state.suggestedEnd <= state.suggestedStart) {
          box.classList.add('hidden');
          return;
        }
        box.classList.remove('hidden');
        $('suggestRange').textContent =
          `${formatTime(state.suggestedStart)} do ${formatTime(state.suggestedEnd)} s` +
          ` · crossfade ${state.suggestedCrossfade} ms`;
        $('suggestExtra').textContent = state.suggestionNote
          ? `AI / Algorytm: ${state.suggestionNote}`
          : 'AI / Algorytm sugeruje powyższy fragment jako najlepszą pętlę.';
      }

      function applySuggestion(suggestion) {
        if (!suggestion) return;
        state.suggestedStart = Number(suggestion.suggestedStart) || 0;
        state.suggestedEnd = Number(suggestion.suggestedEnd) || state.duration;
        state.suggestedCrossfade = Number(suggestion.suggestedCrossfade) || 140;
        if (suggestion.suggestionNote) state.suggestionNote = suggestion.suggestionNote;

        state.start = state.suggestedStart;
        state.end = state.suggestedEnd;
        state.crossfadeMs = state.suggestedCrossfade;
        clampRegion();
        syncSlidersFromState();
        updateSuggestInfo();
      }

      // --- Waveform (prosty peaki z AudioContext) ---
      async function loadWaveformPeaks(arrayBuffer) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const copy = arrayBuffer.slice(0);
          state.audioBuffer = await ctx.decodeAudioData(copy);
          ctx.close();
          drawWaveform();
        } catch {
          state.audioBuffer = null;
          drawWaveform();
        }
      }

      function drawWaveform() {
        const canvas = $('waveCanvas');
        const wrap = $('waveform');
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        g.clearRect(0, 0, w, h);

        const styles = getComputedStyle(document.documentElement);
        const muted = styles.getPropertyValue('--text-muted').trim() || '#8b95a5';
        const accent = styles.getPropertyValue('--accent').trim() || '#3d9b8f';

        if (!state.audioBuffer) {
          g.fillStyle = muted;
          g.globalAlpha = 0.35;
          for (let x = 0; x < w; x += 3) {
            const amp = 8 + Math.sin(x * 0.08) * 6 + Math.sin(x * 0.02) * 10;
            g.fillRect(x, (h - amp) / 2, 2, amp);
          }
          g.globalAlpha = 1;
          return;
        }

        const data = state.audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / w);
        const mid = h / 2;
        g.fillStyle = accent;
        g.globalAlpha = 0.85;
        for (let x = 0; x < w; x++) {
          let min = 1, max = -1;
          const start = x * step;
          for (let i = 0; i < step; i++) {
            const v = data[start + i] || 0;
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const y1 = mid + min * mid * 0.9;
          const y2 = mid + max * mid * 0.9;
          g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
        }
        g.globalAlpha = 1;
      }

      window.addEventListener('resize', () => drawWaveform());

      // --- Upload ---
      function openPicker() {
        fileInput.click();
      }
      $('pickBtn').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
      $('changeBtn').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
      dropzone.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openPicker();
      });

      ['dragenter', 'dragover'].forEach((ev) => {
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((ev) => {
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        });
      });
      dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files?.[0];
        if (file) uploadFile(file);
      });
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) uploadFile(file);
      });

      function uploadFile(file) {
        if (state.uploading) return;
        state.uploading = true;
        state.looping = false;
        player.pause();

        $('uploadProgress').classList.remove('hidden');
        $('uploadBar').style.width = '0%';
        $('uploadPct').textContent = '0%';
        $('errorBox').classList.add('hidden');
        $('resultBox').classList.add('hidden');
        enableEditor(false);

        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append('audio', file);

        xhr.upload.addEventListener('progress', (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          $('uploadBar').style.width = pct + '%';
          $('uploadPct').textContent = pct + '%';
        });

        xhr.addEventListener('load', async () => {
          state.uploading = false;
          $('uploadProgress').classList.add('hidden');
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) throw new Error(data.error || 'Błąd uploadu');

            state.filename = data.filename;
            state.originalName = data.originalName;
            state.duration = data.duration;
            state.repeats = 1;
            state.suggestionNote = data.suggestionNote || null;

            $('dropIdle').classList.add('hidden');
            $('dropLoaded').classList.remove('hidden');
            $('fileName').textContent = data.originalName;
            $('fileMeta').textContent =
              `${formatDuration(data.duration)} · ${formatBytes(data.size)} · ${data.sampleRate} Hz · ${data.channels} ch`;

            player.src = data.url;
            await player.load?.();

            enableEditor(true);

            applySuggestion({
              suggestedStart: data.suggestedStart ?? 0,
              suggestedEnd: data.suggestedEnd ?? data.duration,
              suggestedCrossfade: data.suggestedCrossfade ?? 140,
              suggestionNote: data.suggestionNote,
            });

            // Peaki waveform – osobny odczyt pliku lokalnego
            const ab = await file.arrayBuffer();
            await loadWaveformPeaks(ab);
          } catch (err) {
            showError(err.message || 'Nie udało się wczytać pliku.');
          }
        });

        xhr.addEventListener('error', () => {
          state.uploading = false;
          $('uploadProgress').classList.add('hidden');
          showError('Błąd połączenia podczas wysyłania pliku.');
        });

        xhr.open('POST', '/api/upload');
        xhr.send(form);
      }

      function showError(msg) {
        const box = $('errorBox');
        box.textContent = msg;
        box.classList.remove('hidden');
      }

      // --- Controls ---
      $('startSlider').addEventListener('input', () => {
        state.start = Number($('startSlider').value);
        if (state.start >= state.end) state.start = Math.max(0, state.end - 0.05);
        clampRegion();
        syncSlidersFromState();
      });
      $('endSlider').addEventListener('input', () => {
        state.end = Number($('endSlider').value);
        if (state.end <= state.start) state.end = Math.min(state.duration, state.start + 0.05);
        clampRegion();
        syncSlidersFromState();
      });

      function bindTimeInput(inputId, key) {
        $(inputId).addEventListener('change', () => {
          const v = parseFloat($(inputId).value.replace(',', '.'));
          if (!Number.isFinite(v)) return;
          state[key] = v;
          clampRegion();
          syncSlidersFromState();
        });
      }
      bindTimeInput('startInput', 'start');
      bindTimeInput('endInput', 'end');

      $('crossfadeSlider').addEventListener('input', () => {
        state.crossfadeMs = Number($('crossfadeSlider').value);
        $('crossfadeInput').value = state.crossfadeMs;
        updateSegmentInfo();
      });
      $('crossfadeInput').addEventListener('change', () => {
        state.crossfadeMs = Math.max(0, Math.min(5000, Number($('crossfadeInput').value) || 0));
        clampRegion();
        syncSlidersFromState();
      });

      $('repeatsSlider').addEventListener('input', () => {
        state.repeats = Number($('repeatsSlider').value);
        $('repeatsInput').value = state.repeats;
        updateSegmentInfo();
      });
      $('repeatsInput').addEventListener('change', () => {
        state.repeats = Math.max(1, Math.min(100, Math.floor(Number($('repeatsInput').value) || 1)));
        syncSlidersFromState();
      });

      // --- Playback ---
      let loopRaf = null;

      function stopLoopPreview() {
        state.looping = false;
        if (loopRaf) cancelAnimationFrame(loopRaf);
        loopRaf = null;
        $('playhead').style.display = 'none';
        $('loopPreviewBtn').textContent = '↻ Podgląd pętli';
      }

      function tickPlayhead() {
        if (!state.duration || player.paused) {
          $('playhead').style.display = 'none';
          return;
        }
        const ph = $('playhead');
        ph.style.display = 'block';
        ph.style.left = (player.currentTime / state.duration) * 100 + '%';
        loopRaf = requestAnimationFrame(tickPlayhead);
      }

      player.addEventListener('play', () => {
        if (loopRaf) cancelAnimationFrame(loopRaf);
        tickPlayhead();
      });
      player.addEventListener('pause', () => {
        if (!state.looping) {
          if (loopRaf) cancelAnimationFrame(loopRaf);
          $('playhead').style.display = 'none';
        }
      });

      player.addEventListener('timeupdate', () => {
        if (!state.looping) return;
        if (player.currentTime >= state.end - 0.02) {
          player.currentTime = state.start;
        }
      });

      $('playRegionBtn').addEventListener('click', () => {
        stopLoopPreview();
        player.currentTime = state.start;
        const onTime = () => {
          if (player.currentTime >= state.end) {
            player.pause();
            player.removeEventListener('timeupdate', onTime);
          }
        };
        player.addEventListener('timeupdate', onTime);
        player.play();
      });

      $('loopPreviewBtn').addEventListener('click', () => {
        if (state.looping) {
          player.pause();
          stopLoopPreview();
          return;
        }
        state.looping = true;
        $('loopPreviewBtn').textContent = '⏸ Zatrzymaj pętlę';
        player.currentTime = state.start;
        player.play();
        tickPlayhead();
      });

      $('stopBtn').addEventListener('click', () => {
        player.pause();
        stopLoopPreview();
        player.currentTime = state.start;
      });

      $('autoSuggestBtn').addEventListener('click', async () => {
        if (!state.filename || state.suggesting) return;
        state.suggesting = true;
        const btn = $('autoSuggestBtn');
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Analizowanie…';
        $('errorBox').classList.add('hidden');
        try {
          const res = await fetch(`/api/suggest/${encodeURIComponent(state.filename)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Błąd analizy');
          applySuggestion(data);
        } catch (err) {
          // Fallback: lokalnie zapisane sugestie z uploadu
          if (state.suggestedEnd > state.suggestedStart) {
            applySuggestion({
              suggestedStart: state.suggestedStart,
              suggestedEnd: state.suggestedEnd,
              suggestedCrossfade: state.suggestedCrossfade,
              suggestionNote: state.suggestionNote,
            });
          } else {
            showError(err.message || 'Nie udało się zaproponować pętli.');
          }
        } finally {
          state.suggesting = false;
          btn.disabled = false;
          btn.textContent = prev;
        }
      });

      // --- Generate ---
      $('generateBtn').addEventListener('click', async () => {
        if (!state.filename || state.generating) return;
        state.generating = true;
        $('errorBox').classList.add('hidden');
        $('resultBox').classList.add('hidden');
        $('genProgress').classList.remove('hidden');
        $('genBar').style.width = '5%';
        $('genPct').textContent = '5%';
        $('genStatus').textContent = 'Przygotowanie…';
        $('generateBtn').disabled = true;

        const format = document.querySelector('input[name="format"]:checked')?.value || 'ogg';
        const normalize = Boolean($('normalizeToggle')?.checked);

        // Symulowany postęp (ffmpeg nie streamuje % łatwo przez HTTP)
        let fake = 5;
        const timer = setInterval(() => {
          fake = Math.min(90, fake + Math.random() * 8);
          $('genBar').style.width = fake + '%';
          $('genPct').textContent = Math.round(fake) + '%';
          if (fake < 35) $('genStatus').textContent = 'Wycinanie segmentu…';
          else if (fake < 55) $('genStatus').textContent = 'Crossfade…';
          else if (fake < 75 && normalize) $('genStatus').textContent = 'Normalizacja LUFS…';
          else $('genStatus').textContent = 'Kodowanie…';
        }, 400);

        try {
          const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: state.filename,
              start: state.start,
              end: state.end,
              crossfadeMs: state.crossfadeMs,
              format,
              repeats: state.repeats,
              normalize,
            }),
          });
          const data = await res.json();
          clearInterval(timer);
          if (!res.ok) throw new Error(data.error || 'Błąd generowania');

          $('genBar').style.width = '100%';
          $('genPct').textContent = '100%';
          $('genStatus').textContent = 'Gotowe';

          $('resultBox').classList.remove('hidden');
          const normLabel = data.normalize ? ' · LUFS ON' : ' · LUFS OFF';
          $('resultMeta').textContent =
            `${data.filename} · ${formatDuration(data.duration)} · crossfade ${data.crossfadeMs} ms · ${data.repeats}×${normLabel}`;
          const link = $('downloadLink');
          link.href = data.downloadUrl;
          link.download = data.filename;
          // Auto-pobieranie
          link.click();
        } catch (err) {
          clearInterval(timer);
          showError(err.message || 'Nie udało się wygenerować pętli.');
          $('genProgress').classList.add('hidden');
        } finally {
          state.generating = false;
          $('generateBtn').disabled = false;
        }
      });
    })();
