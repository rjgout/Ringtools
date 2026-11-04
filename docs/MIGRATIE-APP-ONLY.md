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

### C2 – Ringinrichting en roepingencatalogus (gerealiseerd)
- **Catalogus** (`src/lib/catalog/callings.ts`, versie `2026.11-1`): 89 functietitels in 23 organisatiecategorieën uit het aangeleverde LCR-overzicht, plus de afgesproken
  uitzondering "Eerste/Tweede raadgever in de bisschap". **Alleen functietitels en categorieën**: geen namen, bezettingen, steundata of unitgegevens. Het LCR-bronbestand
  staat niet in de repository (test borgt dat er geen `.pdf` in zit). Het later aangeleverde CSV-overzicht (zonder personen) is gebruikt als onafhankelijke controle;
  `tests/fixtures/lcr-functietitels.json` bevat alleen titels/categorieën/vertaalstatus en controleert dat de catalogus volledig is en niets extra's bevat.
  Het LCR-overzicht bevat geen functiecodes: de codes zijn stabiele **interne** codes.
- Per functie: Nederlandse naam, LCR-/Engelse alias (zoekbaar), categorie, type, handboekreferentie, goedkeuringsroute, wie mag roepen en aanstellen, steunverlening, of aanstelling
  verplicht is, vervolgvragen bij ontheffing (president(e) → eerste en tweede raadgever), waarschuwing, controlepunten, actief en cataloguversie.
  Ringpresident, nieuwe ringraadgevers en patriarch lopen via een procedure buiten Ringtools (niet te kiezen); de bisschop zelf is niet opgenomen.
- **Bevoegdheidsregels** komen uit Algemeen handboek 30.8.3 (zoals opgehaald; de bron gaf een samenvatting) en 30.6. **Ter controle door de eigenaar:** alle regels staan als
  `reviewNotes` gemarkeerd waar ze niet bevestigd zijn (o.a. instituutshoofd, seminariehoofd, verificatiecomité, bisschapsraadgevers, noot 3 activiteitencomité/kerkgebouwen).
  De 8 voorlopige vertalingen en de 2 gestandaardiseerde namen (Hogeraadslid, Ringpatriarch) uit het CSV-overzicht zijn gemarkeerd.
- **Wijken en gemeenten** (`RingUnit`): toevoegen, hernoemen, (de)activeren, verantwoordelijk hogeraadslid (meerdere units per lid mogelijk), standaardverantwoordelijken voor de
  drie taken. Vacature en niet-meer-actieve verantwoordelijke zijn zichtbaar en geven geen voorstel. De koppeling bepaalt **nooit** wie in de hoge raad mag ondersteunen.
  Gedeactiveerde units/leden krijgen geen nieuwe toewijzingen.
- **Eigen roepingen** (`RingCustomCalling`): per ring, alleen daar zichtbaar, zonder afgeleide bevoegdheden; bij gebruik bevestigt de bevoegde leiding de procedure
  (nu afgedwongen in de app; serverafdwinging volgt in C3 bij het opslaan op het voorstel). Bestaande voorstellen behouden hun functienaam.
- **Aanstellingsbevoegdheid** (`RingMembership.appointAuthority`): expliciete aanwijzing (ringpresident, aangewezen raadgever, aangewezen hogeraadslid) door de ringbeheerder,
  passend bij de rol, max. één ringpresident, vervalt bij deactiveren of rolwijziging. De lijst van mogelijke aanstellers (`GET /catalog/callings/:code/appointers`) volgt de regel
  van de standaardroeping; een Ringtools-rol of kerkelijke functie is op zichzelf geen machtiging; bij eigen/bijzondere procedures is de lijst leeg (handmatige registratie, C3).
- **Ringinrichting**: overzicht van acht stappen (`GET /rings/:id/setup`); activatie volgt uit `User.activatedAt` (eerste voltooide login). Vacatures in de hoge raad zijn toegestaan.
- **Migratie** `20261108100000_c2_ringinrichting` (additief): enums, `RingUnit`, `RingCustomCalling`, kolommen `RingMembership.appointAuthority` en `User.activatedAt`; bestaande
  ingelogde gebruikers worden als geactiveerd gemarkeerd; niets wordt verwijderd.
- **App**: tabblad "Inrichting" (ringbeheerder) en in het ringbeheer van de webmin; roepingenkiezer (zoeken, organisatie automatisch voorgesteld, eigen roeping toevoegen) in "Nieuw voorstel".
- Open bij C2: opslaan van catalogus-/unitkeuze op het voorstel, automatische voorinvulling van verantwoordelijken en procesvoorstellen (C3); toesteltest.

### C3 – Concepten en nieuw roepingsproces (gerealiseerd)
- **Correctie catalogus (C2)**: `entry()` kent geen ruimste standaardbevoegdheid meer toe. Elke functie heeft een `ruleStatus`: **GEVERIFIEERD** (expliciet genoemd in handboek 30.8.3: o.a.
  ringadministrateur/-secretaris en assistenten, hogeraadslid, organisatiepresidenten en hun raadgevers/secretarissen, verificateur, seminarie-/instituutsleerkracht, welzijnsdeskundige,
  tolkencoördinator – 32 functies), **TE_BEOORDELEN** (onbekend: `ONBEKEND` voor roepen/aanstellen/aanstellingsplicht, steunverlening `NADER_BEPALEN`; 55 functies) en **BIJZONDER**
  (buiten Ringtools). Bij onbekende regels worden **geen** bevoegdheden aan personen toegekend, staat er "Menselijke controle nodig" en is bij gebruik een bevestiging van de bevoegde leiding
  verplicht. Alle controlepunten (`reviewNotes`) zijn behouden; overzicht: [`CATALOGUS-CONTROLE.md`](CATALOGUS-CONTROLE.md) (gegenereerd, door een test actueel gehouden) en `GET /catalog/review`.
- **Nieuw voorstel in vijf stappen** (app): naam (handmatig) → wijk/gemeente → roeping (catalogus of eigen) → verantwoordelijken controleren → concept opslaan of indienen. Geen koppeling met een
  ledenregister of LCR-persoonsgegevens.
- **Alleen via concepten**: `POST /callings` bestaat niet meer; `POST /drafts` (onvolledig mag), `POST /drafts/:id` (bewerken), `POST /drafts/:id/delete`, `GET /drafts`, `POST /drafts/:id/submit`.
  Een concept is alleen zichtbaar voor ringstaf van de eigen, actieve ring, start geen ronde, stuurt geen melding/e-mail/push.
- **Indienen** (`submitDraft`): valideert alles opnieuw server-side (naam, unit van déze ring en actief, functie bestaat en is op te starten, eigen roeping hoort bij deze ring, verantwoordelijken
  actief in deze ring, bevoegdheid, bevestiging), is atomair en idempotent (rij-lock; dubbel tikken/netwerkherhaling/gelijktijdig → exact één voorstel en één set meldingen). Daarna worden de
  persoonsgegevens uit het concept gewist.
- **Server-side vastgelegd op het voorstel**: unit (id + naam/soort-snapshot), functiebron (STANDAARD/EIGEN; VRIJE_TEKST alleen in de overgangswebapp), stabiele functiecode, Nederlandse functienaam bij
  indienen, cataloguversie, procedure-snapshot (regels + verificatiestatus + handboekverwijzing + controlepunten), taakverantwoordelijken, externe bevoegde personen en wie/wanneer de
  procedurecontrole bevestigde. Latere catalogus- of unitwijzigingen veranderen een bestaand voorstel niet van betekenis. Voorstellen van vóór C3 hebben deze velden niet en blijven ongewijzigd geldig.
- **Eigen roepingen**: servercontrole verplicht (zonder bevestiging geweigerd); alleen binnen de eigen ring; nooit afgeleide bevoegdheden. Dezelfde bevestiging geldt voor niet-geverifieerde standaardroepingen.
- **Voorgestelde verantwoordelijken** uit de wijk-/gemeentekoppeling (`buildSuggestions`): alleen voor zover bevoegd; een wijktoewijzing geeft nooit zelf bevoegdheid. Roepen en aanstellen kunnen
  alleen aan expliciet aangewezen personen (geverifieerde regel) of aan een handmatig geregistreerde bevoegde externe persoon; ook bij achteraf wijzigen (`assignTaskGuarded`, ook in de overgangswebapp).
  Ondersteunen (steunverlening) kent geen bevoegdheidsregel. Intern ondersteunen (presidium/hoge raad), roepen, steunverlening en aanstellen blijven gescheiden.
- **Overgangswebapp**: vrije tekst blijft mogelijk maar vereist een expliciete procedurebevestiging en wordt als `VRIJE_TEKST` vastgelegd (geen catalogusregels).
- **Opruimregels concepten**: verlaten concepten (30 dagen niet gewijzigd) worden verwijderd; ingediende concepten behouden alleen een sleutel (zonder persoonsgegevens) en worden na 7 dagen verwijderd
  (nachtelijke cron, `deleteStaleDrafts`). Concepten zijn tijdelijke persoonsgegevens en vallen onder de bestaande bewaartermijnen.
- **Migratie** `20261109100000_c3_concepten` (additief): enum `FunctionSource`, kolommen op `Calling` (alle nullable), tabel `CallingDraft`; niets wordt verwijderd.
- **C1 blijft intact**: ingediend voorstel → ringpresidium → akkoord wacht op expliciete vrijgave → geen automatische doorstart; lege hoge raad keurt nooit goed; individueel en gezamenlijk akkoord werken beide.
