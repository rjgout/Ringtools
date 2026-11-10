# Privacy en storeverklaringen

Bijgewerkt 10 november 2026. Feitelijke implementatie; geen verklaring dat alle juridische releasevoorwaarden al zijn vervuld. Verwerkingsverantwoordelijke: **Raphael Gout, raphael@ringapeldoorn.nl** (opgegeven door de eigenaar). Publieke teksten: `/privacy`, `/accountverwijdering`, `/contact`. De app toont Profiel → Account en privacy.

## Inventaris en technische bewaartermijnen

| Gegevens | Doel / opslag | Feitelijke termijn |
|---|---|---|
| Naam, e-mail, gebruikers-ID, rol, kerkelijke functie, ring/wijklidmaatschap | Account en autorisatie; eigen PostgreSQL | Zolang account bestaat, ook na deactiveren; volledige verwijdering op verzoek |
| Kandidaat/betrokkene, functie, wijk, steun/reacties, besluiten/notities, deelnemers, taken/tijdstippen, audit | Roepingen en vertrouwelijke ontheffingen; PostgreSQL | Verwerkt: 30 dagen; concepten: 30 dagen. Lopende dossiers niet automatisch wissen. Ontheffingen: herinnering na 30, beoordeling na 90 dagen zonder activiteit |
| Uitnodiging: naam, e-mail, rol, status, audit; code/token uitsluitend hashes | Activering; PostgreSQL, verificatiemail via SMTP | 90 dagen na activatie/verlopen/intrekken |
| Sessietokens (server hashes), user-agent/toestellabel | Aanmelding; PostgreSQL en Keychain/versleutelde Android-opslag | 60 dagen inactiviteit, 180 dagen absoluut; ingetrokken/verwijderd eerder |
| Installatie-ID, platform, publieke sleutels, sleutelprotocollen/challenges, beveiligingsgebeurtenissen | Toestelaanmelding en beveiliging | Registraties tot intrekken/verwijderen; korte challenges volgens protocol. Geen vaste algemene logretentie geïmplementeerd |
| Passkey-publieke sleutels, versleuteld TOTP-geheim, hashes herstelcodes | MFA | Tot verwijderen van methode/account |
| APNs-/FCM-token, webpushabonnement | Functionele push via Apple/Google | Tot afmelden, verwijderen, ongeldige providerregistratie; generieke tekst en intern doelpad |
| Interne notificaties, status/readAt | Workflow | Account-/dossiercascade waar gekoppeld; geen algemene losse notificatieretentie |
| Reviewcredential bcrypt-hash, mislukte pogingen en slot | Expliciete REVIEW-accounts, alleen fictieve demo | Tot accountverwijdering; rotatie trekt sessies in; nooit plaintext |
| Verwijdercode (hash), e-mailsnapshot, pogingen | Ook voor gedeactiveerde gebruikers; nooit een login | Code 15 min geldig, opruiming vanaf één dag na vervallen |
| Verwijderverzoek: userId tot wissen, status, streefdatum, ontvangstbewijshash, behandelaar en concrete bewaarmotivering | Beheerwachtrij en controle | Open verzoeken blijven zichtbaar; afgerond bewijs na 90 dagen opgeruimd |
| E-mail en back-ups | SMTP en eigen back-upvoorziening | Eigenaar moet feitelijke leveranciers, retentie en herstel-/wisprocedure vaststellen |

De roepings-/ontheffingscontext **kan religieuze overtuiging/betrokkenheid onthullen**; deze verwerking wordt als gevoelige informatie behandeld en als Sensitive Info opgegeven. Geen ongefundeerde claim dat dit uitsluitend niet-gevoelige administratie is. Namen van personen zonder account zijn eveneens persoonsgegevens. Geen LCR-personenimport of blijvend personenregister.

Biometrie/toestelcode blijft bij iOS/Android; Ringtools ontvangt alleen het verificatieresultaat en bij toestelprotocol publieke sleutel/handtekening. Geen biometrische kenmerken op de server. Een server zonder attestatie bewijst sleutelbezit, geen onafhankelijke hardwareattestatie. Geen advertenties, tracking, advertentie-ID, derde-partijanalytics, locatie, contacten, camera, microfoon of fototoegang. Native plug-ins en secure storage blijven ongewijzigd, inclusief lokale appvergrendeling en Personal Team-beperkingen.

## Apple App Store Connect → App Privacy

Voor de in deze branch geïmplementeerde app/backend, inclusief optionele native meldingen: **Yes, we collect data from this app**. Neem ook inhoud over derden mee. Iedere hieronder aangevinkte categorie: doel **App Functionality**, **Linked to the user's identity: Yes**, **Used for tracking: No**. Geen advertising, developer advertising, analytics of personalization aanvinken.

| App Store Connect categorie | Aanvinken | Onderbouwing |
|---|---|---|
| Contact Info → Name | Ja | Accountnamen en namen van kandidaten/betrokkenen |
| Contact Info → Email Address | Ja | Account, uitnodiging, verificatie |
| Sensitive Info | Ja | Religieuze betrokkenheid/functie en vertrouwelijke dossiers |
| Identifiers → User ID | Ja | Account-/lidmaatschaps-ID |
| Identifiers → Device ID | Ja | Installatie-/toestel-ID en pushregistratie, functioneel |
| User Content → Other User Content | Ja | Voorstellen, besluiten, notities, ondersteuning en taken |
| Usage Data → Product Interaction | Ja | Reacties, uitgevoerde acties en functionele status/tijdstippen |
| Usage Data → Other Usage Data | Ja | Beveiligings- en autorisatiegebeurtenissen gekoppeld aan account/toestel |
| Alle overige categorieën | Nee, zolang de verwerking niet verandert | Geen betalingen, fysieke locatie, contacten, beeld/audio, gezondheid, browse-/zoekhistorie of advertentiegegevens in de geïnspecteerde app |

Privacy Policy URL: `https://ringapeldoorn.nl/privacy`. Support URL: `https://ringapeldoorn.nl/contact`. Account deletion URL: `https://ringapeldoorn.nl/accountverwijdering`. Deze routes moeten na de door de eigenaar goedgekeurde productie-update opnieuw publiek worden gecontroleerd. Niet beweren dat ongepubliceerde branchcode al live staat.

`mobile/ios/App/App/PrivacyInfo.xcprivacy` beschrijft dezelfde categorieën, niet gelinkt voor tracking; UserDefaults required-reason `CA92.1` blijft behouden. Het manifest vervangt de App Privacy-vragenlijst niet. Controleer ook het uiteindelijke samengevoegde archive-manifest van alle SDK's.

`ITSAppUsesNonExemptEncryption=false` bestaat al in de iOS-configuratie. De eerdere onderbouwing “alleen HTTPS” was onvolledig: de app gebruikt ook OS-cryptografie, publieke-sleutelverificatie en veilige opslag. De eigenaar moet de juiste exportvrijstelling in App Store Connect vaststellen; geen exportjuridische conclusie afleiden uit deze boolean.

Google Play Data Safety: eveneens naam/e-mail, religieuze/gevoelige informatie, gebruikerscontent/activiteit en device-ID/push; functioneel, HTTPS, geen verkoop/tracking. Gebruik de verwijder-URL. Definitieve Google-formulierindeling bij publicatie opnieuw controleren.

## Uitvoerbare accountverwijdering

De app vraagt expliciete bevestiging van **het volledige account in alle ringen**, met recente serververificatie. Reviewaccounts herbevestigen met reviewwachtwoord; gewone gebruikers met hun bestaande factor. Verzoeken worden idempotent in `AccountDeletionRequest` opgeslagen. Een gehasht, willekeurig ontvangstbewijs toont zonder sessie alleen status en termijnen, geen identiteit/dossiers. Op toestel uitsluitend secure storage; op website HttpOnly-cookie. Een herhaalde aanvraag vernieuwt het bewijs. Bewijs op een ander toestel kan daardoor vervallen.

Gedeactiveerde gebruikers kunnen rechtstreeks op de publieke verwijderpagina een aparte eenmalige e-mailcode gebruiken: geen sessie, heractivering of MFA-reset. Dit is geen verplicht supportgesprek. Bij verlies van de mailbox is menselijke identiteitscontrole via de verantwoordelijke nodig.

Beheer: beveiligde website → Instellingen → Reviewdemo en verwijderverzoeken (`/instellingen/review`), uitsluitend systeembeheer met recente MFA. Raphael Gout behandelt de zichtbare wachtrij. **Streeftermijn 14 dagen** is een operationele afspraak. Beoordeel dagelijks de wachtrij en neem bij vertraging rechtstreeks contact op via het nog aanwezige accountadres; verzamel geen extra identiteit als bestaande verificatie volstaat.

1. Controleer verzoek/identiteit; bekijk lidmaatschappen en actuele processen in het bestaande beheer.
2. Draag laatste ringbeheer, open taken en actieve rondes eerst correct over of rond ze af via de gewone workflow. De voltooiingsactie geeft concrete blokkeercategorieën terug en wist dan niets. Behandel een blokkade actief; laat een verzoek niet onbeperkt liggen.
3. Historische noodzakelijke relaties: uitsluitend met een **werkelijk vastgestelde grondslag en concrete bewaarmotivering** tijdelijk naar een nieuw niet-authenticeerbaar `AUDIT`-object. Accountnaam/e-mail, credentials en alle lidmaatschappen verdwijnen echt. Dit is pseudonimisering, geen anonimiteit; de dossiertermijnen lopen door. Geen algemene verzonnen kerkelijke of wettelijke bewaarplicht. Zonder geldige basis eerst gegevens/dossier wissen volgens toepasselijke procedure, daarna opnieuw voltooien.
4. Voltooien wist alle sessies, publieke sleutels, TOTP/herstelcodes, pushregistraties, eigen meldingen, challenges en expliciete persoonskoppelingen. Actieve dossiers met expliciet gekoppelde betrokkene blokkeren vooraf; niet op naam raden.
5. Voltooiing verschijnt in de app op het aanmeldscherm → Status verwijderverzoek of op de publieke pagina met ontvangstcookie. Na de dossieropruiming verdwijnen ook verweesde AUDIT-objecten. Oude back-ups moeten bij herstel de uitgevoerde verwijderingen opnieuw toepassen (eigenaarprocedure nog vast te stellen).

Systeembeheeraccounts worden via deze gewone gebruikersprocedure geweigerd; deze app kent geen mobiele webmin-login. De laatste ringbeheerder kan wel aanvragen, maar eerst moet opvolging worden vastgelegd. Een ringlidmaatschap beëindigen is geen volledige accountverwijdering.

## Open eigenaarbeslissingen vóór publieke release

- Concrete AVG-grondslag (art. 6) én toepasselijke uitzondering voor religieuze/bijzondere gegevens (art. 9), informatieplicht voor betrokkenen zonder account en noodzakelijkheidsbeoordeling.
- Feitelijke hosting/SMTP-verwerkers, overeenkomsten, locaties/doorgiften/waarborgen; toegang van technisch beheer.
- Concrete log-, mailbox- en back-upretentie; uitvoering en bewijs van verwijdering bij back-upherstel; eventuele aantoonbare wettelijke uitzonderingen.
- Export compliance, definitieve leeftijdsvragenlijst en storeclassificaties. Geen juridische gereedheid claimen zolang dit openstaat.

Releasepakket, Apple-bronnen, technische controles en productiehandelingen: [app-store/RELEASEPAKKET.md](app-store/RELEASEPAKKET.md).
