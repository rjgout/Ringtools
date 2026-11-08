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

## Aangepaste schermen

Voorsteldetail (kopmenu verwijderen, menu per deelnemer: herinneren / opnieuw vragen / uit ronde, gezamenlijk akkoord als sheet bij de ronde, "Administratief verwerkt" direct onder de kop, melding bovenaan) · Voorstellen, Ontheffingen, Meldingen (`PageHead`, `StatusLabel`) · Nieuw voorstel en concept (menu "Concept verwijderen…") · Gebruikersbeheer (menu per gebruiker: wijzigen, inlogmail, uitnodiging opnieuw, (de)activeren; formulier als sheet; menu per uitnodiging met bevestiging bij intrekken) · Ontheffingsdetail en -concept (verwijderen via menu + dialoog; vrijgeven met bevestiging) · Profiel (sessie intrekken, Face ID uitzetten en uitloggen met bevestiging) · Ringinrichting (wijk/gemeente en eigen roeping deactiveren met bevestiging) · Overzicht (rijen en statuslabels).

## Afwijkingen van Figma en resterende beperkingen

- Figma toont op de lijsten Voorstellen/Ontheffingen een ⋯ per kaart; omdat daar geen secundaire acties bestaan (alleen openen) is die weggelaten. Acties staan op het detailscherm.
- Figma toont een 48 px "+" in de kop; de app houdt de tekstknoppen "Nieuw voorstel"/"Nieuwe ontheffing"/"Uitnodigen" (duidelijker, zelfde hoogte).
- Zoekveld, filtersegmenten en initialenavatars uit de Figma-voorbeeldschermen bestaan nog niet in de app (geen bijbehorende functie of API); niet toegevoegd.
- Het "!"-icoon in de Figma-verwijderdialoog is niet overgenomen; de rode bevestigingsknop en de tekst dragen de waarschuwing.
- Taken in het voorsteldetail houden hun inline invoer (verantwoordelijke, datum, registreren), omdat die direct bij de taak horen.
- Alleen in Chromium (licht/donker, 390 en 320 px) visueel gecontroleerd; niet op een fysieke iPhone of Android-toestel.
