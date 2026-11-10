import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatPrice, usePremium } from '../context/PremiumContext';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function PremiumModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { isPremium, product, purchase, restore } = usePremium();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onBuy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await purchase(__DEV__);
      setMessage(t('purchaseOk'));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t('purchaseError'));
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const ok = await restore();
      setMessage(ok ? t('restoreOk') : t('restoreNone'));
    } catch {
      setMessage(t('purchaseError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('premiumTitle')}</Text>
          <Text style={styles.price}>{t('premiumPrice', { price: formatPrice(product) })}</Text>

          <Text style={styles.section}>{t('premiumBenefits')}</Text>
          <Text style={styles.bullet}>• {t('benefitNormalize')}</Text>
          <Text style={styles.bullet}>• {t('benefitPingPong')}</Text>
          <Text style={styles.bullet}>• {t('benefitUnlimited')}</Text>
          <Text style={styles.bullet}>• {t('benefitNoAds')}</Text>

          {isPremium ? (
            <Text style={styles.owned}>{t('owned')}</Text>
          ) : (
            <>
              <Pressable style={styles.primary} onPress={onBuy} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('buyPremium')}</Text>}
              </Pressable>
              <Pressable style={styles.ghost} onPress={onRestore} disabled={busy}>
                <Text style={styles.ghostText}>{t('restore')}</Text>
              </Pressable>
            </>
          )}

          {message ? <Text style={styles.msg}>{message}</Text> : null}

          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.ghostText}>{t('close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1a1f27',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a323e',
  },
  title: { color: '#e8ecf1', fontSize: 22, fontWeight: '700', marginBottom: 6 },
  price: { color: '#3d9b8f', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  section: { color: '#8b95a5', fontSize: 12, textTransform: 'uppercase', marginBottom: 8 },
  bullet: { color: '#e8ecf1', marginBottom: 6, fontSize: 15 },
  owned: { color: '#3d9b8f', marginTop: 16, fontWeight: '600' },
  primary: {
    marginTop: 18,
    backgroundColor: '#3d9b8f',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2a323e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ghostText: { color: '#e8ecf1', fontWeight: '600' },
  close: { marginTop: 14, alignItems: 'center', padding: 8 },
  msg: { color: '#8b95a5', marginTop: 12, textAlign: 'center' },
});
