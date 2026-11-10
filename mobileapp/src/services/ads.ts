import { Platform } from 'react-native';
import { ADMOB_BANNER_UNIT_ID, ADMOB_INTERSTITIAL_UNIT_ID } from '../constants';

let initialized = false;

export async function initAds(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    const mobileAds = (await import('react-native-google-mobile-ads')).default;
    await mobileAds().initialize();
    initialized = true;
    return true;
  } catch {
    initialized = false;
    return false;
  }
}

export function adsAvailable(): boolean {
  return initialized;
}

export function getBannerUnitId(): string {
  return ADMOB_BANNER_UNIT_ID;
}

export function getInterstitialUnitId(): string {
  return ADMOB_INTERSTITIAL_UNIT_ID;
}

/** Show interstitial after generate (free users only). No-op if ads unavailable. */
export async function showInterstitialIfPossible(): Promise<void> {
  if (!initialized) return;
  try {
    const { InterstitialAd, AdEventType } = await import('react-native-google-mobile-ads');
    const interstitial = InterstitialAd.createForAdRequest(ADMOB_INTERSTITIAL_UNIT_ID);
    await new Promise<void>((resolve) => {
      const unsubLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
        unsubLoaded();
        interstitial.show().finally(() => resolve());
      });
      const unsubError = interstitial.addAdEventListener(AdEventType.ERROR, () => {
        unsubError();
        resolve();
      });
      interstitial.load();
      setTimeout(() => resolve(), 8000);
    });
  } catch {
    /* ignore */
  }
}
