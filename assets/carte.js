/* ==========================================================================
   Livia Bay — carte interactive
   Fond : géométrie OpenStreetMap (via OpenFreeMap), sans aucun nom réel.
   Données : data/quartiers.geojson et data/lieux.json.
   Les adresses des données peuvent être changées avant le chargement du
   script avec : window.LIVIA_BAY_MAP = { places: "...", districts: "..." }
   ========================================================================== */
(function () {
  'use strict';

  const CONFIG = Object.assign({
    places: 'data/lieux.json',
    districts: 'data/quartiers.geojson',
    tiles: 'https://tiles.openfreemap.org/planet',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    home: { center: [-80.185, 25.776], mobileCenter: [-80.172, 25.768], zoom: 12.25, pitch: 48, bearing: -14 },
    maxBounds: [[-80.56, 25.56], [-79.98, 25.98]],
    /* Sujet caché où le staff range les lieux ajoutés depuis la carte */
    store: '/t12-carte-interactive-lieux',
    /* Rangs du forum qui voient le bouton d'ajout : 1 = administrateurs (2 = modérateurs) */
    staffLevels: [1]
  }, window.LIVIA_BAY_MAP || {});

  /* Noms de rues fictifs : chaque vraie rue reçoit toujours le même nom inventé. */
  const STREET_NAMES = [
    'Abernathy', 'Alcott', 'Alder', 'Arbor', 'Ashby', 'Aubrey', 'Avalon', 'Barrow', 'Beaumont', 'Bellamy',
    'Benning', 'Blackwood', 'Bramble', 'Brennan', 'Briar', 'Cabrera', 'Calloway', 'Camden', 'Carver', 'Castile',
    'Cedar', 'Chandler', 'Clement', 'Corbin', 'Crane', 'Cypress', 'Dalton', 'Delacroix', 'Delgado', 'Dorian',
    'Draper', 'Driftwood', 'Dunmore', 'Easton', 'Ellery', 'Elmore', 'Emerson', 'Esperanza', 'Fairbanks', 'Fenwick',
    'Finch', 'Fletcher', 'Fontana', 'Gable', 'Galvez', 'Garland', 'Granger', 'Greer', 'Hadley', 'Halsey',
    'Harbor', 'Harrow', 'Hartley', 'Hawthorne', 'Heliconia', 'Heron', 'Herrera', 'Hollis', 'Holloway', 'Ibis',
    'Isola', 'Iverson', 'Jasper', 'Juniper', 'Keaton', 'Kessler', 'Kingsley', 'Lachlan', 'Langford', 'Lantern',
    'Larkspur', 'Lennox', 'Linden', 'Lowell', 'Lucero', 'Mabry', 'Magnolia', 'Mallory', 'Mangrove', 'Marisol',
    'Marlow', 'Monroe', 'Montoya', 'Morrow', 'Navarre', 'Nolan', 'Oakes', 'Orchid', 'Osprey', 'Palmer',
    'Paloma', 'Paragon', 'Pelican', 'Prescott', 'Quincy', 'Quintero', 'Radcliffe', 'Ramsey', 'Ravel', 'Regent',
    'Reyes', 'Rosalind', 'Rowan', 'Salazar', 'Saltmarsh', 'Sandoval', 'Sawgrass', 'Seagrape', 'Selby', 'Sheridan',
    'Sinclair', 'Solano', 'Sovereign', 'Spencer', 'Starboard', 'Sterling', 'Sullivan', 'Sundial', 'Sutton', 'Tamarind',
    'Tate', 'Thornton', 'Tidewater', 'Torrance', 'Tupelo', 'Valencia', 'Vance', 'Vega', 'Verona', 'Vidal',
    'Waverly', 'Whitlock', 'Wilder', 'Winslow', 'Wren', 'Yardley', 'Yates', 'Zamora', 'Zephyr', 'Larchmont'
  ];

  const WATER_LABELS = {
    type: 'FeatureCollection',
    features: [
      waterLabel('Livia Bay', [-80.1640, 25.8040], 15),
      waterLabel('Livia Bay', [-80.2060, 25.7130], 15),
      waterLabel('Océan Atlantique', [-80.0900, 25.7750], 13)
    ]
  };

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {
    map: null,
    places: [],
    categories: {},
    districts: null,
    district: 'all',
    category: 'all',
    selected: null,
    hovered: null,
    loaded: false,
    basePlaces: [],
    storePlaces: [],
    isAdmin: false,
    editing: null,
    draft: null,
    markers: new Map(),
    rows: new Map()
  };

  /* ---------- Utilitaires ---------- */

  function waterLabel(name, coords, size) {
    return { type: 'Feature', properties: { name, size }, geometry: { type: 'Point', coordinates: coords } };
  }

  /* Lit une variable CSS et la convertit en couleur rgb() que MapLibre comprend
     (les variables du forum peuvent contenir var(), color-mix(), etc.). */
  let probe = null;
  let paint = null;
  function cssVar(name, fallback) {
    if (!probe) {
      probe = document.createElement('span');
      probe.style.display = 'none';
      document.body.append(probe);
    }
    probe.style.color = '';
    probe.style.color = `var(${name}, ${fallback})`;
    const computed = getComputedStyle(probe).color;
    if (!computed) return fallback;
    /* Le navigateur peut répondre « color(srgb …) » : on repeint un pixel pour obtenir du rgba() */
    if (!paint) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      paint = canvas.getContext('2d', { willReadFrequently: true });
    }
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = computed;
    paint.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconName(value) {
    return /^[a-z0-9-]+$/.test(value || '') ? value : 'location';
  }

  function safeURL(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function setStatus(text) {
    $('lb-status').textContent = text || '';
  }

  function isMobile() {
    return window.innerWidth <= 760;
  }

  function categoryOf(place) {
    return state.categories[place.category] || { label: 'Lieu', icon: 'location', color: '#c9c3b4' };
  }

  function categoryColor(key) {
    const category = state.categories[key];
    return `var(--lb-cat-${key}, ${category ? category.color : '#c9c3b4'})`;
  }

  function districtOf(id) {
    return state.districts.features.find((feature) => feature.properties.id === id);
  }

  function placeIcon(place) {
    return iconName(place.icon || categoryOf(place).icon);
  }

  function viewPadding() {
    if (isMobile()) return { top: 70, bottom: Math.round(window.innerHeight * 0.45), left: 30, right: 30 };
    const detailOpen = !$('lb-detail').hidden || !$('lb-form').hidden;
    return { top: 60, bottom: 60, left: 390, right: detailOpen ? 390 : 80 };
  }

  function duration(ms) {
    return reduceMotion ? 0 : ms;
  }

  /* ---------- Données ---------- */

  async function loadJSON(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Impossible de charger ${url}`);
    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      // Page HTML Forumactif contenant un bloc <script type="application/json">
      const page = new DOMParser().parseFromString(text, 'text/html');
      const block = page.querySelector('script[type="application/json"]');
      if (!block) throw new Error(`Aucun bloc de données dans ${url}`);
      return JSON.parse(block.textContent);
    }
    return JSON.parse(text);
  }

  function prepareDistricts(geojson) {
    for (const feature of geojson.features) {
      const props = feature.properties;
      props.color = cssVar(`--lb-q-${props.id}`, props.color || '#cccccc');
    }
    return geojson;
  }

  function districtLabels() {
    return {
      type: 'FeatureCollection',
      features: state.districts.features.map((feature) => ({
        type: 'Feature',
        properties: { id: feature.properties.id, name: feature.properties.name, color: feature.properties.color },
        geometry: { type: 'Point', coordinates: feature.properties.label }
      }))
    };
  }

  function districtBounds(feature) {
    const bounds = new maplibregl.LngLatBounds();
    const walk = (coords) => {
      if (typeof coords[0] === 'number') bounds.extend(coords);
      else coords.forEach(walk);
    };
    walk(feature.geometry.coordinates);
    return bounds;
  }

  /* ---------- Style de carte (écrit pour Livia Bay) ---------- */

  function streetNameExpression() {
    const name = ['downcase', ['coalesce', ['get', 'name'], '']];
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const weights = [3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89];
    const terms = weights.map((weight, index) => [
      '*', ['+', 1, ['index-of', ['slice', name, index, index + 1], chars]], weight
    ]);
    terms.push(['*', ['length', name], 5]);
    const index = ['%', ['+', ...terms], STREET_NAMES.length];
    const raw = ['coalesce', ['get', 'name'], ''];
    const suffix = ['case',
      ['==', ['get', 'class'], 'motorway'], 'Expressway',
      ['in', 'Causeway', raw], 'Causeway',
      ['in', 'Expressway', raw], 'Expressway',
      ['in', 'Boulevard', raw], 'Boulevard',
      ['in', 'Avenue', raw], 'Avenue',
      ['in', 'Drive', raw], 'Drive',
      ['in', 'Road', raw], 'Road',
      ['in', 'Court', raw], 'Court',
      ['in', 'Place', raw], 'Place',
      ['in', 'Terrace', raw], 'Terrace',
      ['in', 'Lane', raw], 'Lane',
      ['in', 'Parkway', raw], 'Parkway',
      ['in', 'Trail', raw], 'Trail',
      ['in', 'Way', raw], 'Way',
      'Street'
    ];
    return ['concat', ['at', index, ['literal', STREET_NAMES]], ' ', suffix];
  }

  function roadLayer(id, classes, color, widths, extra) {
    return Object.assign({
      id,
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], classes, true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], ...widths]
      }
    }, extra || {});
  }

  function buildStyle() {
    /* Les quartiers restent cachés tant que le plan n'est pas chargé */
    const shown = state.loaded ? 'visible' : 'none';
    const C = {
      land: cssVar('--lb-map-land', '#151515'),
      sand: cssVar('--lb-map-sand', '#1d1d1d'),
      park: cssVar('--lb-map-park', '#191919'),
      water: cssVar('--lb-map-water', '#070707'),
      minor: cssVar('--lb-map-road-minor', '#262626'),
      medium: cssVar('--lb-map-road-medium', '#3b3b3b'),
      major: cssVar('--lb-map-road-major', '#6e666a'),
      highway: cssVar('--lb-map-road-highway', '#d6c4cd'),
      building: cssVar('--lb-map-building', '#262626'),
      label: cssVar('--lb-map-label', '#b5b5b5'),
      halo: cssVar('--lb-map-label-halo', '#151515'),
      waterLabel: cssVar('--lb-map-water-label', '#8a4b6b'),
      districtLine: cssVar('--lb-map-district-line', '#f7b6d5'),
      districtLabel: cssVar('--lb-map-district-label', '#f3cfe0'),
      accent: cssVar('--lb-accent', '#f45dab')
    };
    const focus = ['coalesce', ['feature-state', 'focus'], 0];
    const hover = ['boolean', ['feature-state', 'hover'], false];

    return {
      version: 8,
      glyphs: CONFIG.glyphs,
      sources: {
        base: { type: 'vector', url: CONFIG.tiles },
        districts: { type: 'geojson', data: state.districts, promoteId: 'id' },
        districtLabels: { type: 'geojson', data: districtLabels(), promoteId: 'id' },
        waterLabels: { type: 'geojson', data: WATER_LABELS }
      },
      layers: [
        { id: 'land', type: 'background', paint: { 'background-color': C.land } },
        {
          id: 'green', type: 'fill', source: 'base', 'source-layer': 'landcover',
          filter: ['match', ['get', 'class'], ['grass', 'wood', 'wetland', 'farmland'], true, false],
          paint: { 'fill-color': C.park }
        },
        { id: 'parks', type: 'fill', source: 'base', 'source-layer': 'park', paint: { 'fill-color': C.park } },
        {
          id: 'sand', type: 'fill', source: 'base', 'source-layer': 'landcover',
          filter: ['==', ['get', 'class'], 'sand'],
          paint: { 'fill-color': C.sand }
        },

        roadLayer('roads-minor', ['minor', 'service', 'track'], C.minor, [12, 0.3, 15, 1.6, 18, 9], {
          minzoom: 11.5,
          filter: ['all', ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false], ['!=', ['get', 'brunnel'], 'bridge']]
        }),
        roadLayer('roads-medium', ['tertiary', 'secondary'], C.medium, [10, 0.4, 14, 1.6, 18, 12], {
          filter: ['all', ['match', ['get', 'class'], ['tertiary', 'secondary'], true, false], ['!=', ['get', 'brunnel'], 'bridge']]
        }),

        /* Quartiers : dessinés sous l'eau pour que contours et teintes s'arrêtent au rivage */
        {
          id: 'district-fill', type: 'fill', source: 'districts',
          layout: { visibility: shown },
          paint: {
            'fill-color': ['match', focus, 1, C.accent, C.districtLine],
            'fill-opacity': ['case', hover, 0.08, ['match', focus, 1, 0.08, 2, 0, 0.035]],
            'fill-opacity-transition': { duration: 400 }
          }
        },
        {
          id: 'district-glow', type: 'line', source: 'districts',
          layout: { visibility: shown },
          paint: {
            'line-color': ['match', focus, 1, C.accent, C.districtLine],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 12],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9],
            'line-opacity': ['case', hover, 0.35, ['match', focus, 1, 0.45, 2, 0, 0.16]],
            'line-opacity-transition': { duration: 400 }
          }
        },
        {
          id: 'district-line', type: 'line', source: 'districts',
          layout: { 'line-join': 'round', visibility: shown },
          paint: {
            'line-color': ['match', focus, 1, C.accent, C.districtLine],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 13, 1.8, 16, 2.6],
            'line-opacity': ['case', hover, 1, ['match', focus, 1, 1, 2, 0.3, 0.85]],
            'line-opacity-transition': { duration: 400 }
          }
        },

        { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': C.water } },
        {
          id: 'waterways', type: 'line', source: 'base', 'source-layer': 'waterway',
          paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 4] }
        },
        {
          id: 'airport', type: 'fill', source: 'base', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': C.minor, 'fill-opacity': 0.6 }
        },
        {
          id: 'runways', type: 'line', source: 'base', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': C.medium, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 16] }
        },

        roadLayer('bridges-minor', ['minor', 'service', 'track'], C.minor, [12, 0.3, 15, 1.6, 18, 9], {
          minzoom: 11.5,
          filter: ['all', ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false], ['==', ['get', 'brunnel'], 'bridge']]
        }),
        roadLayer('bridges-medium', ['tertiary', 'secondary'], C.medium, [10, 0.4, 14, 1.6, 18, 12], {
          filter: ['all', ['match', ['get', 'class'], ['tertiary', 'secondary'], true, false], ['==', ['get', 'brunnel'], 'bridge']]
        }),
        roadLayer('roads-major', ['primary', 'trunk'], C.major, [9, 0.6, 14, 2.4, 18, 16]),
        roadLayer('roads-highway', ['motorway'], C.highway, [8, 0.8, 14, 3, 18, 18]),
        roadLayer('rail', ['rail', 'transit'], C.medium, [10, 0.4, 16, 1.6], {
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': C.medium,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1.6],
            'line-dasharray': [3, 2]
          }
        }),

        {
          id: 'buildings', type: 'fill-extrusion', source: 'base', 'source-layer': 'building', minzoom: 13,
          paint: {
            'fill-extrusion-color': C.building,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.92]
          }
        },

        {
          id: 'street-names', type: 'symbol', source: 'base', 'source-layer': 'transportation_name', minzoom: 14.5,
          filter: ['all', ['has', 'name'], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false]],
          layout: {
            'symbol-placement': 'line',
            'text-field': streetNameExpression(),
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10, 18, 13],
            'text-letter-spacing': 0.04,
            'text-max-angle': 30
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4, 'text-opacity': 0.8 }
        },
        {
          id: 'water-names', type: 'symbol', source: 'waterLabels',
          layout: {
            'text-field': ['upcase', ['get', 'name']],
            'text-font': ['Noto Sans Italic'],
            'text-size': ['get', 'size'],
            'text-letter-spacing': 0.4
          },
          paint: { 'text-color': C.waterLabel }
        },
        {
          id: 'district-names', type: 'symbol', source: 'districtLabels',
          layout: {
            'text-field': ['upcase', ['get', 'name']],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 13, 15, 16, 18],
            'text-letter-spacing': 0.22,
            'text-allow-overlap': true
          },
          paint: {
            'text-color': ['match', focus, 1, C.accent, C.districtLabel],
            'text-halo-color': C.halo,
            'text-halo-width': 1.8,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, ['match', focus, 2, 0.3, 1], 16, 0],
            'text-opacity-transition': { duration: 400 }
          }
        }
      ]
    };
  }

  /* ---------- Interface ---------- */

  function chip(label, pressed, color, icon) {
    const button = el('button', 'lb-chip');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pressed));
    if (color) button.style.setProperty('--c', color);
    if (icon) {
      const symbol = el('i', `cp cp-${iconName(icon)}`);
      symbol.setAttribute('aria-hidden', 'true');
      button.append(symbol);
    } else if (color) {
      button.append(el('span', 'lb-dot'));
    }
    button.append(document.createTextNode(label));
    return button;
  }

  function renderDistrictFilters() {
    const wrap = $('lb-districts');
    const options = [{ id: 'all', name: 'Toute la ville' }].concat(state.districts.features.map((f) => f.properties));
    options.forEach((option, index) => {
      const button = chip(option.name, option.id === state.district);
      if (index > 0) {
        const number = el('span', 'lb-chip__num', String(index).padStart(2, '0'));
        button.prepend(number);
      }
      button.dataset.value = option.id;
      button.addEventListener('click', () => setDistrict(option.id, true));
      wrap.append(button);
    });
  }

  function renderCategoryFilters() {
    const wrap = $('lb-categories');
    wrap.replaceChildren();
    const used = Object.keys(state.categories).filter((key) => state.places.some((p) => p.category === key));
    const all = chip('Toutes', state.category === 'all');
    all.dataset.value = 'all';
    all.addEventListener('click', () => setCategory('all'));
    wrap.append(all);
    for (const key of used) {
      const category = state.categories[key];
      const button = chip(category.label, state.category === key, categoryColor(key), category.icon);
      button.dataset.value = key;
      button.addEventListener('click', () => setCategory(key));
      wrap.append(button);
    }
  }

  function renderList() {
    const list = $('lb-list');
    const sorted = state.places.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const place of sorted) {
      const item = el('li');
      const row = el('button', 'lb-row');
      row.type = 'button';
      row.style.setProperty('--c', categoryColor(place.category));
      const symbol = el('span', 'lb-symbol');
      symbol.append(el('i', `cp cp-${placeIcon(place)}`));
      const text = el('span', 'lb-row__text');
      const district = districtOf(place.district);
      /* Quartier en majuscules, catégorie en minuscules : deux morceaux pour les styler à part */
      const meta = el('span', 'lb-row__meta');
      meta.append(
        el('span', 'lb-row__district', district ? district.properties.name : 'Hors quartier'),
        document.createTextNode(' · '),
        el('span', 'lb-row__category', categoryOf(place).label)
      );
      text.append(
        el('span', 'lb-row__name', place.name),
        meta
      );
      row.append(symbol, text);
      row.addEventListener('click', () => selectPlace(place.id, true));
      item.append(row);
      list.append(item);
      state.rows.set(place.id, { item, row });
    }
    const empty = el('li', 'lb-empty', 'Aucun lieu pour ce filtre.');
    empty.id = 'lb-empty';
    empty.hidden = true;
    list.append(empty);
  }

  function renderDetail(place) {
    const box = $('lb-detail-content');
    box.replaceChildren();
    const category = categoryOf(place);
    const image = safeURL(place.image);
    if (image) {
      const figure = el('figure', 'lb-detail__figure');
      const img = el('img', 'lb-detail__image');
      img.src = image;
      img.alt = '';
      img.addEventListener('error', () => figure.remove(), { once: true });
      figure.append(img);
      box.append(figure);
    }
    const body = el('div', 'lb-detail__body');
    const badge = el('span', 'lb-badge');
    badge.style.setProperty('--c', categoryColor(place.category));
    const symbol = el('span', 'lb-symbol');
    symbol.append(el('i', `cp cp-${placeIcon(place)}`));
    badge.append(symbol, document.createTextNode(category.label));
    body.append(badge, el('h2', 'lb-detail__name', place.name));

    const district = districtOf(place.district);
    const line = el('p', 'lb-detail__district');
    const dot = el('span', 'lb-dot');
    if (district) dot.style.setProperty('--c', district.properties.color);
    else dot.style.setProperty('--c', 'var(--lb-muted)');
    line.append(dot, document.createTextNode(district ? district.properties.name : 'Hors quartier'));
    body.append(line);

    if (place.description) body.append(el('p', 'lb-detail__desc', place.description));
    const link = safeURL(place.link);
    if (link) {
      const a = el('a', 'lb-button', 'Voir sur le forum');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener';
      body.append(a);
    }
    if (state.isAdmin && place.postId) {
      const tools = el('div', 'lb-detail__staff');
      const edit = el('button', 'lb-lien', 'modifier');
      edit.type = 'button';
      edit.addEventListener('click', () => openForm(place));
      const remove = el('button', 'lb-lien', 'supprimer');
      remove.type = 'button';
      remove.addEventListener('click', () => deletePlace(place));
      tools.append(el('span', 'lb-detail__staff-label', 'staff'), edit, remove);
      body.append(tools);
    }
    box.append(body);
    $('lb-detail').hidden = false;
  }

  /* ---------- Repères ---------- */

  function createMarkers() {
    state.places.forEach((place, index) => {
      const pin = el('button', `lb-pin${place.landmark ? ' is-landmark' : ''}`);
      pin.type = 'button';
      pin.setAttribute('aria-label', place.name);
      pin.style.setProperty('--c', categoryColor(place.category));
      pin.style.setProperty('--i', String(index));
      const dot = el('span', 'lb-pin__dot');
      dot.append(el('i', `cp cp-${placeIcon(place)}`));
      pin.append(dot, el('span', 'lb-pin__label', place.name));
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        selectPlace(place.id, true);
      });
      const marker = new maplibregl.Marker({ element: pin, anchor: 'center' })
        .setLngLat([place.lng, place.lat])
        .addTo(state.map);
      state.markers.set(place.id, { marker, pin });
    });
  }

  function updateLabelVisibility() {
    const zoom = state.map.getZoom();
    const container = $('lb-map');
    container.classList.toggle('show-landmark-labels', zoom >= 13);
    container.classList.toggle('show-labels', zoom >= 15);
  }

  /* ---------- Filtres et sélection ---------- */

  function isVisible(place) {
    return (state.district === 'all' || place.district === state.district) &&
      (state.category === 'all' || place.category === state.category);
  }

  function applyFilters() {
    let count = 0;
    for (const place of state.places) {
      const visible = isVisible(place);
      if (visible) count++;
      const marker = state.markers.get(place.id);
      if (marker) marker.pin.classList.toggle('is-hidden', !visible);
      const row = state.rows.get(place.id);
      if (row) row.item.hidden = !visible;
    }
    $('lb-empty').hidden = count > 0;
    const label = `${count} lieu${count > 1 ? 'x' : ''}`;
    $('lb-count').textContent = label;
    $('lb-count-mobile').textContent = label;
    if (state.selected && !isVisible(state.places.find((p) => p.id === state.selected))) closeDetail();
  }

  function setDistrict(id, fly) {
    state.district = id;
    for (const button of $('lb-districts').children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === id));
    }
    const note = $('lb-district-note');
    const feature = id === 'all' ? null : districtOf(id);
    if (feature) {
      note.textContent = feature.properties.tagline || '';
      note.dataset.num = String(state.districts.features.indexOf(feature) + 1);
      note.style.setProperty('--c', feature.properties.color);
      note.hidden = !feature.properties.tagline;
      // Relance l'animation douce de la note
      note.style.animation = 'none';
      void note.offsetWidth;
      note.style.animation = '';
    } else {
      note.hidden = true;
    }

    if (state.map) {
      for (const f of state.districts.features) {
        const value = id === 'all' ? 0 : (f.properties.id === id ? 1 : 2);
        state.map.setFeatureState({ source: 'districts', id: f.properties.id }, { focus: value });
        state.map.setFeatureState({ source: 'districtLabels', id: f.properties.id }, { focus: value });
      }
      if (fly) {
        if (feature) {
          state.map.fitBounds(districtBounds(feature), {
            padding: viewPadding(), maxZoom: 14.5, duration: duration(1100), essential: true,
            pitch: state.map.getPitch(), bearing: state.map.getBearing()
          });
        } else {
          goHome();
        }
      }
    }
    applyFilters();
  }

  function setCategory(key) {
    state.category = key;
    for (const button of $('lb-categories').children) {
      button.setAttribute('aria-pressed', String(button.dataset.value === key));
    }
    applyFilters();
  }

  function selectPlace(id, fly) {
    const place = state.places.find((p) => p.id === id);
    if (!place) return;
    state.selected = id;
    for (const [key, { pin }] of state.markers) pin.classList.toggle('is-selected', key === id);
    for (const [key, { row }] of state.rows) row.setAttribute('aria-current', String(key === id));
    renderDetail(place);
    if (isMobile()) togglePanel(false);
    if (fly && state.map) {
      state.map.flyTo({
        center: [place.lng, place.lat],
        zoom: Math.max(state.map.getZoom(), 15.5),
        padding: viewPadding(),
        duration: duration(1300),
        essential: true
      });
    }
  }

  function closeDetail() {
    state.selected = null;
    $('lb-detail').hidden = true;
    for (const { pin } of state.markers.values()) pin.classList.remove('is-selected');
    for (const { row } of state.rows.values()) row.setAttribute('aria-current', 'false');
  }

  function homeView() {
    const home = CONFIG.home;
    return isMobile()
      ? { center: home.mobileCenter || home.center, zoom: home.zoom - 0.75 }
      : { center: home.center, zoom: home.zoom };
  }

  function goHome() {
    const home = CONFIG.home;
    const flat = $('lb-3d').getAttribute('aria-pressed') === 'false';
    state.map.flyTo({
      ...homeView(),
      pitch: flat ? 0 : home.pitch,
      bearing: flat ? 0 : home.bearing,
      padding: isMobile() ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: 0, left: 360, right: 0 },
      duration: duration(1200),
      essential: true
    });
  }

  function togglePanel(open) {
    const panel = $('lb-panel');
    const next = open === undefined ? !panel.classList.contains('is-open') : open;
    panel.classList.toggle('is-open', next);
    $('lb-panel-toggle').setAttribute('aria-expanded', String(next));
  }

  /* ---------- Survol des quartiers ---------- */

  function bindDistrictHover() {
    const map = state.map;
    map.on('mousemove', 'district-fill', (event) => {
      const id = event.features[0] && event.features[0].id;
      if (id === state.hovered) return;
      if (state.hovered) map.setFeatureState({ source: 'districts', id: state.hovered }, { hover: false });
      state.hovered = id;
      if (id) map.setFeatureState({ source: 'districts', id }, { hover: true });
    });
    map.on('mouseleave', 'district-fill', () => {
      if (state.hovered) map.setFeatureState({ source: 'districts', id: state.hovered }, { hover: false });
      state.hovered = null;
    });
  }

  /* ---------- Lieux du staff : rangés dans un sujet caché du forum ----------
     Chaque lieu = un message du sujet CONFIG.store, qui contient une ligne
     « LIVIA-BAY-LIEU {…} » dans une balise [code]. Tout le monde peut lire le
     sujet (la carte le charge pour chaque visiteur) ; seuls les admins peuvent
     y écrire, ce sont les permissions du forum qui protègent l'ajout. */

  const STORE_MARK = 'LIVIA-BAY-LIEU';

  function storeTopic() {
    const match = String(CONFIG.store || '').match(/\/t(\d+)/);
    return match ? match[1] : null;
  }

  async function fetchPage(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`le forum répond ${response.status}`);
    return response.text();
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function cleanText(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function readStorePosts(doc) {
    const places = [];
    const posts = doc.querySelectorAll('.lb-message, .post');
    for (const post of posts) {
      const idMatch = (post.id || '').match(/\d+/);
      const body = post.querySelector('.lb-message__texte, .postbody, .content') || post;
      const text = body.textContent || '';
      const mark = text.indexOf(STORE_MARK);
      if (!idMatch || mark < 0) continue;
      const start = text.indexOf('{', mark);
      const end = text.lastIndexOf('}');
      if (start < 0 || end < start) continue;
      let data;
      try { data = JSON.parse(text.slice(start, end + 1)); } catch (error) { continue; }
      const lng = Number(data.lng);
      const lat = Number(data.lat);
      const name = cleanText(data.name, 80);
      if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      places.push({
        id: `forum-${idMatch[0]}`,
        postId: idMatch[0],
        name,
        district: districtOf(data.district) ? data.district : null,
        category: state.categories[data.category] ? data.category : Object.keys(state.categories)[0],
        description: cleanText(data.description, 600),
        image: safeURL(data.image),
        link: safeURL(data.link),
        lng,
        lat
      });
    }
    return places;
  }

  /* Lit toutes les pages du sujet, et le rang de la personne connectée au passage */
  async function loadStore() {
    const topic = storeTopic();
    if (!topic) return;
    const firstHTML = await fetchPage(CONFIG.store);
    const level = firstHTML.match(/_userdata\["user_level"\]\s*=\s*(\d+)/);
    state.isAdmin = Boolean(level && CONFIG.staffLevels.includes(Number(level[1])));
    const first = parseHTML(firstHTML);
    const pages = new Set();
    for (const link of first.querySelectorAll(`a[href*="/t${topic}p"]`)) {
      const page = (link.getAttribute('href') || '').match(new RegExp(`/t${topic}p(\\d+)-[^#?]*`));
      if (page) pages.add(page[0]);
    }
    let places = readStorePosts(first);
    for (const path of pages) places = places.concat(readStorePosts(parseHTML(await fetchPage(path))));
    const seen = new Set();
    state.storePlaces = places.filter((place) => !seen.has(place.id) && seen.add(place.id));
  }

  /* Ouvre un formulaire du forum (répondre, éditer, supprimer), le remplit et l'envoie */
  async function sendForumForm(url, values, submitName) {
    const doc = parseHTML(await fetchPage(url));
    const form = Array.from(doc.forms).find((f) => f.querySelector(`[name="${submitName}"]`));
    if (!form) throw new Error('le forum n’a pas ouvert le formulaire (es-tu connecté·e avec un compte admin ?)');
    const data = new URLSearchParams();
    for (const field of form.querySelectorAll('input, textarea, select')) {
      const type = (field.getAttribute('type') || '').toLowerCase();
      if (!field.name || field.disabled || ['submit', 'button', 'image', 'file', 'reset'].includes(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !field.checked) continue;
      data.append(field.name, field.tagName === 'TEXTAREA' ? field.textContent : field.value);
    }
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    const submit = form.querySelector(`[name="${submitName}"]`);
    data.set(submitName, submit.value || '1');
    const action = new URL(form.getAttribute('action') || url, location.href).href;
    const response = await fetch(action, { method: 'POST', credentials: 'same-origin', body: data });
    if (!response.ok) throw new Error(`le forum répond ${response.status}`);
    return response.text();
  }

  function storeMessage(place) {
    const payload = {
      name: place.name, district: place.district, category: place.category,
      description: place.description, image: place.image, link: place.link,
      lng: Math.round(place.lng * 1e5) / 1e5, lat: Math.round(place.lat * 1e5) / 1e5
    };
    return `[code]${STORE_MARK} ${JSON.stringify(payload)}[/code]`;
  }

  async function reloadPlaces() {
    await loadStore();
    rebuildPlaces();
  }

  function rebuildPlaces() {
    state.places = state.basePlaces.concat(state.storePlaces);
    for (const { marker } of state.markers.values()) marker.remove();
    state.markers.clear();
    state.rows.clear();
    $('lb-list').replaceChildren();
    if (state.category !== 'all' && !state.places.some((p) => p.category === state.category)) state.category = 'all';
    renderCategoryFilters();
    renderList();
    if (state.loaded) createMarkers();
    applyFilters();
    if (state.selected) {
      if (state.places.some((p) => p.id === state.selected)) selectPlace(state.selected, false);
      else closeDetail();
    }
    $('lb-add').hidden = !state.isAdmin;
  }

  /* ---------- Formulaire « ajouter un lieu » ---------- */

  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInDistrict(point, feature) {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    return polygons.some((rings) => pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole)));
  }

  function onLand(point) {
    const pixel = state.map.project(point);
    const canvas = state.map.getCanvas();
    if (pixel.x < 0 || pixel.y < 0 || pixel.x > canvas.clientWidth || pixel.y > canvas.clientHeight) return false;
    return state.map.queryRenderedFeatures(pixel, { layers: ['water', 'waterways'] }).length === 0;
  }

  function waitForMap() {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 2500);
      state.map.once('idle', done);
    });
  }

  /* Un point au hasard dans le quartier, sur la terre ferme */
  async function randomSpot(feature) {
    state.map.fitBounds(districtBounds(feature), {
      padding: viewPadding(), maxZoom: 14.5, duration: duration(700),
      pitch: state.map.getPitch(), bearing: state.map.getBearing()
    });
    await waitForMap();
    const bounds = districtBounds(feature);
    const west = bounds.getWest(), east = bounds.getEast(), south = bounds.getSouth(), north = bounds.getNorth();
    let fallback = null;
    for (let i = 0; i < 400; i++) {
      const point = [west + Math.random() * (east - west), south + Math.random() * (north - south)];
      if (!pointInDistrict(point, feature)) continue;
      if (!fallback) fallback = point;
      if (onLand(point)) return point;
    }
    return fallback || feature.properties.label;
  }

  function setDraft(point) {
    if (!state.draft) {
      const pin = el('div', 'lb-pin is-draft');
      const dot = el('span', 'lb-pin__dot');
      dot.append(el('i', 'cp cp-plus'));
      pin.append(dot);
      state.draft = new maplibregl.Marker({ element: pin, anchor: 'center', draggable: true }).setLngLat(point).addTo(state.map);
    } else {
      state.draft.setLngLat(point);
    }
  }

  function formField(name) {
    return $('lb-form-el').elements[name];
  }

  function fillSelect(select, options, placeholder) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const [value, label] of options) select.append(new Option(label, value));
  }

  function formError(text) {
    $('lb-form-error').textContent = text || '';
    $('lb-form-error').hidden = !text;
  }

  async function placeDraftIn(districtId) {
    const feature = districtOf(districtId);
    if (!feature || !state.map) return;
    $('lb-form-hint').textContent = 'Recherche d’un emplacement…';
    setDraft(await randomSpot(feature));
    $('lb-form-hint').textContent = 'Repère posé au hasard dans le quartier. Fais-le glisser si tu veux le déplacer.';
  }

  function openForm(place) {
    closeDetail();
    state.editing = place || null;
    const form = $('lb-form-el');
    form.reset();
    formError('');
    fillSelect(formField('district'), state.districts.features.map((f) => [f.properties.id, f.properties.name]), 'Choisir un quartier');
    fillSelect(formField('category'), Object.entries(state.categories).map(([key, c]) => [key, c.label]), 'Choisir une catégorie');
    $('lb-form-title').textContent = place ? 'modifier le lieu' : 'nouveau lieu';
    $('lb-form-submit').textContent = place ? 'Enregistrer' : 'Ajouter à la carte';
    $('lb-form-hint').textContent = 'Choisis un quartier : le repère y sera posé au hasard.';
    if (place) {
      for (const key of ['name', 'district', 'category', 'description', 'image', 'link']) formField(key).value = place[key] || '';
      setDraft([place.lng, place.lat]);
      $('lb-form-hint').textContent = 'Fais glisser le repère pour le déplacer, ou change de quartier.';
      state.map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(state.map.getZoom(), 15), padding: viewPadding(), duration: duration(900) });
    }
    $('lb-form').hidden = false;
    if (isMobile()) togglePanel(false);
    formField('name').focus();
  }

  function closeForm() {
    $('lb-form').hidden = true;
    state.editing = null;
    if (state.draft) { state.draft.remove(); state.draft = null; }
  }

  async function saveForm(event) {
    event.preventDefault();
    const values = {};
    for (const key of ['name', 'district', 'category', 'description', 'image', 'link']) values[key] = cleanText(formField(key).value, key === 'description' ? 600 : 300);
    if (!values.name) return formError('Il manque le nom du lieu.');
    if (!values.district) return formError('Choisis un quartier.');
    if (!values.category) return formError('Choisis une catégorie.');
    if (values.image && !safeURL(values.image)) return formError('L’adresse de l’image doit commencer par https://');
    if (values.link && !safeURL(values.link)) return formError('Le lien doit commencer par https://');
    if (!state.draft) await placeDraftIn(values.district);
    const spot = state.draft.getLngLat();
    const place = { ...values, lng: spot.lng, lat: spot.lat };
    const button = $('lb-form-submit');
    button.disabled = true;
    formError('');
    setStatus('Enregistrement sur le forum…');
    const editing = state.editing;
    try {
      const message = storeMessage(place);
      if (editing) await sendForumForm(`/post?p=${editing.postId}&mode=editpost`, { message }, 'post');
      else await sendForumForm(`/post?t=${storeTopic()}&mode=reply`, { message }, 'post');
      const before = new Set(state.storePlaces.map((p) => p.id));
      await reloadPlaces();
      const saved = editing
        ? state.storePlaces.find((p) => p.id === editing.id && p.name === place.name)
        : state.storePlaces.find((p) => !before.has(p.id) && p.name === place.name);
      if (!saved) throw new Error('le forum n’a pas enregistré le message (attends quelques secondes et réessaie)');
      closeForm();
      setStatus('');
      selectPlace(saved.id, true);
    } catch (error) {
      setStatus('');
      formError(`Échec : ${error.message}.`);
    } finally {
      button.disabled = false;
    }
  }

  async function deletePlace(place) {
    if (!window.confirm(`Supprimer « ${place.name} » de la carte ?`)) return;
    setStatus('Suppression sur le forum…');
    try {
      await sendForumForm(`/post?p=${place.postId}&mode=delete`, {}, 'confirm');
      await reloadPlaces();
      if (state.storePlaces.some((p) => p.id === place.id)) throw new Error('le forum a refusé la suppression');
      closeDetail();
      setStatus('');
    } catch (error) {
      setStatus(`Échec : ${error.message}.`);
      setTimeout(() => setStatus(''), 6000);
    }
  }

  /* ---------- Thème clair / sombre (partagé avec le forum) ---------- */

  function currentScheme() {
    return document.documentElement.getAttribute('data-color-scheme') === 'light' ? 'light' : 'dark';
  }

  function updateThemeButton() {
    $('lb-theme').setAttribute('aria-label', currentScheme() === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
    $('lb-theme').title = $('lb-theme').getAttribute('aria-label');
  }

  function applyScheme(scheme, save) {
    document.documentElement.setAttribute('data-color-scheme', scheme);
    if (save) {
      try { localStorage.setItem('color-scheme', scheme); } catch (e) { /* stockage bloqué : le thème vaut pour cette visite */ }
    }
    updateThemeButton();
    /* Le fond de carte relit les variables du nouveau thème */
    if (state.map) state.map.setStyle(buildStyle(), { diff: true });
  }

  /* ---------- Démarrage ---------- */

  async function start() {
    try {
      const [placesData, districtsData] = await Promise.all([loadJSON(CONFIG.places), loadJSON(CONFIG.districts)]);
      state.categories = placesData.categories || {};
      state.places = (placesData.places || []).filter((p) => p && p.id && p.name && Number.isFinite(p.lng) && Number.isFinite(p.lat));
      state.basePlaces = state.places.slice();
      state.districts = prepareDistricts(districtsData);
    } catch (error) {
      setStatus(`Les données de la carte sont indisponibles. ${error.message}`);
      return;
    }

    renderDistrictFilters();
    renderCategoryFilters();
    renderList();
    applyFilters();

    /* Lieux du staff : chargés à part, la carte s'affiche sans les attendre */
    loadStore().then(rebuildPlaces).catch((error) => console.warn('[Livia Bay] lieux du forum indisponibles :', error.message));
    /* Aperçu local du formulaire (sans forum) : ajouter ?apercu-staff à l'adresse */
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /apercu-staff/.test(location.search)) {
      state.isAdmin = true;
      $('lb-add').hidden = false;
    }

    if (!window.maplibregl) {
      setStatus('Le moteur de carte n’a pas pu se charger. Rechargez la page.');
      return;
    }

    const home = CONFIG.home;
    const map = new maplibregl.Map({
      container: 'lb-map',
      style: buildStyle(),
      ...homeView(),
      pitch: home.pitch,
      bearing: home.bearing,
      maxPitch: 65,
      minZoom: 10,
      maxZoom: 18.5,
      maxBounds: CONFIG.maxBounds,
      attributionControl: false
    });
    state.map = map;
    if (!isMobile()) map.setPadding({ top: 0, bottom: 0, left: 360, right: 0 });
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Icônes : cappuccicons'
    }), 'bottom-right');

    map.on('load', () => {
      setStatus('');
      // Crédits repliés par défaut (un clic sur « i » les affiche)
      const attribution = document.querySelector('.maplibregl-ctrl-attrib');
      if (attribution) attribution.classList.remove('maplibregl-compact-show');
      // Les quartiers n'apparaissent qu'une fois le plan chargé
      state.loaded = true;
      for (const id of ['district-fill', 'district-glow', 'district-line']) map.setLayoutProperty(id, 'visibility', 'visible');
      createMarkers();
      bindDistrictHover();
      updateLabelVisibility();
    });
    map.on('zoom', updateLabelVisibility);
    map.on('click', () => {
      if (state.selected) closeDetail();
    });
    map.on('error', (event) => {
      if (event && event.error) console.warn('[Livia Bay]', event.error.message);
      if (event && event.error && /tiles|pbf|Failed to fetch/i.test(String(event.error.message))) {
        setStatus('Une partie du fond de carte n’a pas pu se charger.');
      }
    });
  }

  $('lb-detail-close').addEventListener('click', closeDetail);
  $('lb-add').addEventListener('click', () => openForm(null));
  $('lb-form-close').addEventListener('click', closeForm);
  $('lb-form-el').addEventListener('submit', saveForm);
  $('lb-form-el').elements.district.addEventListener('change', (event) => placeDraftIn(event.target.value));
  $('lb-form-shuffle').addEventListener('click', () => {
    const district = $('lb-form-el').elements.district.value;
    if (district) placeDraftIn(district);
    else formError('Choisis d’abord un quartier.');
  });
  $('lb-theme').addEventListener('click', () => applyScheme(currentScheme() === 'dark' ? 'light' : 'dark', true));
  /* Si le membre change de thème sur le forum dans un autre onglet, la carte suit */
  window.addEventListener('storage', (event) => {
    if (event.key === 'color-scheme' && event.newValue) applyScheme(event.newValue === 'light' ? 'light' : 'dark', false);
  });
  updateThemeButton();
  $('lb-panel-toggle').addEventListener('click', () => togglePanel());
  $('lb-zoom-in').addEventListener('click', () => state.map && state.map.zoomIn({ duration: duration(300) }));
  $('lb-zoom-out').addEventListener('click', () => state.map && state.map.zoomOut({ duration: duration(300) }));
  $('lb-home').addEventListener('click', () => {
    if (!state.map) return;
    closeDetail();
    setDistrict('all', false);
    goHome();
  });
  $('lb-3d').addEventListener('click', (event) => {
    if (!state.map) return;
    const button = event.currentTarget;
    const toFlat = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!toFlat));
    button.textContent = toFlat ? '2D' : '3D';
    state.map.easeTo({
      pitch: toFlat ? 0 : CONFIG.home.pitch,
      bearing: toFlat ? 0 : CONFIG.home.bearing,
      duration: duration(700)
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) closeDetail();
  });

  start();
})();
