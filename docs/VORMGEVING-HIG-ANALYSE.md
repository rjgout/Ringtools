# Vormgeving: Apple HIG / Liquid Glass – analyse en plan (voorstel, nog niet gebouwd)

Status: **V1 (fundament) gebouwd op branch `claude/hig-vormgeving`**; V2–V4 nog niet. Eigenaar heeft V1 goedgekeurd. Uitgangspunt van de eigenaar: de app moet aanvoelen als een echte iOS-app (Liquid Glass, ook op Android een vergelijkbare look), volgens de Apple Human Interface Guidelines: Clarity, Deference, Depth; 8pt-grid; systeemkleuren met volledige Dark Mode; SF Pro met Dynamic Type; geen Safe Area-schendingen of hardcoded kleuren.

## 1. Wat Hallmark (Nutlope/hallmark) wel en niet is

Hallmark is een ontwerp-*skill* voor het genereren van **websites en landingspagina's** (HTML/CSS, vijftig thema's, lint op "AI-slop"). Het is **geen** iOS-designsysteem en bevat geen HIG-componenten. Bruikbaar voor Ringtools zijn de principes die platformonafhankelijk zijn:

- tokens als enige bron voor kleur en lettertype (geen literalen buiten de tokenblokken);
- nooit `transition: all`; animaties alleen op `transform`/`opacity`; `prefers-reduced-motion`-terugval;
- zichtbare `:focus-visible` op alle bedieningselementen; contrastdoelen in beide modi gelijk;
- dark mode als tweede, volwaardig ontworpen weergave (niet omkeren), zie `skills/hallmark/references/dark-mode.md`;
- gedeelde interactie- en toestandsregels (leeg, laden, fout), zie `references/interaction-and-states.md`.

Niet bruikbaar: de themadeal, macrostructuren en fotobibliotheek (marketingsites). Ik gebruik Hallmark dus als **kwaliteitscontrole** (lint op tokens/focus/motion), niet als ontwerpbron. De HIG is de ontwerpbron.

## 2. Huidige stand (`mobile/src/styles.css`, 135 regels, 45 inline `style={{}}` in schermen)

Wat al klopt:
- Veilige schermranden: `--sat/--sab/--sal/--sar` en `viewport-fit=cover`; Dark Mode via `prefers-color-scheme` met eigen tokenset; `color-scheme: light dark`.
- Glasachtig materiaal: `backdrop-filter: blur(20px) saturate(140%)` op kaarten en tabbalk.
- Systeemfont als eerste keuze (`-apple-system`, `SF Pro Text`).

Wat afwijkt van de HIG (gemeten, niet geschat):
1. **`user-scalable=no` in de viewport** (`mobile/index.html`): blokkeert zoomen; strijdig met toegankelijkheid. Verwijderen.
2. **Geen Dynamic Type.** Groottes zijn vaste `rem`/`px` (`1.5rem`, `0.74rem`, `16px`). iOS Dynamic Type vraagt `font: -apple-system-body` (en `-apple-system-title1` e.d.) of een schaalbare tekstmaat; op Android `rem` gekoppeld aan de systeemtekstgrootte. Tabbalklabels (0,74 rem) zijn te klein.
3. **Geen 8pt-grid.** Waarden als 2, 6, 14, 18 px; geen spacingtokens.
4. **Eigen kleurenpalet i.p.v. systeemkleuren.** Indigo-primary (`#4f46e5`) en vaste gradiënten op `.btn-success/.btn-danger` (hardcoded `#22c55e/#ef4444`). HIG: systeemkleuren (`systemBlue`, `systemGreen`, `systemRed`, `label`, `secondaryLabel`, `systemBackground`, `secondarySystemGroupedBackground`) die automatisch meebewegen met Light/Dark/Increased Contrast.
5. **Webachtig in plaats van app-achtig:** geen grote inklappende titel, geen navigatiebalk met terugknop in systeemstijl, geen lijsten in *inset grouped*-stijl, geen sheets/detents, geen haptiek, geen swipe-acties, geen pull-to-refresh, geen contextmenu's, geen echte tabbalk met SF Symbols. Kaarten met schaduw en radiale achtergrondgradiënt lezen als website.
6. **Increased Contrast / Reduce Transparency / Reduce Motion** niet ondersteund (alleen `prefers-color-scheme`).
7. 34 hardcoded kleurlocaties buiten het `:root`-blok en 45 inline stijlen in schermcomponenten.

## 3. Wat een WebView *niet* kan (eerlijke beperking)

- Echt **Liquid Glass** (iOS 26+ `UIGlassEffect`/SwiftUI `glassEffect`) is een native materiaal met lensing en dynamische reflectie. CSS `backdrop-filter` kan het **benaderen**, niet evenaren.
- Meest gelijkwaardige route naar "voelt als een app": **native chrome via Capacitor-plug-ins of eigen Swift**: tabbalk, navigatiebalk en sheets als echte UIKit/SwiftUI-onderdelen, met de React-client als inhoud erin. Dat levert automatisch het systeemmateriaal, Dynamic Type voor chrome, haptiek en terugswipe. Kosten: nieuwe native afhankelijkheden (store-/privacyimpact, exacte pinning, Personal Team-compatibiliteit moet blijven werken, Android apart).
- **iOS 27**: mijn kennis reikt tot juni 2026; ik ken de iOS 27-HIG niet. Ik bouw tegen de HIG zoals die voor iOS 26 (Liquid Glass) bekend is, tenzij de eigenaar iOS 27-schermafbeeldingen of -documentatie aanlevert. Beweren dat het "op iOS 27 lijkt" kan ik niet controleren.
- SF Pro mag alleen op Apple-platforms worden gebruikt (licentie); op Android valt de app terug op het systeemfont (Roboto/Google Sans). "Apple-look op Android" is daarom een bewuste keuze: dezelfde structuur en materialen, maar Android-gedrag (terugknop, systeemgebaren) blijft leidend.

## 4. Voorstel in fasen (elke fase op eigen branch, achter geen enkele beveiligingswijziging)

**V1 – Fundament (alleen CSS/tokens, laag risico)**
- Verwijder `user-scalable=no`; Dynamic Type via `font: -apple-system-*` en `rem` op systeemtekstgrootte; minimumtekst 11 pt, tabbalk 10–11 pt.
- Spacingtokens op 8pt (4pt voor fijne ruimte): `--space-1: 4px … --space-8: 64px`; alle waarden naar tokens.
- Semantische kleurtokens (label/secondaryLabel/fill/groupedBackground/tint) met Light, Dark en Increased Contrast; geen literalen buiten `:root` (lint-test die dit afdwingt, naar voorbeeld van Hallmark's token-gate).
- `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast` ondersteunen.
- Tests: mobiele vitest + een statische lint die hardcoded kleuren en `transition: all` weigert.

**V2 – App-structuur (React, geen native plug-ins)**
- Navigatiebalk met grote inklappende titel en terugknop; tabbalk met SF Symbol-achtige iconen; *inset grouped*-lijsten; sheets met detents voor formulieren en bevestigingen; swipe-acties en pull-to-refresh waar zinvol; Android-terugknop blijft werken.
- Per scherm afspreken wat primair is (Clarity), zonder chrome dat de inhoud overschaduwt (Deference).

**V3 – Liquid Glass-materiaal**
- Benaderd in CSS (blur + saturatie + dunne highlight-rand + diepte via lagen); één materiaaltoken `--material-regular/thick/thin` met terugval bij Reduce Transparency.

**V4 – Optioneel, na akkoord: native chrome**
- Beoordeling van plug-ins of een kleine eigen Swift-laag voor tabbalk/navigatiebalk; alleen bij een vooraf vastgelegde analyse van store-, privacy- en onderhoudsimpact. Personal Team-build blijft zonder extra entitlements.

## 5. Controle

- Geautomatiseerd: kleurtoken-lint, spacing-lint, contrasttests per modus (WCAG/APCA), jsdom-tests, Playwright-schermafbeeldingen van de gebundelde client in iPhone- en Pixel-viewports (Light, Dark, grote tekst) als *simulatie*.
- Niet mogelijk zonder toestel: echte Dynamic Type-instelling, Liquid Glass-weergave, haptiek, Safe Areas rond Dynamic Island, Reduce Transparency. Deze blijven expliciet open voor een iPhone-test door de eigenaar.

## 6. Vragen aan de eigenaar

1. Mag ik V1 (fundament) nu starten? Dit raakt geen beveiliging of workflow.
2. Is V4 (native chrome) bespreekbaar, of blijft de app een gebundelde webclient?
3. Referentie voor "iOS 27": levert de eigenaar schermafbeeldingen/documentatie aan, of bouw ik op de HIG van iOS 26?
4. Gewenste kleur: blijft indigo als merkkleur (als *tint*), of volledig systeemblauw?
5. Voor Android: Apple-look in dezelfde structuur, of platformeigen Material 3 met glasaccenten?

## 7. Stand V1 (gebouwd)

- `mobile/src/styles.css` herschreven op tokens: systeemkleuren (Light, Dark, Verhoogd contrast, Reduce Transparency), 4/8pt-spacingtokens, radiustokens, `--touch` 48 px, Dynamic Type (`font: -apple-system-*` met rem-terugval), `touch-action: manipulation`, Reduce Motion. Klassenamen blijven gelijk; schermen zijn niet gewijzigd.
- `index.html`: `user-scalable=no` verwijderd (zoomen weer mogelijk).
- Kaarten zijn nu effen *inset grouped*-oppervlakken (`--bg-elevated`); glas (`.material`, tabbalk) is gereserveerd voor balken en overlays (V3 breidt dat uit). Merkkleur is systeemblauw (donkerder tintvariant voor 4,5:1).
- `mobile/tests/designTokens.test.ts` bewaakt: geen kleurliteralen buiten `:root`, geen `transition: all`/`100vw`, geen zoomblokkade, spacing op het 4pt-grid, geen vaste px-lettergroottes, aanwezigheid van Reduce Motion/Transparency/Contrast en veilige schermranden, en WCAG-contrast (4,5:1; tekst 7:1) per modus (licht, donker, beide met verhoogd contrast). Deze test vond meteen een contrastfout in de eerste groene knop (4,40:1), die is hersteld.
- Gesimuleerd gecontroleerd (Chromium, iPhone 14-viewport, Light en Dark). **Niet** getest: echte Dynamic Type, SF Pro, Increased Contrast, Reduce Transparency, safe areas rond het Dynamic Island, Android-systeemtekstgrootte. Die blijven open voor een toesteltest.

## 8. Stand V2 (gebouwd): navigatie, tabbalk, knoppen en logica

Gevonden logicafouten (met de correctie):
1. **Android-terugknop kon "vast" zitten:** `navigate(-1)` na het openen van een melding of link (geen eerdere stap in de app) deed niets. Nu: `backAction()` (`mobile/src/lib/navigation.ts`) gaat een stap terug als die er is, anders naar het bovenliggende scherm; op een ander hoofdscherm naar het overzicht; op het overzicht naar de achtergrond.
2. **Geen tab actief op detailschermen:** `/roepingen/:id` markeerde geen enkele tab. Nu hoort elk pad bij een hoofdgebied (`tabForPath`); detailschermen houden hun gebied actief.
3. **Zes tabs voor ringbeheerders** (balk schoof horizontaal). HIG: maximaal vijf. Gebruikers en Inrichting zijn nu twee segmenten onder één tab "Beheer" (`/beheer/gebruikers`, `/beheer/inrichting`; de oude paden verwijzen door).
4. **Vier verschillende, handmatige "‹ Terug"-knoppen** (drie met `navigate(-1)`, twee naar vaste paden). Nu één `NavBar` (terugknop met de naam van het vorige scherm, titel in het midden) voor alle diepere schermen, met dezelfde terugactie als de Android-terugknop.
5. **Tabbalk zonder iconen, labels van 12 pt;** nu icoon + label (11 pt Caption 2), badges met toegankelijk label en "99+", opnieuw tikken op de actieve tab scrolt naar boven.

Knoppen: `.btn` is nu een capsule (min. 48 px); hiërarchie primair (gevuld, tint) / secundair (`btn-ghost`: grijs gevuld, tekst in tint) / tertiair (`btn-plain`, alleen tekst); `btn-small` (44 px) voor knoppen binnen lijstrijen; ondersteunen/niet ondersteunen blijven groen/rood gevuld met contrast ≥ 4,5:1 in alle modi.

Tests: `mobile/tests/navigation.test.tsx` (pure navigatielogica, tabbalk, navigatiebalk, segmenten) en uitgebreide `designTokens.test.ts`. Nog niet gebouwd: grote titel die inklapt bij scrollen, sheets met detents, swipe-acties, pull-to-refresh, haptiek (V2b/V3).

## 9. Besluiten van de eigenaar (6 november 2026)

1. **Android** krijgt dezelfde Apple-look en structuur (tabbalk met iconen, navigatiebalk, segmenten, knophiërarchie). Het systeemfont blijft het lettertype (SF Pro mag niet buiten Apple-platformen); het Android-gedrag (terugknop, systeemgebaren) blijft leidend.
2. **Accentkleur** blijft systeemblauw (tintvariant met 4,5:1-contrast).
3. **iOS 27-referentie:** er wordt gebouwd op de HIG van iOS 26 (Liquid Glass) zoals bekend; er is geen iOS 27-referentie aangeleverd en de overeenkomst met iOS 27 kan niet worden gecontroleerd.
4. **Native tabbalk en navigatiebalk:** alleen wat zonder nieuwe plug-ins of entitlements kan. Voorlopig blijft de app een gebundelde webclient; native chrome (V4) is niet gestart.
5. V1 en V2 staan op `main` (`c4fd3d4`). Nog niet gebouwd: grote titel die inklapt bij scrollen, sheets met detents, swipe-acties, pull-to-refresh, haptiek (V2b/V3).
