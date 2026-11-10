import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import './src/i18n';
import { loadSavedLocale } from './src/i18n';
import { PremiumProvider } from './src/context/PremiumContext';
import { HomeScreen } from './src/screens/HomeScreen';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadSavedLocale().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color="#3d9b8f" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PremiumProvider>
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
          <StatusBar barStyle="light-content" />
          <HomeScreen />
        </SafeAreaView>
      </PremiumProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: '#0b0e12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: { flex: 1, backgroundColor: '#0b0e12' },
});
