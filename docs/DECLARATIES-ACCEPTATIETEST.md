# Acceptatietest declaratiemodule (fase 1) – dev.ringapeldoorn.nl

Afvinkbaar. Alleen op de **development-omgeving** met **testadressen** en testgegevens; nooit productie, nooit echte bonnen of persoonsgegevens.
Resultaat per punt: ☐ nog niet · ✅ geslaagd · ❌ mislukt (noteer wat je zag). Zie ook `docs/DECLARATIES.md` en `docs/DEV-OMGEVING.md`.

## 0. Voorbereiding (door de eigenaar, handmatig in Portainer)
Er is **geen** automatische deployment. Migratiemap: `20261205100000_declaraties_basis` (additief; bestaande gegevens blijven).

1. ☐ **Back-up dev-database** (voor elke update): zie `docs/BACKUP-HERSTEL.md`, met de dev-container en dev-database (`ringtools_dev`), bijv. `docker exec <dev-db-container> pg_dump -U ringtools_dev -Fc ringtools_dev > ringtools_dev_voor_declaraties.dump`. Bewaar het bestand buiten de Synology-stack. Zonder werkende back-up niet doorgaan.
2. ☐ **Sleutel ongewijzigd:** `DEV_SETTINGS_ENCRYPTION_KEY` blijft precies zoals nu. Bewaar die waarde apart van de dump; zonder sleutel zijn declaraties (versleuteld) onleesbaar.
3. ☐ **Stack-bestand:** voeg in de stack `ringtools-dev` onder `app` → `environment` één regel toe (de rest blijft gelijk):
   ```yaml
   DECLARATIONS_ENABLED: ${DECLARATIONS_ENABLED:-false}
   ```
   Image: `ghcr.io/rjgout/ringtools:develop` (of vast: `ghcr.io/rjgout/ringtools:develop-<kort>` van de commit die de migratienaam bevat; zie het rapport).
4. ☐ **Environment variables** (Portainer, onder de stack): voeg toe `DECLARATIONS_ENABLED=true` en zet `DEV_MAIL_ALLOWLIST=<testadres-1>,<testadres-2>,…` (uitsluitend jouw testadressen of een eigen testdomein, bijv. `@testdomein.nl`). Laat alle andere waarden staan. Een adres buiten de lijst ontvangt niets (ook geen registratiecode).
5. ☐ **Bijwerken:** "Update the stack" met *Re-pull image*. Controleer in de containerlog: `Database-migraties toepassen…` → `All migrations have been successfully applied`.
6. ☐ `https://dev.ringapeldoorn.nl/api/health` geeft `{"status":"ok"}`.
7. ☐ `https://dev.ringapeldoorn.nl/api/mobile/v1/meta` bevat `"declarations":true` en `"environment":"development"`.
8. ☐ Bestaande dev-accounts, ringen en voorstellen zijn er nog; inloggen met een bestaand testaccount werkt zoals voorheen.
9. ☐ De dev-SMTP werkt (webmin → Instellingen → E-mail); een testmail komt aan op een adres in de allowlist.

**Terugdraaien:** zet `DECLARATIONS_ENABLED=false` (module verdwijnt, gegevens blijven). Pas bij echte problemen: vorige image-tag kiezen; herstel de dump alleen als de database zelf beschadigd is.

## Rollen en testpersonen
Gebruik plusadressen of aparte testadressen, allemaal in de allowlist.

| Code | Rol in de test |
|---|---|
| A | Ringbeheerder van testring R1 (bestaand of door webmin aangemaakt) |
| B | Ringpresident (alleen lezen) van R1 |
| C | Financieel administrateur van R1 (ring-niveau) |
| W | Financieel administrateur van wijk W1 in R1 + bisschop/wijkleider (voor activering) |
| D | Gewoon kerklid (declarant), nieuw adres |
| E | Gewoon kerklid in/bij een **andere** ring R2 (of ringbeheerder van R2) |
| F | Gebruiker zonder financiële functie, ook ringlid van R1 (bijv. ringsecretaris) |

## 1. Registratie (e-mailcode, rol Kerklid)
- ☐ 1.1 Nieuw adres D vraagt op de inlogpagina een code aan; mail komt aan (allowlist).
- ☐ 1.2 Foute code → duidelijke fout, geen account. Goede code → ingelogd; D is **Kerklid** zonder ring (alleen Declaraties zichtbaar, geen roepingen).
- ☐ 1.3 Dezelfde code een tweede keer gebruiken mislukt.
- ☐ 1.4 Een adres dat al een account heeft krijgt geen tweede account (er verschijnt geen "bestaat al"-melding; antwoord blijft generiek).
- ☐ 1.5 Adres **buiten** de allowlist: er komt geen mail aan (dev-vangnet).
- ☐ 1.6 Meer dan 3 aanvragen per uur voor één adres: geen extra codes.
- ☐ 1.7 Bestaande gebruikers (rol ringpresidium, enz.) loggen nog gewoon in met hun code (en MFA waar die geldt).

## 2. Onboarding
- ☐ 2.1 Eerste keer: scherm "Je gegevens": naam, ring (lijst), wijk/gemeente (lijst van die ring).
- ☐ 2.2 Naam met <2 tekens of speciale tekens wordt geweigerd.
- ☐ 2.3 Opslaan zet voorkeursring en -eenheid; een nieuwe declaratie vult die vooraf in.
- ☐ 2.4 Later wijzigen via "Mijn gegevens en voorkeuren wijzigen".
- ☐ 2.5 Per declaratie een andere bestemming kiezen wijzigt het profiel niet.

## 3. Financiële functies en activering
- ☐ 3.1 A: Declaraties → *Financiële functies*. Een gewoon kerklid (D) en een ringlid zonder beheer (F) zien deze ingang **niet** en krijgen via de API 403.
- ☐ 3.2 A wijst B toe als *Ringpresident (alleen lezen)* en C als *Financieel administrateur* (nog onbekende adressen).
- ☐ 3.3 Vóór B en C zich hebben aangemeld: de ring staat **niet** geactiveerd; er bestaat geen account en geen functie voor die adressen (alleen "wacht op aanmelding").
- ☐ 3.4 B en C melden zich aan met hun e-mailcode → de functie wordt actief; scherm "Activering" toont de ring als *Geactiveerd*.
- ☐ 3.5 Verkeerde persoon die zich met een **ander** adres registreert, krijgt de functie niet.
- ☐ 3.6 Wijk W1: bisschop + administrateur (W) toewijzen → alleen W1 wordt geactiveerd; de ring blijft los daarvan.
- ☐ 3.7 Een functie intrekken (administrateur C) → ring niet meer geactiveerd; nieuwe declaraties daarheen worden geweigerd; bestaande blijven zichtbaar voor eigenaar en bevoegden.
- ☐ 3.8 A ziet **geen** declaraties (ringbeheerder ≠ financiële rechten).
- ☐ 3.9 Een ledenadministrateur/ringsecretaris krijgt niet automatisch financiële rechten.

## 4. Declaratie indienen
- ☐ 4.1 D kiest een **niet-geactiveerde** bestemming → exact: "Declareren is voor deze ring, wijk of gemeente nog niet geactiveerd. Neem contact op met je plaatselijke leiders om de declaratiemodule te laten activeren." Indienen is geblokkeerd.
- ☐ 4.2 Zelfde poging rechtstreeks via de API (bijv. met een herhaald verzoek) → server weigert (409).
- ☐ 4.3 Geactiveerde ring zonder wijk: eerst de bevestiging "Weet je zeker dat deze declaratie voor de ring is en niet voor je wijk of gemeente?"; zonder vinkje geen indiening.
- ☐ 4.4 Verplichte velden: organisatie, wie vooraf toestemming gaf, bevestiging vooraf goedgekeurd, voor wie, overmaken aan, bedrag, omschrijving, ≥1 bon. Ontbreekt iets → duidelijke melding.
- ☐ 4.5 Bedragen: `12,50`, `12.5`, `12` geldig; `0`, `-5`, `abc`, `12,505`, `60000` geweigerd. Geen IBAN-veld.
- ☐ 4.6 "Voor wie" en "overmaken aan" mogen verschillen.
- ☐ 4.7 Indienen zonder extra bevestigingsstap; status **Ingediend**; detail toont alles.
- ☐ 4.8 Dubbel tikken/netwerkfout en opnieuw proberen maakt **één** declaratie.
- ☐ 4.9 Uitlegscherm "Hoe declareer je?" bereikbaar en bevat de richtlijnen.

## 5. Bonnen en bestanden
- ☐ 5.1 Foto maken in de browser op een telefoon (`/app`) en toevoegen; meerdere bonnen mogelijk.
- ☐ 5.2 JPEG, PNG en PDF worden geaccepteerd; een `.txt` of hernoemd bestand wordt geweigerd.
- ☐ 5.3 Bestand >10 MB wordt geweigerd; totaal >25 MB wordt geweigerd; >10 bijlagen wordt geweigerd.
- ☐ 5.4 Een bon van bijna 25 MB komt door de reverse proxy (anders: `client_max_body_size` ≥ 40 MB instellen).
- ☐ 5.5 Een PDF met JavaScript/actieve inhoud wordt geweigerd (testbestand klaarzetten).
- ☐ 5.6 Administrateur kan de bon downloaden; het bestand is leesbaar en gelijk aan het origineel.
- ☐ 5.7 *(Niet in fase 1)* Omzetting naar PDF en export van het dossier: genoteerd als fase 2.
- ☐ 5.8 Camera in de **iOS/Android-app**: nog niet te testen zonder dev-build (open).

## 6. Verwerking en status
- ☐ 6.1 C opent *Declaraties verwerken* → ziet alleen declaraties van R1-ring-niveau; W ziet alleen W1.
- ☐ 6.2 C opent de declaratie → status wordt automatisch **Gezien door administrateur** (tijdstempel, één keer); opnieuw openen verandert niets.
- ☐ 6.3 Overgangen: *In behandeling*, *Aanvulling nodig* (toelichting verplicht ≥5 tekens), *Administratief verwerkt*, *Afgewezen* (toelichting verplicht). Er bestaat **geen** status "Uitbetaald".
- ☐ 6.4 Eindstatussen (verwerkt/afgewezen) zijn definitief; verdere wijziging wordt geweigerd.
- ☐ 6.5 D ziet status en verloop (inclusief de toelichting) maar kan zelf niets verwerken.
- ☐ 6.6 Een administrateur ziet zijn **eigen** declaraties niet in het beheeroverzicht en kan ze niet zelf verwerken.
- ☐ 6.7 B (ringpresident) opent dezelfde declaratie: leest alles, **status blijft ongewijzigd**, geen verwerkknoppen; ook wijk-declaraties van R1 zijn leesbaar.
- ☐ 6.8 Toegangslog: B en C hun inzage staan vastgelegd (controle via database of beheer; zie `DeclarationAccessLog`).

## 7. Privacy en beveiliging
- ☐ 7.1 In de database staan omschrijving, namen en bonnen **versleuteld** (geen leesbare tekst in `Declaration.sealed` / `DeclarationAttachment.data`).
- ☐ 7.2 Er komen geen mails of meldingen met bedragen, omschrijvingen of bonnen (fase 1 verstuurt geen declaratiemeldingen).
- ☐ 7.3 Er is nergens een zoeklijst van kerkleden of gebruikers voor ringbeheerders/financiële beheerders.
- ☐ 7.4 Webmin heeft geen automatische toegang tot declaraties of bonnen.
- ☐ 7.5 Accountverwijdering: een account met een **open** declaratie wordt geblokkeerd; een afgehandelde declaratie blijft zonder koppeling en met "Verwijderde gebruiker" (niet anoniem).

## 8. Toegang tussen gebruikers, ringen en units (poging tot ongeautoriseerde inzage)
Gebruik de browser met de netwerkweergave of een API-client met de sessie van de betreffende gebruiker. Noteer id's van een declaratie van D (`<decl>`) en een bijlage (`<bijlage>`).
- ☐ 8.1 **E** (andere ring) opent `/#/declaraties/<decl>` en roept `GET /api/mobile/v1/declarations/<decl>` aan → **404** "Deze declaratie bestaat niet" (geen bestaansinformatie).
- ☐ 8.2 E vraagt de bijlage op (`…/declarations/<decl>/attachments/<bijlage>`) → 404.
- ☐ 8.3 **F** (ringlid zonder financiële functie) probeert detail en bijlage → 404.
- ☐ 8.4 **A** (ringbeheerder) probeert detail en bijlage → 404.
- ☐ 8.5 **D2** (tweede kerklid) vraagt de declaratie van D op → 404 en ziet die niet in "Mijn declaraties".
- ☐ 8.6 E/D2/F proberen `POST …/declarations/<decl>/status` → 404 of 403, status ongewijzigd.
- ☐ 8.7 W (administrateur wijk W1) probeert een ring-niveau-declaratie → 404; C (ring) probeert een W1-declaratie → 404.
- ☐ 8.8 B van R1 probeert een declaratie van R2 → 404.
- ☐ 8.9 Zonder sessie: alle `/declarations…`-routes geven 401.
- ☐ 8.10 `GET /api/mobile/v1/declarations/official` als gewoon kerklid → lege lijst, geen gegevens van anderen.
- ☐ 8.11 `GET/POST /rings/<R1>/finance` als niet-ringbeheerder of vanuit R2 → 403.
- ☐ 8.12 Id's raden (willekeurige id) geeft dezelfde 404 als een bestaand-maar-verboden id.

## 9. Module uitschakelen
- ☐ 9.1 Zet `DECLARATIONS_ENABLED=false` en werk de stack bij.
- ☐ 9.2 `/meta` toont `"declarations":false`; de kaart/ingang Declaraties verdwijnt; alle `/declarations…`- en `/finance`-routes geven 404.
- ☐ 9.3 Nieuwe registratie via code is niet meer mogelijk (geen account voor onbekende adressen).
- ☐ 9.4 Roepingen, stemmen, beheer en inloggen werken ongewijzigd voor bestaande gebruikers.
- ☐ 9.5 Opnieuw aanzetten: eerder ingediende declaraties en functies zijn er nog.

## 10. Roepingen niet verstoord (regressie)
- ☐ 10.1 Voorstel indienen, ondersteunen, presidiumakkoord vastleggen en vrijgeven werkt als voorheen.
- ☐ 10.2 Meldingen en tabbalk onveranderd; Kerklid ziet geen roepingen.

## Afsluiting
Datum/uitvoerder: ______ · Image/commit: ______ · Open punten: ______
Pas na een geslaagde acceptatie en uitdrukkelijk akkoord van de eigenaar volgt een PR `develop` → `main`; fase 2 start pas daarna.
