import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CITIES } from "../cities.js";
import { createWeatherService } from "../service.js";
import { createApp } from "../app.js";
import { applyIncomingUrl } from "../../api/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const designPath = path.join(repoRoot, "Isobar Weather Dashboard", "Isobar Weather.dc.html");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function batch(rows = CITIES) {
  return rows.map((city, index) => ({
    latitude: city.lat,
    longitude: city.lon,
    utc_offset_seconds: 0,
    current: {
      temperature_2m: index,
      weather_code: 0,
      wind_speed_10m: 3,
      relative_humidity_2m: 40,
    },
    hourly: { precipitation_probability: [index] },
  }));
}

function detail(city) {
  return {
    latitude: city.lat,
    longitude: city.lon,
    utc_offset_seconds: 32400,
    current: {
      time: "2026-09-28T17:30",
      temperature_2m: 23.1,
      apparent_temperature: 27.5,
      relative_humidity_2m: 94,
      wind_speed_10m: 4,
      weather_code: 55,
      precipitation: 0.3,
    },
    hourly: {
      time: Array.from({ length: 30 }, (_, index) => `2026-09-28T${String(index % 24).padStart(2, "0")}:00`),
      temperature_2m: Array.from({ length: 30 }, (_, index) => 20 + index),
      precipitation_probability: Array.from({ length: 30 }, () => 10),
    },
    daily: {
      time: Array.from({ length: 7 }, (_, index) => `2026-09-2${index + 1}`),
      weather_code: Array.from({ length: 7 }, () => 1),
      temperature_2m_max: Array.from({ length: 7 }, () => 24),
      temperature_2m_min: Array.from({ length: 7 }, () => 18),
      sunrise: Array.from({ length: 7 }, () => "2026-09-28T05:33"),
      sunset: Array.from({ length: 7 }, () => "2026-09-28T17:30"),
      uv_index_max: Array.from({ length: 7 }, () => 3),
    },
  };
}

function harness({ fail = false, bodyFor } = {}) {
  const calls = [];
  let clock = 1_000_000;
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (fail instanceof Function ? fail(calls.length, url) : fail) {
      throw new Error("network");
    }
    if (bodyFor) return jsonResponse(bodyFor(String(url), calls.length));
    if (String(url).includes("forecast_days=7")) {
      const city = CITIES.find((item) => String(url).includes(`latitude=${item.lat}`));
      return jsonResponse(detail(city));
    }
    return jsonResponse(batch());
  };
  const weather = createWeatherService({ fetchImpl, now: () => clock, ttlMs: 10 * 60 * 1000, log() {} });
  const handle = createApp({ weather });
  return {
    calls,
    advance(ms) {
      clock += ms;
    },
    async get(urlPath) {
      const chunks = [];
      let statusCode = 0;
      let headers = {};
      const res = {
        writeHead(code, value) {
          statusCode = code;
          headers = value || {};
        },
        end(body) {
          if (body) chunks.push(Buffer.from(body));
        },
        pipe() {},
      };
      const req = { method: "GET", url: urlPath };
      await handle(req, res);
      const raw = Buffer.concat(chunks).toString("utf8");
      return {
        statusCode,
        headers,
        raw,
        json: raw && headers["Content-Type"]?.includes("json") ? JSON.parse(raw) : null,
      };
    },
  };
}

test("unknown city is refused and does not call Open-Meteo", async () => {
  const app = harness();
  const response = await app.get("/api/cities/atlantis");
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.error, "unknown_city");
  assert.match(response.json.message, /atlantis/);
  assert.ok(response.json.ids.includes("tokyo"));
  assert.equal(JSON.stringify(response.json).includes("temperature"), false);
  assert.equal(app.calls.length, 0);
});

test("a short Open-Meteo batch is refused and not cached", async () => {
  const app = harness({ bodyFor: () => batch(CITIES.slice(0, 1)) });
  const first = await app.get("/api/conditions");
  const second = await app.get("/api/conditions");
  assert.equal(first.statusCode, 503);
  assert.equal(first.json.error, "upstream_unavailable");
  assert.equal(JSON.stringify(first.json).includes("temperature"), false);
  assert.match(first.json.message, /Retry shortly/);
  assert.equal(second.statusCode, 503);
  assert.equal(app.calls.length, 2);
});

test("a batch whose coordinates do not match the catalog is refused", async () => {
  const swapped = batch();
  const first = swapped[0];
  swapped[0] = { ...swapped[swapped.length - 1], current: { ...swapped[swapped.length - 1].current, temperature_2m: 999 } };
  swapped[swapped.length - 1] = first;
  const app = harness({ bodyFor: (url) => (url.includes("forecast_days") ? detail(CITIES[0]) : swapped) });
  const response = await app.get("/api/conditions");
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.stringify(response.json).includes("999"), false);
});

test("fresh conditions are cached and a later outage serves them as stale", async () => {
  let down = false;
  const app = harness({ fail: () => down });
  const fresh = await app.get("/api/conditions");
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.json.stale, false);
  assert.equal(fresh.json.source, "open-meteo");
  assert.equal(fresh.json.results.length, CITIES.length);
  assert.equal(fresh.json.results[0].current.temperature_2m, 0);
  assert.equal(fresh.json.results.at(-1).current.temperature_2m, CITIES.length - 1);
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0], /temperature_unit=celsius/);
  assert.match(app.calls[0], /wind_speed_unit=kmh/);
  assert.equal(app.calls[0].includes("latitude=0"), false);

  const cached = await app.get("/api/conditions");
  assert.equal(cached.json.stale, false);
  assert.equal(app.calls.length, 1);

  app.advance(10 * 60 * 1000 + 1);
  down = true;
  const stale = await app.get("/api/conditions");
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.results[0].current.temperature_2m, 0);
  assert.equal(stale.json.fetchedAt, fresh.json.fetchedAt);
});

test("city detail uses the catalog coordinates, not a query string", async () => {
  const app = harness();
  const response = await app.get("/api/cities/tokyo?latitude=0&longitude=0");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.forecast.current.temperature_2m, 23.1);
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0], /latitude=35\.68/);
  assert.match(app.calls[0], /longitude=139\.69/);
  assert.equal(app.calls[0].includes("latitude=0"), false);
});

test("detail with a missing hourly temperature is refused", async () => {
  const app = harness({
    bodyFor: (url) => {
      if (!url.includes("forecast_days")) return batch();
      const city = CITIES.find((item) => url.includes(`latitude=${item.lat}`));
      const row = detail(city);
      row.hourly.temperature_2m[3] = null;
      return row;
    },
  });
  const response = await app.get("/api/cities/tokyo");
  assert.equal(response.statusCode, 503);
  assert.equal(response.json.error, "upstream_unavailable");
  assert.equal(JSON.stringify(response.json).includes("temperature_2m"), false);
});

test("the dashboard page is served and server files are not", async () => {
  const app = harness();
  const page = await app.get("/");
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["Content-Type"], /text\/html/);
  assert.match(page.raw, /Isobar/);
  assert.match(page.raw, /\/api\/conditions/);
  const escaped = await app.get("/../package.json");
  assert.equal(escaped.statusCode, 404);
  const support = await app.get("/support.js");
  assert.equal(support.statusCode, 200);
  assert.match(support.raw, /DCLogic/);
});

test("central Africa is on the catalog", () => {
  for (const id of ["libreville", "portgentil", "yaounde", "douala", "brazzaville", "pointenoire", "kinshasa", "bangui", "malabo"]) {
    assert.ok(CITIES.some((city) => city.id === id), id);
  }
});

test("the design page and the server catalog are the same cities, in the same order", () => {
  const html = readFileSync(designPath, "utf8");
  const start = html.indexOf("const CITIES = [");
  const end = html.indexOf("].map(", start);
  assert.ok(start > 0 && end > start);
  const rows = Function(`"use strict"; return (${html.slice(start + "const CITIES = ".length, end + 1)});`)();
  assert.deepEqual(
    rows.map(([id, name, country, lat, lon]) => ({ id, name, country, lat, lon })),
    CITIES,
  );
  assert.equal(html.includes("api.open-meteo.com"), false);
  assert.equal(html.includes("mockCurrent"), false);
  assert.equal(html.includes("/api/conditions"), true);
  assert.equal(html.includes("/api/cities/"), true);
});

test("a map tap hits the nearest city and misses the ocean", () => {
  const html = readFileSync(designPath, "utf8");
  const start = html.indexOf("function nearestCity");
  const end = html.indexOf("function nightShade", start);
  assert.ok(start > 0 && end > start);
  const nearestCity = Function(`"use strict"; ${html.slice(start, end)}; return nearestCity;`)();
  const cities = [
    { id: "a", lon: 0, lat: 0 },
    { id: "b", lon: 10, lat: 0 },
  ];
  const rect = { left: 0, top: 0, width: 360, height: 140 };
  assert.equal(nearestCity(cities, rect, 0, 0, 1, 180, 80, 22).id, "a");
  assert.equal(nearestCity(cities, rect, 0, 0, 1, 190, 80, 22).id, "b");
  assert.equal(nearestCity(cities, rect, 0, 0, 1, 0, 0, 22), null);
});

test("an empty or unknown choice opens on Libreville", () => {
  const html = readFileSync(designPath, "utf8");
  const start = html.indexOf("const HOME_ID");
  const end = html.indexOf("const WMO_EN", start);
  assert.ok(start > 0 && end > start);
  const chosenCity = Function(`"use strict"; ${html.slice(start, end)}; return chosenCity;`)();
  const cities = [{ id: "tokyo" }, { id: "libreville" }, { id: "dakar" }];
  assert.equal(chosenCity(cities, null).id, "libreville");
  assert.equal(chosenCity(cities, "").id, "libreville");
  assert.equal(chosenCity(cities, "missing").id, "libreville");
  assert.equal(chosenCity(cities, "dakar").id, "dakar");
});

test("a Vercel rewrite still opens the dashboard and the weather routes", async () => {
  const config = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  assert.equal(config.functions["api/index.js"].includeFiles, "Isobar Weather Dashboard/**");
  assert.ok(config.rewrites.some((rule) => rule.destination.startsWith("/api/index?__path=")));

  const home = { method: "GET", url: "/api/index?__path=" };
  applyIncomingUrl(home);
  assert.equal(home.url, "/");
  const page = await harness().get(home.url);
  assert.equal(page.statusCode, 200);
  assert.match(page.raw, /Isobar/);
  assert.match(page.raw, /\/api\/conditions/);

  const city = { method: "GET", url: "/api/index?__path=api/cities/tokyo&latitude=0" };
  applyIncomingUrl(city);
  assert.equal(city.url, "/api/cities/tokyo?latitude=0");

  const direct = { method: "GET", url: "/api/conditions" };
  applyIncomingUrl(direct);
  assert.equal(direct.url, "/api/conditions");

  const escaped = { method: "GET", url: "/api/index?__path=../package.json" };
  applyIncomingUrl(escaped);
  const blocked = await harness().get(escaped.url);
  assert.equal(blocked.statusCode, 404);
});
