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
Uitgangspunt (besluit eigenaar): zes maanden na administratieve verwerking. Er is **geen** automatische verwijdering gebouwd. Onderzoek naar wettelijke en kerkelijke bewaartermijnen moet vóór activering van verwijdering plaatsvinden; geen juridische grondslagen zijn aangenomen.

## Accountverwijdering (besluit eigenaar: een declaratie met naam is niet anoniem)
- Een declaratie bevat persoonsgegevens (declarant, begunstigde, omschrijving, bonnen) en wordt **nooit als anoniem** aangemerkt, ook niet na verwijdering van het account.
- Een account met een nog niet afgehandelde declaratie (Ingediend/Gezien/In behandeling/Aanvulling nodig) kan niet worden verwijderd (blokkade `OPEN_DECLARATIONS`); eerst afhandelen.
- Bij verwijdering van het account: koppeling aan het account (`ownerId`) en het declaratieprofiel verdwijnen en de directe naam wordt vervangen door "Verwijderde gebruiker". De afgehandelde declaratie zelf blijft als administratie bestaan tot het einde van de bewaartermijn (zes maanden na verwerking als uitgangspunt) en wordt nog **niet** automatisch verwijderd.
- Onderzoek/voorstel voor minimale historische gegevens: na de bewaartermijn alleen bedrag, ring/unit, status en tijdstempels bewaren (geen bonnen, geen vrije tekst, geen namen); tot die tijd de volledige inhoud versleuteld laten staan. Vereist akkoord van de eigenaar en juridische toetsing; geen grondslag aangenomen.
- Open punt: namen binnen de versleutelde tekst (bijv. "voor wie") worden bij verwijdering niet herschreven.

## Opslag: grootte, sleutels, back-up en herstel
- Limieten: 10 MB per bestand, 25 MB totaal, 10 bijlagen (client verkleint foto's). Upload gaat als JSON (base64, ~34 MB bij het maximum): controleer op de Synology/reverse proxy dat `client_max_body_size` (of vergelijkbaar) minimaal 40 MB toestaat, anders falen grote declaraties met een proxyfout. **Nog te testen op dev.**
- Sleutel: afgeleid van `SETTINGS_ENCRYPTION_KEY`. Zonder deze sleutel zijn alle declaraties onleesbaar. Bewaar de sleutel apart van de database-dump (wachtwoordkluis); wijzig hem niet zonder een herversleutelingsprocedure (niet gebouwd; het formaat bevat een versienummer voor latere rotatie).
- Back-up: `pg_dump` bevat de versleutelde bytea-gegevens; de dump alleen is dus nuttig zonder de sleutel niet. Hersteltest: dump terugzetten in een `_test`-database met dezelfde sleutel en een declaratie openen (nog uit te voeren; zie `docs/BACKUP-HERSTEL.md`). De databasegrootte groeit met bonnen; houd het volume in de gaten.

## Privacy/store
- iOS: `NSCameraUsageDescription` (akkoord eigenaar) – "Ringtools gebruikt de camera alleen om een foto van een bon bij een declaratie te maken." In `docs/STORE-PRIVACY.md` vastgelegd; bij de App Privacy-verklaring moeten foto's/bonnen en financiële gegevens (declaraties) worden meegenomen zodra de module in een store-build wordt geactiveerd.
- Android-camera via de bestandskiezer en beide platformen: **niet op een toestel getest**.
- Meldingen/e-mail bevatten geen bedragen of omschrijvingen (fase 1 verstuurt geen declaratiemeldingen).

## Migratienamen
Migraties heten `<jjjjmmddhhmmss>_<naam>` en worden op naam gesorteerd. De bestaande reeks loopt voor op de kalenderdatum (laatste vóór deze module: `20261204110000`); `20261205100000_declaraties_basis` sluit daar direct op aan. Geef een volgende migratie altijd een naam die **na** de laatste bestaande sorteert, ook als `prisma migrate dev` een eerdere (kalender)datum voorstelt: een eerdere naam draait op een nieuwe database vóór zijn voorganger en faalt. Hernoem een migratie nooit nadat die ergens is toegepast.
