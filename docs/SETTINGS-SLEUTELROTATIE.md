# SETTINGS_ENCRYPTION_KEY veilig roteren

Deze PR roteert geen productiesleutel en verandert het versleutelingsformaat niet. De eigenaar voert productieonderhoud pas na afzonderlijke beoordeling uit. De waarschuwing over een korte sleutel staat los van de geweigerde demo-lidmaatschapswijziging.

## Wat de huidige code doet

`src/lib/crypto.ts` gebruikt AES-256-GCM: een willekeurige IV van 12 bytes, authenticatietag van 16 bytes, en ciphertext; de opslag is `iv.tag.ciphertext` in base64. Een sleutel van precies 64 hextekens wordt als 32 bytes gelezen; andere invoer wordt met SHA-256 afgeleid. Hashen geeft een zwak wachtwoord geen extra entropie. De invoer wordt **niet getrimd**: ook eventuele witruimte behoort tot de bestaande sleutel. Alleen de lengtewaarschuwing is bekend; de productiesleutel is niet ingezien.

Alle gevonden velden die deze sleutel gebruiken:

- `SmtpSettings.encryptedPassword` (optioneel).
- `TotpCredential.secretEncrypted` (ook nog niet bevestigde inschrijvingen).
- `TotpCredential.pendingSecretEncrypted` (optioneel; lopende vervanging).

Reviewwachtwoorden zijn bcrypt-hashes en gebruiken deze sleutel niet. Passkeys en gehashte herstelcodes evenmin. `SETTINGS_ENCRYPTION_KEY` wordt momenteel rechtstreeks uit de omgeving gelezen; daarvoor is geen `_FILE`-variant geïmplementeerd. De applicatie heeft geen sleutelring, sleutelversie of ingebouwd rotatiecommando. Alleen de omgevingsvariabele wijzigen maakt bestaande SMTP- en TOTP-gegevens onleesbaar en kan ook webmin buitensluiten.

## Uitvoerbaar onderhoudsplan en vrijgavevoorwaarden

1. Eigenaar plant een onderhoudsvenster en bewaart de huidige exacte sleutel buiten GitHub/CI, in een goedgekeurde geheimenkluis. Leg image-digest en herstelprocedure vast zonder waarden. Maak een versleutelde databaseback-up en herstel die eerst op een geïsoleerde kopie. De oude sleutel moet beschikbaar blijven zolang oude back-ups nodig zijn.
2. Laat vóór productiegebruik een afzonderlijk beoordeeld onderhoudshulpmiddel bouwen dat het **bestaande formaat en dezelfde sleutelafleiding** gebruikt. Het krijgt oude en nieuwe sleutel via afgeschermde invoer, nooit commandoregelargumenten, Git of logging. De runtime-image bevat geen TypeScript-broncode: ga niet uit van een bestaand script in de container.
3. Genereer de nieuwe sleutel met een cryptografische generator: 32 willekeurige bytes, gecodeerd als 64 hextekens. Bewaar hem direct in de geheimenkluis. Geen door een mens gekozen wachtwoord en geen waarden in dit document of uitvoerlog.
4. Droogtest op de geïsoleerde kopie: ontsleutel **alle** aanwezige waarden in de drie velden met de exacte oude sleutel. Ontbrekende optionele waarden blijven ontbreken. Stop bij één onleesbare/authenticatiefout; reset geen MFA en overschrijf niets. Rapporteer uitsluitend aantallen en succes/falen. Test expliciet SMTP, bevestigd TOTP, onbevestigd TOTP en lopende TOTP-vervanging.
5. Test de onderhoudsfunctie met synthetische gegevens: verkeerde oude sleutel, beschadigde tag, lege optionele velden, 64-hex en oorspronkelijke tekstsleutels inclusief witruimte, fout halverwege (volledige rollback), en exacte roundtrip voor ieder veld. Test ook webmin- en gebruikers-MFA na omzetting. Pas na groene tests mag het hulpmiddel voor productie worden vrijgegeven. Dit hulpmiddel is **geen onderdeel van PR #4**.
6. Eigenaar pauzeert automatische imagevervanging en stopt alle applicatie-instanties, cronjobs en overige schrijvers. Maak de definitieve consistente back-up. Houd de applicatie gestopt gedurende databaseomzetting én configuratiewijziging; oude en nieuwe app mogen niet gelijktijdig schrijven.
7. Het beoordeelde hulpmiddel opent één PostgreSQL-transactie, vergrendelt de SMTP- en TOTP-tabellen tegen gelijktijdig schrijfwerk, leest alle rijen opnieuw, ontsleutelt alles met de oude sleutel en versleutelt met de nieuwe sleutel en telkens een nieuwe IV. Verifieer voor **alle** waarden dat ontsleuteling met de nieuwe sleutel exact dezelfde bytes oplevert vóór commit. Wijzig uitsluitend de drie ciphertextvelden; laat IDs, bevestigingsstatus, tellers, herstelcodes, sessies en overige metadata ongemoeid. Elke fout betekent rollback van de volledige transactie. Geen plaintext of ciphertext in logs.
8. Pas na geslaagde commit configureert de eigenaar de nieuwe exacte omgevingswaarde en start dezelfde gecontroleerde applicatieversie. Verifieer in een beveiligde sessie SMTP en webmin-TOTP, gebruikers-TOTP en een pending inschrijving/vervanging. Herstelcodes blijven beschikbaar als bestaande noodvoorziening, niet als vervanging voor de rotatie. Controleer dat de waarschuwing verdwijnt zonder sleutelwaarden te loggen.
9. Bij problemen: applicatie gestopt houden; herstel **database én de bijbehorende oude sleutel samen**. Alleen de sleutel terugzetten na een geslaagde databaseomzetting werkt niet. Als na herstart al nieuwe gegevens zijn geschreven, betekent back-upherstel gegevensverlies: eerst stoppen en een gecontroleerd herstelbesluit nemen. Hervat automatische updates pas na acceptatie.

Een online rotatie vraagt een apart ontwerp met versies, gelijktijdige decryptie met oude/nieuwe sleutels, expliciete schrijfsleutel en gecontroleerde uitfasering. Dat wordt hier niet geïntroduceerd. Bestaande versleutelde gegevens en MFA blijven met deze PR dus compatibel; de geconstateerde zwakke productiesleutel blijft een open eigenaaractie tot het onderhoud is uitgevoerd.
