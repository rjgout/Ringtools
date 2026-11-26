# Declaratiemodule (fase 1)

Aparte module naast Roepingen. Alleen actief met `DECLARATIONS_ENABLED=true` (standaard **uit**; zonder vlag bestaan de API-routes niet, `/meta` meldt `declarations: false` en de app toont niets).
Roepingen, hun rechten en workflow zijn niet gewijzigd.

## Wat fase 1 bevat
- **Registratie:** onbekend e-mailadres → eenmalige code (`InvitationLoginCode.purpose = "registration"`, 15 min, 3 per adres/uur, 300 globaal/uur) → account met rol `KERKLID`, zonder ringlidmaatschap. Bestaande accounts (ook ambigue) worden nooit overgenomen; het antwoord verraadt niet of een adres bestaat. Openstaande financiële toekenningen op exact dat adres worden in dezelfde transactie gekoppeld.
- **Financiële functies** (los van roepingrollen; alleen ringbeheerders van de eigen ring, op exact e-mailadres, geen zoeklijst): financieel (sub)administrateur van ring of wijk/gemeente, ringpresident (alleen lezen, ring + onderliggende units), bisschop/gemeentepresident (nodig voor activering, geen automatische rechten).
- **Activering:** ring = ringpresident + ≥1 administrateur; wijk/gemeente = bisschop/gemeentepresident + ≥1 administrateur van die unit. Server weigert indienen bij een niet-geactiveerde bestemming (melding exact conform opdracht). Na deactivering blijven bestaande declaraties zichtbaar voor eigenaar en bevoegden.
- **Indienen:** bestemming, organisatie, goedkeurder, bevestiging vooraf goedgekeurd, voor wie, overmaken aan, bedrag (geen IBAN), omschrijving, opmerkingen, 1–10 bonnen (JPEG/PNG/PDF). Direct naar de ring vraagt een uitdrukkelijke bevestiging. Idempotent via `clientRequestId`.
- **Verwerken:** statussen Ingediend → Gezien → In behandeling / Aanvulling nodig → Administratief verwerkt / Afgewezen (geen "Uitbetaald"). "Gezien" wordt automatisch gezet wanneer een bevoegde administrateur de declaratie opent. De ringpresident leest zonder statuswijziging; zijn toegang staat in een apart log (`DeclarationAccessLog`). Statushistorie blijft bewaard.

## Scopekeuzes (graag bevestigen)
- Een administrateur op **ringniveau** ziet declaraties rechtstreeks naar de ring; een administrateur van een **wijk/gemeente** ziet alleen die unit. Een ringpresident leest de hele ring incl. units. Subadministrateur heeft dezelfde rechten als administrateur.
- Een administrateur verwerkt nooit zijn eigen declaraties (hij ziet ze niet in het beheeroverzicht).
- Ringbeheerders, bisschoppen en webmin krijgen geen automatische inzage.

## Opslag en versleuteling (keuze + onderbouwing)
Gekozen: **versleuteling op applicatieniveau in de bestaande PostgreSQL** (AES-256-GCM; sleutel via HKDF uit `SETTINGS_ENCRYPTION_KEY`, aparte context; per rij een eigen IV; AAD = declaratie-/bijlage-ID zodat een gekopieerde ciphertext niet te openen is). Tekstvelden staan als één versleutelde blob; alleen bedrag, status, ring/unit en tijdstempels staan leesbaar voor filtering. Bonnen staan versleuteld als `bytea`.
Waarom niet een apart bestandsarchief: de Synology-/Docker-opzet heeft één volume (database) dat al wordt geback-upt (`docs/BACKUP-HERSTEL.md`); een tweede opslag vraagt eigen back-up, rechten en consistentie. Databaseversleuteling op schijfniveau (volume/NAS-encryptie) blijft aanvullend aan te raden maar beschermt niet tegen toegang via de database zelf. Nadeel: sleutelverlies = gegevensverlies (sleutel mee back-uppen, apart van de dump). Herzien als bijlagen groter/talrijker worden.

## Bestandsvalidatie
Type op magic bytes (niet op naam/MIME van de client), max. 10 MB per bestand, 25 MB totaal, max. 10 bijlagen, PDF's met actieve inhoud (JavaScript, launch, embedded files) worden geweigerd, bestandsnaam wordt gesaneerd. Foto's worden in de app verkleind. Server-side omzetting naar PDF is **fase 2**.

## Nog niet gebouwd (volgende fasen)
Ingelogd blijven met biometrie, berichten per declaratie, meldingen en voorkeuren, PDF-exports (bonnen/overzicht/dossier), persoonlijke namenlijst, minimaal twee ringbeheerders + noodfuncties centrale beheerder, en automatische verwijdering.

## Bewaartermijn (onderzoek nog open)
Uitgangspunt ca. 6 maanden na administratieve verwerking. Er is **geen** automatische verwijdering gebouwd. Onderzoek naar wettelijke en kerkelijke bewaartermijnen moet vóór activering van verwijdering plaatsvinden; geen juridische grondslagen zijn aangenomen.

## Privacy/store
- Accountverwijdering: `Declaration.ownerId` wordt `NULL` (naamsnapshot blijft voor de administratie); beoordeling samen met `docs/STORE-PRIVACY.md` nodig.
- iOS: `NSCameraUsageDescription` toegevoegd (foto van een bon). Android-camera via de bestandskiezer en beide platformen: **niet op een toestel getest**.
- Meldingen/e-mail bevatten geen bedragen of omschrijvingen (fase 1 verstuurt geen declaratiemeldingen).
