# Ontwerpstandaard mobiele app (UX/UI-uniformering)

Referentie: Figma-bestand *Ringtools UI Kit* (`R6qg8Qul1ZuIVYnBzDJ2PA`, pagina "01 • Ringtools UI Kit"): foundations, controles, voorbeeldschermen en de "Codex implementatiechecklist". De app hergebruikt de bestaande CSS-tokens (`mobile/src/styles.css`); er zijn geen nieuwe afhankelijkheden of kleuren buiten de tokens bijgekomen (uitzondering: token `--switch-knob`). Workflow, serverautorisatie, notificatiebeveiliging, Face ID, MFA en ringisolatie zijn ongewijzigd: de client toont alleen wat de server al toestaat.

## Componenten (centraal; niet per scherm nabouwen)

| Component | Bestand | Gebruik |
|---|---|---|
| `ActionMenu` + `IconButton` | `components/Menu.tsx` | Secundaire acties bij een rij of kaart (⋯, 48 × 48 px). Menu opent direct bij de knop, boven of onder naar beschikbare ruimte (`placeMenu`), blijft binnen het scherm. Sluit bij tikken buiten, Escape, Android-terugactie, navigatie; focus keert terug naar de knop. Zonder zichtbare items verschijnt geen knop (rolgebonden). |
| `ConfirmProvider` / `useConfirm` / `ConfirmDialog` | `components/Dialog.tsx` | Eén bevestigingsdialoog voor verwijderen, deactiveren, intrekken, uitloggen en vrijgeven. Titel + gevolg + expliciete knoppen ("Annuleren" / "Verwijderen"). Focus op Annuleren, focus-trap, Escape/terug/achtergrond = annuleren, één keer uitvoeren. Geen `window.confirm`. |
| `Sheet` | `components/Dialog.tsx` | Formulier bij een rij (bijv. gebruiker wijzigen, gezamenlijk akkoord): opent bovenaan, toetsenbord dekt niets af, Escape/terug sluit. Vervangt formulieren onderaan een lange pagina. |
| `StatusLabel` | `components/ui.tsx` | Eén vorm voor statussen (`neutral`/`ok`/`warn`/`bad`); de tekst noemt altijd de status (kleur is nooit het enige signaal). |
| `PageHead` | `components/ui.tsx` | Titel + ondertitel links, directe actie rechts (⋯ of hoofdknop). |
| `.item-row` / `.item-main` | `styles.css` | Kaartrij: tikbaar hoofdgedeelte + ⋯ rechts (nooit een knop in een knop). |
| `lib/overlays.ts` | | Stapel van open overlays; de Android-terugknop (`App.tsx`) sluit eerst de bovenste overlay. |

## Regels

1. **Primair direct zichtbaar, secundair in ⋯ bij de rij.** Geen actieknoppen onderaan een lange pagina en geen formulier dat onderaan verschijnt na een tik. Uitkomsten en fouten staan bovenaan de pagina (geen scrollsprong).
2. **Bevestig destructieve en ingrijpende acties** met `useConfirm`; systeemprompts alleen voor biometrie en OS-toestemmingen.
3. **Aanraakdoel ≥ 48 px** (`--touch`): knoppen, icoonknoppen, menu-items, invoervelden en keuzelijsten. Keuzelijsten krijgen op iOS dezelfde hoogte als een invoerveld.
4. **Aan/uit = schakelaar** (geen vinkje). Keuzerondjes alleen voor een exclusieve ja/nee-keuze.
5. **Tokens, geen kleurliteralen** buiten de `:root`-blokken (`tests/designTokens.test.ts`, `tests/uxStandard.test.ts`); licht/donker, hoog contrast en Dynamic Type volgen uit de tokens en rem-eenheden.
6. **Rolgebonden acties** worden verborgen (`hidden`) of komen niet voor in het scherm; de server blijft de bevoegdheid bepalen.

## Navigatie en invoer

- **Overzicht** is alleen een overzicht: geen knoppen. Wat jouw actie vraagt (voorstel of ontheffing) staat er als rij die opent; verder niets.
- **Voorstellen** is de enige lijst voor voorstellen én ontheffingen; elke rij toont het type ("Voorstel" of "Ontheffing") en de status. Ringstaf ziet daar beide knoppen ("Nieuw voorstel", "Nieuwe ontheffing"). Het aparte scherm Ontheffingen bestaat niet meer (`/ontheffingen` verwijst naar Voorstellen; ontheffingen horen onder de tab Voorstellen).
- **Roeping kiezen**: twee keuzelijsten (organisatie, roeping), geen zoekveld. Weinig uitleg: alleen wat nodig is om een fout te voorkomen.
- **Verantwoordelijken**: de voorgestelde persoon wordt direct ingevuld zolang er nog niets is gekozen; een eigen keuze wordt nooit overschreven. Er is geen invoer voor een externe uitvoerder (iedereen heeft een account).

## Aangepaste schermen

Voorsteldetail (kopmenu verwijderen, menu per deelnemer: herinneren / opnieuw vragen / uit ronde, gezamenlijk akkoord als sheet bij de ronde, "Administratief verwerkt" direct onder de kop, melding bovenaan) · Voorstellen, Ontheffingen, Meldingen (`PageHead`, `StatusLabel`) · Nieuw voorstel en concept (menu "Concept verwijderen…") · Gebruikersbeheer (menu per gebruiker: wijzigen, inlogmail, uitnodiging opnieuw, (de)activeren; formulier als sheet; menu per uitnodiging met bevestiging bij intrekken) · Ontheffingsdetail en -concept (verwijderen via menu + dialoog; vrijgeven met bevestiging) · Profiel (sessie intrekken, Face ID uitzetten en uitloggen met bevestiging) · Ringinrichting (wijk/gemeente en eigen roeping deactiveren met bevestiging) · Overzicht (rijen en statuslabels).

## Afwijkingen van Figma en resterende beperkingen

- Figma toont op de lijsten Voorstellen/Ontheffingen een ⋯ per kaart; omdat daar geen secundaire acties bestaan (alleen openen) is die weggelaten. Acties staan op het detailscherm.
- Figma toont een 48 px "+" in de kop; de app houdt de tekstknoppen "Nieuw voorstel"/"Nieuwe ontheffing"/"Uitnodigen" (duidelijker, zelfde hoogte).
- Zoekveld, filtersegmenten en initialenavatars uit de Figma-voorbeeldschermen bestaan nog niet in de app (geen bijbehorende functie of API); niet toegevoegd.
- Het "!"-icoon in de Figma-verwijderdialoog is niet overgenomen; de rode bevestigingsknop en de tekst dragen de waarschuwing.
- Taken in het voorsteldetail houden hun inline invoer (verantwoordelijke, datum, registreren), omdat die direct bij de taak horen.
- Alleen in Chromium (licht/donker, 390 en 320 px) visueel gecontroleerd; niet op een fysieke iPhone of Android-toestel.

## iOS 26-ontwerpstijl (Liquid Glass) – gedeeld designsysteem

Uitgangspunt (Apple HIG, Materials / Adopting Liquid Glass): **glas is de bedieningslaag, inhoud blijft rustig en effen.** Alle stijlen staan als tokens en componentklassen in `mobile/src/styles.css`; schermen gebruiken geen eigen kleuren, afrondingen of afmetingen (`tests/liquidGlassUi.test.tsx` bewaakt dit, inclusief het verbod op inline opmaak en browser-dialogen).

| Laag | Wat | Implementatie |
|---|---|---|
| **Native Liquid Glass** | hoofdnavigatie (tabbalk) | echte `UITabBar` (iOS 26+: systeemglas), `NativeTabBarPlugin.swift` |
| **Glas in CSS** (benadering, geen claim van Apple's exacte optiek) | navigatiebalk bovenaan, terugknop, icoonknoppen, contextmenu, segmentbesturing | tokens `--glass*`, `--glass-edge*`, `--elev-*`; klasse `.glass-control` en de componenten zelf |
| **Effen oppervlakken** | kaarten, lijstrijen, formulieren, invoervelden, dialogen en sheets met inhoud | `.glass` (naam historisch: effen gegroepeerd vlak), `--field-bg` |

- **Vormen:** bediening is een capsule (`--radius-pill`: knoppen, segmenten, labels, terugknop; icoonknop rond); kaarten `--radius-xl` (28), rijen/menu `--radius-l` (20), velden `--radius-m` (14).
- **Knoppen:** `.btn-primary` (gevuld), `.btn-secondary`/`.btn-ghost` (tint-gevuld), `.btn-destructive`/`.btn-danger` (rood gevuld), `.btn-plain` (tekst), `.icon-btn` (rond glas, 48 px), uitgeschakeld = 45 % + niet tikbaar. Alle minimaal 48 px (`--touch`).
- **Navigatiebalk:** glas bovenaan; de pagina schuift eronder door (de balk meet zijn hoogte → `--navbar-h`); één terugknop met duidelijke naam; lange titels lopen over meerdere regels.
- **Overlays:** menu (glas, bij de knop), dialoog en sheet (effen, scrim met lichte blur), één stijl voor bevestigen/selecteren/formulieren; Escape/terug sluit; focus keert terug.
- **Formulieren:** effen velden, 2 px rode rand bij `aria-invalid`, foutmelding als blok met waarschuwingsteken (`.error`), schakelaars i.p.v. vinkjes.
- **Statussen:** `.status` met symbool (✓ ! ✕) naast de tekst; nooit alleen kleur.
- **Toegankelijkheid per modus:** donker, Verhoogd contrast (glas nagenoeg dekkend), Reduce Transparency (glas effen, geen blur, geen lichtrand), Reduce Motion (alle overgangen uit), Dynamic Type (`-apple-system-*`, `min-height` i.p.v. vaste hoogtes; dialoogknoppen stapelen), veilige randen en toetsenbord ongewijzigd. Contrastparen voor glas, tint-gevulde knop, menu en veld worden per modus getest.
- **Terugval:** Android, PWA en browser gebruiken dezelfde CSS-tokens (glas valt waar `backdrop-filter` ontbreekt effen terug); iOS 18–25 krijgt de standaardbalk met systeemblur voor de tabs. Android wordt niet in een iOS-kopie gedwongen: eigen terugknop-gedrag en de React-tabbalk blijven.
- **Bewust niet native:** contextmenu's, sheets en dialogen blijven React-componenten. Een native `UIMenu` zou een onzichtbaar `UIButton` per ankerpositie met `performPrimaryAction()` en een callbackbrug per menu vragen, zonder toestel niet te verifiëren en met risico op regressies in rolgebonden acties; een eigen `UIGlassEffect`-laag boven de WebView geeft problemen met de appvergrendeling en overlays. Voorstel voor later: een gerichte proef met één native menu.
