import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadPremiumFlag, savePremiumFlag } from '../services/premium';
import {
  buyPremium,
  endPurchases,
  fetchPremiumProduct,
  initPurchases,
  restorePremium,
  type ProductInfo,
} from '../services/purchases';
import { initAds } from '../services/ads';
import { FREE_MAX_FILE_BYTES, PREMIUM_PRICE_LABEL } from '../constants';

type PremiumContextValue = {
  isPremium: boolean;
  ready: boolean;
  product: ProductInfo | null;
  maxFileBytes: number;
  canUseNormalize: boolean;
  canUsePingPong: boolean;
  showAds: boolean;
  purchase: (simulate?: boolean) => Promise<void>;
  restore: () => Promise<boolean>;
  setPremiumDev: (v: boolean) => Promise<void>;
};

const PremiumContext = createContext<PremiumContextValue | null>(null);

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [ready, setReady] = useState(false);
  const [product, setProduct] = useState<ProductInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const owned = await loadPremiumFlag();
      if (!mounted) return;
      setIsPremium(owned);
      if (!owned) {
        await initAds();
      }
      const ok = await initPurchases();
      if (ok) {
        const p = await fetchPremiumProduct();
        if (mounted && p) setProduct(p);
      }
      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
      void endPurchases();
    };
  }, []);

  const purchase = useCallback(async (simulate?: boolean) => {
    await buyPremium({ simulate: Boolean(simulate) });
    setIsPremium(true);
  }, []);

  const restore = useCallback(async () => {
    const owned = await restorePremium();
    if (owned) setIsPremium(true);
    return owned;
  }, []);

  const setPremiumDev = useCallback(async (v: boolean) => {
    await savePremiumFlag(v);
    setIsPremium(v);
  }, []);

  const value = useMemo<PremiumContextValue>(
    () => ({
      isPremium,
      ready,
      product,
      maxFileBytes: isPremium ? Number.POSITIVE_INFINITY : FREE_MAX_FILE_BYTES,
      canUseNormalize: isPremium,
      canUsePingPong: isPremium,
      showAds: !isPremium,
      purchase,
      restore,
      setPremiumDev,
    }),
    [isPremium, ready, product, purchase, restore, setPremiumDev]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremium outside PremiumProvider');
  return ctx;
}

export function formatPrice(product: ProductInfo | null): string {
  return product?.price || PREMIUM_PRICE_LABEL;
}
