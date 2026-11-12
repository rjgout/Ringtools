# Schermvullende native Ringtools-splash

De eigenaar heeft het eerste ontwerp met een klein vierkant icoon op een effen achtergrond afgewezen. Het definitieve ontwerp trekt de blauwe kleuren door tot de schermranden. De oorspronkelijke ring, zeven units en personen blijven behouden; geen tekst, kruis of placeholder.

## Bronnen en exports

- `mobile/resources/icon.png`: ongewijzigde originele bron van het beeldmerk.
- `mobile/resources/splash-background.png`: apart uitgewerkte blauwe kleurenlaag in de bestaande huisstijl, zonder nieuw beeldmerk. Schermvullend, zonder icoonvlak.
- `mobile/scripts/splash-art.mjs`: maakt uitsluitend de achtergrond buiten de gesloten witte/gouden contouren transparant. De oorspronkelijke kleuren van alle behouden pixels, de donkere binnenvlakken, personen en verbindingen blijven exact behouden. Twee bronpixels marge beschermen de anti-aliasranden. Het beeldmerk wordt niet opnieuw getekend.
- `mobile/scripts/generate-splash-assets.mjs`: exporteert de twee lagen voor iOS en Android. Het originele appicoon blijft ongewijzigd. Oude target-/icoonvlakexports worden verwijderd. `npm run assets` voert na de algemene assetgenerator deze export uit.

```sh
cd mobile
npm ci
npm run assets:splash
npm run check:splash
npm run check:native-config
npm run cap:sync
```

`check:splash` vergelijkt alle exports met hun bronnen en controleert met twee regressietests dat de vierkante achtergrond verdwijnt en alle behouden pixels en acht binnenvlakken origineel blijven.

## iPhone en iPad

`LaunchScreen.storyboard` heeft twee afzonderlijke imageviews. De achtergrond vult alle vier schermranden met `scaleAspectFill`; alleen het abstracte kleurenveld kan worden bijgesneden. Het oorspronkelijke beeldmerk staat erboven met `scaleAspectFit`, een voorkeursmaat van 192pt en een maximum van de halve schermbreedte én -hoogte. Het beeldmerk vervormt dus niet bij rotatie, op een iPad of in een smal venster. Universele 1x/2x/3x-exports behouden scherpe contouren. De bestaande Capacitor-iOS-plugin gebruikt ditzelfde storyboard. `launchAutoHide: false`, appvergrendeling en het gereedmoment blijven behouden.

## Android

Android 12+ ondersteunt uitsluitend een effen **systeem**achtergrond, geen schermvullende afbeelding. De korte systeemfase is daarom blauw met een expliciet transparant systeemicoon, zonder los appicoon of target. Daarna toont de app een native, schermvullende kleurenlaag plus hetzelfde oorspronkelijke beeldmerk.

- `MainActivity.load()` schakelt uitsluitend de standaard Android-splash-hold uit met `launchShowDuration=0`. Alle andere configuratie en plugins blijven behouden.
- `RingtoolsSplashPlugin` toont de native layout vóór de eerste appweergave. De kleurenlaag vult het scherm; het beeldmerk houdt dezelfde begrensde 192dp-maat als iOS. Er is geen timer of extra wachttijd. Bij een ongeschikte WebView wordt de foutweergave niet afgedekt. Bij vernietiging van de activity wordt de laag verwijderd.
- `nativeSplash.ts` verbergt de standaardlaag en op Android ook de eigen beeldlaag, vanaf dezelfde bestaande hide-aanroepen. Herhaald hide is veilig; een ontbrekende oudere bridge blokkeert de opstart niet. De ontgrendelcontroller, verificatie, sessies, ringisolatie en privacybescherming veranderen niet.
- `ringtools_splash.xml` wordt ook als standaard Capacitor-layout gebruikt. `drawable/splash.xml` is de compatibele window-fallback. Geen oude port/land/night-targetbitmaps meer.

Geen wijzigingen aan app-ID, appiconen, APNs, entitlements, eigenaarcertificaten, productiegegevens of serverinstellingen.

## Validatie en beelden

Lokaal: mobiele TypeScript/Vite/Capacitor-build, 427 mobiele tests inclusief Android/iOS-hide-regressies, native configuratie, assetintegriteit, twee pixelbehoudtests en Android `assembleDebug`. Deze cloudwerkplek is Linux zonder Xcode of geïnstalleerde Android-emulator/system image; een build is geen fysieke toesteltest.

macOS-CI bouwt de echte iOS-simulatorapp. `capture-splash-simulators.sh` laadt het gecompileerde `LaunchScreen.storyboardc` en `Assets.car` uit die build in een tijdelijke UIKit-testhost op een iPhone- en iPad-simulator, elk licht en donker. De testhost heeft geen backend of authenticatie en wijzigt Ringtools zelf niet. De pixelcontrole vergelijkt zowel het hele kleurenveld als het oorspronkelijke beeldmerk; zwarte beelden, placeholders en een achtergebleven vierkant icoonvlak worden afgekeurd. Beelden staan in artifact **ringtools-ios-splash-screenshots**. Dit is een native storyboard-/assettest, geen volledige koude-starttest van de beveiligde app. De bestaande iOS-configuratie-, Personal Team- en unsigned releasearchivecontroles blijven bestaan.

Controleer na een latere installatie op echte iPhone/iPad/Android ook de koude start, rotatie/multitasking en overgang naar appvergrendeling. iOS kan een oude launchsnapshot cachen; installeer de nieuwe build opnieuw als de oude afbeelding nog verschijnt. Native assets worden gebundeld: een Docker-update vervangt de splash in een reeds geïnstalleerde TestFlight-/Android-app niet.

## Oplevering

De eigenaar heeft op 12 november 2026 toegestaan om na groene controles naar `main` te gaan. Dit vervangt voor deze wijziging de eerdere instructie om niet te mergen. De automatische Docker-publicatie/Watchtower-update op main is bekend. Geen handmatige productiemigratie en geen TestFlight-upload starten. Definitieve commit-, CI- en screenshotlinks worden in PR #5 en het opleverbericht vastgelegd.
