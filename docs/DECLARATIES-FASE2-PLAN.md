# Declaraties – planning fase 2 (nog niet gebouwd)

Status: **alleen planning**. Fase 2 start pas na de acceptatietest van fase 1 op dev (`docs/DECLARATIES-ACCEPTATIETEST.md`) en na akkoord van de eigenaar.

## Activiteiten – besluiten eigenaar
1. Alleen financiële administrateurs en subadministrateurs mogen activiteiten aanmaken (en wijzigen/afsluiten).
2. Een activiteit hoort bij **één** ring, wijk of gemeente.
3. Kerkleden kunnen bij hun declaratie een activiteit selecteren; de koppeling blijft **optioneel**.
4. Kerkleden zien nooit declaraties of financiële overzichten van anderen.
5. Budgetten zijn zichtbaar voor bevoegde financiële administrateurs en de ringpresident binnen hun scope.
6. Budgetoverschrijding geeft een **waarschuwing** en blokkeert nooit een declaratie.
7. Export naar **PDF en CSV**.
8. Een activiteit kan meerdere declaraties van verschillende gebruikers bevatten.

## Ontwerpschets (ter beoordeling, additief)
- Model `Activity` (ring/unit-scope, naam, periode, optioneel budget in eurocenten, actief) en optionele `Declaration.activityId`. De scope van de declaratie moet gelijk zijn aan die van de activiteit.
- Overzicht per activiteit voor de administrateur: totaal, aantal per status, verwerkt versus openstaand, budgetpercentage; ringpresident leest hetzelfde (alleen lezen) binnen zijn scope.
- Het kerklid ziet bij de keuze alleen activiteiten van de gekozen bestemming (naam en periode, **geen** budget of totalen).
- Export (PDF/CSV) volgt dezelfde autorisatie en wordt in het toegangslog vastgelegd; exports bevatten persoonsgegevens en zijn dus even vertrouwelijk als de declaraties zelf.
- Server-side tests: scope, optionaliteit, geen inzage voor kerkleden, budgetwaarschuwing zonder blokkade, exportautorisatie.

## Overige onderdelen fase 2 (uit de oorspronkelijke opdracht)
Berichten per declaratie, meldingen en voorkeuren, PDF-exports (bonnen/overzicht/dossier), omzetting foto's naar PDF, persoonlijke namenlijst, ingelogd blijven met biometrie, twee ringbeheerders en noodfuncties centrale beheerder, onderzoek bewaartermijn vóór automatische verwijdering.
