import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { usePremium } from '../context/PremiumContext';
import { getBannerUnitId } from '../services/ads';

/**
 * Banner AdMob — only for free users. Falls back to placeholder if native ads missing.
 */
export function AdBanner() {
  const { showAds } = usePremium();
  const [nativeReady, setNativeReady] = useState(false);
  const [BannerAd, setBannerAd] = useState<React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions?: object;
  }> | null>(null);
  const [size, setSize] = useState('ANCHORED_ADAPTIVE_BANNER');

  useEffect(() => {
    if (!showAds) return;
    let cancelled = false;
    (async () => {
      try {
        const ads = await import('react-native-google-mobile-ads');
        if (cancelled) return;
        setBannerAd(() => ads.BannerAd as never);
        setSize(ads.BannerAdSize.ANCHORED_ADAPTIVE_BANNER);
        setNativeReady(true);
      } catch {
        setNativeReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAds]);

  if (!showAds) return null;

  if (nativeReady && BannerAd && (Platform.OS === 'android' || Platform.OS === 'ios')) {
    return (
      <View style={styles.wrap}>
        <BannerAd
          unitId={getBannerUnitId()}
          size={size}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, styles.placeholder]}>
      <Text style={styles.placeholderText}>AdMob banner (dev build required)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12161c',
    minHeight: 50,
  },
  placeholder: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a323e',
  },
  placeholderText: {
    color: '#8b95a5',
    fontSize: 11,
  },
});
