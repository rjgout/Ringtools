# Privacycorrectie: notificaties en uitvoering

Basis: actuele `main` `681141c` (App Store-demo en accountverwijdering inbegrepen). Branch `fix/notificatie-privacy-uitvoering`. Geen productiegegevens, configuratie, APNs-sleutels of Portainer aangepast. Geen deploy, merge of TestFlight-upload.

## Vastgestelde oorzaak

In de basisversie deed `workflow.afterCallingCreated` direct na het indienen van een concept zowel de presidiumuitnodiging als `notifyTaskAssignee` voor vooraf aangewezen uitvoerders. `assignTask` riep dezelfde melding onvoorwaardelijk aan na iedere opslag, ook zonder feitelijke wijziging en ongeacht de goedkeuringsfase. `taskAssignedEmail`, de ondersteuningsmails en de 30-dagenherinnering bevatten kandidaatnaam, functietitel, soms fase/taak en een persoonlijke `/open/<token>`-link. De centrale documentatie beschouwde een persoonlijke inbox ten onrechte als voldoende reden om dossierinhoud te mailen.

Daarnaast verleenden mobiele detail-/lijstautorisatie en de beveiligde webdetailpagina zelfstandig toegang op grond van een `*AssigneeId`. Een voorafgaande administratieve toewijzing kon daardoor meer blootgeven dan alleen het voortijdige bericht. De oude open-linkresolver controleerde alleen actief ringlidmaatschap, niet de actuele dossierbevoegdheid.

De geschiedenis bevat `notifyTaskAssignee` al bij commit `bcd46d1` (18 oktober 2026). Dit is een broncodefeit, **geen vaststelling dat die commit toen in productie is gebruikt**. De eigenaar heeft een voortijdige taakmail gemeld. Er zijn in deze opdracht geen productiedatabase, echte mailboxen of SMTP-/APNs-logs geraadpleegd; omvang, daadwerkelijke afleveringen en productieperiode zijn niet vastgesteld.

## Definitieve goedkeuring en expliciete uitvoering

De bestaande statusvolgorde blijft behouden: presidium → `PRESIDIUM_APPROVED` → expliciete vrijgave aan hoge raad → hoge raad → `APPROVED` → uitvoering → `PROCESSED`. `APPROVED` zegt voortaan uitsluitend dat de beoordeling is afgerond. De bestaande roeping krijgt een afzonderlijke **vrijgavetijd, vrijgever en revisie/generatie**. Dit is geen parallelle goedkeuringsstatus.

Ringstaf ziet bij een goedgekeurd voorstel **Vrijgeven voor uitvoering** in iOS/Android en op de beveiligde website. De app vraagt expliciete bevestiging. De server eist opnieuw actief staflidmaatschap van precies deze ring en definitieve goedkeuring. Alleen dan worden open toegewezen taken uitvoerbaar en worden hun notificatiegebeurtenissen atomair opgeslagen. Herhaalde vrijgave is idempotent. Er is ook een generieke, eenmalige stafmelding dat de uitvoering op vrijgave wacht; de aandachtspuntenlijst toont deze voorstellen.

Een database-trigger wist de uitvoeringsvrijgave zodra een voorstel naar een eerdere/geblokkeerde status gaat. Alleen opnieuw goedkeuren herstelt de uitvoeringsvrijgave niet. Alle taskmutaties en de laatste verzendcontrole gebruiken dezelfde roepingrijvergrendeling.

Vooraf toewijzen blijft toegestaan. Ongewijzigd opslaan is geen nieuwe gebeurtenis. Na vrijgave veroorzaakt alleen een daadwerkelijk gewijzigde, nog open en uitvoerbare taak een nieuwe melding. Interne en externe uitvoerders worden via dezelfde transactionele toewijzingsfunctie opgeslagen; een externe uitvoerder zonder account krijgt geen melding. De secretaris/administrateur kan nog steeds niet als ondersteuner worden toegewezen.

## Centrale toegang en zichtbaarheid

`callingAccess.ts` bepaalt wanneer uitvoering is vrijgegeven en wanneer toewijzing toegang mag geven. Deze grens wordt gebruikt door detail- en lijst-API, mobiele/webtaakoverzichten, dashboardtaken, actietellers, taakafronding en oude deeplinks. Zonder onafhankelijke staf- of beoordelingsbevoegdheid geeft een vooraf gekozen uitvoeringstaak vóór vrijgave geen toegang.

Een hogeraadslid dat daadwerkelijk aan de geopende beoordelingsronde deelneemt, behoudt zijn bestaande beoordelingsrecht. Dat is een zelfstandige bevoegdheid; het betekent niet dat zijn eventuele uitvoeringstaak al is vrijgegeven. De taaksectie blijft voor niet-staf verborgen totdat de uitvoering is vrijgegeven. Een lid dat pas na de gesloten ronde is toegevoegd en alleen als uitvoerder is aangewezen, krijgt vóór vrijgave geen detailtoegang.

`notificationVisibilityWhere` wordt hergebruikt voor het mobiele notificatiecentrum, beide web-API's voor lijst/teller en gelezen-acties. Het herbeoordeelt actueel lidmaatschap, ring, dossierbevoegdheid en ontheffingsuitsluiting. Oude voortijdige taakmeldingen zonder geldige nieuwe uitvoeringsgebeurtenis worden niet getoond of geteld. Er wordt geen bestaande productierij gewist om dit te bereiken. De oude linkresolver geeft een onbevoegde bestemming niet meer vrij en verstuurt daarvoor geen app-push of nieuwe loginmail.

De demo-isolatie blijft intact: fictieve demo, geen externe uitnodiging/mail/push, dezelfde workflowregels en expliciete uitvoeringsvrijgave in de demoseed. Gebruikers blijven uitsluitend hun eigen bevoegde ringgegevens zien. MFA, sessies en lokale schermvergrendeling zijn behouden.

## Teksten en onderzochte triggers

Functionele e-mail, exact:

> Onderwerp: Er staat een handeling klaar in Ringtools
>
> Er staat een handeling voor je klaar in Ringtools.
>
> Open de Ringtools-app om deze te bekijken en af te handelen.

Functionele push, exact:

> Ringtools
>
> Er staat een handeling voor je klaar.

`notificationText.ts` is de gemeenschappelijke bron. De vier oudere mailbouwers blijven broncompatibel maar negeren hun vertrouwelijke argumenten en retourneren uitsluitend deze tekst. De centrale notifier voert oude `buildEmail`-callbacks niet meer uit. Functionele mails maken geen persoonlijke links of tokens meer. Push bevat hooguit een canoniek intern dossierpad met een ondoorzichtig resource-ID en de vaste tag `ringtools-action`; geen namen, querystrings, fase, stemreden of authenticatietoken. Dossierdetails worden pas na gewone serverauthenticatie en autorisatie opgehaald.

| Trigger | Ontvangers / voorwaarden | Kanalen en inhoud |
|---|---|---|
| Concept bewaren | Niemand voor uitvoering | Geen uitvoeringsgebeurtenis |
| Indienen / herstellen aanmaakmelding | Actieve bevoegde presidiumdeelnemers in actuele ronde | Intern, generieke push en voorkeur-afhankelijke generieke mail; geen uitvoerders |
| Presidiumpauze / hogeraadspauze | Bevoegd presidium | Bestaande interne/pushkanalen, generiek; geen uitvoering |
| Presidiumakkoord | Actieve ringstaf; status wacht op hogeraadsvrijgave | Herstelbare generieke stafmelding |
| Expliciete vrijgave aan hoge raad | Actieve deelnemers van geopende hogeraadronde | Intern, generieke push/mail; uitsluitend beoordelingsverzoek |
| Opnieuw vragen / beoordelingsherinnering | Actuele bevoegde deelnemer van juiste ronde | Generiek; bestaande afkoeling en negatieve-reactiecontroles blijven |
| Definitief hogeraadsakkoord (individueel/vergadering) | Ringstaf moet uitvoering nog expliciet vrijgeven | Atomair ontdubbelde generieke stafmelding, geen uitvoeringstaakmelding |
| Uitvoeringsvrijgave | Actieve toegewezen ontvangers van open uitvoerbare taken | Duurzame taakgebeurtenis; intern + generieke push/mail |
| Toewijzing / hertoewijzing | Alleen gewijzigde open taak na uitvoeringsvrijgave | Oude gebeurtenis ongeldig, één nieuwe gebeurtenis voor huidige uitvoerder |
| Taak afronden | Alleen vrijgegeven uitvoering; actueel staflid of werkelijk huidige uitvoerder | Bestaande eenmalige generieke melding aan bevoegde aanmaker |
| Nachtelijke 30-dagenherinnering | Actief bevoegd presidium | Generieke aandachtmelding, geen taakdetails of bericht aan vooraf aangewezen uitvoerder |
| Ontheffingen en hun retries/herinneringen | Bestaande `visibleWhere`: ringstaf / actuele hogeraadronde, betrokkene uitgesloten | Behouden interne/pushkanalen, generiek; **nog steeds geen e-mail** |
| Oude persoonlijke koppeling → app-push | Alleen als gekoppelde gebruiker nu dossierbevoegd is | Dezelfde generieke push, geen token in payload |

Uitzonderingen: login-/verificatiecodes, door de gebruiker expliciet gevraagde loginlinks, welkom-/uitnodigingsmail en beveiligingswaarschuwingen houden uitsluitend hun noodzakelijke account-/uitnodigings-/beveiligingsinhoud. Geen kandidaat, roeping, negatieve reactie of ontheffingsdossier wordt hierin opgenomen. De bestaande uitnodigingscontext (de beoogde ring) blijft in de welkomstmail staan; dat is geen roepingsdossier. Technische handmatige SMTP-/pushtestberichten blijven herkenbare testberichten zonder dossierinhoud. De APNs-/FCM-protocollen, ondertekening, sleutels, headers, productieconfiguratie en native listeners zijn niet gewijzigd.

## Wachtrij, gelijktijdigheid en afleveronzekerheid

`TaskNotification` bewaart per roeping/taak/revisie een unieke gebeurtenis en de vrijgavegeneratie. Vrijgave en toewijzingswijziging slaan dit in dezelfde transactie op als de mutatie. Alleen `PENDING` kan eenmaal worden geclaimd; een interne notificatie met unieke verwijzing wordt vóór extern I/O duurzaam vastgelegd. De laatste verzendcontrole onder roepingvergrendeling controleert opnieuw huidige taak, generatie, vrijgave, open toestand en actief lidmaatschap. Een eerder opgeslagen blokkade of andere toewijzing annuleert de melding voor alle kanalen. De cron verwerkt alleen nog geldige wachtende gebeurtenissen.

De verzendtransactie is begrensd op 150 seconden. Zij serialiseert met wijzigingen aan de roeping; een door de provider al gestarte levering kan niet worden teruggehaald. PostgreSQL, SMTP en push hebben geen gezamenlijke transactie of uniforme idempotentiesleutel. Daarom wordt bij een fout/afgebroken bevestiging **nooit automatisch extern opnieuw verzonden**: toestand `UNKNOWN`, interne melding blijft beschikbaar zolang bevoegd. Een oude `CLAIMED` zonder eindbevestiging wordt eveneens `UNKNOWN`. `SENT` registreert de verzendpoging, geen garantie dat een toestel of mailbox het bericht daadwerkelijk heeft getoond. Ongeldige oudere toewijzingen worden `CANCELLED`; een eerder gevuld `sentAt` blijft daarbij auditbewijs van de eerdere poging.

Dit voorkomt dubbele externe pogingen bij retries en crashes; de afweging is dat een onzekere poging niet automatisch opnieuw wordt aangeboden. Reeds door SMTP/APNs/FCM aangenomen of onderweg zijnde berichten kunnen later arriveren en zijn niet intrekbaar. Zij bevatten in deze versie uitsluitend de generieke tekst. Alleen een werkelijk nieuwe geldige toewijzing/vrijgave kan een nieuwe gebeurtenis maken.

## Mogelijke eerdere blootstelling en eigenaarbeoordeling

Feiten: de code kon te vroege taakberichten maken en dossiernamen/functies mailen; toewijzing kon extra detailtoegang geven. Mogelijke ontvangers: vooraf aangewezen uitvoerders met actieve accounts/ringlidmaatschappen, ook als zij op grond van hun beoordelingsrol nog geen toegang hadden. SMTP-configuratie, e-mailvoorkeuren, pushregistraties en daadwerkelijke aflevering bepalen welke kanalen zijn gebruikt. Eerdere task-notificatierijen bewijzen een opgeslagen gebeurtenis, geen succesvolle SMTP-aflevering. Zonder productieonderzoek is geen betrouwbare omvang of einddatum vast te stellen.

Raphael Gout kan privé controleren: versies en deploymomenten, aantallen taakmeldingen vóór `approvedAt`, lidmaatschappen/rollen ten tijde van de gebeurtenis en beschikbare SMTP-afleverinformatie. Houd bewijs afgeschermd en minimaal; geen echte namen, adressen, dossiers of mailinhoud in GitHub, deze repo, nieuwe logs of publieke rapporten. De normale dossieropruiming kan historische gegevens al hebben verwijderd; geen huidige treffers betekent dus niet dat er nooit eerdere verzending was.

Voorbeeld **alleen voor eigenaar**, uitsluitend geaggregeerd uitvoeren in de eigen beveiligde omgeving (hier niet uitgevoerd):

```sql
SELECT COUNT(*) AS mogelijk_voortijdige_taakgebeurtenissen,
       COUNT(DISTINCT n."userId") AS betrokken_accounts
FROM "Notification" n JOIN "Calling" c ON c.id = n."callingId"
WHERE n.type = 'TASK_ASSIGNED'
  AND (c."approvedAt" IS NULL OR n."createdAt" < c."approvedAt");
```

Deze query meet opgeslagen meldingen bij nog aanwezige dossiers, niet externe aflevering, niet alle historische gevallen en niet automatisch onbevoegde ontvangers (sommigen waren zelfstandig bevoegd). Maak geen ongefundeerde uitspraak dat juridisch een meldplichtig datalek vaststaat. De verantwoordelijke beoordeelt aard/gevoeligheid, bevoegdheid, ontvangers, daadwerkelijke toegang/aflevering, risico en eventuele AVG-vervolgstappen, zo nodig met privacyadvies. Reeds ontvangen e-mails kunnen door de correctie niet worden teruggehaald.

## Migratie, update en rollback

Twee additieve migraties: `20261204100000_execution_notification_privacy` (vrijgavemetadata, taakgebeurtenissen, unieke notificatiebinding) en `20261204110000_execution_ready_notifications` (unieke afleveringssleutel, nieuw stafmeldingstype en trigger die vrijgave wist bij terugzetten). Geen bestaande persoons-/taakgegevens herschreven, geen automatische uitvoeringsvrijgave, geen productieopruiming van oude notificaties.

Vóór een eigenaarupdate: gecontroleerde databaseback-up en herstelcontrole volgens BACKUP-HERSTEL.md; noteer huidig image-digest en versies. Beoordeel PR en groene controles. Alleen eigenaar mag mergen: `main` publiceert Docker en Watchtower kan die installeren. Deze opdracht start dat niet.

Bestaande `APPROVED`-voorstellen krijgen **geen** impliciete vrijgave. Ringstaf beoordeelt ze en kiest bewust Vrijgeven voor uitvoering; reeds afgeronde taken sturen daarbij geen nieuwe taakmelding. Oude clients kunnen geen nieuwe vrijgaveknop tonen; gebruik daarvoor de beveiligde website totdat de nieuwe appbuild handmatig is geïnstalleerd. Nieuwe API-velden/routes zijn toevoegingen aan versie 1; de server bewaakt de uitvoeringsgrens ook voor oude clients. Geef de eigenaar bij een release een hoger, nog ongebruikt buildnummer; geen automatische TestFlight-upload.

Rollback naar de kwetsbare oude image kan de vroege meldingen en toegang opnieuw inschakelen. Bovendien kan een oude Prisma-client het nieuwe notificatie-enumtype in nieuwe rijen niet lezen. Een applicatierollback alleen is daarom geen veilige herstelprocedure. Kies een gecontroleerde voorwaartse correctie, of een volledige, consistente pre-updateback-up met expliciete beoordeling van het verlies van latere wijzigingen en het opnieuw toepassen van accountverwijderingen. Verwijder geen nieuwe enumwaarden/tabellen of productiegebeurtenissen om een rollback af te dwingen.

## Validatie en fysieke acceptatie

Lokaal geslaagd: **684 backendtests**, waaronder **20 nieuwe privacytests**; **421 mobiele tests**, waaronder bevestiging/annuleren van uitvoeringsvrijgave. TypeScript (root/mobile), ESLint zonder waarschuwingen, Next-/mobiele productiebuild, Prisma validate/migrate op uitsluitend `_test`/`_e2e`, schema-diff zonder verschil, native configuratiecontrole en **7 iOS-bundleverifiertests**. Android debug: **BUILD SUCCESSFUL**, JDK21/SDK36, zonder signing/publicatie. Gerichte browsercontrole: **6 geslaagd**; volledige browserregressie met functies aan: **73 geslaagd, 7 verwachte vlagoverslagen**, inclusief echte web/API-afscherming vóór/na vrijgave en de mobiele vrijgavebevestiging tegen de draaiende backend.

CI dekt de nieuwe beleids-/wachtrijbestanden en de lifecycle-/privacy-/vrijgavetests, client, Android debug en op macOS iOS simulator + unsigned device archive/configuraties. De actuele CI-uitkomst voor deze featurebranch staat bij de PR en in [GitHub Actions](https://github.com/rjgout/Ringtools/actions/workflows/mobile-ci.yml). Een unsigned archive bewijst geen distributiesigning of echte APNs-aflevering.

Fysieke iPhone-/iPad-/Android-validatie van deze wijziging is niet uitgevoerd. De eigenaar meldt dat de bestaande APNs-levering op iPhone werkt; dat is geen claim dat deze nieuwe flow al fysiek is geaccepteerd. Controleer handmatig met uitsluitend fictieve demo/testgegevens:

1. Administratief vooraf toewijzen, presidiumronde, pauze en hogeraadakkoord zonder uitvoeringsvrijgave: geen taakbericht, taakoverzicht of extra detailtoegang door alleen de toewijzing. Gebruik hiervoor ook een uitvoerder zonder zelfstandig beoordelingsrecht; een actief hogeraadsdeelnemer mag wel zijn beoordeling zien.
2. Ringstaf geeft expliciet uitvoering vrij: de huidige uitvoerder ziet de taak en krijgt uitsluitend de exacte generieke push/e-mail. Tikken op iPhone opent na normale appvergrendeling en serverauthenticatie het bevoegde voorstel.
3. Ongewijzigd opslaan/herhaalde vrijgave: geen dubbele melding. Hertoewijzen: alleen de nieuwe huidige uitvoerder ontvangt een nieuwe melding. Oude of vreemde-ringdeeplink geeft geen extra toegang.
4. Controleer hetzelfde met app op voorgrond/achtergrond/koude start, op iPad en Android waar beschikbaar. Geen APNs-sleutels/Portainer aanpassen voor deze codecorrectie; configureer geen productie-experimenten met echte kandidaten.
