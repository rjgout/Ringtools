# Ringtools mobiel (Capacitor 8)

Gebundelde React-client (Vite) voor iOS en Android, bovenop de bestaande Ringtools-backend (`/api/mobile/v1`).
Geen website-wrapper: `capacitor.config.ts` heeft bewust **geen** `server.url`.

Volledige handleiding: [`../docs/MOBILE.md`](../docs/MOBILE.md) · privacy/storevoorbereiding: [`../docs/STORE-PRIVACY.md`](../docs/STORE-PRIVACY.md) · regels: [`../AGENTS.md`](../AGENTS.md).

```bash
npm ci
cp .env.example .env     # VITE_API_URL (publiek), voorlopige app-ID's
npm run dev              # client in de browser (proxy naar de backend)
npm test && npm run build && npm run check:native-config
npx cap sync && npm run ios      # Xcode
npx cap sync && npm run android  # Android Studio
```

Structuur: `src/` (client) · `ios/` (Xcode, SwiftPM) · `android/` (Gradle) · `resources/` (bron voor iconen/splash) ·
`scripts/` (`configure-native.mjs`, `check-native-config.mjs`). Het gedeelde API-contract staat in `../shared/api-types.ts`.

Geen signingbestanden, sleutels of `google-services.json` in git (zie `.gitignore`).
