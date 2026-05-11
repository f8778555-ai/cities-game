/**
 * Собирает словарь городов для игры «Города».
 *
 * Источники:
 *   1. https://github.com/pensnarik/russian-cities — все города России (JSON).
 *   2. https://github.com/hflabs/city — города России (CSV, dadata.ru).
 *   3. ./world_cities_ru.json — столицы и крупные города мира в русском написании.
 *   4. ./extra_cities.txt — дополнительные города вручную (по одному на строку).
 *
 * Генерирует:
 *   • ../public/cities.js     — для браузера (window.CitiesDB)
 *   • ../server/cities_db.mjs — для Node-сервера (ESM export)
 *
 * Запуск:  node build_cities.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_BROWSER = resolve(__dirname, "..", "public", "cities.js");
const OUT_SERVER  = resolve(__dirname, "..", "server", "cities_db.mjs");
const CACHE_PENSNARIK = resolve(__dirname, ".cache_russian_cities.json");
const CACHE_HFLABS = resolve(__dirname, ".cache_hflabs_city.csv");
const WORLD = resolve(__dirname, "world_cities_ru.json");
const EXTRA_FILES = [
  resolve(__dirname, "extra_cities.txt"),
  resolve(__dirname, "extra_cities2.txt"),
  resolve(__dirname, "extra_cis.txt"),
  resolve(__dirname, "extra_cis2.txt"),
  resolve(__dirname, "ua_all_cities.txt"),
  resolve(__dirname, "extra_world.txt"),
  resolve(__dirname, "extra_world2.txt"),
  resolve(__dirname, "extra_world3.txt"),
  resolve(__dirname, "extra_world4.txt"),
];

const URL_PENSNARIK =
  "https://raw.githubusercontent.com/pensnarik/russian-cities/master/russian-cities.json";
const URL_HFLABS =
  "https://raw.githubusercontent.com/hflabs/city/master/city.csv";

async function fetchJSON(url, cache) {
  if (existsSync(cache)) {
    try { return JSON.parse(readFileSync(cache, "utf8")); } catch {}
  }
  console.log("→ скачиваем", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  writeFileSync(cache, JSON.stringify(data), "utf8");
  console.log(`  получено ${data.length} записей`);
  return data;
}

async function fetchText(url, cache) {
  if (existsSync(cache)) {
    try { return readFileSync(cache, "utf8"); } catch {}
  }
  console.log("→ скачиваем", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  writeFileSync(cache, text, "utf8");
  return text;
}

function parseHflabsCsv(csv) {
  // CSV: колонка "city" (индекс 9) содержит название города
  const lines = csv.split("\n");
  const cities = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Простой CSV-парсер: разбиваем по запятым, учитывая кавычки
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(field); field = ""; continue; }
      field += ch;
    }
    fields.push(field);
    const cityName = (fields[9] || "").trim();
    if (cityName) cities.add(cityName);
  }
  return Array.from(cities);
}

function norm(s) {
  return String(s).trim().toLowerCase().replace(/ё/g, "е");
}

function buildList(pensnarik, hflabs, world, extra) {
  const uniq = new Map(); // norm -> display name
  const add = (name) => {
    if (!name || typeof name !== "string") return;
    const cleaned = name.trim();
    if (!cleaned) return;
    if (!/^[А-ЯЁ]/.test(cleaned)) return;
    const n = norm(cleaned);
    if (!uniq.has(n)) uniq.set(n, cleaned);
  };
  for (const entry of pensnarik) add(entry.name);
  for (const name of hflabs) add(name);
  for (const name of world) add(name);
  for (const name of extra) add(name);
  return Array.from(uniq.values()).sort((a, b) => a.localeCompare(b, "ru"));
}

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function writeBrowser(cities) {
  const content = `/**
 * Автоматически сгенерировано build_cities.mjs. Не редактируйте вручную.
 * Источники: pensnarik/russian-cities + hflabs/city + world_cities_ru.json + extra_cities.txt
 * Записей: ${cities.length}
 */
(function (global) {
  const CITY_LIST = ${JSON.stringify(cities, null, 2)};

  function norm(s) {
    return s.trim().toLowerCase().replace(/ё/g, "е");
  }

  const INDEX = new Map();
  const CANONICAL = new Map();
  for (const city of CITY_LIST) {
    const n = norm(city);
    const first = n[0];
    if (!INDEX.has(first)) INDEX.set(first, new Set());
    INDEX.get(first).add(n);
    if (!CANONICAL.has(n)) CANONICAL.set(n, city);
  }

  global.CitiesDB = {
    has(name) { return CANONICAL.has(norm(name)); },
    canonical(name) { return CANONICAL.get(norm(name)) || name; },
    byLetter(letter) {
      const l = (letter || "").toLowerCase();
      return INDEX.get(l) ? Array.from(INDEX.get(l)) : [];
    },
    all() { return CITY_LIST.slice(); },
    size() { return CANONICAL.size; },
    norm,
  };
})(window);
`;
  ensureDir(OUT_BROWSER);
  writeFileSync(OUT_BROWSER, content, "utf8");
}

function writeServer(cities) {
  const content = `/**
 * Автоматически сгенерировано build_cities.mjs. Не редактируйте вручную.
 * Записей: ${cities.length}
 */
export const CITY_LIST = ${JSON.stringify(cities, null, 2)};

export function norm(s) {
  return String(s).trim().toLowerCase().replace(/ё/g, "е");
}

const INDEX = new Map();
const CANONICAL = new Map();
for (const city of CITY_LIST) {
  const n = norm(city);
  const first = n[0];
  if (!INDEX.has(first)) INDEX.set(first, new Set());
  INDEX.get(first).add(n);
  if (!CANONICAL.has(n)) CANONICAL.set(n, city);
}

export function has(name) { return CANONICAL.has(norm(name)); }
export function canonical(name) { return CANONICAL.get(norm(name)) || name; }
export function byLetter(letter) {
  const l = String(letter || "").toLowerCase();
  return INDEX.get(l) ? Array.from(INDEX.get(l)) : [];
}
export function size() { return CANONICAL.size; }
`;
  ensureDir(OUT_SERVER);
  writeFileSync(OUT_SERVER, content, "utf8");
}

async function main() {
  const pensnarik = await fetchJSON(URL_PENSNARIK, CACHE_PENSNARIK);
  const hflabsCsv = await fetchText(URL_HFLABS, CACHE_HFLABS);
  const hflabsCities = parseHflabsCsv(hflabsCsv);
  console.log(`  hflabs: ${hflabsCities.length} городов`);

  const world = JSON.parse(readFileSync(WORLD, "utf8"));

  let extra = [];
  for (const f of EXTRA_FILES) {
    if (existsSync(f)) {
      const lines = readFileSync(f, "utf8").split("\n").map(s => s.trim()).filter(Boolean);
      extra.push(...lines);
    }
  }
  if (extra.length) console.log(`  extra: ${extra.length} городов (из ${EXTRA_FILES.length} файлов)`);

  const cities = buildList(pensnarik, hflabsCities, world, extra);

  const byLetter = {};
  for (const c of cities) {
    const l = norm(c)[0];
    byLetter[l] = (byLetter[l] || 0) + 1;
  }
  console.log(`✓ Всего: ${cities.length} городов`);
  console.log("  По буквам:", Object.entries(byLetter)
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([l, n]) => `${l}=${n}`)
    .join(" "));

  writeBrowser(cities);
  writeServer(cities);
  console.log("→ public/cities.js");
  console.log("→ server/cities_db.mjs");
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
