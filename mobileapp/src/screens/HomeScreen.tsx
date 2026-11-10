import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { AdBanner } from '../components/AdBanner';
import { PremiumModal } from '../components/PremiumModal';
import { usePremium } from '../context/PremiumContext';
import { API_BASE_URL, DEFAULT_CROSSFADE_MS, FREE_MAX_FILE_BYTES } from '../constants';
import {
  absoluteMediaUrl,
  generateLoop,
  refineSeam,
  suggestLoop,
  uploadAudio,
} from '../services/api';
import { showInterstitialIfPossible } from '../services/ads';
import { setAppLocale } from '../i18n';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '0.00 s';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${Number(s).toFixed(2)} s`;
}

export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const premium = usePremium();

  const [premiumOpen, setPremiumOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [filename, setFilename] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [crossfadeMs, setCrossfadeMs] = useState(DEFAULT_CROSSFADE_MS);
  const [repeats, setRepeats] = useState(1);
  const [format, setFormat] = useState<'ogg' | 'wav'>('ogg');
  const [normalize, setNormalize] = useState(false);
  const [pingPong, setPingPong] = useState(false);
  const [suggestText, setSuggestText] = useState<string | null>(null);
  const [seamText, setSeamText] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceUrlRef = useRef<string | null>(null);

  const segmentInfo = useMemo(() => {
    const len = Math.max(0, end - start);
    const cf = crossfadeMs / 1000;
    const outLen = Math.max(0, len - (cf > 0.001 ? cf : 0)) * repeats * (pingPong ? 2 : 1);
    return t('segment', { len: formatDuration(len), out: formatDuration(outLen) });
  }, [start, end, crossfadeMs, repeats, pingPong, t]);

  const unloadSound = useCallback(async () => {
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.remove();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    }
  }, []);

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const size = asset.size ?? 0;

    if (!premium.isPremium && size > FREE_MAX_FILE_BYTES) {
      Alert.alert(
        t('premiumRequired'),
        t('fileTooLarge', { size: formatBytes(size) }),
        [
          { text: t('close'), style: 'cancel' },
          { text: t('premium'), onPress: () => setPremiumOpen(true) },
        ]
      );
      return;
    }

    setBusy(true);
    setStatus(t('loading'));
    setResultUrl(null);
    setSeamText(null);
    try {
      await unloadSound();
      const uploaded = await uploadAudio(
        asset.uri,
        asset.name || 'audio.mp3',
        asset.mimeType || 'audio/mpeg'
      );
      setFilename(uploaded.filename);
      setOriginalName(uploaded.originalName);
      setDuration(uploaded.duration);
      setStart(uploaded.suggestedStart ?? 0);
      setEnd(uploaded.suggestedEnd ?? uploaded.duration);
      setCrossfadeMs(DEFAULT_CROSSFADE_MS);
      setFileMeta(
        `${formatDuration(uploaded.duration)} · ${formatBytes(uploaded.size)} · ${uploaded.sampleRate} Hz`
      );
      setSuggestText(
        t('suggestInfo', {
          start: (uploaded.suggestedStart ?? 0).toFixed(3),
          end: (uploaded.suggestedEnd ?? uploaded.duration).toFixed(3),
          cf: DEFAULT_CROSSFADE_MS,
        })
      );
      sourceUrlRef.current = absoluteMediaUrl(uploaded.url);
      setStatus(null);
    } catch (e) {
      Alert.alert(t('error'), e instanceof Error ? e.message : t('uploadError'));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const applyRange = (s: number, e: number, note?: string) => {
    setStart(s);
    setEnd(e);
    setCrossfadeMs(DEFAULT_CROSSFADE_MS);
    setSuggestText(
      t('suggestInfo', {
        start: s.toFixed(3),
        end: e.toFixed(3),
        cf: DEFAULT_CROSSFADE_MS,
      }) + (note ? `\n${note}` : '')
    );
  };

  const onBest = async () => {
    if (!filename) return;
    setBusy(true);
    try {
      const data = await suggestLoop(filename, 'best');
      const s = data.best?.suggestedStart ?? data.suggestedStart;
      const e = data.best?.suggestedEnd ?? data.suggestedEnd;
      applyRange(s, e, data.best?.suggestionNote || data.suggestionNote);
    } catch (err) {
      Alert.alert(t('error'), err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const onLongest = async () => {
    if (!filename) return;
    setBusy(true);
    try {
      const data = await suggestLoop(filename, 'longest');
      const s = data.longest?.suggestedStart ?? data.suggestedStart;
      const e = data.longest?.suggestedEnd ?? data.suggestedEnd;
      applyRange(s, e, data.longest?.suggestionNote || data.suggestionNote);
    } catch (err) {
      Alert.alert(t('error'), err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const onRefine = async () => {
    if (!filename) return;
    setBusy(true);
    try {
      const data = await refineSeam(filename, start, end);
      applyRange(data.suggestedStart, data.suggestedEnd, data.suggestionNote);
      if (data.seamLabel != null) {
        setSeamText(
          t('seamInfo', { label: data.seamLabel, score: data.seamScore ?? '—' })
        );
      }
    } catch (err) {
      Alert.alert(t('error'), err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const playFragment = async () => {
    if (!sourceUrlRef.current) return;
    await unloadSound();
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer({ uri: sourceUrlRef.current });
    playerRef.current = player;
    await player.seekTo(start);
    player.play();
    loopTimerRef.current = setInterval(() => {
      if (!playerRef.current?.playing) return;
      if (playerRef.current.currentTime >= end) {
        playerRef.current.pause();
        if (loopTimerRef.current) {
          clearInterval(loopTimerRef.current);
          loopTimerRef.current = null;
        }
      }
    }, 50);
  };

  const previewLoop = async () => {
    if (!sourceUrlRef.current) return;
    await unloadSound();
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer({ uri: sourceUrlRef.current });
    playerRef.current = player;
    await player.seekTo(start);
    player.play();
    loopTimerRef.current = setInterval(() => {
      if (!playerRef.current?.playing) return;
      if (playerRef.current.currentTime >= end - 0.02) {
        void playerRef.current.seekTo(start);
      }
    }, 40);
  };

  const onGenerate = async () => {
    if (!filename) return;
    const useNormalize = premium.canUseNormalize && normalize;
    const usePingPong = premium.canUsePingPong && pingPong;

    setBusy(true);
    setStatus(t('generating'));
    setResultUrl(null);
    try {
      const data = await generateLoop({
        filename,
        start,
        end,
        crossfadeMs,
        format,
        repeats,
        normalize: useNormalize,
        pingPong: usePingPong,
      });
      const url = absoluteMediaUrl(data.downloadUrl);
      setResultUrl(url);
      setResultMeta(
        `${data.filename} · ${formatDuration(data.duration)} · ${data.sampleRate} Hz` +
          (data.pingPong ? ' · ping-pong' : '') +
          (data.normalize ? ' · LUFS' : '')
      );
      setStatus(t('ready'));
      if (premium.showAds) {
        void showInterstitialIfPossible();
      }
    } catch (err) {
      Alert.alert(t('error'), err instanceof Error ? err.message : t('error'));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    if (!resultUrl) return;
    await Share.share({ url: resultUrl, message: resultUrl });
  };

  const toggleNormalize = (v: boolean) => {
    if (v && !premium.canUseNormalize) {
      setPremiumOpen(true);
      return;
    }
    setNormalize(v);
  };

  const togglePingPong = (v: boolean) => {
    if (v && !premium.canUsePingPong) {
      setPremiumOpen(true);
      return;
    }
    setPingPong(v);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('appName')}</Text>
            <Text style={styles.tagline}>{t('tagline')}</Text>
          </View>
          <Pressable style={styles.premiumBtn} onPress={() => setPremiumOpen(true)}>
            <Text style={styles.premiumBtnText}>
              {premium.isPremium ? '★ Premium' : t('premium')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>{t('language')}</Text>
          <View style={styles.langRow}>
            <Pressable
              style={[styles.chip, i18n.language === 'en' && styles.chipOn]}
              onPress={() => void setAppLocale('en')}
            >
              <Text style={styles.chipText}>{t('english')}</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, i18n.language === 'pl' && styles.chipOn]}
              onPress={() => void setAppLocale('pl')}
            >
              <Text style={styles.chipText}>{t('polish')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.label}>{t('pickFile')}</Text>
          <Text style={styles.hint}>{t('dropHint')}</Text>
          {!premium.isPremium ? (
            <Text style={styles.warn}>
              {t('freeLimit', { size: (FREE_MAX_FILE_BYTES / 1048576).toFixed(0) })}
            </Text>
          ) : null}
          <Pressable style={styles.primary} onPress={pickFile} disabled={busy}>
            <Text style={styles.primaryText}>
              {originalName ? t('changeFile') : t('pickFile')}
            </Text>
          </Pressable>
          {originalName ? (
            <>
              <Text style={styles.fileName}>{originalName}</Text>
              <Text style={styles.hint}>{fileMeta}</Text>
            </>
          ) : null}
        </View>

        {filename ? (
          <>
            {suggestText ? <Text style={styles.suggest}>{suggestText}</Text> : null}
            {seamText ? <Text style={styles.suggest}>{seamText}</Text> : null}

            <View style={styles.actions}>
              <Action label={t('playFragment')} onPress={playFragment} />
              <Action label={t('previewLoop')} onPress={previewLoop} />
              <Action label={t('stop')} onPress={unloadSound} />
              <Action label={t('bestLoop')} onPress={onBest} />
              <Action label={t('longestLoop')} onPress={onLongest} />
              <Action label={t('refineSeam')} onPress={onRefine} />
            </View>

            <Field
              label={t('start')}
              value={String(start)}
              onChange={(v) => setStart(Number(v) || 0)}
              suffix={t('seconds')}
            />
            <Field
              label={t('end')}
              value={String(end)}
              onChange={(v) => setEnd(Number(v) || 0)}
              suffix={t('seconds')}
            />
            <Field
              label={t('crossfade')}
              value={String(crossfadeMs)}
              onChange={(v) => setCrossfadeMs(Math.max(0, Math.min(5000, Number(v) || 0)))}
              suffix="ms"
            />
            <Field
              label={t('repeats')}
              value={String(repeats)}
              onChange={(v) => setRepeats(Math.max(1, Math.min(100, Math.floor(Number(v) || 1))))}
              suffix="×"
            />

            <Text style={styles.label}>{t('format')}</Text>
            <View style={styles.langRow}>
              <Pressable
                style={[styles.chip, format === 'ogg' && styles.chipOn]}
                onPress={() => setFormat('ogg')}
              >
                <Text style={styles.chipText}>.ogg</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, format === 'wav' && styles.chipOn]}
                onPress={() => setFormat('wav')}
              >
                <Text style={styles.chipText}>.wav</Text>
              </Pressable>
            </View>

            <ToggleRow
              label={t('normalize')}
              hint={t('normalizeHint')}
              value={normalize}
              onChange={toggleNormalize}
              locked={!premium.canUseNormalize}
            />
            <ToggleRow
              label={t('pingPong')}
              hint={t('pingPongHint')}
              value={pingPong}
              onChange={togglePingPong}
              locked={!premium.canUsePingPong}
            />

            <Text style={styles.hint}>{segmentInfo}</Text>

            <Pressable style={styles.primary} onPress={onGenerate} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>{t('generate')}</Text>
              )}
            </Pressable>

            {resultUrl ? (
              <View style={styles.result}>
                <Text style={styles.label}>{t('ready')}</Text>
                <Text style={styles.hint}>{resultMeta}</Text>
                <Pressable style={styles.ghost} onPress={onShare}>
                  <Text style={styles.ghostText}>{t('download')}</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}

        {status ? <Text style={styles.status}>{status}</Text> : null}
        <Text style={styles.api}>{t('apiHint', { url: API_BASE_URL })}</Text>
      </ScrollView>

      <AdBanner />
      <PremiumModal visible={premiumOpen} onClose={() => setPremiumOpen(false)} />
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void | Promise<void> }) {
  return (
    <Pressable style={styles.action} onPress={() => void onPress()}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
        />
        <Text style={styles.hint}>{suffix}</Text>
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  locked,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  locked: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>
          {label}
          {locked ? ' 🔒' : ''}
        </Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#2a323e', true: '#2a6f67' }}
        thumbColor={value ? '#3d9b8f' : '#8b95a5'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0e12' },
  scroll: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'flex-start' },
  title: { color: '#e8ecf1', fontSize: 24, fontWeight: '700' },
  tagline: { color: '#8b95a5', marginTop: 4, fontSize: 13 },
  premiumBtn: {
    backgroundColor: '#3d9b8f',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  premiumBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  row: { marginBottom: 12 },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: { borderColor: '#3d9b8f', backgroundColor: 'rgba(61,155,143,0.15)' },
  chipText: { color: '#e8ecf1', fontWeight: '600' },
  panel: {
    backgroundColor: '#1a1f27',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a323e',
    padding: 14,
    marginBottom: 14,
  },
  label: {
    color: '#8b95a5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 10,
  },
  hint: { color: '#8b95a5', fontSize: 12 },
  warn: { color: '#e8b84a', fontSize: 12, marginTop: 6, marginBottom: 4 },
  primary: {
    marginTop: 12,
    backgroundColor: '#3d9b8f',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghost: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostText: { color: '#e8ecf1', fontWeight: '600' },
  fileName: { color: '#e8ecf1', marginTop: 12, fontWeight: '600' },
  suggest: { color: '#8b95a5', fontSize: 12, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  action: {
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionText: { color: '#e8ecf1', fontSize: 12, fontWeight: '600' },
  fieldWrap: { marginBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#12161c',
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 8,
    color: '#e8ecf1',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'monospace',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#12161c',
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  toggleLabel: { color: '#e8ecf1', fontWeight: '600', marginBottom: 4 },
  result: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#12161c',
    borderWidth: 1,
    borderColor: '#2a323e',
  },
  status: { color: '#3d9b8f', marginTop: 12, textAlign: 'center' },
  api: { color: '#5c6b7a', fontSize: 10, marginTop: 20, textAlign: 'center' },
});
