/** Free tier: max upload size (10 MB). Premium: unlimited. */
export const FREE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Google Play one-time product ID (configure in Play Console). */
export const PREMIUM_PRODUCT_ID = 'alm_premium';

export const PREMIUM_PRICE_LABEL = '$3.99';

/** AdMob test IDs — replace with production IDs before release. */
export const ADMOB_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
export const ADMOB_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';
export const ADMOB_INTERSTITIAL_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';

/**
 * Backend Audio Loop Maker API.
 * Android emulator → host machine: http://10.0.2.2:3000
 * Physical device → your LAN IP, e.g. http://192.168.1.10:3000
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://10.0.2.2:3000';

export const DEFAULT_CROSSFADE_MS = 140;
export const ASYNC_PREMIUM_KEY = '@alm/premium';
export const ASYNC_LOCALE_KEY = '@alm/locale';
