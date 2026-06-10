# ✈ Travel Planner

A client-side web application that lets users search for tourist attractions in any city, filter results by category, and build a personal Trip List — all without a backend or API key.

🌐 **Live demo:** [https://pablitoCM.github.io/travel-planner/](https://pablitoCM.github.io/travel-planner/)

---

## Project Structure

```
travel-planner/
├── index.html        ← Page structure: layout, modals, form
├── README.md         ← This file
└── code/
    ├── style.css     ← All styles (variables, layout, components)
    └── app.js        ← All application logic (14 annotated sections)
```

---

## Features

| Feature | Description |
|---|---|
| City search | Type any city name and get real tourist attractions |
| Category filter | Filter by Museums, Historic, Nature, Religious, and more |
| Sort results | Sort A→Z, Z→A |
| Trip List | Save and remove places, persisted across page reloads |
| Detail modal | Coordinates, opening hours, fee info + Google Maps / OSM links |
| Custom places | Add your own places via form with input validation |
| API cache | Results cached 10 min in LocalStorage — no redundant requests |
| No API key | 100% free, works out of the box |

---

## APIs Used

Both APIs are completely free and require no registration or API key.

| API | Purpose | Docs |
|---|---|---|
| [Nominatim](https://nominatim.openstreetmap.org) | Converts city name → coordinates + bounding box | [docs](https://nominatim.org/release-docs/develop/api/Search/) |
| [Overpass API](https://overpass-api.de) | Returns Points of Interest from OpenStreetMap | [docs](https://wiki.openstreetmap.org/wiki/Overpass_API) |

---

## Design Decisions

**Overpass API instead of OpenTripMap**
OpenTripMap was originally chosen but changed its policy to require a paid API key mid-development. The Overpass API (OpenStreetMap) was selected as a replacement: genuinely free, no key needed, and richer metadata (opening hours, phone, Wikipedia links).

**Client-side filtering**
Changing the category filter does not trigger a new API call. The full result set is kept in memory and filtered instantly using predicate functions (`FILTER_MATCHERS`). This gives instant feedback and avoids unnecessary API requests.

**LocalStorage cache with TTL**
Results are cached under the key `tp_cache_<city>_<category>` with a 10-minute TTL. This reduces API requests on repeated searches and keeps the app responsive on slow connections.

**No framework, no build step**
Pure HTML + CSS + JS. The app runs in any browser from a local server or the GitHub Pages URL with zero configuration.

**HTML escaping on all API data**
All place names and descriptions from the API are passed through `escHtml()` before being injected into `innerHTML`, preventing XSS if a place name contains special characters.

---

## 📋 Requirements

- Any modern browser (Chrome, Firefox, Edge, Safari)
- Internet connection (to reach Nominatim and Overpass API)
- No API keys · No npm · No build tools

---

*Politechnika Krakowska — Problem Solving — Academic Year 2025/2026*
