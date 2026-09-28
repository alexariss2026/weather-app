# Isobar

## Français

Isobar est un tableau de bord des conditions météo dans le monde. Il sert à voir, d’un coup d’œil, la température, le vent et la probabilité de pluie pour des villes réparties sur la planète, avec une couverture large de l’Afrique — Afrique centrale, Gabon, Cameroun et les deux Congo compris.

La page suit le dessin d’origine : une liste, une carte, et le détail de la ville choisie. Les mesures viennent d’[Open-Meteo](https://open-meteo.com/), un service météo ouvert. Ce serveur est le seul à l’appeler. L’écran est en français par défaut ; l’anglais est le second choix, via le bouton EN.

Une lecture réussie est gardée dix minutes, puis rafraîchie. Si Open-Meteo ne répond plus, la dernière lecture reste affichée et l’en-tête indique l’heure du cache. S’il n’y a encore aucune lecture, la page dit « Indisponible » et réessaie. Elle n’invente pas de température. La carte montre le jour et la nuit selon la position réelle du soleil. La pluie, les nuages, la neige ou le soleil dans le panneau correspondent au code météo de la ville affichée.

```bash
npm start
```

Ouvrir http://localhost:3000

```bash
npm test
```

Ce projet a été réalisé par Arissani Sambouni Alex, élève gabonais en classe de Terminale, passionné d’informatique. Il reflète son sérieux et son envie d’apprendre en construisant un outil réel, branché sur des données en direct.

- Courriel : alexarissani10@gmail.com
- Téléphone : +241 04 69 34 98

## English

Isobar is a dashboard of weather conditions around the world. It is for reading temperature, wind, and the chance of rain across cities on every continent, with broad coverage of Africa — including Central Africa, Gabon, Cameroon, and both Congos.

The screen keeps the original layout: a city list, a map, and the selected city’s forecast. The readings come from [Open-Meteo](https://open-meteo.com/), an open weather service. This server is the only caller. French is the primary language; English is the secondary one, chosen with the EN control.

A successful reading is kept for ten minutes, then refreshed. If Open-Meteo stops answering, the last reading stays up and the header shows when it was fetched. If there has never been a reading, the page says Unavailable and retries. It does not invent temperatures. The map shades night from the real position of the sun. Rain, cloud, snow, or sun in the side panel follows the weather code of the city on screen.

```bash
npm start
```

Open http://localhost:3000

```bash
npm test
```

This project was built by Arissani Sambouni Alex, a Gabonese student in Terminale, passionate about IT. It reflects his dedication and his drive to learn by building a real tool on live data.

- Email: alexarissani10@gmail.com
- Phone: +241 04 69 34 98

Have fun
