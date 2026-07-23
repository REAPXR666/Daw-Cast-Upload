import { env } from "./env.js";
import { buildApp } from "./app.js";

const app = await buildApp();

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`api-server listening on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
