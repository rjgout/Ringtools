# E2.6 – kwaliteitsronde en controle van de roepingenworkflow

Doel: betrouwbaarheid van de dagelijkse werkzaamheden van het ringpresidium (concept → ondersteuning → vrijgave → uitvoering → verwerkt) aantoonbaar maken zonder fysieke toesteltest. Alles hieronder is **codecontrole en geautomatiseerde tests (simulatie)**; niets is op een echte iPhone getest.

## Fase A – E2.5 technisch afgerond

- **Playwright-matrix** (`e2e/nativeDevice.spec.ts`, modus `E2E_NATIVE_DEVICE=off|login|auto`): vier configuraties, steeds met dezelfde expliciete verwachtingen. De eerste test van de spec vergelijkt de verwachte modus met `/meta` van de draaiende server; een ongeldige vlagcombinatie faalt dus in plaats van te worden overgeslagen. Configuraties: `WEB_TOTP/TRUSTED/NATIVE` = `on/on/auto`, `on/on/login` (TOTP en vertrouwde toestellen aan, automatische inrichting uit), `on/off/off`, `off/off/off`.
- `vertrouwdeToestellen.spec.ts` vereist `E2E_WEB_TOTP=on` (de testgebruiker gebruikt een authenticator-app); dat staat nu expliciet in de spec. Dit was een testconfiguratiefout, geen productfout.
- **Migraties** gecontroleerd op een lege database, en op een gevulde database in de toestand van vóór E2.4a (ringen, gebruikers, lidmaatschappen, sessies, E2.3-toestellen) en van vóór E2.5 (actief E2.4a-toestel, ingetrokken toestel). Alle gegevens bleven behouden; E2.3-toestellen blijven niet-geactiveerd (geen stille promotie); schema-diff leeg.
- **Autorisatie** (`tests/deviceAuthorization.test.ts`): ander account kan toestel/inrichting van een gebruiker niet uitzetten of voltooien; ingetrokken sessie, gedeactiveerd account, pending-login, webmin en toestelsessie (geen recente MFA) worden server-side geweigerd; ingetrokken toestel kan niet worden hergebruikt.

## Fase B – gevonden fouten (alle bewezen met een falende test vóór de correctie)

Test: `tests/workflowRaces.test.ts` (backend) en `mobile/tests/callingDetail.test.tsx`.

1. **Tegenstem naast presidiumakkoord (race in `castVote`)**. De statuscontrole gebeurde buiten de rijvergrendeling. Wijzigt een presidiumlid zijn reactie in een tegenstem terwijl het laatste akkoord binnenkomt, dan bleef de ronde `PRESIDIUM_APPROVED` met een opgeslagen tegenstem. Bewijs: `status=PRESIDIUM_APPROVED, tegenstemmen=1`. Correctie: controle, deelnemerscontrole en opslaan onder dezelfde vergrendeling als de herberekening; een reactie op een gesloten ronde wordt geweigerd.
2. **Dubbele "taak afgerond"-melding (`completeTask`)**: drie gelijktijdige afrondingen gaven drie meldingen (verwacht 1). Correctie: controle en opslaan onder vergrendeling.
3. **Dubbele verwerking (`markProcessed`)**: twee gelijktijdige verwerkingen slaagden beide en overschreven verwerker/tijdstip. Correctie: gereedheidscontrole onder vergrendeling; de tweede wordt geweigerd.
4. **Dubbele 30-dagenherinnering (`sendDue30DayReminders`)**: twee overlappende runs stuurden elk de herinnering (4 i.p.v. 2 meldingen). Correctie: atomair claimen; bij een fout bij het versturen wordt de claim vrijgegeven zodat de volgende run het opnieuw probeert (zoals voorheen).
5. **Dubbel tikken in de app (hardening)**: twee tikken binnen dezelfde render startten twee verzoeken (test: 2 aanroepen vóór, 1 na de correctie). De server was al grotendeels idempotent, maar de tweede uitkomst kon de eerste melding overschrijven (bijv. "nog niet gereed" na een geslaagde verwerking).

Aanvullend gecontroleerd en in orde bevonden (met nieuwe regressietests in `tests/workflowLifecycleApi.test.ts`): volledige levenscyclus via de API met concept bewaren/hervatten, niet-stemgerechtigde rollen, tegenstem pauzeert en niets gaat vanzelf verder, opnieuw vragen, expliciete en idempotente vrijgave, hogeraadronde, taken, verwerken; meldingen alleen naar de juiste ontvangers, zonder persoonsgegevens in titel/bericht/pad, correcte ongelezen-teller; rollen- en ringmatrix (andere ring, gedeactiveerd account/lidmaatschap/ring, webmin, hoge raad zonder staf, gebruiker in meerdere ringen); gelijktijdige tegenstemmen en gelijktijdige laatste akkoorden geven één pauze- resp. vrijgavemelding.

## Open beleidsvragen (niet zelfstandig besloten)

1. **Bewaartermijn en opruiming** blijven ongewijzigd (30 dagen na verwerking). Geen aanleiding gevonden om dit te wijzigen.
2. **Tegenstem na gesloten ronde.** Sinds de correctie kan een reactie na afsluiten van een ronde niet meer worden gewijzigd. Wenst de eigenaar dat een presidiumlid na een presidiumakkoord nog bezwaar kan melden, dan is dat een procedurekeuze (bijvoorbeeld een aparte "bezwaar"-handeling) en geen stille wijziging van een gesloten ronde.
3. **Weesapparaat bij E2.5.** Gaat het antwoord van de server bij automatische inrichting verloren, dan kan een toestel op de server blijven staan dat de app niet kent. Voorkeur: laten staan (zichtbaar en intrekbaar op het web); automatisch opruimen vereist een beleidskeuze over wat "verloren" betekent.

## Nog fysiek op een iPhone te testen

De volledige E2.5-acceptatietest (`docs/E2-3-IPHONE-ACCEPTATIETEST.md`, E2.5-deel) blijft open voor de eigenaar: opstartgedrag zonder sessie, instellen van Face ID, dubbele prompts, accountwissel op één toestel, schermafscherming bij statusovergangen. Ook de workflowschermen (stemmen, taken, verwerken) zijn alleen in jsdom getest.
