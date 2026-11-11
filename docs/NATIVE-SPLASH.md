# Native Ringtools-splash

## Oorzaak

Het huidige appicoon was al Ringtools, maar `mobile/resources/splash.png` bevatte nog het blauwe/paarse target. De iOS-assetcatalogus verwees naar gegenereerde `Default…`-bestanden met datzelfde beeld; ook oude Capacitor-splashbestanden waren achtergebleven. Android had schermvullende bitmapexports per oriëntatie/nachtmodus en geen expliciete branded icon-verwijzing voor de Android 12+-splash.

## Ontwerp en exports

Het **ongewijzigde bestaande appicoon** is de bron: zeven witte unitgroepen rond één gouden ring. Geen kruis, nieuwe symbolen, tekst, spinner of externe afbeelding. Het beeld staat centraal op `#0b1220`, dezelfde donkere kleur als de bestaande native splashconfiguratie. Appicoon en normale appschermen worden niet gewijzigd.

- iOS: `LaunchScreen.storyboard` heeft een echte effen achtergrond en een aparte `scaleAspectFit`-imageview. Voorkeursmaat 192pt; maximaal de helft van schermbreedte én -hoogte. Daardoor blijft het beeld op iPhone, iPad, smalle vensters en liggende schermen volledig zichtbaar, zonder een grote bitmap te croppen. Universele 1x/2x/3x-assets; dezelfde rustige splash in lichte/donkere modus.
- Android: `Theme.SplashScreen` verwijst expliciet naar `splash_mark` en `splash_background`; na de splash keert de bestaande `AppTheme.NoActionBar` terug. Donkere status-/navigatiebalk bij het opstarten. Een 288dp-export bevat het volledige vierkante beeld op 128dp: diagonaal circa 181dp, binnen het ronde 192dp-masker van Android 12+. De compatibele XML-splash heeft dezelfde achtergrond en een gecentreerde bitmap. Geen oriëntatie-/nightvariant met een oud target meer.
- Capacitor: `launchAutoHide: false` en de bestaande vergrendel-/opstartstroom blijven behouden. Alleen de Android-resource en veilige `CENTER_INSIDE`-schaal voor de fallback zijn expliciet ingesteld. APNs, permissies, app-ID, signing, entitlements en backend blijven ongewijzigd.

Herhaalbare technische export:

```sh
cd mobile
npm ci
npm run assets:splash
npm run check:splash
npm run check:native-config
npm run cap:sync
```

`scripts/generate-splash-assets.mjs` maakt de native resoluties vanuit `resources/icon.png`, werkt de splashbron bij en verwijdert oude exports. Het verandert het icoon zelf niet. `npm run assets` voert na de bestaande algemene assetgenerator deze splash-export uit, zodat regenereren de configuratie niet terugzet. `check:splash` vergelijkt alle exports met de huidige bron en weigert achtergebleven bestanden; CI voert deze controle uit. Sharp is hiervoor expliciet als ontwikkelafhankelijkheid opgenomen (dezelfde versie was al transitief aanwezig).

## Native controle en screenshots

Lokaal: mobiele TypeScript/Vite/Capacitor-build, mobiele tests, native configuratie, assetintegriteit en Android `assembleDebug`. Deze cloudwerkplek is Linux: geen Xcode/iOS-simulator en geen geïnstalleerde Android-emulator/system image. Een Android-build is geen visuele emulatorcontrole.

De bestaande macOS-iOS-CI bouwt de simulatorapp en voert `scripts/capture-splash-simulators.sh` uit op een beschikbare iPhone- en iPad-simulator, in lichte én donkere modus. Een tijdelijke, ad-hoc ondertekende UIKit-testhost laadt **het gecompileerde `LaunchScreen.storyboardc` en `Assets.car` uit de echte simulatorbuild**. Zo blijven het werkelijke beeld en de Auto Layout zichtbaar voor een screenshot, zonder een screenshotmodus of vertraging in Ringtools zelf toe te voegen. Een pixelcontrole vergelijkt de opname met de donkere achtergrond en het bronicoon; zwarte beelden, onjuiste schaal of placeholders falen. De eerste capturepoging stopte vóór `main()` en leverde zwarte beelden op omdat UIKit nog niet tekende; die beelden gelden niet als visueel bewijs. De testhost bevat geen authenticatie, backend of netwerkcode. Dit is een native storyboard-/assettest op echte simulators, geen test van de volledige Ringtools-koude-startketen. Die laatste overgang blijft onderdeel van fysieke acceptatie. De beelden staan in CI-artifact **ringtools-ios-splash-screenshots**. De overige iOS-configuratie- en unsigned releasearchivecontroles blijven bestaan. Geen TestFlight-upload.

Definitieve build-/CI-uitkomst en screenshotlinks staan bij de feature-PR. Controleer vóór een latere release op een echt toestel ook een koude start, rotatie/iPad-multitasking en de overgang naar het bestaande vergrendel-/aanmeldscherm. iOS kan een oude launchsnapshot cachen: sluit de app volledig en installeer de nieuwe build opnieuw indien de oude afbeelding nog zichtbaar lijkt. Geen productiegegevens of serverconfiguratie wijzigen voor deze controle.
