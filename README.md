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

1. **Zorg voor een domein/subdomein met HTTPS** (aanbevolen, nodig zodat de
   WhatsApp-links overal werken): stel in DSM een reverse proxy in
   (Configuratiescherm → Aanmeldingsportaal → Geavanceerd → Reverse Proxy) die
   bijvoorbeeld `https://ringpresidium.jouwdomein.nl` doorstuurt naar
   `http://<NAS-IP>:3000`, met een Let's Encrypt-certificaat.
2. Ga in **Portainer** naar **Stacks → Add stack**.
3. Kies **Repository** als bron en vul de git-URL van deze repository in
   (branch `main`), of plak de inhoud van `docker-compose.yml` onder **Web editor**.
4. Vul de environment variables in (zie `.env.example` voor uitleg per variabele):
   - `APP_BASE_URL`: de HTTPS-URL uit stap 1 — hiermee worden de WhatsApp-links
     opgebouwd.
   - `SESSION_SECRET`: verzin een lange, willekeurige tekst.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD`: het admin-account. Standaard
     `webmin` / `ldstools123!` — **verander dit wachtwoord** zodra de app draait
     door de environment variable aan te passen en de stack te herstarten.
   - `SMTP_*` en `MAIL_FROM`: nodig voor de 30-dagen-melding. Leeg laten mag,
     dan wordt er alleen niet automatisch gemaild/opgeruimd totdat je dit invult.
5. Klik op **Deploy the stack**. Portainer bouwt de image en start de container.
6. Open de app via je domein en log in met het admin-account. Maak daarna via
   **Gebruikers** de accounts voor de ringpresidiumleden aan.

De data staat in het volume `ringpresidium_data` (bestand `/app/data/db.json`
in de container) en blijft bewaard bij het updaten/herstarten van de stack.

## Back-up

Maak af en toe een kopie van het volume `ringpresidium_data` (bijvoorbeeld via
Synology's Hyper Backup op de Docker-volumemap), zodat de lijst met
hogeraadsleden en gebruikersaccounts niet verloren gaat.
