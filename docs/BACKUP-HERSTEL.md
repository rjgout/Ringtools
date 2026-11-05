# Back-up, herstel en gecontroleerde releases (NAS)

**Besluit eigenaar:** Ringtools krijgt voorlopig **gecontroleerde releases**, geen automatische Watchtower-updates. Pas als automatische back-ups vóór een update en
het herstel aantoonbaar werken, bekijken we automatisering opnieuw. In de repository staat daarvoor het label `com.centurylinklabs.watchtower.enable: "false"`
op de services `app` en `db` in `docker-compose.yml`. **Dat label werkt pas nadat de stack in Portainer opnieuw is uitgerold met dit bestand** — ik heb de
Portainer-stack en jouw Watchtower-configuratie niet aangepast. Controleer na het uitrollen in de Watchtower-logs dat deze containers worden overgeslagen. Daarnaast raad
ik aan `image:` bij de app vast te zetten op een sha-tag (`ghcr.io/rjgout/ringtools:<sha>`) in plaats van `:latest`; dan gebeurt er ook bij een handmatige "pull" niets onverwachts.

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

## 2. Gecontroleerde release
1. Back-up maken (stap 1) en de dump op een andere plek bewaren.
2. Oefenherstel (stap 3) — minstens bij de eerste release en na elke migratie die tabellen wijzigt.
3. In de stack `image: ghcr.io/rjgout/ringtools:<nieuwe-sha>` zetten en de stack opnieuw uitrollen.
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
1. Zet de app stil (`docker stop <app-container>`; de db blijft draaien). Bij gecontroleerde releases start Watchtower hem niet opnieuw.
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
