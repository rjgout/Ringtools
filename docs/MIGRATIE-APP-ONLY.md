# Migratie naar app-first / app-only

Doel: Ringtools wordt een volwaardige native app (iOS + Android). De publieke website wordt een uithangbord; alleen een streng beveiligde
technische beheeromgeving voor `webmin` blijft via het web bestaan. **Deze migratie verloopt gefaseerd. De definitieve omschakeling
(web-login voor gewone gebruikers uit) gebeurt uitsluitend na een afzonderlijke, expliciete opdracht van de eigenaar.**

## Fasen en status

| Fase | Inhoud | Status |
|---|---|---|
| A | Alle roepings- en taakfunctionaliteit in de app | in uitvoering |
| B | Gebruikers- en ringbeheer; veilige webmin-login in de app | gepland |
| C | Native passkeys; uitnodigings- en activatieprocedure | gepland |
| D | Ontheffingen (eigen module en datamodel) | gepland |
| E | Publieke informatieve website; voorbereiding uitschakelen web-login (feature flag, standaard UIT) | gepland |
| F | Live acceptatie iPhone/Android; daarna eventuele storepublicatie | gepland (handmatig, eigenaar) |

## Overgangsfase (nu)
De webapp blijft bereikbaar voor bestaande gebruikers. De app krijgt alle functionaliteit. Checklist voor de omschakeling (alles moet
aantoonbaar waar zijn): alle reguliere functies werken in de app · native MFA werkt · gebruikers zonder technische kennis kunnen installeren ·
nieuwe gebruikers kunnen worden uitgenodigd en geactiveerd · e-maillinks werken · iOS én Android beschikbaar voor de doelgroep ·
betrouwbare herstelprocedure bij verlies van een toestel.

## Resterende blokkades per fase
Wordt na elke fase bijgewerkt (zie hieronder).
