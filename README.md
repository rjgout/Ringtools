# Ringtools — Ringpresidium webapp

Webapp voor het ringpresidium om roepingen (naam + functie) aan te maken,
via een WhatsApp-link door de hogeraad te laten steunen (of niet), en de
afhandeling daarvan bij te houden.

## Functionaliteit

- **Inloggen**: alleen accounts die de admin heeft aangemaakt kunnen inloggen.
- **Admin** (`webmin` / `ldstools123!` als startwaarde, zie hieronder): beheert
  de inlogaccounts van het ringpresidium (gebruikersnaam, wachtwoord, e-mail).
- **Ringpresidium**: beheert de lijst met hogeraadsleden, maakt roepingen aan
  (naam + functie) en krijgt daarbij een unieke link om te delen via WhatsApp.
- **Openbare stempagina** (`/vote/:token`): degene die de link opent kiest zijn/haar
  eigen naam uit de lijst van hogeraadsleden en klikt op "Ik steun" of "Ik steun
  niet". Daarna verschijnt een bedankpagina.
- Het ringpresidium kan reacties ook **handmatig invoeren** namens iemand
  (bijvoorbeeld na een telefoontje).
- Zodra iedereen op de lijst gereageerd heeft, verschijnt de roeping onder
  **"Te verwerken"**. Het ringpresidium klikt daar op **"Markeer als verwerkt"**,
  waarna de roeping definitief verwijderd wordt.
- Is een roeping **30 dagen** nadat iedereen gereageerd heeft nog niet verwerkt,
  dan krijgt iedereen met een ringpresidium-account een e-mail met een overzicht,
  en wordt de roeping daarna automatisch verwijderd. (Als er geen e-mailserver is
  ingesteld, wordt er niets verwijderd totdat dat wel het geval is — zo gaat er
  nooit stilletjes data verloren.)

## Techniek

- Node.js + Express, server-rendered met EJS (geen build-stap nodig).
- Data wordt opgeslagen in één JSON-bestand (`data/db.json`), geen aparte
  database nodig. Voldoende voor de schaal van een ringpresidium.
- Geen native/binaire dependencies — draait zonder problemen op elke
  Synology-architectuur (ARM of x86) via Docker.

## Lokaal draaien (ontwikkeling)

```bash
cp .env.example .env
npm install
npm run dev
```

De app draait dan op http://localhost:3000. Log in met `webmin` /
`ldstools123!` (of de waarden die je in `.env` hebt gezet).

## Draaien op je Synology NAS via Portainer

### Stap 1 — Mappen aanmaken op de NAS

De app slaat alle gegevens op in één map (`/app/data` in de container), die we
koppelen aan een echte map op je NAS zodat je hem terugziet in File Station en
kunt back-uppen.

1. Open **File Station** op je Synology.
2. Zorg dat er een gedeelde map `docker` bestaat (die heb je meestal al als je
   Container Manager/Docker eerder hebt gebruikt). Zo niet: **Shared Folder** →
   **Create** → naam `docker`.
3. Maak daarin de map **`docker/ringpresidium/data`** aan (dus: open `docker`,
   maak submap `ringpresidium`, daarin submap `data`).

Dat is de enige map die je hoeft aan te maken — de app zet zelf zijn
databasebestand (`db.json`) in die map neer zodra hij voor het eerst opstart.

Let op: als jouw NAS-volume niet `volume1` heet (te zien bovenin File Station,
bijvoorbeeld `volume2` of `volume3`), pas dat dan hieronder in stap 3 aan.

### Stap 2 — Domein/HTTPS instellen (aanbevolen)

Nodig zodat de WhatsApp-links overal werken, niet alleen thuis. Stel in DSM
een reverse proxy in: **Configuratiescherm → Aanmeldingsportaal → Geavanceerd
→ Reverse Proxy**, die bijvoorbeeld `https://ringpresidium.jouwdomein.nl`
doorstuurt naar `http://<NAS-IP>:3000`, met een Let's Encrypt-certificaat
(**Configuratiescherm → Beveiliging → Certificaat**).

### Stap 3 — Stack aanmaken in Portainer

1. Open **Portainer** en ga naar **Stacks → Add stack**.
2. Geef de stack een naam, bijvoorbeeld `ringpresidium`.
3. Kies bij **Build method**:
   - **Repository** (aanbevolen): vul de git-URL van deze repository in bij
     *Repository URL*, en `claude/ringpresidium-webapp-veccye` (of `main`,
     zodra het daarheen gemerged is) bij *Repository reference branch*.
     Portainer haalt de code op en bouwt de image zelf via de `Dockerfile`.
   - **Web editor**: plak dan de inhoud van `docker-compose.yml` uit deze
     repository. Let op: bij deze methode moet je zelf de projectbestanden nog
     ergens op de NAS zetten en `build: .` vervangen door een pad daarnaartoe,
     dus de Repository-methode is eenvoudiger.
4. Vul onderin bij **Environment variables** de volgende waarden in (zie ook
   `.env.example` in de repository voor uitleg per variabele):

   | Naam | Waarde |
   |---|---|
   | `APP_BASE_URL` | `https://ringpresidium.jouwdomein.nl` (je domein uit stap 2) |
   | `SESSION_SECRET` | een lange, zelfverzonnen willekeurige tekst |
   | `COOKIE_SECURE` | `true` (staat al goed als je HTTPS gebruikt) |
   | `ADMIN_USERNAME` | `webmin` (of iets anders) |
   | `ADMIN_PASSWORD` | `ldstools123!` (**verander dit** na de eerste keer inloggen) |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | voor de 30-dagen-mail; mag je (voorlopig) leeg laten |

   Als je de Web editor-methode gebruikt, staan deze al als voorbeeldwaarden in
   `docker-compose.yml` — pas ze daar direct aan in plaats van los als
   environment variables.
5. Controleer dat het volume-pad in `docker-compose.yml` overeenkomt met de map
   uit stap 1, dus: `/volume1/docker/ringpresidium/data:/app/data` (pas
   `volume1` aan indien nodig).
6. Klik op **Deploy the stack**. Portainer bouwt de image (dit kan de eerste
   keer een paar minuten duren) en start de container.
7. Controleer via **Containers → ringpresidium → Logs** of je de regel
   `[server] Ringpresidium-tool draait op poort 3000` ziet.
8. Open de app via je domein (of `http://<NAS-IP>:3000` zonder reverse proxy)
   en log in met het admin-account. Maak daarna via **Gebruikers** de accounts
   voor de ringpresidiumleden aan, en voeg via **Hogeraad** de hogeraadsleden toe.

### Bijwerken naar een nieuwe versie

Ga in Portainer naar de stack → **Pull and redeploy** (bij de Repository-
methode) of **Update the stack** (bij Web editor, na het aanpassen van de
inhoud). Je data in de `data`-map blijft altijd staan; alleen de
applicatiecode wordt vervangen.

## Back-up

Neem de map `/volume1/docker/ringpresidium/data` (met daarin `db.json`) mee in
je Synology Hyper Backup-taak, zodat de lijst met hogeraadsleden,
gebruikersaccounts en openstaande roepingen niet verloren gaat.
