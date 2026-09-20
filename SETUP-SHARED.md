# Het gedeelde Planboard activeren

Voor de update met instellen vanuit de site en publicatie zonder lokale Node-installatie: zie [UPDATE-2026-09-10.md](UPDATE-2026-09-10.md). De onderstaande stappen met zelf gegenereerde sleutels zijn de oudere, optionele beheerroute.

De bestaande link blijft **https://planbord-285.pages.dev/**.
De nieuwe code is lokaal voorbereid. Deze handleiding koppelt de gedeelde database en achtergrondmeldingen; alleen bestanden uploaden activeert die diensten niet.

## 1. Cloudflare D1-database

Open Cloudflare → **Storage & databases → D1 SQL Database → Create database**.
Noem de database `planboard`. Noteer de **Database ID**.
Open de SQL-console van de database en voer de inhoud van `server/schema.sql` uit.
De statements gebruiken CREATE IF NOT EXISTS en wissen geen bestaande gegevens.

## 2. Database aan de bestaande Pages-site koppelen

Open **Workers & Pages → planbord-285 → Settings → Bindings → Add → D1 database**.
Gebruik als bindingnaam exact **DB** en selecteer de database `planboard`.
Gebruik de productieomgeving. Een previewomgeving krijgt een aparte testdatabase als je die later wilt gebruiken.

Cloudflare-documentatie: https://developers.cloudflare.com/pages/functions/bindings/

## 3. Uitnodigingscode en pushsleutels

Voer in de projectmap uit met Node.js:

```powershell
node tools/generate-push-keys.cjs
```

Dit toont vier waarden. Bewaar die veilig. Zet de waarden nooit in een GitHub-bestand of screenshot.

In de Pages-instellingen onder **Variables and Secrets**:

| Naam | Waarde | Type |
| --- | --- | --- |
| WORKSPACE_CODE | De gegenereerde uitnodigingscode | Secret |
| ADMIN_CODE | Een apart, sterk adminwachtwoord voor accounts beheren | Secret |
| VAPID_PUBLIC_KEY | De gegenereerde publieke sleutel | Text |
| VAPID_PRIVATE_JWK | Het volledige JSON-object, inclusief accolades | Secret |
| PUSH_SUBJECT | https://planbord-285.pages.dev | Text |

De uitnodigingscode deel je alleen met collega's die toegang mogen krijgen.
Iedere deelnemer heeft dezelfde rechten om projecten en teams te wijzigen.
Een team is een filter/ontvangersgroep, geen beveiligde subruimte.

## 4. Bestanden uploaden naar GitHub

Pak `planboard-shared-upload.zip` uit en upload de inhoud naar de bestaande repository **tomvanoosten/Planbord**.
Upload de ZIP zelf niet als website. Behoud de mappenstructuur:

```text
index.html
styles.css
board-core.js
app.js
teams.js
shared.js
sw.js
_routes.json
_headers
functions/api/[[path]].js
server/backend.mjs
server/push.mjs
server/schema.sql
worker/reminders.mjs
worker/wrangler.jsonc
tools/generate-push-keys.cjs
```

In Pages blijft de build command leeg en de outputdirectory `/`.
De `functions`-map wordt door Pages automatisch als servercode gebouwd.
Wacht op een geslaagde nieuwe deployment nadat bindings en variabelen zijn ingesteld.

## 5. Achtergrondtaak installeren

Dit is een extra Worker naast de bestaande Pages-site; je webadres verandert niet.
Vervang in `worker/wrangler.jsonc` de tekst `REPLACE_WITH_YOUR_D1_DATABASE_ID` door de Database ID van stap 1.

Installeer zo nodig Node.js met npm en open een terminal in de projectmap:

```powershell
npx wrangler login
npx wrangler deploy --config worker/wrangler.jsonc
```

Dit maakt **planboard-reminders** met een controle iedere minuut.
De taak gebruikt dezelfde D1-database. In de instellingen van deze Worker voeg je dezelfde pushwaarden toe:

- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_JWK (Secret)
- PUSH_SUBJECT

De Worker heeft geen WORKSPACE_CODE nodig: hij gebruikt rechtstreeks de database.
Zet geen private sleutel in `wrangler.jsonc`.

De taak verwerkt maximaal vijf nieuwe alarmen en vijf pushpogingen per minuut om het aantal bewerkingen per uitvoering beperkt te houden. Een grote stapel verlopen herinneringen wordt over meerdere minuten verwerkt.

Cloudflare-documentatie: https://developers.cloudflare.com/workers/configuration/cron-triggers/

## 6. Eerste keer verbinden

1. Open https://planbord-285.pages.dev/ en vernieuw met Ctrl+F5.
2. Klik **Gastprofiel / verbinden**.
3. Vul je naam en uitnodigingscode in.
4. Het gedeelde bord start leeg, met de standaardkolommen.
5. Wil je je eerdere projecten meenemen? Open je profiel en kies **Lokaal bord overnemen**. Dit voegt de lokale kolommen en projecten toe. De bestaande gedeelde projecten blijven behouden.
6. Maak teams via **Teams beheren**. Via je gastprofiel vink je de teams aan waartoe je wilt behoren.
7. Klik **Meldingen inschakelen** en geef de browser toestemming.

Iedereen hoort automatisch bij **Iedereen**. Een project kan een team hebben voor het filter bovenaan; de ontvangers van zijn herinneringen stel je apart in.
Iedere herinnering staat standaard op Iedereen. Je kunt meerdere teams en/of individuele collega's kiezen.
Wie in twee gekozen teams zit, krijgt dezelfde herinnering één keer in het meldingenoverzicht.

Het gastprofiel wordt met een beveiligde browsercookie onthouden. Een andere browser of het wissen van cookies maakt een nieuw profiel; het is geen pc- of hardware-identificatie. Bij herstel op een ander apparaat is op dit moment opnieuw deelnemen nodig.

## 7. Samen controleren

- Open de site in twee aparte browsers en meld je aan met verschillende namen.
- Voeg een project toe; de andere browser moet dit normaal binnen ongeveer vijf seconden zien.
- Maak een team en laat slechts één profiel aansluiten.
- Stel een alarm over een paar minuten in en selecteer alleen dat team.
- Controleer dat alleen dat profiel de melding krijgt.
- Controleer ook een alarm aan Iedereen en twee overlappende teams.
- Markeer een melding als gelezen: dit mag de melding bij een collega niet als gelezen markeren.
- Test een wijziging terwijl iemand anders een project bewerkt: bij een conflict verschijnt een herstelvenster en wordt geen werk stilletjes overschreven.
- Activeer desktopmeldingen, sluit de tab en test een gepland alarm. Controleer bij geen popup ook de browserinstellingen, Windows Niet storen en de logs van de Worker.

## Grenzen van meldingen

De server kan een herinnering produceren terwijl de site gesloten is. Pushbezorging blijft afhankelijk van de browser, OS-instellingen, internet en achtergrondprocessen. Als de pc uit staat of de browser geen achtergrondpush ondersteunt, kan de popup later komen.
Het persoonlijke meldingenoverzicht bewaart de herinnering wel. Er is geen e-mail- of sms-kanaal.

In-app popups sluiten na vijf seconden. Desktoppopups vragen om hetzelfde, maar een browser kan een service worker eerder stoppen of zijn eigen weergaveduur kiezen.
Geselecteerde teams worden op het moment van het alarm naar personen vertaald; later toetreden geeft geen oude teammeldingen.

Je kunt op gratis Cloudflare-diensten beginnen binnen hun limieten. Dit is geen garantie op onbeperkt gratis gebruik: polling, databasegebruik en pushpogingen tellen mee. Er is geen betaald plan geactiveerd door deze code.

## Reservekopieën en conflicten

Lokale gegevens worden vóór de eerste verbinding bewaard in deze browser.
Bij een opslagconflict kun je je lokale versie als JSON downloaden voordat je de gedeelde versie laadt.
De code biedt nog geen algemene JSON-import of gebruikersbeheer om profielen te verwijderen.
Een mislukte opslag blijft als herstelkopie in de browser aanwezig; het gedeelde bord wordt niet automatisch met een oude versie overschreven.

## Verificatie door de ontwikkelaar

```powershell
node --test tests.cjs server/backend.test.mjs
```

De controles gebruiken Node.js en een lokale SQLite-database. Cloudflare-deployment en echte pushbezorging moeten na koppeling van het account nog met twee browsers worden gecontroleerd.
