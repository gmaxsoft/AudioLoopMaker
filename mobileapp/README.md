# Audio Loop Maker — Mobile (Android)

Expo / React Native client for [Audio Loop Maker](../README.md) with:

- **Default language: English**, also **Polish**
- **AdMob** ads (free tier)
- **One-time Premium** ($3.99 USD) via Google Play Billing
- Premium unlocks: **LUFS normalization**, **ping-pong**, **unlimited file size**, **no ads**
- Free tier: **max 10 MB** upload + ads; Premium features locked

Audio processing uses the existing Node/FFmpeg backend (`../server.js`).

## Requirements

- Node.js 18+
- Expo CLI / `npx expo`
- Android Studio (for device/emulator builds)
- Running API: `node server.js` in the repo root (port 3000)

## Setup

```bash
cd mobileapp
npm install
```

Set API URL (Android emulator → host machine):

```bash
# .env or shell
set EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

Physical device: use your PC LAN IP, e.g. `http://192.168.1.20:3000`.

## Run (development)

AdMob and IAP need a **development build** (not Expo Go):

```bash
npx expo prebuild --platform android
npx expo run:android
```

Expo Go (UI / API only; ads & billing mocked / placeholders):

```bash
npx expo start
```

In `__DEV__`, buying Premium simulates unlock when native IAP is unavailable.

## Premium product (Play Console)

1. Create one-time in-app product ID: **`alm_premium`**
2. Price: **USD 3.99** (or local equivalent)
3. Replace AdMob test IDs in `src/constants.ts` and `app.json` with your production IDs before release

## Free vs Premium

| Feature | Free | Premium |
|--------|------|---------|
| Ads (banner + interstitial) | Yes | No |
| Max file size | 10 MB | Unlimited |
| Loudness normalization (LUFS) | Locked | Yes |
| Ping-pong mode | Locked | Yes |
| Loop tools (best / longest / seam) | Yes | Yes |
| OGG / WAV @ 48 kHz (server) | Yes | Yes |

## Project structure

```
mobileapp/
├── App.tsx
├── app.json
├── src/
│   ├── constants.ts
│   ├── i18n/          # en (default) + pl
│   ├── context/       # Premium state
│   ├── services/      # API, ads, IAP
│   ├── components/    # AdBanner, PremiumModal
│   └── screens/       # HomeScreen
└── README.md
```

## License

MIT · Maxsoft
