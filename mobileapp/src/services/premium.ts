import AsyncStorage from '@react-native-async-storage/async-storage';
import { ASYNC_PREMIUM_KEY } from '../constants';

export async function loadPremiumFlag(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(ASYNC_PREMIUM_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function savePremiumFlag(owned: boolean): Promise<void> {
  await AsyncStorage.setItem(ASYNC_PREMIUM_KEY, owned ? '1' : '0');
}
