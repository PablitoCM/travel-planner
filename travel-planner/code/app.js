// ================================================
// TRAVEL PLANNER — app.js
// ================================================
// Sections:
//   1. CONFIG & CONSTANTS
//   2. STATE
//   3. API — Overpass (OSM) + Nominatim (100% free, no key)
//   4. CACHE (LocalStorage)
//   5. RENDER — results
//   6. RENDER — trip list
//   7. MODAL — detail view
//   8. CUSTOM PLACE FORM
//   9. FILTERS & SORT
//   10. SEARCH FLOW
//   11. TOAST
//   12. EVENT LISTENERS
//   13. INIT
//   14. UNIT TESTS  →  run  runTests()  in browser console
// ================================================


// ---- 1. CONFIG & CONSTANTS ----

// Nominatim: geocode city name → lat/lon (free, no key)
const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
// Overpass: query POIs from OpenStreetMap (free, no key)
const OVERPASS_API  = "https://overpass-api.de/api/interpreter";

const CACHE_PREFIX  = "tp_cache_";
const CACHE_TTL_MS  = 10 * 60 * 1000;   // 10 minutes

// OSM tag value → human-readable label
const TAG_LABELS = {
  museum: "Museum", gallery: "Gallery", attraction: "Attraction",
  viewpoint: "Viewpoint", artwork: "Artwork", zoo: "Zoo",
  aquarium: "Aquarium", theme_park: "Theme Park",
  place_of_worship: "Religious", theatre: "Theatre",
  cinema: "Cinema", library: "Library", marketplace: "Market",
  monument: "Monument", castle: "Castle", ruins: "Ruins",
  archaeological_site: "Arch. Site", memorial: "Memorial",
  park: "Park", garden: "Garden", stadium: "Stadium",
  nature_reserve: "Nature Reserve",
};

// Category filter value → Overpass node pattern (without bounding box)
const CATEGORY_QUERIES = {
  museums:      `node["tourism"~"museum|gallery"]`,
  historic:     `node["historic"]`,
  natural:      `node["leisure"~"park|garden|nature_reserve"]`,
  religion:     `node["amenity"="place_of_worship"]`,
  architecture: `node["tourism"="attraction"]`,
  cultural:     `node["tourism"~"artwork|theatre|cinema"]`,
  amusements:   `node["tourism"~"theme_park|zoo|aquarium"]`,
  sport:        `node["leisure"="stadium"]`,
};

// Patterns used when no category filter is selected
const DEFAULT_QUERY_TYPES = [
  `node["tourism"~"museum|gallery|attraction|viewpoint|zoo|aquarium|theme_park"]`,
  `node["historic"~"monument|castle|ruins|archaeological_site|memorial"]`,
  `node["leisure"~"park|garden|nature_reserve"]`,
  `node["amenity"="place_of_worship"]["name"]`,
];

function kindLabel(tags = {}) {
  const val = tags.tourism || tags.historic || tags.leisure || tags.amenity || "";
  return TAG_LABELS[val] || (val ? val.charAt(0).toUpperCase() + val.slice(1).replace(/_/g, " ") : "Place");
}

function tagsToKind(tags = {}) {
  return tags.tourism || tags.historic || tags.leisure || tags.amenity || "other";
}


// ---- 2. STATE ----

let allResults  = [];
let filteredRes = [];
let trip        = JSON.parse(localStorage.getItem("trip")) || [];


// ---- 3. API HELPERS ----

/**
 * Geocode city → { lat, lon, displayName, bbox }
 * bbox = [south, north, west, east] strings from Nominatim
 */
async function geocodeCity(city) {
  const url = `${NOMINATIM_API}?q=${encodeURIComponent(city)}&format=json&limit=1&addressdetails=1`;
  const res  = await fetch(url, {
    headers: { "Accept-Language": "en", "User-Agent": "TravelPlannerApp/1.0" }
  });
  if (!res.ok) throw new Error("Geocoding service unavailable. Try again.");
  const data = await res.json();
  if (!data.length) throw new Error(`City "${city}" not found. Try a different name.`);
  const { lat, lon, display_name, boundingbox } = data[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon), displayName: display_name, bbox: boundingbox };
}

/**
 * Build Overpass QL query for POIs inside bbox.
 */
function buildOverpassQuery(bbox, categoryKey) {
  const [s, n, w, e] = bbox;
  const box = `(${s},${w},${n},${e})`;
  const patterns = categoryKey && CATEGORY_QUERIES[categoryKey]
    ? [`${CATEGORY_QUERIES[categoryKey]}${box}`]
    : DEFAULT_QUERY_TYPES.map(t => `${t}${box}`);

  return `[out:json][timeout:25];\n(\n  ${patterns.join(";\n  ")};\n);\nout body 80;`;
}

/**
 * Fetch POIs from Overpass. Returns normalised place array.
 */
async function fetchPlaces(bbox, categoryKey) {
  const query = buildOverpassQuery(bbox, categoryKey);
  const res   = await fetch(OVERPASS_API, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    "data=" + encodeURIComponent(query)
  });
  if (!res.ok) throw new Error("Could not reach the places service. Try again.");
  const json = await res.json();
  if (!json.elements) return [];

  return json.elements
    .filter(el => el.tags && el.tags.name)
    .map(el => ({
      xid:      String(el.id),
      name:     el.tags.name,
      kind:     tagsToKind(el.tags),
      tags:     el.tags,
      lat:      el.lat,
      lon:      el.lon,
      website:  el.tags.website || el.tags["contact:website"] || null,
      wikipedia: el.tags.wikipedia || null,
    }))
    .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i) // deduplicate
    .slice(0, 60);
}

function getPlaceDetail(xid) {
  return allResults.find(p => p.xid === xid) || null;
}


// ---- 4. CACHE (LocalStorage) ----

function cacheKey(city, catKey) {
  return CACHE_PREFIX + city.toLowerCase().replace(/\s+/g, "_") + "_" + (catKey || "all");
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { console.warn("Cache write failed:", e); }
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch (e) { return null; }
}


// ---- 5. RENDER — RESULTS ----

function renderResults(places) {
  const container = document.getElementById("results");
  document.getElementById("resultCount").textContent =
    places.length ? `${places.length} place${places.length !== 1 ? "s" : ""}` : "";

  if (places.length === 0) {
    container.innerHTML = "<p class='placeholder'>No places found. Try another city or category.</p>";
    return;
  }

  const addedNames = new Set(trip.map(p => p.name));
  container.innerHTML = places.map(place => {
    const label = kindLabel(place.tags || {});
    const added = addedNames.has(place.name);
    return `
      <div class="place-card" onclick="openModal('${escHtml(place.xid)}')">
        <div class="card-info">
          <h3 title="${escHtml(place.name)}">${escHtml(place.name)}</h3>
          <div class="card-meta">
            <span class="badge">${escHtml(label)}</span>
          </div>
        </div>
        <div class="card-actions" onclick="event.stopPropagation()">
          <button
            class="add-btn${added ? " added" : ""}"
            onclick="addToTrip('${escHtml(place.name)}','${escHtml(label)}',${place.lat},${place.lon})"
            ${added ? "disabled" : ""}
          >${added ? "✓ Added" : "+ Add"}</button>
          <button class="detail-btn" onclick="openModal('${escHtml(place.xid)}')">Details</button>
        </div>
      </div>
    `;
  }).join("");
}

function showSkeletons(n = 6) {
  document.getElementById("results").innerHTML =
    Array(n).fill(`<div class="skeleton skeleton-card"></div>`).join("");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}


// ---- 6. RENDER — TRIP LIST ----

function saveTrip() { localStorage.setItem("trip", JSON.stringify(trip)); }

function renderTrip() {
  const list     = document.getElementById("tripItems");
  const emptyMsg = document.getElementById("emptyMsg");
  emptyMsg.style.display = trip.length === 0 ? "block" : "none";

  if (trip.length === 0) { list.innerHTML = ""; return; }

  const sortVal = document.getElementById("tripSort").value;
  const sorted  = sortTrip([...trip], sortVal);

  list.innerHTML = sorted.map(place => {
    const origIndex = trip.indexOf(place);
    return `
      <li>
        <span class="trip-name" title="${escHtml(place.name)}">${escHtml(place.name)}</span>
        <span class="trip-cat">${escHtml(place.category)}</span>
        <button class="remove-btn" onclick="removeFromTrip(${origIndex})" title="Remove">✕</button>
      </li>
    `;
  }).join("");
}

function sortTrip(arr, strategy) {
  if (strategy === "name_asc")  return arr.sort((a, b) => a.name.localeCompare(b.name));
  if (strategy === "category")  return arr.sort((a, b) => a.category.localeCompare(b.category));
  return arr;   // "added" → original order
}

function addToTrip(name, category, lat, lon) {
  if (trip.some(p => p.name === name)) {
    showToast(`"${name}" is already in your trip.`);
    return;
  }
  trip.push({ name, category, lat, lon });
  saveTrip();
  renderTrip();
  refreshAddButtons();
  showToast(`✓ "${name}" added!`);
}

function removeFromTrip(index) {
  trip.splice(index, 1);
  saveTrip();
  renderTrip();
  refreshAddButtons();
}

function refreshAddButtons() {
  const addedNames = new Set(trip.map(p => p.name));
  document.querySelectorAll(".place-card").forEach(card => {
    const btn  = card.querySelector(".add-btn");
    const name = card.querySelector("h3")?.textContent.trim();
    if (!btn || !name) return;
    if (addedNames.has(name)) {
      btn.textContent = "✓ Added"; btn.classList.add("added"); btn.disabled = true;
    } else {
      btn.textContent = "+ Add"; btn.classList.remove("added"); btn.disabled = false;
    }
  });
}


// ---- 7. MODAL — DETAIL VIEW ----

function openModal(xid) {
  const overlay = document.getElementById("modalOverlay");
  const body    = document.getElementById("modalBody");
  overlay.classList.remove("hidden");

  const place = getPlaceDetail(xid);
  if (!place) {
    body.innerHTML = "<p class='error-msg'>Details not available.</p>";
    return;
  }

  const label   = kindLabel(place.tags || {});
  const added   = trip.some(p => p.name === place.name);
  const gmaps   = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
  const osm     = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}&zoom=16`;
  const wikiUrl = place.wikipedia
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(place.wikipedia.replace(/^en:/, ""))}`
    : null;

  // Build extra tags info
  const extras = [];
  if (place.tags?.opening_hours)  extras.push(`🕐 ${place.tags.opening_hours}`);
  if (place.tags?.phone)          extras.push(`📞 ${place.tags.phone}`);
  if (place.tags?.fee)            extras.push(`🎟 Fee: ${place.tags.fee}`);
  if (place.website)              extras.push(`🌐 <a href="${escHtml(place.website)}" target="_blank" rel="noopener">Website</a>`);

  body.innerHTML = `
    <p class="modal-category">${escHtml(label)}</p>
    <h2>${escHtml(place.name)}</h2>
    ${extras.length ? `<p class="modal-desc" style="line-height:2">${extras.join(" &nbsp;·&nbsp; ")}</p>` : ""}
    <p class="modal-coords">📍 ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}</p>
    <div class="modal-links">
      <a class="map-link" href="${gmaps}" target="_blank" rel="noopener">🗺 Google Maps</a>
      <a class="map-link osm-link" href="${osm}" target="_blank" rel="noopener">🌍 OpenStreetMap</a>
      ${wikiUrl ? `<a class="map-link osm-link" href="${wikiUrl}" target="_blank" rel="noopener">📖 Wikipedia</a>` : ""}
      <button
        class="modal-add-btn${added ? " added" : ""}"
        id="modalAddBtn"
        onclick="addToTripFromModal('${escHtml(place.name)}','${escHtml(label)}',${place.lat},${place.lon})"
        ${added ? "disabled" : ""}
      >${added ? "✓ In Trip" : "+ Add to Trip"}</button>
    </div>
  `;
}

function addToTripFromModal(name, category, lat, lon) {
  addToTrip(name, category, lat, lon);
  const btn = document.getElementById("modalAddBtn");
  if (btn) { btn.textContent = "✓ In Trip"; btn.classList.add("added"); btn.disabled = true; }
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
  document.getElementById("modalBody").innerHTML = "";
}


// ---- 8. CUSTOM PLACE FORM ----

function validateCustomForm() {
  const nameEl = document.getElementById("customName");
  const catEl  = document.getElementById("customCategory");
  const errN   = document.getElementById("errName");
  const errC   = document.getElementById("errCat");
  let valid = true;

  nameEl.classList.remove("invalid"); errN.textContent = "";
  if (!nameEl.value.trim()) {
    nameEl.classList.add("invalid"); errN.textContent = "Place name is required."; valid = false;
  } else if (nameEl.value.trim().length < 2) {
    nameEl.classList.add("invalid"); errN.textContent = "Name must be at least 2 characters."; valid = false;
  }

  catEl.classList.remove("invalid"); errC.textContent = "";
  if (!catEl.value) {
    catEl.classList.add("invalid"); errC.textContent = "Please select a category."; valid = false;
  }

  return valid;
}

// Maps custom form select values → readable label
const CUSTOM_CAT_LABELS = {
  museums:      "Museum",
  historic:     "Historic",
  natural:      "Nature",
  religion:     "Religious",
  architecture: "Architecture",
  cultural:     "Cultural",
  other:        "Other",
};

document.getElementById("addCustomBtn").addEventListener("click", function () {
  if (!validateCustomForm()) return;
  const name     = document.getElementById("customName").value.trim();
  const catVal   = document.getElementById("customCategory").value;
  const category = CUSTOM_CAT_LABELS[catVal] || catVal;
  const city     = document.getElementById("customCity").value.trim();

  if (trip.some(p => p.name === name)) { showToast(`"${name}" is already in your trip.`); return; }

  trip.push({ name, category, city: city || null, lat: null, lon: null, custom: true });
  saveTrip();
  renderTrip();

  document.getElementById("customName").value     = "";
  document.getElementById("customCategory").value = "";
  document.getElementById("customCity").value     = "";

  showToast(`✓ "${name}" added to your trip!`);
});


// ---- 9. FILTERS & SORT ----

// Maps each select <option value> to the OSM tag values it should match
const FILTER_MATCHERS = {
  museums:      p => ["museum","gallery"].includes(p.tags?.tourism),
  historic:     p => !!p.tags?.historic,
  natural:      p => ["park","garden","nature_reserve"].includes(p.tags?.leisure),
  religion:     p => p.tags?.amenity === "place_of_worship",
  architecture: p => p.tags?.tourism === "attraction",
  cultural:     p => ["artwork","theatre","cinema"].includes(p.tags?.tourism),
  amusements:   p => ["theme_park","zoo","aquarium"].includes(p.tags?.tourism),
  sport:        p => p.tags?.leisure === "stadium",
  other:        p => !p.tags?.tourism && !p.tags?.historic && !p.tags?.leisure && !p.tags?.amenity,
};

function applyFilters() {
  const cat  = document.getElementById("categoryFilter").value;
  const sort = document.getElementById("sortBy").value;

  filteredRes = (cat && FILTER_MATCHERS[cat])
    ? allResults.filter(FILTER_MATCHERS[cat])
    : [...allResults];

  filteredRes = sortResults(filteredRes, sort);
  renderResults(filteredRes);
}

function sortResults(arr, strategy) {
  const copy = [...arr];
  if (strategy === "name_asc")  return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (strategy === "name_desc") return copy.sort((a, b) => b.name.localeCompare(a.name));
  return copy;
}


// ---- 10. SEARCH FLOW ----

async function doSearch() {
  const city = document.getElementById("searchInput").value.trim();
  if (!city) { showToast("Please type a city name first."); return; }

  showSkeletons();
  document.getElementById("filtersBar").classList.remove("hidden");
  document.getElementById("resultCount").textContent = "";

  try {
    const catKey = document.getElementById("categoryFilter").value;
    const key    = cacheKey(city, catKey);
    const cached = cacheGet(key);

    if (cached) {
      allResults = cached;
      applyFilters();
      showToast(`Showing cached results for "${city}"`);
      return;
    }

    // 1. Geocode
    const geo = await geocodeCity(city);

    // 2. Fetch places via Overpass
    const places = await fetchPlaces(geo.bbox, catKey);

    // 3. Cache & display
    cacheSet(key, places);
    allResults = places;
    applyFilters();

  } catch (err) {
    document.getElementById("results").innerHTML =
      `<p class="error-msg">⚠ ${escHtml(err.message)}</p>`;
    document.getElementById("resultCount").textContent = "";
  }
}


// ---- 11. TOAST ----

let toastTimer = null;

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2500);
}


// ---- 12. EVENT LISTENERS ----

document.getElementById("searchBtn").addEventListener("click", doSearch);
document.getElementById("searchInput").addEventListener("keydown", e => {
  if (e.key === "Enter") doSearch();
});

document.getElementById("categoryFilter").addEventListener("change", applyFilters);
document.getElementById("sortBy").addEventListener("change", applyFilters);
document.getElementById("tripSort").addEventListener("change", renderTrip);

document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalOverlay").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });


// ---- 13. INIT ----

renderTrip();


// ---- 14. UNIT TESTS ----
// Open browser console and run:  runTests()

function runTests() {
  let passed = 0, failed = 0;

  function assert(label, condition) {
    if (condition) { console.log(`  ✅ PASS: ${label}`); passed++; }
    else           { console.error(`  ❌ FAIL: ${label}`); failed++; }
  }

  console.group("🧪 Travel Planner — Unit Tests");

  // sortResults
  console.group("sortResults()");
  const places = [
    { name: "Louvre",       tags: { tourism: "museum"  } },
    { name: "Eiffel Tower", tags: { tourism: "attraction" } },
    { name: "Notre-Dame",   tags: { amenity: "place_of_worship" } },
  ];
  const asc = sortResults(places, "name_asc");
  assert("name_asc first: Eiffel Tower",  asc[0].name === "Eiffel Tower");
  assert("name_asc last:  Notre-Dame",    asc[2].name === "Notre-Dame");
  const desc = sortResults(places, "name_desc");
  assert("name_desc first: Notre-Dame",   desc[0].name === "Notre-Dame");
  console.groupEnd();

  // sortTrip
  console.group("sortTrip()");
  const tripItems = [
    { name: "Sagrada Familia", category: "Architecture" },
    { name: "Alhambra",        category: "Historic"     },
    { name: "Prado Museum",    category: "Museum"       },
  ];
  const byName = sortTrip([...tripItems], "name_asc");
  assert("name_asc first: Alhambra",        byName[0].name === "Alhambra");
  const byCat = sortTrip([...tripItems], "category");
  assert("category first: Architecture",    byCat[0].category === "Architecture");
  console.groupEnd();

  // cacheGet / cacheSet
  console.group("Cache");
  const testKey = "__tp_test__";
  localStorage.removeItem(testKey);
  assert("cacheGet null for missing key",   cacheGet(testKey) === null);
  cacheSet(testKey, [{ name: "Test" }]);
  const got = cacheGet(testKey);
  assert("cacheGet returns saved data",     got !== null && got[0].name === "Test");
  localStorage.setItem("__tp_exp__", JSON.stringify({ ts: Date.now() - CACHE_TTL_MS - 1, data: [] }));
  assert("cacheGet null for expired",       cacheGet("__tp_exp__") === null);
  localStorage.removeItem(testKey);
  localStorage.removeItem("__tp_exp__");
  console.groupEnd();

  // kindLabel
  console.group("kindLabel()");
  assert("museum  → Museum",    kindLabel({ tourism: "museum" })  === "Museum");
  assert("park    → Park",      kindLabel({ leisure: "park" })    === "Park");
  assert("castle  → Castle",    kindLabel({ historic: "castle" }) === "Castle");
  assert("empty   → Place",     kindLabel({})                     === "Place");
  console.groupEnd();

  // duplicate guard
  console.group("Duplicate guard");
  trip.push({ name: "__dup__", category: "Test" });
  assert("Duplicate detected",  trip.some(p => p.name === "__dup__") === true);
  trip.splice(trip.findIndex(p => p.name === "__dup__"), 1);
  assert("Cleanup OK",          trip.every(p => p.name !== "__dup__"));
  console.groupEnd();

  console.log(`\n  Results: ${passed} passed, ${failed} failed`);
  console.groupEnd();
}
