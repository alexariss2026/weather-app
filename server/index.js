import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createWeatherService } from "./service.js";

const port = Number(process.env.PORT) || 3000;
const weather = createWeatherService({
  log: (entry) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  },
});
const server = createServer(createApp({ weather }));

server.listen(port, () => {
  console.log(`Isobar listening on http://localhost:${port}`);
});
