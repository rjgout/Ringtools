# Bugfix: iOS-app permanent vergrendeld ("De schermbeveiliging … kon niet worden ingeschakeld")

## Symptoom
Op een fysieke iPhone bleef Ringtools vergrendeld met de melding dat de schermbeveiliging niet kon worden ingeschakeld. Opnieuw proberen, uitloggen
en herinstalleren hielpen niet: de fout zat dus in de code/build, niet in toestand op het toestel.

## Onderzoek (wat is nagegaan)
| Mogelijke oorzaak | Bevinding |
|---|---|
| Ontbrekende native registratie | **Uitgesloten (statisch).** `PrivacyScreenPlugin` staat in `packageClassList` van `ios/App/App/capacitor.config.json`; het SPM-product `CapacitorCommunityPrivacyScreen` zit in `CapApp-SPM/Package.swift`; `@objc(PrivacyScreenPlugin)` + `CAPBridgedPlugin` (jsName `PrivacyScreen`) komt overeen met `Capacitor.isPluginAvailable("PrivacyScreen")`. Capacitor 8 (`CapacitorBridge.registerPlugins`) laadt de klasse via `NSClassFromString` en roept `load()` aan. `SceneDelegate.swift` is hier niet van invloed. |
| Fout in de native plug-in (8.0.0) | **Niet gevonden.** `enable()` zet `isSecureTextEntry` op de hoofdthread en roept `call.resolve()` aan; met `preventScreenshots: false` wordt de laagtruc niet geactiveerd. |
| Timing tijdens opstarten | **Onwaarschijnlijk.** De PluginHeaders staan vóór de eerste JS-uitvoering in de pagina; een native aanroep duurt milliseconden, de limiet is 3 s. |
| Aanroep van `enable()` in onze code | **OORZAAK.** Zie hieronder. |

## Werkelijke oorzaak
`ensurePrivacyScreen()` haalde de plug-in op met een `async`-functie die de Capacitor-plug-in **zelf teruggaf** (`return PrivacyScreen`).
Een Capacitor-plug-in is een `Proxy` die voor *elke* eigenschap — ook `then` — een native methodeaanroep teruggeeft
(`@capacitor/core` `registerPlugin`, `default: createPluginMethodWrapper(prop)`). Een `async`-functie die een waarde teruggeeft doorloopt de
promise-resolutieprocedure en leest daarbij `value.then`. Daardoor werd er een native methode `then` aangeroepen die nooit `resolve` aanroept:
de promise **hangt eeuwig**, de tijdslimiet van 3 s sloeg toe en het resultaat was `false` → "schermbeveiliging niet ingeschakeld" → permanent
geblokkeerd, bij elke start en na elke herinstallatie, op elk toestel. `enable()` werd daardoor nooit eens aangeroepen.

Bewijs: `tests/privacyScreenRegression.test.tsx` gebruikt de echte `@capacitor/core`-proxy en toont dat `(async () => proxy)()` niet oplost, terwijl een
gewoon object met `enable()` wel werkt. **Let op:** de oorzaak is bewezen met de echte Capacitor-code en reproductie van de hang in tests; het is
*niet* op de fysieke iPhone waargenomen (daar had ik geen toegang toe). De nieuwe diagnostiek (hieronder) maakt zichtbaar of er toch een andere reden is.

Waarom niet eerder gezien: de E3-tests injecteerden een nepplug-in (een gewoon object, niet-thenable), en de CI bouwt alleen voor de simulator zonder de app
te starten. De werkelijke proxy werd nergens in een test gebruikt.

## Oplossing
- `src/lib/privacyScreen.ts`: de plug-in wordt statisch geïmporteerd en **nooit** als waarde door een promise gegeven; `enable()` wordt aangeroepen via
  een gewoon object (`{ enable: () => PrivacyScreen.enable() }`). Geen dynamische chunk meer nodig voor deze kritieke controle.
- **Fail-closed blijft:** alleen `ok` ontgrendelt. Ontbrekende plug-in, laadfout, fout bij `enable()` of time-out blokkeren nog steeds en tonen geen
  biometrische prompt. De controle is niet verwijderd of versoepeld.
- **Diagnostiek:** elke uitkomst heeft een code (`ok`, `plugin-missing`, `load-failed`, `enable-failed`, `timeout`), de duur in ms en bij `enable-failed`
  een korte foutcode (bijv. `UNIMPLEMENTED`; nooit de foutboodschap). Dit staat op het vergrendelscherm ("Technische code: …") en in `console.warn`
  (zichtbaar in Safari Web Inspector). Geen gebruikersgegevens, tokens of vertrouwelijke tekst.
- **Melding per platform:** op iOS gaat de melding over de afscherming in de app-switcher (schermafbeeldingen zijn daar bewust niet geblokkeerd,
  `preventScreenshots: false`); op Android over schermafbeeldingen en recente apps.
- **Herstel:** "Opnieuw proberen" herhaalt de volledige controle; na herstel ontgrendelt de app normaal. Dit geldt ook na terugkeer uit de achtergrond.
- Niet gewijzigd: backend, MFA, signing, provisioning, entitlements, `App-PersonalTeam`, `Package.swift`, native code.

## Tests (mobile)
`tests/privacyScreenRegression.test.tsx`: echte proxy (hang bewezen), correct geregistreerde plug-in, thenable plug-inobject via de standaardlader,
ontbrekende registratie, lader faalt/leeg, time-out, mislukte activering (alleen foutcode), niet-native, herstel na opnieuw proberen, herstel na
terugkeer, melding iOS versus Android en diagnostiek. Bestaande appLock-tests blijven geslaagd.

## Wat op een fysieke iPhone getest moet worden (NIET door mij uitgevoerd)
1. Bouw `App-PersonalTeam` / `Debug-PersonalTeam` (zie instructie in `docs/MOBILE.md`) en installeer op de iPhone.
2. Koude start: de app vraagt Face ID of de toestelcode; ontgrendelt; geen melding over schermbeveiliging.
3. Annuleren van de prompt: blijft vergrendeld met "Ontgrendelen"; opnieuw lukt.
4. App naar de achtergrond < 30 s en terug: geen prompt, wel direct bruikbaar; > 30 s: opnieuw Face ID/toestelcode.
5. **App-switcher:** open de app-switcher (veeg omhoog/dubbel Home): de Ringtools-kaart toont de neutrale grijze afscherming, geen inhoud.
6. Volledig afsluiten en opnieuw openen; telefoon vergrendelen en ontgrendelen; app verwijderen en opnieuw installeren: blijft werken.
7. Faalt het toch: noteer de "Technische code" op het vergrendelscherm (of de `[privacy-screen]`-regel in Safari Web Inspector) en stuur die door.
