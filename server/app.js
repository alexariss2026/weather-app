import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./cities.js";
import { createWeatherService, WeatherError } from "./service.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "Isobar Weather Dashboard");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function publicFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const requested = decoded === "/" ? "Isobar Weather.dc.html" : decoded.replace(/^\/+/, "");
  if (!requested || requested.split("/").some((part) => part.startsWith("."))) return null;
  const full = path.resolve(publicRoot, requested);
  const relative = path.relative(publicRoot, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!TYPES[path.extname(full)]) return null;
  return full;
}

export function createApp({ weather = createWeatherService() } = {}) {
  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (req.method !== "GET") {
        sendJson(res, 405, {
          error: "method_not_allowed",
          message: "Weather routes accept GET only.",
        });
        return;
      }
      try {
        if (pathname === "/api/conditions") {
          const report = await weather.conditions();
          sendJson(res, 200, {
            source: "open-meteo",
            fetchedAt: report.fetchedAt,
            stale: report.stale,
            results: report.value,
          });
          return;
        }
        if (pathname.startsWith("/api/cities/")) {
          const id = pathname.slice("/api/cities/".length);
          if (!id || id.includes("/")) {
            sendJson(res, 404, {
              error: "not_found",
              message: "Ask for /api/cities/{id} using an id from the catalog.",
            });
            return;
          }
          const report = await weather.city(id);
          sendJson(res, 200, {
            source: "open-meteo",
            id,
            fetchedAt: report.fetchedAt,
            stale: report.stale,
            forecast: report.value,
          });
          return;
        }
        sendJson(res, 404, {
          error: "not_found",
          message: "Known routes are /api/conditions and /api/cities/{id}.",
        });
      } catch (error) {
        if (error instanceof WeatherError && error.code === "unknown_city") {
          sendJson(res, 404, {
            error: "unknown_city",
            message: error.message,
            ids: CITIES.map((city) => city.id),
          });
          return;
        }
        sendJson(res, 503, {
          error: "upstream_unavailable",
          message:
            "Open-Meteo did not return a usable forecast and nothing is cached. Retry shortly.",
        });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "method_not_allowed", message: "This page accepts GET only." });
      return;
    }

    const file = publicFile(pathname);
    if (!file) {
      sendJson(res, 404, { error: "not_found", message: "That file is not part of the dashboard." });
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      sendJson(res, 404, { error: "not_found", message: "That file is not part of the dashboard." });
      return;
    }
    if (!info.isFile()) {
      sendJson(res, 404, { error: "not_found", message: "That file is not part of the dashboard." });
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)],
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
