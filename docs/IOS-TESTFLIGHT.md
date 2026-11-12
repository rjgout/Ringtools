# Ringtools: handmatige iOS Distribution-signing

Dit ontwerp gebruikt het **bestaande** Apple Distribution-certificaat met privésleutel en het bestaande App Store-profiel voor `nl.ringapeldoorn.ringtools`. Het maakt geen Apple-certificaten of profielen aan en trekt niets in. De echte eigenaarbestanden zijn niet door Codex ontvangen of getest. Een geslaagde synthetische test bewijst niet dat de Windows-export door macOS wordt geaccepteerd.

## Oorzaak en audit

De oude `ios-testflight.yml` archiveerde Release met automatische signing, `iPhone Developer` op projectniveau en `CODE_SIGN_STYLE=Automatic` op de app-target. De export vroeg daarna pas om Apple Distribution. Beide stappen gebruikten `-allowProvisioningUpdates` en App Store Connect-authenticatie. Tijdelijke macOS-runners konden zo opnieuw Development-identiteiten aanvragen. Dat past bij de gemelde certificaatlimiet; de exacte historische Apple-accountmutaties zijn niet onafhankelijk vastgesteld. De oude archivecontrole controleerde alleen metadata, niet de distributiehandtekening. Alleen de IPA werd streng op Distribution gecontroleerd. De oude upload stond standaard aan.

## Nieuwe uitvoering en grenzen

1. `.github/workflows/ios-signing-tests.yml`: automatische Linux/macOS-CI met uitsluitend gegenereerde, zelfondertekende synthetische testsleutels. Geen `testflight`-omgeving, signingsecrets, Apple-account, echte signingbuild of upload. De macOS-test probeert alleen een tijdelijk synthetisch AES256-SHA256-P12 te importeren en rapporteert acceptatie of veilige afwijzing.
2. `.github/workflows/ios-signing-import-check.yml`: **afzonderlijk te autoriseren** handmatige importcontrole op `main`, omgeving `testflight`. `import_authorized` staat standaard uit. Decodeert/valideert uitsluitend de bestaande middelen, probeert import in een tijdelijke keychain, controleert een geldige codesigning-identiteit en ruimt alles weer op. Geen Xcode-build, ondertekening, App Store Connect-sleutel of IPA-upload. Alleen een niet-geheim bewijs met commit en SHA-256-binding van de twee versleutelde/publieke bestanden wordt zeven dagen bewaard, na succesvolle cleanup.
3. `.github/workflows/ios-testflight.yml`: **opnieuw afzonderlijk te autoriseren** handmatige Distribution-build op dezelfde `main`-commit. `signing_authorized=false`, **`upload=false`**. Vereist het runnummer van de geslaagde importcontrole. Controleert event, workflowpad, branch, commit, runresultaat en het bewijs voor dezelfde P12/profielbytes. Bij een gewijzigde commit of gewijzigde bestanden is een nieuwe importcontrole nodig. Verlopen/verwijderd bewijs betekent opnieuw controleren. Er wordt geen IPA-artifact gepubliceerd; zonder upload blijft de IPA alleen op de tijdelijke runner en wordt hij opgeruimd.

Deze workflows worden in deze opdracht **niet gestart**. De nieuwe workflows worden pas op `main` bruikbaar na onafhankelijke review én afzonderlijke expliciete merge-toestemming. `main` publiceert ook Docker-images; een merge is dus een aparte productiehandeling. Vink een toestemmingsinput uitsluitend aan na echte eigenaarstoestemming. Die invoer is geen vervanging van GitHub-environmentbescherming.

Configureer als eigenaar de omgeving `testflight` met vereiste reviewers, voorkomen van zelfgoedkeuring waar beschikbaar en uitsluitend `main` als toegestane deploymentbranch. Configureer **geen** gelijknamige signingsecrets op repository- of organisatieniveau. PR-workflows krijgen geen environment en verwijzen niet naar deze secrets; distributiejobs weigeren andere repositories/events/branches. Eigenaar/maintainers blijven verantwoordelijk voor workflowreview en repositorybeveiliging. De twee handmatige workflows delen één concurrencygroep zonder automatische annulering.

## Signingontwerp

`mobile/scripts/ios_distribution.py` beheert de tijdelijke middelen. `ios_signing_policy.py` bevat het gedeelde beleid; `verify-ios-bundle.py` controleert zowel archive als IPA met dezelfde distributieregels.

- Strikte base64- en aanwezigheidscontrole; P12 moet met het gegeven wachtwoord openen, een privésleutel met overeenkomend certificaat bevatten, een geldige Apple Distribution-naam, de verwachte team-OU, code-signing-EKU en geldigheidsperiode hebben.
- `security cms` decodeert het profiel. Het moet geldig en specifiek voor deze app zijn, dezelfde teamidentiteit hebben, het exacte certificaat bevatten, iOS/App Store-distributie ondersteunen, `get-task-allow=false` en productie-APNs toestaan. Development/ad-hoc (ook een lege `ProvisionedDevices`-sleutel), enterprise, wildcard-app-ID, ontbrekende distributiemarker, verkeerde/verlopen middelen worden geweigerd. Een bestaande App ID-prefix mag afwijken van Team ID; beide worden onafhankelijk gecontroleerd.
- Tijdelijke keychain met willekeurig, alleen in geheugen gehouden wachtwoord; restrictieve directory-/bestandsrechten. `security find-identity -v -p codesigning` moet de geïmporteerde SHA-1-identiteit als geldig herkennen. Een onvolledige/onbetrouwbare certificaatketen stopt de run. Gebruik de bestaande volledige keten; geen automatische certificaataanvraag.
- Alleen het eigen profiel-UUID wordt in de legacy- en moderne Xcode-profieldirectory geïnstalleerd. Eventuele bestaande bestanden worden met inhoud en rechten hersteld. Andere profielen blijven intact. De vorige keychainzoeklijst wordt hersteld; de standaardkeychain wordt niet gewijzigd.
- **Release** is op project- en targetniveau `Manual` / `Apple Distribution`. Debug behoudt sandbox-APNs; Release gebruikt `App-Store.entitlements` met expliciet productie-APNs en dezelfde Associated Domains. Debug-PersonalTeam blijft zonder capabilities. Er wordt niet vertrouwd op een automatische entitlementsomzetting bij export. Commandoregel pinnt het gevalideerde Distribution-certificaat op zijn SHA-1-identiteit en team. Alleen de app-target consumeert `RINGTOOLS_DISTRIBUTION_PROFILE_UUID` als `PROVISIONING_PROFILE_SPECIFIER`; Swift Package-frameworks krijgen geen ongeschikt globaal profiel of overschreven Bundle ID. De app-Bundle ID blijft vast in de Release-target en wordt opnieuw gecontroleerd. Dezelfde identiteit en expliciete Bundle ID→profielmapping staan in de handmatige `app-store-connect`-exportopties. SHA-1 is hier de Xcode-identificator, geen wachtwoordhash of vertrouwensbeslissing.
- Geen provisioningupdates, apparaatregistratie of App Store Connect-authenticatie in archive/export. Geen API die certificaten of profielen aanmaakt. Signing zonder middelen faalt; geen automatische fallback.
- Archive **en** IPA vereisen een geldige strikte codesignhandtekening, Apple Distribution, dezelfde geselecteerde certificaatvingerafdruk, matching profiel/certificaat/team/appidentiteit, App Store-distributie, geen debuggerrechten, productie-APNs, `applinks:ringapeldoorn.nl`, `webcredentials:ringapeldoorn.nl`, correcte Bundle ID/versie/build en `PrivacyInfo.xcprivacy`.
- Alleen de expliciete uploadstap krijgt de bestaande ASC-secrets en schrijft tijdelijk de P8 in de door `altool` ondersteunde `./private_keys`-directory. De sleutel wordt niet aan Xcode doorgegeven. De bestaande APNs-serverconfiguratie en sleutels blijven ongewijzigd.
- `always()` herstelt profielen/zoeklijst en verwijdert de tijdelijke keychain, P12, P8, archive, IPA en werkdirectory, ook bij fouten. Cleanup probeert alle herstelacties; een mislukte herstelactie maakt de run rood en houdt het hersteljournaal voor een tweede poging beschikbaar. Bij een hard beëindigde runner is expliciete cleanup niet gegarandeerd; GitHub vernietigt de tijdelijke hosted runner. Geen self-hosted runner gebruiken zonder apart beoordeeld herstelbeleid.
- Geen ruwe `security`-/Xcode-/altool-uitvoer of distributionlogs in CI/artifacts. Fouten geven uitsluitend een generieke categorie. Voor nadere diagnose uitsluitend veilige lokale inspectie door de eigenaar, nooit bestanden/wachtwoorden/identiteiten in chat, issues, PR's of logs plaatsen.

## Environment secrets `testflight`

| Secret | Inhoud / gebruik |
|---|---|
| `IOS_TEAM_ID` | Bestaande tien tekens lange Apple Team ID; geen voorbeeldwaarde overnemen |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 van de bestaande wachtwoordbeveiligde `AppleDistribution.p12` |
| `IOS_DISTRIBUTION_P12_PASSWORD` | Het bestaande P12-wachtwoord, ongewijzigd |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64 van `Ringtools_App_Store_Distribution.mobileprovision` |
| `ASC_KEY_ID` | Bestaande sleutelidentificatie; alleen bij goedgekeurde upload |
| `ASC_ISSUER_ID` | Bestaande issuer; alleen bij goedgekeurde upload |
| `ASC_API_KEY_P8_BASE64` | Bestaande P8, base64; alleen bij goedgekeurde upload |

Geen nieuwe API-sleutel of bredere provisioningrechten nodig. Beoordeel als eigenaar de bestaande ASC-rechten voor upload; geen automatisch accountbeheer. Geen secretwaarden in documentatie, appvariabelen, broncode of review.

## Windows: bestaande bestanden rechtstreeks naar secrets

Voer dit alleen als eigenaar uit op een vertrouwde Windows-machine, buiten de repository, zonder transcriptie/schermopname. Installeer/controleer GitHub CLI vooraf, meld aan en controleer account/repository met `gh auth status` en `gh repo view rjgout/Ringtools`. Configureer eerst de beschermde environment. Bewaar de originele bestanden en beveiligde reservekopie. Deel ze niet met Codex. De voorbeelden bevatten alleen lokale voorbeeldpaden; vervang uitsluitend die paden.

PowerShell: base64 rechtstreeks via stdin naar `gh secret set`. Geen `--body` met secretwaarden, geen consoleprint of tussenbestand:

```powershell
$ErrorActionPreference = 'Stop'
Get-Command gh -ErrorAction Stop | Out-Null

function Set-RingtoolsFileSecret([string]$Name, [string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    try {
        $encoded = [Convert]::ToBase64String($bytes)
        if ($encoded.Length -gt 64000) { throw 'Bestand te groot voor een GitHub secret; stop en beoordeel lokaal.' }
        $encoded | gh secret set $Name --repo rjgout/Ringtools --env testflight
        if ($LASTEXITCODE -ne 0) { throw 'GitHub secret instellen mislukt.' }
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $encoded = $null
        $bytes = $null
    }
}
Set-RingtoolsFileSecret 'IOS_DISTRIBUTION_P12_BASE64' 'C:\BeveiligdeSigning\AppleDistribution.p12'
Set-RingtoolsFileSecret 'IOS_PROVISIONING_PROFILE_BASE64' 'C:\BeveiligdeSigning\Ringtools_App_Store_Distribution.mobileprovision'

$password = Read-Host 'Bestaand P12-wachtwoord' -AsSecureString
$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    # Schrijf exact het wachtwoord: geen BOM of door PowerShell toegevoegde newline.
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command gh -ErrorAction Stop).Source
    $startInfo.Arguments = 'secret set IOS_DISTRIBUTION_P12_PASSWORD --repo rjgout/Ringtools --env testflight'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.StandardInputEncoding = New-Object Text.UTF8Encoding($false)
    $secretProcess = New-Object Diagnostics.Process
    $secretProcess.StartInfo = $startInfo
    try {
        $secretProcess.Start() | Out-Null
        $secretProcess.StandardInput.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
        $secretProcess.StandardInput.Close()
        $secretProcess.WaitForExit()
        if ($secretProcess.ExitCode -ne 0) { throw 'P12-wachtwoordsecret instellen mislukt.' }
    } finally {
        $secretProcess.Dispose()
    }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $password.Dispose()
    $password = $null
}
```

PowerShell/.NET gebruikt kortstondig managed strings die niet gegarandeerd onmiddellijk uit geheugen gewist worden; voer dit daarom uitsluitend op de vertrouwde eigenaarmachine uit en sluit de sessie daarna. De invoer verschijnt niet in shellgeschiedenis of console. Gebruik geen clipboard met ingeschakelde geschiedenis/synchronisatie en geen commando met een letterlijk wachtwoord. Controleer uitsluitend de **namen** met `gh secret list --repo rjgout/Ringtools --env testflight`. Stel ontbrekende `IOS_TEAM_ID` als eigenaar via de beveiligde environmentinterface in; controleer bestaande ASC-secrets pas voor een afzonderlijk goedgekeurde upload. Codex wijzigt geen secrets.

## Synthetische macOS-formaatbevinding

De eerste macOS-policy-CI op commit `805f0ba` wees de synthetische AES256-SHA256-export veilig af ([run 43206742004](https://github.com/rjgout/Ringtools/actions/runs/43206742004)). De regressies bevatten daarom ook een **verplicht geslaagde** tijdelijke import van een synthetische TripleDES-SHA1-P12 en een verplicht geweigerd verkeerd wachtwoord. Daarmee wordt onderscheid gemaakt tussen een defecte importopdracht en AES-compatibiliteit. Alleen de synthetische formaatproef mag afwijzen zonder de policy-CI rood te maken; de echte eigenaar-importcontrole faalt dan altijd en levert geen importbewijs op.

Als de afzonderlijk toegestane controle de echte AES-export afwijst, kan de eigenaar na expliciete beoordeling hetzelfde bestaande certificaat mét dezelfde privésleutel vanuit de Windows-certificaatopslag herverpakken. Bijvoorbeeld, uitsluitend lokaal op de vertrouwde eigenaarmachine, met een nieuw sterk exportwachtwoord en een beveiligde doelmap:

```powershell
$thumbprint = Read-Host 'Thumbprint van het bestaande Distribution-certificaat (alleen lokaal)'
$certificate = Get-Item ('Cert:\CurrentUser\My\' + $thumbprint)
if (-not $certificate.HasPrivateKey) { throw 'Bestaande privésleutel ontbreekt; stop.' }
$exportPassword = Read-Host 'Sterk wachtwoord voor compatibele tijdelijke export' -AsSecureString
try {
    Export-PfxCertificate -Cert $certificate `
        -FilePath 'C:\BeveiligdeSigning\AppleDistribution-compatible.p12' `
        -Password $exportPassword -CryptoAlgorithmOption TripleDES_SHA1 -ChainOption BuildChain |
        Out-Null
} finally {
    $exportPassword.Dispose()
}
```

Dit vraagt geen nieuw Apple-certificaat aan en wijzigt geen bestaand certificaat/profiel. TripleDES-SHA1 is een ouder interoperabiliteitsformaat; gebruik het uitsluitend voor deze versleutelde overdracht, met een sterk uniek wachtwoord, beschermde opslag en beperkte bewaartijd. Er vindt geen stille downgrade in CI plaats. De eigenaar vervangt daarna bewust de P12- en wachtwoordsecret via bovenstaande stdin-procedure en herhaalt de importcontrole. Bewaar de bestaande beveiligde oorspronkelijke reservekopie. Gebruik geen `-nodes`/onversleutelde PEM-export. De feitelijke eigenaarbestanden kunnen pas na afzonderlijke toestemming worden beoordeeld.

## Exacte eigenaarshandelingen en open acceptatie

1. Laat deze draft-PR onafhankelijk reviewen, inclusief workflowrechten, Xcode Release-configuratie, testuitvoer en cleanup. Geen merge zonder expliciet akkoord; een merge naar `main` heeft ook Docker/Watchtower-impact.
2. Richt de environmentbescherming en drie nieuwe secrets hierboven in; bevestig de bestaande Team ID. Geen nieuwe certificaten/profielen maken of intrekken.
3. Geef **afzonderlijk toestemming uitsluitend voor de niet-publicerende importcontrole**. Na toegestane merge: Actions → *iOS signing importcontrole (geen build of upload)* → `main` → `import_authorized=true`; keur het environmentverzoek goed. Controleer resultaat **en cleanup**, noteer run-ID. Dit is de eerste test met de echte Windows AES256-SHA256-export.
4. Bij afwijzing stopt alles. Controleer lokaal wachtwoord, exportformaat, certificaatgeldigheid/team/profielmatching en keten. Geen automatische algoritmedowngrade of nieuwe Apple-certificaten. Als macOS het Windows-AES-formaat afwijst, kan de eigenaar na aparte beoordeling dezelfde bestaande sleutel/certificaat opnieuw als compatibele wachtwoordbeveiligde P12 exporteren (inclusief bestaande keten). Dit is herverpakken, geen certificaatproductie. Geen onversleutelde privésleutelbestanden gebruiken. Beveilig de nieuwe export en verwijder overtollige kopieën. Vervang zo nodig uitsluitend de betreffende secrets en herhaal de importcontrole.
5. Geef pas na succesvolle importcontrole afzonderlijk toestemming voor een **echte signingbuild**. Start *iOS TestFlight (handmatig)* op dezelfde commit met run-ID, `signing_authorized=true`, juiste HTTPS-URL, versie en uniek oplopend buildnummer; **laat upload uit**. Keur de environmentaanvraag opnieuw goed. Archive/export mogen geen Development-identiteit of automatische provisioning gebruiken.
6. Upload alleen na nogmaals expliciete toestemming: `upload=true` maakt de drie ASC-secrets beschikbaar en voert `altool` uit na alle controles. Een nieuwe workflow-run bouwt opnieuw; gebruik een nieuw buildnummer. Geen automatische TestFlight-upload/App Store-publicatie.
7. Fysieke acceptatie na een later goedgekeurde TestFlight-upload: iPhone én iPad, productieserverpush/APNs, universal links/native passkeys, MFA/Face ID en privacybescherming. Deze opdracht verandert geen appfunctionaliteit of Android-configuratie en claimt geen fysieke acceptatie.

## Regressiecommando's

```bash
python3 -m pip install -r mobile/scripts/signing-requirements.txt
python3 -m unittest discover -s mobile/scripts -p 'test_*signing*.py' -v
python3 mobile/scripts/test_verify_ios_bundle.py -v
cd mobile
npm ci
npm test
npm run build
npm run check:native-config
```

Gewone `mobile-ci.yml` behoudt simulatorbuilds, de ad-hoc gesigneerde simulatorconfiguratiecontroles en een **ongesignede** Release-archive. De nieuwe policy-CI draait op Linux en macOS met nul signingsecrets. De synthetische AES-import is uitsluitend een formaatproef met een zelfondertekend testcertificaat en publiceert geen sleutel. Echte owner-P12-compatibiliteit, Apple-vertrouwen en App Store-acceptatie blijven open tot de afzonderlijk geautoriseerde controles hierboven. Er is geen databasewijziging; rollback van deze PR vraagt geen datamigratie. Terugzetten naar automatische signing is geen geaccepteerde fallback.
