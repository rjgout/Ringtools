# Back-up en herstel van de NAS-installatie (Postgres + Docker-image)

Doel: een mislukte update (Watchtower of handmatig) kunnen terugdraaien zonder gegevensverlies of een kapotte combinatie van image en database.
**Status:** de database-stappen (dump, restore, migratiecontrole, oudere image tegen nieuwere database, oudere dump onder nieuwere image) zijn
in de ontwikkelomgeving getest op PostgreSQL 16 met de echte migratieketen (22 migraties). De Docker-/Synology-commando's zelf zijn **niet** op de
NAS uitgevoerd (geen toegang; niets is gedeployd). Voer de procedure daarom eerst één keer als oefening uit op de NAS (stap "Oefening").

## Wat is wat
| Onderdeel | Waar | Herstelbaar via |
|---|---|---|
| Code/image | `ghcr.io/rjgout/ringtools:latest` en `:<sha>`-tags | Compose op een oudere sha-tag zetten |
| Gegevens | Postgres-volume `ringtools_db` (service `db`) | **Logische dump** (`pg_dump`) of Hyper Backup van het volume |
| Geheimen | `.env`/Portainer-stack: o.a. `SETTINGS_ENCRYPTION_KEY` (SMTP-wachtwoord en TOTP-geheimen!), `POSTGRES_PASSWORD`, VAPID-sleutels | Apart bewaren (wachtwoordmanager). **Een dump zonder dezelfde `SETTINGS_ENCRYPTION_KEY` maakt versleutelde velden (SMTP, TOTP) onleesbaar.** |

## Belangrijk: image en database horen bij elkaar
Het opstartscript (`docker-entrypoint.sh`) voert bij elke start `prisma migrate deploy` uit. Gemeten gedrag:
- **Nieuwere image op oudere database:** de ontbrekende migraties worden toegepast (geteste route: dump van de oude staat teruggezet, daarna nieuwe image → alle migraties toegepast, gegevens intact).
- **Oudere image op nieuwere database** (alleen de image terugdraaien): `migrate deploy` meldt "No pending migrations" en start gewoon, er wordt **niets** teruggedraaid. De oudere code kent de nieuwere kolommen/enumwaarden niet. Migraties zijn additief, dus dit werkt meestal, maar niet gegarandeerd: een rij met een nieuwe enumwaarde (bijv. een melding van het type `AWAITING_RELEASE`) kan door oudere code niet gelezen worden. **Dit specifieke gedrag van de oude code is niet getest.**
- **Conclusie:** voor een betrouwbaar terugdraaien zet je de **image én de dump van vóór de update** samen terug (gegevens van ná de dump gaan dan verloren). Alleen de image terugzetten is een noodgreep voor als er nog geen nieuwe gegevens met nieuwe enumwaarden zijn.

## 1. Back-up maken (vóór elke update, en dagelijks)
Op de NAS (SSH of Portainer-console van de `db`-container; namen kunnen per stack verschillen, zie `docker ps`):
```bash
# stack-/containernaam en gegevens uit je Portainer-omgeving
DBC=<naam-van-de-db-container>
docker exec "$DBC" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > /volume1/backups/ringtools-$(date +%Y%m%d-%H%M)-voor-update.dump
ls -l /volume1/backups/ringtools-*.dump        # niet leeg?
docker exec "$DBC" pg_restore --list < /volume1/backups/<bestand>.dump | head   # leesbaar?
```
- Noteer ook de huidige image: `docker inspect --format '{{.Image}} {{index .RepoDigests 0}}' <app-container>` en de sha-tag (GitHub Actions toont die per run).
- Bewaar de dump op een andere plek dan het volume (Hyper Backup/externe schijf). Een bestandsbackup van het volume terwijl Postgres draait is alleen crash-consistent; een dump is de betrouwbare vorm.
- **Watchtower** werkt automatisch en maakt zelf geen back-up. Plan daarom een dagelijkse taak in Synology Taakplanner met bovenstaande `pg_dump` (en bewaar bv. 14 dagen). Wil je een back-up vlak vóór elke Watchtower-update, dan kan dat via een Watchtower *pre-update lifecycle hook*; dat is een wijziging in jouw Watchtower-configuratie en is dus **niet** door mij aangebracht.

## 2. Herstellen na een mislukte update
1. Zet de app stil: `docker stop <app-container>` (de database mag blijven draaien). Watchtower kan de container opnieuw starten; zet Watchtower voor deze stack tijdelijk op pauze of stop de stack in Portainer.
2. Zet de **vorige image** vast in de stack: in `docker-compose.yml`/Portainer `image: ghcr.io/rjgout/ringtools:<vorige-sha>` in plaats van `:latest`.
3. Database terugzetten (alleen nodig als de update de gegevens heeft aangetast, of volgens de conclusie hierboven):
```bash
docker exec -i "$DBC" psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\"" -c "CREATE DATABASE \"$POSTGRES_DB\""
docker exec -i "$DBC" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < /volume1/backups/<bestand>.dump
```
4. Start de stack. De entrypoint voert `prisma migrate deploy` uit; bij een gelijk lopende image/dump meldt die "No pending migrations".
5. Controle: inloggen (e-mailcode) met een testaccount, een voorstel openen, `docker logs <app-container>` zonder fouten, en `docker exec <app-container> node_modules/.bin/prisma migrate status` (verwacht: "Database schema is up to date").
6. Zet Watchtower pas terug op automatisch **nadat** de oorzaak is hersteld, anders haalt het weer dezelfde `:latest` binnen. (Of laat de stack op de vaste sha-tag staan tot je bewust opnieuw naar `:latest` gaat.)

## 3. Oefening (eenmalig, op de NAS)
Maak een dump, herstel die in een **tweede** database (`CREATE DATABASE ringtools_oefen`; `pg_restore -d ringtools_oefen`), vergelijk het aantal rijen van `"User"`, `"Calling"` en `_prisma_migrations` met het origineel en verwijder de oefendatabase weer. Zo weet je dat de dump bruikbaar is zonder productie aan te raken.

## Wat in de ontwikkelomgeving is getest (PostgreSQL 16, migratieketen van 22 migraties)
| Test | Uitkomst |
|---|---|
| `pg_dump -Fc` van een gemigreerde database met gegevens, `pg_restore` in een lege database | Rijen en `_prisma_migrations` (22) gelijk; `prisma migrate status`: "Database schema is up to date" |
| Oudere migratieset (zonder de laatste migratie) uitvoeren op de nieuwere database | `migrate deploy` eindigt met exit 0 en "No pending migrations"; er wordt niets teruggedraaid |
| Dump van een database op de oudere staat (21 migraties) terugzetten en de nieuwe migratieset uitvoeren | Laatste migratie wordt toegepast, bestaande rij blijft aanwezig |
| Docker-/Synology-commando's, Watchtower-gedrag, enumwaarde-gedrag van oudere code | **Niet getest** |
