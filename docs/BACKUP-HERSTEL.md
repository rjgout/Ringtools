# Back-up, herstel en automatische updates (NAS)

**Besluit eigenaar:** de Ringtools-app wordt **automatisch bijgewerkt via Watchtower** zodra er een nieuwe image op `main` is gepubliceerd. PostgreSQL (`db`) wordt
**niet** automatisch bijgewerkt. (Een eerdere versie van dit document beschreef gecontroleerde, handmatige releases; dat gaf een tussentijds bericht weer en is hiermee
vervangen.) De back-up- en herstelprocedures hieronder blijven gelden.

## Hoe de automatische update werkt
1. Een push naar `main` start de workflow *Build en publiceer Docker-image*: typecontrole, migraties op een CI-database, alle tests, en pas daarna bouwen en publiceren van
   `ghcr.io/rjgout/ringtools:latest` (plus een `:<sha>`-tag). Wat op `main` komt is dus direct de release: alleen mergen na groene CI.
2. Watchtower ziet de nieuwe digest van `:latest`, haalt de image op en vervangt de app-container (zelfde configuratie). De image is publiek leesbaar (anoniem pullen getest), er
   zijn geen registry-inloggegevens nodig.
3. Bij het opstarten voert `docker-entrypoint.sh` `prisma migrate deploy` uit en start dan de app.

## Compose-labels (in `docker-compose.yml`)
| Service | Label | Gevolg |
|---|---|---|
| `app` | `com.centurylinklabs.watchtower.enable: "true"` | Bijwerken toegestaan; ook nodig als Watchtower met `WATCHTOWER_LABEL_ENABLE=true` draait (alleen gelabelde containers) |
| `db` | `com.centurylinklabs.watchtower.enable: "false"` | Nooit automatisch (de tag `postgres:16-alpine` zou anders stilletjes minor-/patchupdates ophalen; een major-upgrade vraagt dump en restore) |

## Eenmalig in Portainer (Watchtower-configuratie zelf is niet door mij aangepast)
Het label van een **reeds draaiende container** verandert niet door een wijziging in GitHub. Wat te doen:
1. **Stack opnieuw uitrollen met de nieuwe compose**: Portainer → Stacks → Ringtools → Editor: zet bij `app` het label `com.centurylinklabs.watchtower.enable: "true"` en laat bij `db` `"false"`
   (of plak de huidige `docker-compose.yml`) → *Update the stack*. De stackomgevingsvariabelen (`POSTGRES_PASSWORD`, `SETTINGS_ENCRYPTION_KEY`, `APP_BASE_URL`, …) blijven staan.
   Dit herstart de containers één keer; maak vooraf een back-up (stap 1 hieronder).
2. Heb je het uitsluitingslabel `enable=false` bij `app` eerder uitgerold (vanaf commit `7ebbfbd`), dan is stap 1 **noodzakelijk**. Heb je dat nooit uitgerold, dan staat er op de draaiende
   `app`-container geen label en werkt Watchtower in de standaardmodus al; stap 1 is dan alleen nodig voor de modus met `WATCHTOWER_LABEL_ENABLE`.
3. **Controleer de Watchtower-instellingen** (Portainer → Containers → watchtower → Inspect / Env):
   - `WATCHTOWER_LABEL_ENABLE=true`? Dan wordt alleen gelabeld bewaakt: `app` heeft nu het label, `db` bewust niet. Staat de variabele niet, dan worden alle containers bewaakt behalve die met `enable=false`.
   - `WATCHTOWER_POLL_INTERVAL` (seconden) of `WATCHTOWER_SCHEDULE` (cron): bepaalt hoe snel een nieuwe release landt.
   - `WATCHTOWER_CLEANUP=true` is aan te raden (oude images opruimen, de NAS heeft beperkte schijfruimte).
   - Watchtower start geen containers opnieuw die hij niet bewaakt; `WATCHTOWER_MONITOR_ONLY=true` zou alleen melden en **niet** bijwerken — zet dat uit.
   - Meldingen (`WATCHTOWER_NOTIFICATION_URL`, bijv. e-mail/ntfy) zijn aan te raden zodat je een mislukte update merkt.
   - Het image moet `:latest` blijven (niet vastzetten op een sha-tag), anders ziet Watchtower nooit een nieuwe versie.
4. Controle na de eerste update: `docker logs <watchtower>` toont "Found new … image" en "Updating … ringtools"; `docker logs <app-container>` toont de migraties en het starten.

## Risico van automatische databasemigraties (beoordeling)
- **Altijd een back-up eerst:** Watchtower maakt zelf geen back-up en de app-image bevat geen `pg_dump`. Plan daarom een **dagelijkse** `scripts/db-backup.sh`-taak in de Synology Taakplanner (zie stap 1) vóór het moment waarop Watchtower pollt, en bewaar minstens 14 dagen. Een back-up vlak vóór elke update is met Watchtower alleen mogelijk via een eigen hook in jouw Watchtower-opzet; dat heb ik niet ingericht.
- **Migraties zijn additief** (kolommen/tabellen/enumwaarden toevoegen). De enige commit-reeks die nu klaarstaat voor het bijwerken vanaf de laatste gepubliceerde image (`c9210aa`) bevat één migratie, `20261117100000_e2_herstelcode_begrenzing`: twee kolommen met standaardwaarde op `TotpCredential` (geen data verwijderd; getest op een gevulde database). Eerdere migraties met `DROP INDEX`/`DELETE` (`multi_ring`, `native_push_devices`) zijn lang geleden toegepast. Controleer bij elke toekomstige release `git diff <vorige>..<nieuwe> -- prisma/migrations` op `DROP`, `DELETE`, `TRUNCATE` en `ALTER … TYPE`.
- **Mislukte migratie:** de app-container start dan niet (restart-lus door `restart: unless-stopped`); de oude image draait niet meer. Postgres voert elke migratie in een transactie uit, maar Prisma markeert een mislukte migratie als "failed" en weigert verder tot die is opgelost (`prisma migrate resolve`). Herstel: stap 4 hieronder (vorige image-sha vastzetten, zo nodig de dump terugzetten) en laat de oorzaak onderzoeken vóór je terugkeert naar `:latest`.
- **Niet terug te draaien:** `ALTER TYPE … ADD VALUE` en gegevens die door nieuwe code zijn geschreven. Een oudere image op een nieuwere database start wel (`migrate deploy`: "No pending migrations"), maar is niet gegarandeerd compatibel.
- **Gelijktijdigheid:** er is één app-container; tijdens de vervanging is de app kort onbereikbaar (seconden tot een halve minuut, plus de duur van migraties).

## Status van wat getest is
Getest in de ontwikkelomgeving (PostgreSQL 16, 23 migraties): de scripts `scripts/db-backup.sh` en `scripts/db-restore-oefen.sh`, aangestuurd via een nagebootste `docker exec`
die **alleen** de omgeving van de container meegeeft (dus zonder `POSTGRES_USER`/`POSTGRES_DB` op de host): een geslaagde back-up, een foute containernaam, een niet-bestaande
database (geen bestand blijft achter), een kapotte dump, een ontbrekend bestand, herstel naar een aparte oefendatabase met vergelijking, en opruimen. Ook getest: dump/restore
met gegevens, een oudere migratieset tegen een nieuwere database, en een oudere dump onder de nieuwere migratieset (zie onderaan).
**Niet getest:** het echte `docker`, Synology Taakplanner, Portainer en Watchtower, en het gedrag van oudere code bij een nieuwe enumwaarde. **Oefen daarom eerst op de NAS (stap 3).**

## Wat is wat
| Onderdeel | Waar | Herstelbaar via |
|---|---|---|
| Code/image | `ghcr.io/rjgout/ringtools:latest` en `:<sha>` | Compose op een oudere sha-tag zetten |
| Gegevens | Postgres-volume `ringtools_db` (service `db`) | **Logische dump** (`pg_dump`) of Hyper Backup van het volume |
| Geheimen | Portainer-stack/`.env`: o.a. `SETTINGS_ENCRYPTION_KEY` (SMTP-wachtwoord en TOTP-geheimen!), `POSTGRES_PASSWORD`, VAPID-sleutels | Apart bewaren. **Een dump zonder dezelfde `SETTINGS_ENCRYPTION_KEY` maakt versleutelde velden onleesbaar.** |

`POSTGRES_USER` en `POSTGRES_DB` staan alleen in de containeromgeving (Portainer-stack). Alle commando's hieronder en in de scripts laten de shell **in de container** de variabelen
uitbreiden (enkele aanhalingstekens rond `sh -c '…'`); de NAS-shell hoeft ze niet te kennen. De containernaam zie je met `docker ps` (bijv. `ringtools-db-1`).

## Image en database horen bij elkaar
`docker-entrypoint.sh` voert bij elke start `prisma migrate deploy` uit. Gemeten:
- **Nieuwere image op oudere database:** ontbrekende migraties worden toegepast, gegevens blijven intact.
- **Oudere image op nieuwere database:** `migrate deploy` meldt "No pending migrations" en start; er wordt niets teruggedraaid. De oudere code kent nieuwe kolommen/enumwaarden niet.
  Additieve migraties werken meestal, niet gegarandeerd (een rij met een nieuwe enumwaarde, bv. type `AWAITING_RELEASE`, kan door oudere code niet gelezen worden — niet getest).
- **Conclusie:** voor een betrouwbaar terugdraaien zet je de **image én de dump van vóór de update** samen terug (gegevens van ná de dump gaan verloren). Alleen de image terugzetten is een noodgreep.

## 1. Back-up maken (vóór elke release, en dagelijks)
```sh
scripts/db-backup.sh <db-container> /volume1/backups/ringtools
```
Het script maakt een `pg_dump -Fc`, controleert dat die niet leeg is en leesbaar is (`pg_restore --list`), schrijft eerst naar een `.partial`-bestand en hernoemt pas bij succes; bij elke fout
stopt het met een foutmelding en blijft er geen (half) bestand achter. Controleer de uitvoer ("OK: …") en noteer de huidige image-sha (GitHub Actions toont die per run;
`docker inspect --format '{{.Image}}' <app-container>`). Bewaar de dump buiten het volume (Hyper Backup/externe schijf). Plan dagelijks een Synology-taak (bv. 14 dagen bewaren).
Een bestandsbackup van een draaiende database is alleen crash-consistent; de dump is de betrouwbare vorm.

## 2. Handmatige release of uitrol buiten Watchtower om (optioneel)
1. Back-up maken (stap 1) en de dump op een andere plek bewaren.
2. Oefenherstel (stap 3) — minstens bij de eerste release en na elke migratie die tabellen wijzigt.
3. Wil je bewust een bepaalde versie draaien (bijv. na een mislukte update), zet dan tijdelijk `image: ghcr.io/rjgout/ringtools:<sha>` in de stack; Watchtower werkt een vaste tag niet bij. Zet daarna terug op `:latest` om automatische updates te hervatten.
4. Controle: `docker logs <app-container>` zonder fouten, `docker exec <app-container> node_modules/.bin/prisma migrate status` ("Database schema is up to date"), inloggen met een testaccount en een voorstel openen.
5. Mislukt het: zie stap 4 (terugdraaien).

## 3. Oefenherstel in een afzonderlijke database (raakt de echte database niet)
```sh
scripts/db-restore-oefen.sh <db-container> /volume1/backups/ringtools/<bestand>.dump
scripts/db-restore-oefen.sh <db-container> --opruimen
```
Herstelt in `<POSTGRES_DB>_oefen`, stopt bij de eerste fout (`--exit-on-error`; de oefendatabase blijft dan staan voor onderzoek) en toont aantallen (gebruikers, voorstellen, ringen, migraties) van de
echte en de oefendatabase. De echte database kan sinds de dump veranderd zijn; vergelijk dus met de toestand op het moment van de back-up.

## 4. Terugdraaien na een mislukte update
1. Zet de app stil (`docker stop <app-container>`; de db blijft draaien). Watchtower kan de app opnieuw starten of bijwerken zodra de image of `:latest` verandert: zet daarom de vorige sha-tag vast (stap 2) vóór je de app weer start, of zet Watchtower tijdelijk op pauze.
2. Zet de **vorige image-sha** in de stack.
3. Alleen als de gegevens zijn aangetast, of volgens de conclusie hierboven, de database terugzetten. Dit overschrijft de echte database — doe dit bewust en alleen met een gecontroleerde dump:
```sh
docker exec <db-container> sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$POSTGRES_DB\"" -c "CREATE DATABASE \"$POSTGRES_DB\""'
docker exec -i <db-container> sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < /volume1/backups/ringtools/<bestand>.dump
```
   Als het `pg_restore`-commando faalt, is de database leeg of half hersteld: herhaal het herstel of herstel in de oefendatabase en hernoem (`ALTER DATABASE … RENAME TO …`) na controle. Beëindig verbindingen vóór `DROP DATABASE` (stop de app eerst).
4. Stack starten; de entrypoint voert `migrate deploy` uit. Controle zoals bij een release (stap 2.4).

## Getest in de ontwikkelomgeving (migratieketen)
| Test | Uitkomst |
|---|---|
| `pg_dump -Fc` met gegevens → `pg_restore` in een lege database | Rijen en `_prisma_migrations` gelijk; `prisma migrate status`: up to date |
| Oudere migratieset tegen de nieuwere database | `migrate deploy` exit 0, "No pending migrations"; niets teruggedraaid |
| Dump van een oudere staat terugzetten en de nieuwe migratieset uitvoeren | Laatste migratie toegepast, bestaande rij blijft |
| `scripts/db-backup.sh` en `scripts/db-restore-oefen.sh` met nagebootste `docker exec` (alleen containeromgeving) | Succes- en foutpaden zoals boven; geen bestanden achtergebleven bij fouten |
