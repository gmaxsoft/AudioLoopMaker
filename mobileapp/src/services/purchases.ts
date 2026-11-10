import { Platform } from 'react-native';
import { PREMIUM_PRODUCT_ID } from '../constants';
import { savePremiumFlag } from './premium';

type PurchaseModule = typeof import('react-native-iap');

let iap: PurchaseModule | null = null;

async function getIap(): Promise<PurchaseModule | null> {
  if (iap) return iap;
  try {
    iap = await import('react-native-iap');
    return iap;
  } catch {
    return null;
  }
}

export type ProductInfo = {
  productId: string;
  title: string;
  description: string;
  price: string;
};

/**
 * Connect to Play Billing. Returns false in Expo Go / missing native module.
 */
export async function initPurchases(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  const mod = await getIap();
  if (!mod) return false;
  try {
    await mod.initConnection();
    return true;
  } catch {
    return false;
  }
}

export async function endPurchases(): Promise<void> {
  const mod = await getIap();
  if (!mod) return;
  try {
    await mod.endConnection();
  } catch {
    /* ignore */
  }
}

export async function fetchPremiumProduct(): Promise<ProductInfo | null> {
  const mod = await getIap();
  if (!mod) return null;
  try {
    const products = await mod.fetchProducts({
      skus: [PREMIUM_PRODUCT_ID],
      type: 'in-app',
    });
    const p = products?.[0] as
      | { id?: string; title?: string; description?: string; displayPrice?: string; productId?: string; localizedPrice?: string }
      | undefined;
    if (!p) return null;
    return {
      productId: p.id || p.productId || PREMIUM_PRODUCT_ID,
      title: p.title || 'Premium',
      description: p.description || '',
      price: p.displayPrice || p.localizedPrice || '$3.99',
    };
  } catch {
    return null;
  }
}

/**
 * One-time Premium purchase.
 * In __DEV__ without native IAP, set simulate=true to unlock locally.
 */
export async function buyPremium(options?: { simulate?: boolean }): Promise<boolean> {
  if (options?.simulate && __DEV__) {
    await savePremiumFlag(true);
    return true;
  }

  const mod = await getIap();
  if (!mod) {
    if (__DEV__) {
      await savePremiumFlag(true);
      return true;
    }
    throw new Error('IAP unavailable — use a development build with Play Billing');
  }

  try {
    await mod.requestPurchase({
      type: 'in-app',
      request: {
        google: { skus: [PREMIUM_PRODUCT_ID] },
        apple: { sku: PREMIUM_PRODUCT_ID },
      },
    });
    await savePremiumFlag(true);
    return true;
  } catch (e) {
    throw e instanceof Error ? e : new Error('Purchase failed');
  }
}

export async function restorePremium(): Promise<boolean> {
  const mod = await getIap();
  if (!mod) {
    if (__DEV__) {
      const owned = await import('./premium').then((m) => m.loadPremiumFlag());
      return owned;
    }
    return false;
  }
  try {
    const purchases = await mod.getAvailablePurchases();
    const owned = (purchases || []).some(
      (p: { productId?: string; id?: string }) =>
        p.productId === PREMIUM_PRODUCT_ID || p.id === PREMIUM_PRODUCT_ID
    );
    if (owned) await savePremiumFlag(true);
    return owned;
  } catch {
    return false;
  }
}
