import { CITIES } from "./cities.js";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const USER_AGENT = "IsobarWeather/1.0";
const GRID_TOLERANCE_DEG = 1;

export class WeatherError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function near(actual, expected) {
  return finite(actual) && Math.abs(actual - expected) <= GRID_TOLERANCE_DEG;
}

function refuse(message) {
  throw new WeatherError(
    "upstream_unavailable",
    message ||
      "Open-Meteo did not return a usable forecast and nothing is cached. Retry shortly.",
  );
}

function assertConditions(item, city) {
  const current = item?.current;
  if (
    !current ||
    !finite(current.temperature_2m) ||
    !finite(current.weather_code) ||
    !finite(current.wind_speed_10m) ||
    !finite(current.relative_humidity_2m) ||
    !finite(item.utc_offset_seconds) ||
    !near(item.latitude, city.lat) ||
    !near(item.longitude, city.lon)
  ) {
    refuse("Open-Meteo conditions did not match the city catalog.");
  }
  const chance = item?.hourly?.precipitation_probability;
  if (!Array.isArray(chance) || chance.length < 1) {
    refuse("Open-Meteo conditions omitted precipitation probability.");
  }
  if (chance[0] != null && !finite(chance[0])) {
    refuse("Open-Meteo precipitation probability was not a number.");
  }
}

function sameLength(record, keys, minimum) {
  const arrays = keys.map((key) => record?.[key]);
  if (arrays.some((value) => !Array.isArray(value))) return false;
  const length = arrays[0].length;
  return length >= minimum && arrays.every((value) => value.length === length);
}

function assertDetail(item, city) {
  const current = item?.current;
  if (
    !current ||
    !finite(current.temperature_2m) ||
    !finite(current.apparent_temperature) ||
    !finite(current.relative_humidity_2m) ||
    !finite(current.wind_speed_10m) ||
    !finite(current.weather_code) ||
    !finite(current.precipitation) ||
    typeof current.time !== "string" ||
    !finite(item.utc_offset_seconds) ||
    !near(item.latitude, city.lat) ||
    !near(item.longitude, city.lon)
  ) {
    refuse("Open-Meteo detail did not match the requested city.");
  }
  if (!sameLength(item.hourly, ["time", "temperature_2m", "precipitation_probability"], 25)) {
    refuse("Open-Meteo detail omitted the next 24 hours.");
  }
  if (!item.hourly.temperature_2m.slice(0, 25).every(finite)) {
    refuse("Open-Meteo detail omitted an hourly temperature.");
  }
  if (
    !sameLength(
      item.daily,
      [
        "time",
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "sunrise",
        "sunset",
        "uv_index_max",
      ],
      7,
    )
  ) {
    refuse("Open-Meteo detail omitted the 7-day forecast.");
  }
  if (
    !item.daily.temperature_2m_max.every(finite) ||
    !item.daily.temperature_2m_min.every(finite) ||
    !item.daily.weather_code.every(finite)
  ) {
    refuse("Open-Meteo detail omitted a daily temperature.");
  }
}

async function readUpstream(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    refuse();
  }
  if (!response?.ok) refuse();
  try {
    return await response.json();
  } catch {
    refuse();
  }
}

export function createWeatherService({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = 10 * 60 * 1000,
  log = () => {},
  cities = CITIES,
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function load(key, run) {
    const hit = cache.get(key);
    const t = now();
    if (hit && t - hit.at < ttlMs) {
      return { stale: false, fetchedAt: new Date(hit.at).toISOString(), value: hit.value };
    }
    if (inflight.has(key)) return inflight.get(key);

    const started = now();
    const pending = (async () => {
      try {
        const value = await run();
        const at = now();
        cache.set(key, { at, value });
        log({ key, outcome: "fresh", ms: at - started });
        return { stale: false, fetchedAt: new Date(at).toISOString(), value };
      } catch (error) {
        log({
          key,
          outcome: hit ? "stale" : "unavailable",
          ms: now() - started,
          code: error?.code || "error",
        });
        if (hit) {
          return { stale: true, fetchedAt: new Date(hit.at).toISOString(), value: hit.value };
        }
        if (error instanceof WeatherError) throw error;
        refuse();
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
    return pending;
  }

  function conditionsUrl() {
    const params = new URLSearchParams({
      latitude: cities.map((city) => city.lat).join(","),
      longitude: cities.map((city) => city.lon).join(","),
      current: "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m",
      hourly: "precipitation_probability",
      forecast_hours: "1",
      timezone: "auto",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
    });
    return `${OPEN_METEO}?${params}`;
  }

  function detailUrl(city) {
    const params = new URLSearchParams({
      latitude: String(city.lat),
      longitude: String(city.lon),
      current:
        "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation",
      hourly: "temperature_2m,precipitation_probability",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max",
      timezone: "auto",
      forecast_days: "7",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
    });
    return `${OPEN_METEO}?${params}`;
  }

  return {
    async conditions() {
      return load("conditions", async () => {
        const json = await readUpstream(fetchImpl, conditionsUrl());
        const rows = Array.isArray(json) ? json : [json];
        if (rows.length !== cities.length) {
          refuse("Open-Meteo returned a different number of cities than the catalog.");
        }
        rows.forEach((row, index) => assertConditions(row, cities[index]));
        return rows;
      });
    },

    async city(id) {
      const city = cities.find((item) => item.id === id) ?? null;
      if (!city) {
        throw new WeatherError(
          "unknown_city",
          `No city "${id}" is on this dashboard. Pick an id from ids.`,
        );
      }
      return load(`city:${city.id}`, async () => {
        const json = await readUpstream(fetchImpl, detailUrl(city));
        const forecast = Array.isArray(json) ? json[0] : json;
        assertDetail(forecast, city);
        return forecast;
      });
    },
  };
}
