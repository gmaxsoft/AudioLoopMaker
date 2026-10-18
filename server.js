const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUTS_DIR = path.join(__dirname, 'public', 'outputs');

for (const dir of [UPLOADS_DIR, OUTPUTS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: Infinity,
    fieldSize: Infinity,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(mp3|wav|ogg|flac|m4a|aac|wma|aiff|aif|opus|webm)$/i;
    if (allowed.test(path.extname(file.originalname)) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Nieobsługiwany format pliku audio.'));
    }
  },
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Usuwa plik, ignorując błędy braku pliku. */
function safeUnlink(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

/** Probe metadanych audio (czas trwania, kanały, sample rate). */
function probeAudio(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const stream = (metadata.streams || []).find((s) => s.codec_type === 'audio');
      if (!stream) return reject(new Error('Nie znaleziono ścieżki audio w pliku.'));
      const duration = Number(metadata.format?.duration || stream.duration || 0);
      resolve({
        duration,
        channels: stream.channels || 2,
        sampleRate: Number(stream.sample_rate) || 44100,
        codec: stream.codec_name || 'unknown',
        format: metadata.format?.format_name || 'unknown',
        bitRate: Number(metadata.format?.bit_rate) || null,
      });
    });
  });
}

const ANALYSIS_RATE = 22050;

/** Dekoduje audio do mono PCM s16le (raw) do analizy. */
function extractMonoPcm(inputPath, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(ANALYSIS_RATE)
      .audioCodec('pcm_s16le')
      .format('s16le')
      .on('error', reject)
      .on('end', resolve)
      .save(outPath);
  });
}

/** Najbliższe przejście przez zero w okolicy indeksu. */
function nearestZeroCrossing(samples, index, searchRadius) {
  const n = samples.length;
  const center = Math.max(0, Math.min(n - 1, index | 0));
  const radius = Math.max(1, searchRadius | 0);
  let best = center;
  let bestAbs = Math.abs(samples[center]);

  for (let d = 0; d <= radius; d++) {
    for (const idx of [center - d, center + d]) {
      if (idx <= 0 || idx >= n - 1) continue;
      const a = samples[idx - 1];
      const b = samples[idx];
      const crossed = (a >= 0 && b < 0) || (a < 0 && b >= 0) || b === 0;
      const absB = Math.abs(b);
      if (crossed && absB <= bestAbs) {
        bestAbs = absB;
        best = idx;
        if (absB === 0) return best;
      } else if (absB < bestAbs) {
        bestAbs = absB;
        best = idx;
      }
    }
  }
  return best;
}

/** RMS w oknie [from, to). */
function windowRms(samples, from, to) {
  let sum = 0;
  const start = Math.max(0, from | 0);
  const end = Math.min(samples.length, to | 0);
  const len = end - start;
  if (len <= 0) return 0;
  for (let i = start; i < end; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / len);
}

/** Korelacja znormalizowana dwóch wycinków (podobieństwo styku pętli). */
function normalizedCorrelation(samples, aStart, bStart, length) {
  const n = samples.length;
  const len = Math.min(length, n - aStart, n - bStart);
  if (len < 8) return 0;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < len; i++) {
    meanA += samples[aStart + i];
    meanB += samples[bStart + i];
  }
  meanA /= len;
  meanB /= len;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < len; i++) {
    const da = samples[aStart + i] - meanA;
    const db = samples[bStart + i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/** Minimalny próg jakości, by uznać fragment za nadający się na pętlę. */
const LOOP_QUALITY_THRESHOLD = 0.38;

function snapSuggestion(candidate, samples, sampleRate, duration, notePrefix) {
  const zcRadius = Math.floor(sampleRate * 0.02);
  const snappedStart = nearestZeroCrossing(samples, candidate.startIdx, zcRadius);
  let snappedEnd = nearestZeroCrossing(samples, candidate.endIdx, zcRadius);
  if (snappedEnd <= snappedStart + Math.floor(0.5 * sampleRate)) {
    snappedEnd = Math.min(
      samples.length - 1,
      snappedStart + Math.floor(candidate.loopLen * sampleRate)
    );
  }
  const suggestedStart = Number((snappedStart / sampleRate).toFixed(3));
  const suggestedEnd = Number(Math.min(duration, snappedEnd / sampleRate).toFixed(3));
  const segLen = suggestedEnd - suggestedStart;
  return {
    suggestedStart,
    suggestedEnd,
    suggestedCrossfade: 140,
    suggestionNote: `${notePrefix} ~${segLen.toFixed(1)} s (score ${candidate.score.toFixed(2)})`,
  };
}

/**
 * Analiza PCM – zwraca dwie propozycje:
 * - best: najlepszy jakościowo fragment (5–30 s)
 * - longest: najdłuższy fragment spełniający próg jakości pętli
 */
function analyzeSamplesForLoop(samples, sampleRate, durationSec) {
  const duration = Math.max(0, Number(durationSec) || samples.length / sampleRate);
  const fallbackOne = {
    suggestedStart: 0,
    suggestedEnd: Number(duration.toFixed(3)),
    suggestedCrossfade: 140,
    suggestionNote: 'Cały utwór (fallback)',
  };
  const fallback = { best: fallbackOne, longest: { ...fallbackOne } };

  if (!samples || samples.length < sampleRate * 0.2) {
    return fallback;
  }

  const edgeMs = 80;
  const edgeSamples = Math.floor((edgeMs / 1000) * sampleRate);
  const zcRadius = Math.floor(sampleRate * 0.02);

  // Krótkie nagrania: cały utwór
  if (duration <= 8) {
    const startIdx = nearestZeroCrossing(samples, 0, zcRadius * 2);
    const endIdx = nearestZeroCrossing(samples, samples.length - 1, zcRadius * 2);
    const start = Math.max(0, startIdx / sampleRate);
    const end = Math.min(duration, Math.max(start + 0.05, endIdx / sampleRate));
    const one = {
      suggestedStart: Number(start.toFixed(3)),
      suggestedEnd: Number(end.toFixed(3)),
      suggestedCrossfade: 140,
      suggestionNote: 'Cały utwór ze snappowaniem zero-crossing',
    };
    return { best: one, longest: { ...one } };
  }

  // Pomiń ciszę / fade na brzegach
  const margin = Math.min(2, duration * 0.03);
  const searchStart = Math.floor(margin * sampleRate);
  const searchEnd = Math.floor((duration - margin) * sampleRate);
  const usableSec = Math.max(1, (searchEnd - searchStart) / sampleRate);

  const hop = Math.max(1, Math.floor(0.25 * sampleRate)); // 250 ms
  const energyWin = Math.floor(0.05 * sampleRate);

  function scoreWindow(i, winSamples, loopLen) {
    const endIdx = i + winSamples;
    const chunkRms = [];
    for (let t = i; t + energyWin <= endIdx; t += energyWin) {
      chunkRms.push(windowRms(samples, t, t + energyWin));
    }
    if (chunkRms.length < 2) return null;
    const meanRms = chunkRms.reduce((a, b) => a + b, 0) / chunkRms.length;
    if (meanRms < 0.008) return null;

    let varSum = 0;
    for (const r of chunkRms) {
      const d = r - meanRms;
      varSum += d * d;
    }
    const rmsStd = Math.sqrt(varSum / chunkRms.length);
    const stability = meanRms > 0 ? 1 / (1 + (rmsStd / meanRms) * 4) : 0;

    const corrLen = Math.min(edgeSamples, Math.floor(winSamples / 4));
    const corr = normalizedCorrelation(samples, i, endIdx - corrLen, corrLen);

    const edgeEnergy =
      (windowRms(samples, i, i + Math.min(edgeSamples, winSamples)) +
        windowRms(samples, endIdx - Math.min(edgeSamples, winSamples), endIdx)) /
      2;
    const edgeScore = 1 / (1 + edgeEnergy * 8);

    const lengthBonus = Math.min(1, loopLen / 30) * 0.15;
    const quality = stability * 0.4 + Math.max(0, corr) * 0.45 + edgeScore * 0.15;
    return {
      startIdx: i,
      endIdx,
      score: quality + lengthBonus,
      quality,
      corr,
      loopLen,
    };
  }

  function findBestAtLength(loopLen) {
    const winSamples = Math.floor(loopLen * sampleRate);
    if (winSamples < energyWin * 4) return null;
    const maxStart = Math.min(searchEnd - winSamples, samples.length - winSamples - 1);
    if (maxStart <= searchStart) return null;

    let localBest = null;
    for (let i = searchStart; i <= maxStart; i += hop) {
      const c = scoreWindow(i, winSamples, loopLen);
      if (!c) continue;
      if (!localBest || c.score > localBest.score) localBest = c;
    }
    return localBest;
  }

  // --- Najlepsza jakościowo (5–30 s) ---
  const bestLengths = [5, 8, 10, 12, 15, 20, 30].filter((l) => l <= usableSec);
  if (bestLengths.length === 0) bestLengths.push(Math.max(1, usableSec));

  let bestCand = null;
  for (const loopLen of bestLengths) {
    const c = findBestAtLength(loopLen);
    if (!c) continue;
    if (!bestCand || c.score > bestCand.score) bestCand = c;
  }

  // --- Najdłuższy nadający się na pętlę (od max w dół, pierwszy spełniający próg) ---
  let longestCand = null;
  const maxLong = Math.floor(usableSec);
  for (let L = maxLong; L >= 5; L -= L > 90 ? 5 : L > 45 ? 2 : 1) {
    const c = findBestAtLength(L);
    if (c && c.quality >= LOOP_QUALITY_THRESHOLD) {
      longestCand = c;
      break; // pierwsza (najdłuższa) spełniająca próg
    }
  }

  if (!bestCand) {
    const len = Math.min(10, duration);
    const midStart = Math.max(0, (duration - len) / 2);
    bestCand = {
      startIdx: Math.floor(midStart * sampleRate),
      endIdx: Math.floor((midStart + len) * sampleRate),
      score: 0,
      quality: 0,
      corr: 0,
      loopLen: len,
    };
  }
  if (!longestCand) longestCand = bestCand;

  return {
    best: snapSuggestion(bestCand, samples, sampleRate, duration, 'Najlepsza pętla'),
    longest: snapSuggestion(longestCand, samples, sampleRate, duration, 'Najdłuższy fragment na pętlę'),
  };
}

/** Pełna ścieżka: dekoduj → analizuj (best + longest) → posprzątaj. */
async function suggestLoops(inputPath, durationSec) {
  const tmpPcm = path.join(UPLOADS_DIR, `${uuidv4()}_analyze.pcm`);
  try {
    await extractMonoPcm(inputPath, tmpPcm);
    const buf = await fs.promises.readFile(tmpPcm);
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    return analyzeSamplesForLoop(samples, ANALYSIS_RATE, durationSec);
  } finally {
    safeUnlink(tmpPcm);
  }
}

/** Kompatybilność: zwraca tylko propozycję „best”. */
async function suggestBestLoop(inputPath, durationSec) {
  const both = await suggestLoops(inputPath, durationSec);
  return both.best;
}

/** Filtr EBU R128 – wyrównanie głośności do poziomu streamingowego. */
const LOUDNORM_FILTER = 'loudnorm=I=-14:LRA=11:TP=-1.5';

/**
 * Generuje płynną pętlę audio:
 * 1) wycina segment → tymczasowy WAV
 * 2) nakłada koniec na początek (crossfade / acrossfade)
 * 3) opcjonalnie powtarza blok X razy
 * 4) opcjonalna normalizacja LUFS (loudnorm)
 * 5) koduje do .ogg (Vorbis) lub .wav
 */
async function generateLoop({
  inputPath,
  outputPath,
  startSec,
  endSec,
  crossfadeMs,
  format,
  repeats,
  normalize = true,
}) {
  const duration = endSec - startSec;
  const crossfadeSec = Math.max(0, Number(crossfadeMs) || 0) / 1000;
  const reps = Math.max(1, Math.min(100, Math.floor(Number(repeats) || 1)));
  const jobId = uuidv4();
  const tmpSeg = path.join(UPLOADS_DIR, `${jobId}_seg.wav`);
  const tmpLoop = path.join(UPLOADS_DIR, `${jobId}_loop.wav`);
  const tmpRepeated = path.join(UPLOADS_DIR, `${jobId}_rep.wav`);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startSec)
        .duration(duration)
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('error', reject)
        .on('end', resolve)
        .save(tmpSeg);
    });

    const cf = Math.min(crossfadeSec, duration / 2 - 0.001);

    if (cf > 0.001) {
      const filter = [
        `[0:a]asplit=3[s0][s1][s2]`,
        `[s0]atrim=${cf}:${duration - cf},asetpts=PTS-STARTPTS[main]`,
        `[s1]atrim=${duration - cf}:${duration},asetpts=PTS-STARTPTS[end]`,
        `[s2]atrim=0:${cf},asetpts=PTS-STARTPTS[begin]`,
        `[end][begin]acrossfade=d=${cf}:c1=tri:c2=tri[xf]`,
        `[main][xf]concat=n=2:v=0:a=1[out]`,
      ].join(';');

      await new Promise((resolve, reject) => {
        ffmpeg(tmpSeg)
          .complexFilter(filter)
          .outputOptions(['-map', '[out]'])
          .audioCodec('pcm_s16le')
          .format('wav')
          .on('error', reject)
          .on('end', resolve)
          .save(tmpLoop);
      });
    } else {
      fs.copyFileSync(tmpSeg, tmpLoop);
    }

    let sourceForEncode = tmpLoop;

    if (reps > 1) {
      const inputs = Array.from({ length: reps }, () => tmpLoop);
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        inputs.forEach((p) => cmd.input(p));
        const concatList = inputs.map((_, i) => `[${i}:a]`).join('');
        cmd
          .complexFilter(`${concatList}concat=n=${reps}:v=0:a=1[out]`)
          .outputOptions(['-map', '[out]'])
          .audioCodec('pcm_s16le')
          .format('wav')
          .on('error', reject)
          .on('end', resolve)
          .save(tmpRepeated);
      });
      sourceForEncode = tmpRepeated;
    }

    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(sourceForEncode);
      if (normalize) {
        cmd = cmd.audioFilters(LOUDNORM_FILTER);
      }
      if (format === 'ogg') {
        cmd = cmd.audioCodec('libvorbis').audioQuality(4).format('ogg');
      } else {
        cmd = cmd.audioCodec('pcm_s16le').format('wav');
      }
      cmd.on('error', reject).on('end', resolve).save(outputPath);
    });

    const outMeta = await probeAudio(outputPath);
    return { duration: outMeta.duration, normalized: Boolean(normalize) };
  } finally {
    safeUnlink(tmpSeg);
    safeUnlink(tmpLoop);
    safeUnlink(tmpRepeated);
  }
}

// --- API ---

app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nie przesłano pliku audio.' });
    }

    const meta = await probeAudio(req.file.path);

    const fallbackOne = {
      suggestedStart: 0,
      suggestedEnd: Number(meta.duration.toFixed(3)),
      suggestedCrossfade: 140,
      suggestionNote: 'Domyślnie cały utwór',
    };
    let suggestions = { best: fallbackOne, longest: { ...fallbackOne } };
    try {
      suggestions = await suggestLoops(req.file.path, meta.duration);
    } catch (analyseErr) {
      console.warn('Analiza pętli nie powiodła się, użyto fallback:', analyseErr.message);
    }

    const best = suggestions.best;
    const longest = suggestions.longest;

    res.json({
      id: path.basename(req.file.filename, path.extname(req.file.filename)),
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
      duration: meta.duration,
      channels: meta.channels,
      sampleRate: meta.sampleRate,
      codec: meta.codec,
      suggestedStart: best.suggestedStart,
      suggestedEnd: best.suggestedEnd,
      suggestedCrossfade: best.suggestedCrossfade,
      suggestionNote: best.suggestionNote || null,
      longestSuggestedStart: longest.suggestedStart,
      longestSuggestedEnd: longest.suggestedEnd,
      longestSuggestedCrossfade: longest.suggestedCrossfade,
      longestSuggestionNote: longest.suggestionNote || null,
    });
  } catch (err) {
    if (req.file) safeUnlink(req.file.path);
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Błąd podczas analizy pliku audio.' });
  }
});

// Serwowanie uploadów (podgląd w przeglądarce)
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/meta/:filename', async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Plik nie istnieje.' });
    }
    const meta = await probeAudio(filePath);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Propozycja pętli dla już wgranego pliku.
 * Query: ?mode=best (domyślnie) | mode=longest
 */
app.get('/api/suggest/:filename', async (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Plik nie istnieje.' });
    }
    const meta = await probeAudio(filePath);
    const both = await suggestLoops(filePath, meta.duration);
    const mode = String(req.query.mode || 'best').toLowerCase() === 'longest' ? 'longest' : 'best';
    const suggestion = both[mode];
    res.json({
      duration: meta.duration,
      mode,
      best: both.best,
      longest: both.longest,
      ...suggestion,
    });
  } catch (err) {
    console.error('Suggest error:', err);
    res.status(500).json({ error: err.message || 'Błąd analizy pętli.' });
  }
});

app.post('/api/generate', async (req, res) => {
  const {
    filename,
    start,
    end,
    crossfadeMs = 140,
    format = 'ogg',
    repeats = 1,
    normalize = true,
  } = req.body || {};

  try {
    if (!filename) {
      return res.status(400).json({ error: 'Brak nazwy pliku źródłowego.' });
    }

    const safeName = path.basename(filename);
    const inputPath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Plik źródłowy nie istnieje. Wgraj audio ponownie.' });
    }

    const meta = await probeAudio(inputPath);
    const startSec = Math.max(0, Number(start) || 0);
    let endSec = Math.min(meta.duration, Number(end) || meta.duration);

    if (!(endSec > startSec)) {
      return res.status(400).json({ error: 'Czas End musi być większy niż Start.' });
    }

    const segmentDuration = endSec - startSec;
    // Soft limit informacyjny 5 min – nie blokujemy dłuższych nagrań
    if (segmentDuration > 300) {
      console.log(`Uwaga: segment dłuższy niż 5 min (${segmentDuration.toFixed(1)} s).`);
    }

    // Domyślnie włączona; wyłączenie tylko przy jawnej wartości false
    const doNormalize = !(normalize === false || normalize === 'false' || normalize === 0 || normalize === '0');

    const outFormat = format === 'wav' ? 'wav' : 'ogg';
    const outName = `loop_${uuidv4()}.${outFormat}`;
    const outputPath = path.join(OUTPUTS_DIR, outName);

    const result = await generateLoop({
      inputPath,
      outputPath,
      startSec,
      endSec,
      crossfadeMs: Number(crossfadeMs) || 0,
      format: outFormat,
      repeats: Number(repeats) || 1,
      normalize: doNormalize,
    });

    res.json({
      success: true,
      downloadUrl: `/outputs/${outName}`,
      filename: outName,
      duration: result.duration,
      format: outFormat,
      crossfadeMs: Number(crossfadeMs) || 0,
      repeats: Math.max(1, Math.min(100, Math.floor(Number(repeats) || 1))),
      normalize: result.normalized,
    });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message || 'Błąd generowania pętli.' });
  }
});

app.post('/api/cleanup', (req, res) => {
  const { filename } = req.body || {};
  if (filename) {
    safeUnlink(path.join(UPLOADS_DIR, path.basename(filename)));
  }
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Błąd uploadu: ${err.message}` });
  }
  res.status(500).json({ error: err.message || 'Wewnętrzny błąd serwera.' });
});

app.listen(PORT, () => {
  console.log(`Audio Loop Maker działa na http://localhost:${PORT}`);
});
