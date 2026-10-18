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

/**
 * Generuje płynną pętlę audio:
 * 1) wycina segment → tymczasowy WAV
 * 2) nakłada koniec na początek (crossfade / acrossfade)
 * 3) opcjonalnie powtarza blok X razy
 * 4) koduje do .ogg (Vorbis) lub .wav
 */
async function generateLoop({
  inputPath,
  outputPath,
  startSec,
  endSec,
  crossfadeMs,
  format,
  repeats,
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
      if (format === 'ogg') {
        cmd = cmd.audioCodec('libvorbis').audioQuality(4).format('ogg');
      } else {
        cmd = cmd.audioCodec('pcm_s16le').format('wav');
      }
      cmd.on('error', reject).on('end', resolve).save(outputPath);
    });

    const outMeta = await probeAudio(outputPath);
    return { duration: outMeta.duration };
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

app.post('/api/generate', async (req, res) => {
  const {
    filename,
    start,
    end,
    crossfadeMs = 50,
    format = 'ogg',
    repeats = 1,
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
    });

    res.json({
      success: true,
      downloadUrl: `/outputs/${outName}`,
      filename: outName,
      duration: result.duration,
      format: outFormat,
      crossfadeMs: Number(crossfadeMs) || 0,
      repeats: Math.max(1, Math.min(100, Math.floor(Number(repeats) || 1))),
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
