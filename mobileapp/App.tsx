import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StatusBar, StyleSheet, View } from 'react-native';
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
    <PremiumProvider>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <HomeScreen />
      </View>
    </PremiumProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: '#0b0e12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    flex: 1,
    backgroundColor: '#0b0e12',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
});
