# Migratie naar app-first / app-only

Doel: Ringtools wordt een volwaardige native app (iOS + Android). De publieke website wordt een uithangbord; alleen een streng beveiligde
technische beheeromgeving voor `webmin` blijft via het web bestaan. **Deze migratie verloopt gefaseerd. De definitieve omschakeling
(web-login voor gewone gebruikers uit) gebeurt uitsluitend na een afzonderlijke, expliciete opdracht van de eigenaar.**

## Fasen en status

| Fase | Inhoud | Status |
|---|---|---|
| A | Alle roepings- en taakfunctionaliteit in de app | gebouwd en getest (CI); toesteltest iPhone/Android open |
| B | Gebruikers- en ringbeheer; veilige webmin-login in de app | gebouwd en getest (lokaal); toesteltest open |
| C | Native passkeys; uitnodigings- en activatieprocedure; C6 afronding (zie "C6") | C5.1 (uitnodigen/activeren) gebouwd en getest; C5.2 (native passkeys) voorbereid, functievlag UIT, toesteltest open; zie "C5" |
| D | Ontheffingen (eigen module en datamodel) | gebouwd en getest (C4, lokaal/CI); toesteltest open; zie "C4" en "Open vragen" |
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
  anderen aangemaakt; secretaris/administrateur registreren alleen een werkelijk genomen besluit en tellen niet als ondersteuner: het presidiumbesluit vereist minstens één actief presidiumlid dat deelnam en dat wordt vastgelegd (zie "C4-correcties"). Hoge raad: verplichte presiderende
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

### C3-correcties (bij C4)
- **Vastgelegde procedure telt**: `assignTaskChecked` bepaalt de bevoegdheid bij achteraf wijzigen uit de bij indienen vastgelegde `procedureSnapshot` (regel + `ruleStatus`), niet uit de actuele catalogus.
  Alleen voor voorstellen van vóór de snapshot valt het terug op de catalogus. De personen zelf worden altijd nu bepaald (actief lid, expliciet aangewezen).
- **Herstelbare aanmaakmeldingen**: na een gelukt indienen zijn de meldingen losgekoppeld van het opslaan. `Calling.creationNotifyClaimedAt/creationNotifiedAt` + `deliverCreationNotifications` (claim met 2 minuten
  lease, compare-and-set): precies één verzender tegelijk; pas na volledig succes wordt `creationNotifiedAt` gezet. Een fout laat het voorstel bestaan; een herhaald indienen of de cron (elke 10 minuten,
  `retryPendingCreationNotifications`) maakt de levering af en slaat ontvangers over die al een interne melding voor dit voorstel hebben. Interne melding is de betrouwbare registratie; push/e-mail zijn per ontvanger
  hooguit eenmaal (liever een gemiste push dan een dubbele). Bestaande voorstellen zijn in de migratie als reeds gemeld gemarkeerd.
- **Wijk/gemeente van herkomst verplicht**: indienen is geblokkeerd zolang de ring geen actieve wijk/gemeente heeft (het concept blijft bewaard); daarna is een keuze verplicht. De overgangswebapp (vrije tekst, wordt
  uitgefaseerd) gebruikt `createCalling` direct en kent deze eis niet; nieuwe functionaliteit loopt alleen via de app.
- **Bisschop**: een eigen roeping met de naam "Bisschop" is voor voorstellen en ontheffingen geweigerd (`isBishopFunctionName`).

### C4 – Ontheffingen (gerealiseerd)
Zelfstandige module (`src/lib/ontheffingen.ts`, `src/lib/api/ontheffingen.ts`, app-schermen `Ontheffingen`, `OntheffingForm`, `OntheffingDetail`), los van `Calling`.
- **Route**: concept → ringpresidium (individueel via ondersteuning in de app, of gezamenlijk besluit in een vergadering) → `PRESIDIUM_APPROVED` wacht op **expliciete, idempotente vrijgave** → hoge raad
  (individueel of gezamenlijk; presiderend presidiumlid verplicht) → `APPROVED` → uitvoering per persoon: persoonlijk informeren → bekendmaking (met registratie of er **gelegenheid tot dankbetuiging is geboden**; geen
  stemknoppen; verwerken vereist de bekendmaking, niet dat er daadwerkelijk dank is uitgesproken) → administratief verwerken → `PROCESSED` → dossier wordt 30 dagen later verwijderd. Een lege hoge raad (ook na uitsluiting van betrokkenen) leidt nooit tot goedkeuring en blokkeert de vrijgave.
- **Concept**: naam handmatig, wijk/gemeente (verplicht bij indienen), roeping uit de Nederlandstalige catalogus (of eigen roeping met procedurebevestiging); bewaren en later wijzigen; alleen zichtbaar voor de
  aanmaker; start niets; vervalt 30 dagen na de laatste wijziging. Indienen valideert alles opnieuw, is atomair en idempotent en legt unit, functie, cataloguversie en procedure vast.
- **Buiten Ringtools**: functies met `ringtoolsProcess = false` (ringpresident, eerste/tweede raadgever ringpresidium, ringpatriarch) en de bisschop zijn niet te kiezen, **ook niet als eigen roeping**: `isOutsideRingtoolsFunctionName`
  (catalogus + gangbare schrijfwijzen, volledig geankerd zodat o.a. "Jongemannenpresident" of "Eerste raadgever jongemannen" niet worden geraakt) weigert ze bij het toevoegen/hernoemen van een eigen roeping én bij elk gebruik/indienen
  (voorstellen en ontheffingen, ook voor eigen roepingen die al bestonden). Raadgevers in een bisschap blijven toegestaan (afspraak eigenaar).
- **Vertrouwelijkheid betrokkene** (geen register van huidige roepingen, dus nooit koppelen op naam):
  - Bij elke betrokkene verklaart de staf expliciet "Ringtools-account: dit account" (`GEKOPPELD`) of "geen account" (`GEEN_ACCOUNT`); zonder antwoord kan niet worden ingediend. Je kunt jezelf niet koppelen; een account
    maar één keer per dossier; alleen een actief lid van déze ring. De koppeling ligt na indienen vast (geen wijziging) en verdwijnt met het dossier (cascade bij verwijderen/opruimen).
  - Een gekoppeld account heeft **nergens** toegang: detail (`loadAccess` geeft hetzelfde antwoord als bij een onbestaand dossier), lijst, aantallen (`ontheffingCounts`, dashboard, app-badge), stemmen, vrijgave,
    uitvoering, verwijderen, push, interne meldingen (`notify` filtert betrokkenen zelf nog eens weg) en deeplinks. Het is uitgesloten van de deelnemerslijsten van beide rondes en van het gezamenlijk besluit.
  - Ontheffingen sturen nooit e-mail en geen persoonlijke open-link; push en interne meldingen zijn generiek ("Vertrouwelijk voorstel") zonder naam, functie of het woord ontheffing. Een universele link bestaat bewust niet.
  - Een concept is alleen voor de aanmaker zichtbaar (voor de koppeling vastligt kan niemand anders het zien). Hogeraadsleden zien alleen dossiers van hun lopende ronde, en daarin alleen naam en functie.
  - Het audittrail bevat geen namen of functies.
- **Gezamenlijke ontheffing** (functie met `releaseFollowUps`: ZHV-presidente, jongemannen-/jongevrouwen-/zondagsschool-/jeugdwerkpresident(e)): verplichte vraag per raadgever: "Naam invullen" (met account-
  identificatie) of "Niet van toepassing" (optionele reden, vastgelegd). Er komt **één** besluit voor het dossier (geen afzonderlijke goedkeuringsbesluiten of stemmen per persoon); de uitvoeringsstatus
  (geïnformeerd/bekendgemaakt/verwerkt) staat per persoon; het dossier is verwerkt zodra alle genoemde personen verwerkt zijn. Een "niet van toepassing"-raadgever heeft geen naam, koppeling of status.
- **Migratie** `20261111100000_c4_ontheffingen` (additief): enums, tabellen `Ontheffing`, `OntheffingPerson`, `OntheffingVoter`, `OntheffingVote`, `OntheffingDecision`, `OntheffingAudit`, kolom `Notification.ontheffingId`,
  drie `NotificationType`-waarden. Plus `20261110100000_c4a_aanmaakmeldingen` (C3-correctie). Niets wordt verwijderd.
- **Herstelbare meldingen**: `Ontheffing.notifyEvent/notifyClaimedAt` (zelfde claim/lease-principe); cron elke 10 minuten.

### C4-correcties na review (`be43e92` → vervolgcommit)
- **Persoonlijke kennisgeving vóór vrijgave**: is de betrokkene hogeraadslid (functie `hogeraadslid`, `jongemannenpresident`, `zondagsschoolpresident`, of een gekoppeld account met de rol hoge raad), dan weigert
  `releaseOntheffingToHogeraad` de vrijgave server-side zolang `informedAt` ontbreekt (`releaseBlockers`, dezelfde controle in de weergave `blockers` van de app). Niet-van-toepassing-raadgevers en andere functies hebben geen extra blokkade.
- **Gekoppeld hogeraadslid blijft uitgesloten** van dossier, deelnemerslijsten, aantallen, meldingen, push en deeplinks, ook ná de kennisgeving (getest).
- **Gezamenlijk presidiumbesluit**: alleen mogelijk met minstens één actief, niet-betrokken presidiumlid; de registrerende staf (ook secretaris/administrateur) moet de presidiumleden noemen die het besluit namen (`presentUserIds`,
  gevalideerd, opgeslagen). Een secretaris legt dus vast wat besloten is en neemt het niet zelf.
  **Dezelfde regel geldt nu ook voor roepingsvoorstellen (C1, `registerGroupDecision`, fase PRESIDIUM)**: `presentUserIds` is verplicht (actieve leden van het ringpresidium van déze ring), wordt opgeslagen in `GroupDecision.presentUserIds`
  en zonder actief presidiumlid kan geen gezamenlijk presidiumbesluit worden vastgelegd. De hogeraadsfase is ongewijzigd. Beide vormen van ondersteuning blijven bestaan: individuele reacties in de app én het gezamenlijk besluit.
- **Dankbetuiging**: `OntheffingPerson.thanksOffered` (ja/nee, verplicht bij de bekendmaking) i.p.v. een tijdstip van daadwerkelijk uitgesproken dank.
- **Openstaande dossiers**: `lastActivityAt` (inhoudelijke activiteit). Na 30 dagen zonder activiteit een generieke herinnering aan het ringpresidium (eenmalig), na 90 dagen een markering "beoordeling nodig" (+ melding, zichtbaar in lijst, dossier en aantallen);
  alleen een expliciete beoordeling door ringstaf (`POST /ontheffingen/:id/review` = aanhouden, of verwijderen) lost dat op. **Lopende dossiers worden nooit automatisch verwijderd** zolang er geen vastgesteld bewaarbeleid is. Alleen verwerkte dossiers
  (30 dagen na verwerking) en niet-ingediende concepten (30 dagen na laatste wijziging, zoals bij roepingsconcepten) worden automatisch opgeruimd.
- **E-mail centraal uitgesloten**: `notify()` negeert `buildEmail` zodra `ontheffingId` is meegegeven of het type met `CONFIDENTIAL_` begint, ongeacht de aanroeper (getest).
- **Migratie** `20261112100000_c4b_correcties` is **strikt additief**: meldingstype `CONFIDENTIAL_REMINDER`, kolommen `lastActivityAt/reminderSentAt/reviewFlaggedAt` op `Ontheffing` en `OntheffingPerson.thanksOffered`
  (waarde uit `thankedAt` overgenomen). `thankedAt` blijft bestaan als verouderd, ongebruikt veld en wordt pas in een latere, aparte migratie opgeruimd. De C4-migraties zijn nergens buiten de testomgeving toegepast: `main` bevat ze niet
  en de image (dus `migrate deploy` op de NAS) wordt alleen vanaf `main` gebouwd; ze zijn getest op een verse database (volledige keten, geen schema-afwijking, geen `DROP`/`DELETE`/`TRUNCATE`).

### C4.5 – Kerkelijke functies, bevoegdheden en catalogus (gerealiseerd)
Afgebakend: Ringtools ondersteunt uitsluitend roepingen en ontheffingen; organisatorische aanwijzingen en taakverdelingen krijgen geen eigen workflow.
- **Gestructureerde functie** (`RingMembership.churchFunctionCode`: ONBEKEND, RINGPRESIDENT, EERSTE_RAADGEVER, TWEEDE_RAADGEVER, RINGSECRETARIS, RINGADMINISTRATEUR, HOGERAADSLID, ANDERS). De bestaande Ringtools-rollen (toegang, gebruikersbeheer) blijven ongewijzigd; `churchFunction`
  blijft als vrije omschrijving en bepaalt nooit een bevoegdheid. Functie moet bij de rol passen (server-side); ringpresident, eerste en tweede raadgever zijn uniek per ring (onder ring-lock; gelijktijdig toewijzen levert één houder).
- **Bevoegdheid** (`src/lib/churchFunctions.ts`, `eligibleForRule`): ringpresident = functie volstaat; raadgever in het ringpresidium = functie eerste/tweede raadgever **én** expliciete machtiging `AANGEWEZEN_RAADGEVER`; hogeraadslid = functie **én**
  machtiging `AANGEWEZEN_HOGERAADSLID`. De oude waarde `RINGPRESIDENT` als machtiging wordt niet meer toegekend en is niet meer effectief. Een wijziging van rol of functie trekt een niet meer passende machtiging in (nooit omhoog); een machtiging komt nooit vanzelf terug.
  Fail-closed bij `ONBEKEND`, bij een functie die niet (meer) bij de rol past, zonder machtiging, voor inactieve leden/accounts/ringen en voor leden van een andere ring. Alleen een `GEVERIFIEERD`e regel kent bevoegdheid toe (ongewijzigd).
- **Automatische voorstellen** (`buildSuggestions`): voorkeur 1) standaardverantwoordelijke/verantwoordelijk hogeraadslid van de wijk — alleen als die persoon bevoegd is; 2) de ringpresident; 3) de enige bevoegde. Bij meerdere bevoegden zonder duidelijke keuze geen voorstel.
  Elk voorstel noemt de grond ("Ringpresident (op grond van de functie)", "Aangewezen raadgever (functie + machtiging)"). Bij niet-geverifieerde/bijzondere procedures en eigen roepingen nooit een voorstel: "Menselijke controle nodig". Als niemand bevoegd is volgt een niet-persoonlijke uitleg
  (geen ringpresident vastgelegd / geen raadgever aangewezen / N leden zonder functie). Een **externe uitvoerder zonder Ringtools-account** blijft een aparte, handmatige registratie en wordt nooit voorgesteld. Indienen en achteraf wijzigen controleren dit nog steeds server-side (vastgelegde procedure).
- **Migratie** `20261113100000_c45_kerkelijke_functies` (additief: enum + kolom met standaard `ONBEKEND`; geen DROP/DELETE). Voorzichtige afleiding voor bestaande leden, alleen waar ondubbelzinnig: rol hoge raad → HOGERAADSLID (geeft op zichzelf niets); de enige actieve houder van de oude aanwijzing
  RINGPRESIDENT → RINGPRESIDENT; exacte omschrijving ("ringpresident", "eerste/tweede raadgever [ringpresidium]") bij rol ringpresidium, actief, uniek in de ring en functie nog niet vergeven. **Nooit** een machtiging toegekend of gewijzigd. Wat onzeker is blijft `ONBEKEND`:
  bestaande aangewezen raadgevers zonder exacte omschrijving zijn pas weer bevoegd nadat de ringbeheerder hun functie (eerste/tweede raadgever) vastlegt — de ringinrichting toont dit ("Kerkelijke functies van het ringpresidium vastgelegd") en de gebruikerslijst markeert "Kerkelijke functie nog vast te leggen".
- **Catalogusoverzicht** (app, onder Inrichting; ook voor de webmin via `/admin/catalog/callings`, voor ringbeheerders en ringstaf van de eigen ring via `/catalog/callings`): per organisatie, met zoeken en filters (organisatie, soort regel, controlepunten); toont procedure, roepen/aanstellen, steunverlening,
  aanstellingsplicht, handboek, controlepunten en waarschuwingen; onderscheidt **geverifieerde regels**, **algemene ringprocedure – regels nog te beoordelen** en **buiten Ringtools** (en eigen roepingen). Alleen lezen; een bestaand dossier behoudt de vastgelegde procedure. Alleen functietitels en regels, geen personen/LCR-gegevens.
- **Kleine correctie**: het gezamenlijk presidiumbesluit bij roepingsvoorstellen kent geen "direct vrijgeven" meer (API weigert `releaseNow`); registreren en vrijgeven zijn twee aparte, expliciete handelingen.

### CI-status van commit `762575f` (C4.5)
- **Geslaagd:** dispatch-run `41879871986` op `762575f` — alle vier de jobs groen, inclusief een uitgevoerde iOS-simulatorbuild en `verify-ios-configs.sh`.
- **Niet volledig groen:** de latere push-run op `main` (`41884854396`, zelfde commit) was **niet** volledig groen. Backend, client/native-configuratie, Android en de Docker-build (`41884854406`) slaagden; de iOS-simulatorjob faalde eerst
  door een SwiftPM-fout ("Could not resolve package dependencies": cachemap van `capacitor-swift-pm` ontbrak op de runner) en de herstart werd na 15 minuten geannuleerd omdat er geen macOS-runner beschikbaar kwam. Dit is een runner-/infrastructuurprobleem, geen bevinding in de code;
  er is bewust geen derde poging gedaan. Voor `main` is dus geen eigen geslaagde iOS-run beschikbaar; het iOS-bewijs berust op de dispatch-run hierboven.

### C5 – Uitnodigingen en native MFA (gebouwd/voorbereid)
**C5.1 Uitnodigen en activeren (gebouwd; toesteltest open).**
- Model `RingInvitation` + `RingInvitationAudit` (migratie `20261114100000_c5_uitnodigingen`, uitsluitend toevoegend; geverifieerd op een schone database en op een database met bestaande gegevens: aantallen en inhoud ongewijzigd, geen schema-afwijking).
- Ringbeheerder (eigen ring) of webmin nodigt uit met naam, e-mailadres, Ringtools-rol, optioneel functie en ringbeheerder-ja/nee (verse herverificatie vereist). Geen machtiging in de uitnodiging; die legt de beheerder na activatie vast.
- Veiligheid: token (256 bit) en activeringscode (12 tekens, ~60 bit) alleen als hash; 7 dagen geldig; eenmalig en atomair verbruikt (ring-lock + `updateMany`); max. 5 codepogingen per uitnodiging; rate limits per IP/e-mailadres/uitnodiger; geen dubbele open uitnodigingen (ring-lock);
  opnieuw versturen/herinneren vervangt token en code (oude link vervalt), met 5 minuten wachttijd en maximaal 10 verzendingen; intrekken is idempotent; wijzigen van rol/functie kan zolang de uitnodiging openstaat.
- Bestaand account (ook in een andere ring, of nog niet geactiveerd) krijgt géén tweede account; het antwoord aan de uitnodiger is identiek voor bekende en onbekende adressen. Beheerdersaccount en gedeactiveerde accounts kunnen niet via een uitnodiging worden geactiveerd of overgenomen.
- Functieconflict bij activatie (bijv. ringpresident intussen vergeven) → geen functie, dus geen bevoegdheid (fail-closed). Deactiveren van een lid trekt openstaande uitnodigingen in; een uitnodiging kan een daarna bewust gedeactiveerd lid niet heractiveren.
- Status in de app: niet verstuurd · verstuurd · verlopen · ingetrokken · account geactiveerd. Opruiming van afgeronde/verlopen uitnodigingen na 90 dagen (cron). Audittrail: aangemaakt, verstuurd, mislukt, gewijzigd, ingetrokken, geactiveerd, geweigerd, foute code (zonder tokens/e-mailadressen).
- E-mail: bestaande SMTP-infrastructuur; Nederlandstalige mail met link + activeringscode + geldigheid; zonder rol, functie of namen van anderen. Ontheffingen blijven volledig uitgesloten van e-mail.
- **Correctieronde na review (`1b86801` →):** (1) WebAuthn-challenge wordt atomair verbruikt (`DELETE … RETURNING`; gelijktijdige verificaties met één challenge: hooguit één slaagt); `promoteSessionToMfaVerified` geeft per sessie hooguit één nieuwe sessie uit
  (`SessionNoLongerValidError` → 401 / terug naar inloggen, geen 500), met regressietests die de race aantoonbaar reproduceerden vóór de fix. (2) (Opnieuw) versturen van uitnodigingen is idempotent: rij-lock + verzendclaim (`sendClaimedAt`, lease 2 min; migratie `20261115100000_c5_uitnodiging_verzendclaim`, één nullable kolom);
  een gelijktijdig verzoek krijgt `inProgress` en verstuurt niets; bij een SMTP-storing worden eerdere token/code/geldigheid hersteld, zodat een al bezorgde link blijft werken.
- **SMTP-time-outs en de claimlease (tweede correctieronde):** `src/lib/mailer.ts` stelt expliciete time-outs in (verbinden 10 s, greeting 10 s, DNS 10 s, socket-inactiviteit 30 s) en een harde totaaltijd per verzending (45 s; instelling `SMTP_SEND_DEADLINE_MS`, begrensd op 60 s) — ruim onder de claimlease van 2 min (test bewaakt de marge).
  *Gegarandeerd:* er lopen nooit twee verzendpogingen van dezelfde uitnodiging tegelijk (de eerste is binnen 60 s afgerond en heeft zijn claim vrijgegeven vóór de lease verloopt); een late of hangende verzending kan status, token of teller niet meer wijzigen (compare-and-set op het token) en wordt als 'verouderd' vastgelegd;
  een eerder bezorgde link wordt bij een mislukte of getimede verzending hersteld. *Niet te garanderen:* bij een time-out is de afleverstatus onbekend — de server kan de mail alsnog hebben aangenomen, en de onderliggende verbinding loopt nog door tot de nodemailer-time-outs. Dan kan de ontvanger een mail hebben waarvan de link inmiddels is vervangen
  (bij een eerste verzending blijft de nieuwe link juist geldig). Ook na een servercrash tijdens het versturen kan na de lease een dubbele mail ontstaan. Dit wordt vastgelegd (`SEND_FAILED` met "time-out; afleverstatus onbekend") en de ringbeheerder kan altijd opnieuw versturen.
**C5.3 Gebruiksgemak (gebouwd; toesteltest open).** Activatiescherm zonder sessie (link `/uitnodiging/<token>` als universele link/app-link, ook koude start; terugval: "Ik heb een uitnodiging" met e-mailadres + code); duidelijke teksten bij verlopen/gebruikt/geen verbinding/onderbroken activatie;
daarna (zonder verplichte MFA) direct ingelogd: de uitnodiging bewijst de controle over het e-mailadres, de sessie wordt in dezelfde transactie uitgegeven (zie 'Direct ingelogd na activatie'); met verplichte MFA blijft inloggen met de tweede factor nodig. Informatieve landingspagina op de website (verbruikt niets, geen referrer). In de Personal Team-testbuild werkt de universele link niet; de handmatige code is daar de route.
**C5.2 Native passkeys (voorbereid, NIET geactiveerd; vervolg: gap-analyse en plug-inopties in `docs/PASSKEYS-NATIVE.md`, wacht op beslissing).** Sinds het vervolg ook herverificatie met passkey in de app (`useReauth`). **Plug-in gekozen (optie A) en geïntegreerd:** `@capawesome/capacitor-passkeys` 0.1.2 exact gepind, adapter `lib/capawesomePasskeys.ts`, productie-entitlement `webcredentials:` voorbereid (Personal Team onaangetast); review en externe vereisten in `docs/PASSKEYS-NATIVE.md`. `NATIVE_PASSKEYS_ENABLED` blijft uit; niet op een fysiek toestel getest. Zie `docs/PASSKEYS-NATIVE.md`: pending-login, passkey-API, origin-allowlist, lockout en 21 backendtests met echte WebAuthn-verificatie zijn klaar; geen native plug-in gekoppeld, functievlag uit, productie-entitlements en `App-PersonalTeam` ongewijzigd.
Externe vereisten vóór activering: Apple Team-ID en Associated Domains met `webcredentials:`, Android-vingerafdrukken, plug-inkeuze en toesteltests (lijst in het document).

**Direct ingelogd na activatie (verbetering na fysieke iPhone-test).** Na een geslaagde activatie krijgt een gebruiker zonder verplichte MFA direct een gewone volledige sessie (geen tweede e-mailcode); de app bevestigt kort en gaat naar het overzicht. Voorwaarden en maatregelen:
sessie in dezelfde transactie als het atomaire verbruik (hooguit één activatie en één sessie, ook bij gelijktijdige pogingen; rollback = geen sessie); alleen voor actieve, niet-beheerders-accounts zonder `mfaEnabled` en een actieve ring; zelfde levensduur, `mfaAt` en servercontroles als een gewone login; token alleen in de JSON-respons (`no-store`),
op het toestel in Keychain/Keystore, niet in URL's of logs; accounts met verplichte MFA en het beheerdersaccount krijgen nooit een sessie (veilige blokkade blijft); is er al iemand ingelogd in de app dan wordt geen sessie gevraagd (nooit stilzwijgend van account wisselen).
Bij een onderbroken verbinding is de uitnodiging mogelijk al verbruikt: een nieuwe poging geeft dan geen tweede sessie; de gebruiker logt gewoon in met de e-mailcode (een eventuele sessie waarvan het token verloren ging verloopt vanzelf en is zonder token onbruikbaar). Het uitnodigingsproces is hiermee niet minder streng dan de e-mailcode-login: wie de uitnodigingsmail bezit bezit ook de mailbox.

### C6 – Afronding bestaande functionaliteit (inventarisatie en correcties)
Peildatum: `773bb34` + C6-commit. Geen nieuwe functionaliteit, geen nieuwe kerkelijke regels; migraties zijn niet nodig geweest.

**Gevonden en opgelost (aantoonbare fouten)**
1. *Gedeactiveerde ring bleef bereikbaar in de overgangswebapp.* `getActiveMembership` (autorisatie per voorstel op de detailpagina en in de webacties voor staf/taken) negeerde `Ring.active` en `User.active`. Een lid van een door de webmin gedeactiveerde ring kon via een directe URL het
   voorstel nog openen. Nu `ring: { active: true }` en `user: { active: true }` (regressietest in `tests/rings.test.ts`, bewezen rood vóór de fix). De mobiele API en alle andere controles hadden dit al goed.
2. *Verlopen WebAuthn-challenges werden nooit opgeruimd* (alleen bij verbruik of MFA-reset). `deleteExpiredAuthData` (nachtelijke cron) verwijdert ze nu; een lopende challenge blijft staan (test in `tests/sessions.test.ts`).

**Gecontroleerd en in orde bevonden:** ringisolatie en `ring.active` in alle overige lidmaatschapscontroles (de resterende zoekopdrachten zonder die filter zijn ontvangerslijsten binnen een reeds geautoriseerde handeling); clientroutes ↔ serverroutes (refresh, apparaten, beheerroutes);
rate-limiter-opruiming; cron-dekking (sessies, inloglinks, openlinks, concepten, uitnodigingen, ontheffingen, aanmaakmeldingen); migratieketen op een schone database; volledige backendsuite.

**Onvoltooide bestaande eisen — voorstel, niet zelf ingevuld (functionele keuze)**
- *Push/melding aan ringstaf bij "Presidium akkoord – wacht op vrijgave"* (genoemd als open punt bij C1). Vereist een nieuw meldingstype (enum-migratie) en een tekst; voorstel: één generieke melding "Voorstel wacht op vrijgave" aan actieve ringstaf van de ring, zonder naam, alleen intern pad. Pas bouwen na akkoord.

**Bewust uitgesteld: toesteltests (blokkeren C6 niet; geregistreerd als acceptatietests voor fase F)**
- iPhone en Android: inloggen met e-mailcode, activatie via universele link/app-link, pushlevering (APNs/FCM), deeplinks uit meldingen, Android-terugknop, donkere modus/veilige randen.
- Native passkeys (C5.2): iPhone én Android, inclusief Apple Team-ID/Associated Domains en Android-vingerafdrukken (`docs/PASSKEYS-NATIVE.md`). De functievlag `NATIVE_PASSKEYS_ENABLED` blijft UIT; native passkeys zijn **niet productiegereed** zolang deze tests en de domeinconfiguratie ontbreken.
- Personal Team-build: handmatige controle dat alles zonder push/links/passkeys bruikbaar blijft.

**Open beslissingen van de eigenaar (ongewijzigd):** open vragen 1, 4, 5, 6 en 7 hieronder en de punten A en B. Er is aan geen van deze iets veranderd.

**Fase E** begint niet voordat C6 is beoordeeld.

### Open punten voor een latere review (vastgelegd, niet gebouwd)
- **A. Uitleg over namen bij ontheffingen.** In de huidige app staat een verwarrende tekst over het niet zichtbaar zijn van namen. De namen van betrokkenen mogen binnen het dossier zichtbaar zijn voor bevoegde leden van het ringpresidium en de hoge raad.
  Dit verandert niets aan de toegangsbeveiliging of de uitsluiting van de betrokkene. De ontheffingsprocedure is hiervoor niet gewijzigd; alleen de uitleg wordt later aangepast.
- **B. Bevoegde uitvoerders bij niet-geverifieerde roepingen.** Zie "Open vragen", punt 7: een bevoegde persoon uit de eigen ring moet in de toekomst als interne uitvoerder kunnen worden vastgelegd nadat de bevoegde leiding de procedure heeft gecontroleerd.
  De huidige beperking blijft bestaan; de procedurecontrole is niet uitgeschakeld en er worden geen bevoegdheden verzonnen.

### Open vragen voor de eigenaar (niet zelf beslist)
1. **Deelname van een betrokken hogeraadslid na kennisgeving.** Hoe neemt de betrokkene daarna deel aan de eigen behandeling, of wordt hij daarvan uitgesloten? Er is geen kerkelijke regel verzonnen: een gekoppeld account blijft
   voorlopig *altijd* uitgesloten en zonder toegang (veiligste uitgangspunt). Het register van de kennisgeving (`informedAt`) staat klaar, maar geeft geen toegang.
2. ~~Persoonlijk informeren vóór vrijgave bij een hogeraadslid~~ — door de eigenaar vastgesteld en geïmplementeerd.
3. ~~Dankbetuiging~~ — vastgesteld: registreren of gelegenheid is geboden; verwerken vereist de bekendmaking.
4. Wat als het hele ringpresidium betrokkene is (bijv. ontheffing van alle drie)? Er blijven dan geen presidiumdeelnemers over. Ringtools legt dan **geen** presidiumbesluit vast: ook een secretaris of administrateur kan het niet zelfstandig als presidiumbesluit vaststellen (en een individuele ronde heeft geen deelnemers, dus geen goedkeuring). Hoe zo'n geval wél moet verlopen is een open vraag voor de eigenaar; er is geen oplossing verzonnen.
5. Definitief bewaarbeleid voor lopende dossiers (nu: herinnering na 30 dagen, beoordeling na 90 dagen, nooit automatisch verwijderen).
6. Geldt de wijk/gemeente van herkomst ook voor ontheffingen van ringfuncties zonder wijkbinding?

7. **Bevoegde uitvoerder bij niet-geverifieerde roepingen (functioneel openstaand punt, nog niet gebouwd).**
   - *Huidige situatie:* bij roepingen met een nog niet-geverifieerde bevoegdheidsprocedure (`TE_BEOORDELEN`, bijzonder, eigen roeping) kunnen geen personen uit de eigen ring worden geselecteerd om te roepen of aan te stellen; er kan alleen een externe uitvoerder worden ingevoerd
     (`eligibleForRule` levert voor niet-`GEVERIFIEERD`e regels niemand). Dat is niet wenselijk wanneer bijvoorbeeld de ringpresident zelf de handeling uitvoert.
   - *Uitgangspunten voor de toekomstige verbetering:*
     - Geen automatische toekenning van onbevestigde bevoegdheden.
     - De bevoegde leiding controleert de toepasselijke procedure expliciet en bevestigt die (de verplichte procedurecontrole blijft).
     - Een daadwerkelijk bevoegde interne persoon kan daarna als interne uitvoerder worden geregistreerd, met vastlegging van de gecontroleerde grondslag.
     - Een intern ringlid mag niet ten onrechte als externe persoon worden ingevoerd.
     - De bestaande server-side beveiliging (ringisolatie, vastgelegde procedure) en de audittrail blijven behouden.
   - *Status:* niet ontworpen of geïmplementeerd; er worden geen bevoegdheden verzonnen. Pas oppakken na de iPhone-acceptatietest van C4 en C4.5 en op expliciete opdracht van de eigenaar.
