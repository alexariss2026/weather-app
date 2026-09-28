import { createApp } from "../server/app.js";
import { createWeatherService } from "../server/service.js";

const weather = createWeatherService({
  log: (entry) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  },
});
const handle = createApp({ weather });

export function applyIncomingUrl(req) {
  const raw = req.url || "/";
  let url;
  try {
    url = new URL(raw, "http://localhost");
  } catch {
    return;
  }
  if (url.pathname !== "/api/index" && url.pathname !== "/api/index.js") return;
  const hinted = url.searchParams.get("__path") ?? "";
  url.searchParams.delete("__path");
  const pathname = `/${String(hinted).replace(/^\/+/, "")}`;
  const qs = url.searchParams.toString();
  req.url = qs ? `${pathname}?${qs}` : pathname;
}

export default function handler(req, res) {
  applyIncomingUrl(req);
  return handle(req, res);
}
