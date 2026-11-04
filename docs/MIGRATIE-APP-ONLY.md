# Migratie naar app-first / app-only

Doel: Ringtools wordt een volwaardige native app (iOS + Android). De publieke website wordt een uithangbord; alleen een streng beveiligde
technische beheeromgeving voor `webmin` blijft via het web bestaan. **Deze migratie verloopt gefaseerd. De definitieve omschakeling
(web-login voor gewone gebruikers uit) gebeurt uitsluitend na een afzonderlijke, expliciete opdracht van de eigenaar.**

## Fasen en status

| Fase | Inhoud | Status |
|---|---|---|
| A | Alle roepings- en taakfunctionaliteit in de app | gebouwd en getest (CI); toesteltest iPhone/Android open |
| B | Gebruikers- en ringbeheer; veilige webmin-login in de app | gebouwd en getest (lokaal); toesteltest open |
| C | Native passkeys; uitnodigings- en activatieprocedure | gepland |
| D | Ontheffingen (eigen module en datamodel) | gepland |
| E | Publieke informatieve website; voorbereiding uitschakelen web-login (feature flag, standaard UIT) | gepland |
| F | Live acceptatie iPhone/Android; daarna eventuele storepublicatie | gepland (handmatig, eigenaar) |

## Overgangsfase (nu)
De webapp blijft bereikbaar voor bestaande gebruikers. De app krijgt alle functionaliteit. Checklist voor de omschakeling (alles moet
aantoonbaar waar zijn): alle reguliere functies werken in de app · native MFA werkt · gebruikers zonder technische kennis kunnen installeren ·
nieuwe gebruikers kunnen worden uitgenodigd en geactiveerd · e-maillinks werken · iOS én Android beschikbaar voor de doelgroep ·
betrouwbare herstelprocedure bij verlies van een toestel.

## Resterende blokkades per fase
Wordt na elke fase bijgewerkt (zie hieronder).

### Fase A
- Gebouwd: scherm "Nieuw voorstel" (ringleden via `GET /rings/:id/members`, alleen staf, alleen eigen ring), staf-acties in het voorstel
  (iedereen/individueel herinneren, opnieuw vragen, uit ronde halen), taken toewijzen en afronden (incl. gelegenheid bij Ondersteunen en datum),
  administratief verwerken en definitief verwijderen met bevestiging. Alle acties roepen de bestaande `workflow.ts`-functies aan.
- Blokkade: geen fysieke toesteltest; echte pushlevering ongetest (zie `docs/MOBILE.md`).

### Fase B
- **Webmin-login in de app:** `POST /admin/auth/login` (wachtwoord, rate-limit) → wachtend token (10 min, nergens als sessie geldig) →
  `POST /admin/auth/totp` (TOTP of herstelcode, zelfde lockout/replay-bescherming als de web) → volledige sessie. Zonder bevestigde TOTP is er
  geen mobiele sessie (`totp-not-configured`); eerste TOTP-inschrijving blijft in de technische beheeromgeving (web).
- **Herverificatie:** gevoelige acties geven `403 reauth-required` als de laatste tweede factor > 15 min oud is. Webmin: verse TOTP
  (`/admin/auth/reauth`); ringbeheerder: verse e-mailcode (`/auth/reauth`); gebruikers met passkey-verificatie volgen in Fase C.
- **Gebruikersbeheer:** `GET/POST /rings/:id/users`, `POST /memberships/:id` (ringbeheerder, alleen eigen ring; webmin via `/admin/...`).
  Alle regels zitten in `src/lib/rings.ts` (≥ 1 actieve ringbeheerder, geen bestaande accounts koppelen door ringbeheerders, functie ≠ rechten).
  "Uit de ring verwijderen" = lidmaatschap deactiveren (bestaand gedrag; geschiedenis blijft). Deelnemers aan rondes: zie Fase A.
- **Ringbeheer (alleen webmin):** `/admin/rings` (lijst, aanmaken met eerste ringbeheerder, hernoemen, (de)activeren). Nieuw: `Ring.active`
  (additieve migratie `20261106100000_ring_active`, standaard `true`); een gedeactiveerde ring is voor leden onzichtbaar, niets wordt verwijderd.
- **Sessie-intrekking op afstand:** `/sessions` en `/admin/sessions` (+ `/revoke`).
- Blokkades: geen fysieke toesteltest; passkey-herverificatie en native passkeys (Fase C); uitnodigingsmail voor nieuwe gebruikers (Fase C: nu loggen
  nieuwe gebruikers in via "Stuur code" op hun e-mailadres); TOTP-inschrijving blijft web (technisch beheer).

## Fase C (functionele herziening, opdracht na `61dcef5`)

Volgorde: C1 workflowcorrecties · C2 ringinrichting + roepingencatalogus · C3 concepten en nieuw roepingsproces · C4 ontheffingen ·
C5 uitnodigingen en native MFA · C6 afronding. Ringtools is een hulpmiddel om voorstellen, ondersteuning, ontheffingen en uitvoering te
coördineren; **LCR blijft de officiële bron**, Ringtools houdt geen blijvend personenregister bij en neemt geen kerkelijke beslissingen.

### C1 – Workflowcorrecties (gerealiseerd)
- **Geen automatische goedkeuring meer** bij een lege hoge raad (de regel is verwijderd). Een lege hoge raad blokkeert de vrijgave met een duidelijke melding.
- **Nieuwe status `PRESIDIUM_APPROVED`** ("Presidium akkoord – wacht op vrijgave aan de hoge raad"). Na individueel of gezamenlijk akkoord start de
  hogeraadronde NIET meer automatisch en de hoge raad ontvangt niets.
- **Vrijgave** (`releaseToHogeraad`, `POST /callings/:id/release`): alleen ringstaf van de eigen (actieve) ring; controleert opnieuw de actieve
  hogeraadsleden (en is het haakpunt voor de persoonlijke kennisgeving bij ontheffingen, C4); maakt de deelnemerslijst; start de ronde; verstuurt de
  meldingen. Idempotent en race-vrij (rij-lock): exact één ronde, één audit-regel (`CallingAudit`), één uitnodiging per persoon.
- **Gezamenlijk akkoord** (`registerGroupDecision`, `POST /callings/:id/group-decision`) voor presidium én hoge raad. Het is een vastlegging van een
  daadwerkelijk genomen besluit (`GroupDecision`: datum, registrant, tijdstip, expliciete verklaring, toelichting). Er worden **nooit** reacties namens
  anderen aangemaakt; secretaris/administrateur registreren namens het presidium en tellen niet als ondersteuner. Hoge raad: verplichte presiderende
  persoon uit het ringpresidium, minstens één aanwezige, aanwezigen/afwezigen moeten deelnemers van de ronde zijn, afwezig ≠ ondersteunend. Er is
  bewust géén quorum- of meerderheidsregel. Bestaande negatieve reacties blijven bewaard; registreren vereist een expliciete, gemotiveerde afhandeling.
- **Datamodel (additief, migratie `20261107100000_c1_workflow_vrijgave`):** enum-waarde `PRESIDIUM_APPROVED`, enum `DecisionMethod`, kolommen op
  `Calling` (presidiumApprovedAt/-Method, hogeraadReleasedAt/-ById, hogeraadApprovalMethod), tabellen `GroupDecision` en `CallingAudit` (beide
  cascade op het voorstel: verdwijnen met het voorstel, dus geen blijvend register). Bestaande voorstellen en statussen blijven ongewijzigd geldig.
- Overgangswebapp: alleen een knop "Vrijgeven aan de hoge raad" (zodat geen voorstel vastloopt); gezamenlijke besluiten zijn app-only.
- Open bij C1: pushmelding aan ringstaf bij "wacht op vrijgave" (nu zichtbaar op overzicht/dashboard); toesteltest.
