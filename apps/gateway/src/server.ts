import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();

  const app = await buildApp({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === "development"
          ? {
              target: "pino-pretty",
              options: { colorize: true },
            }
          : undefined,
    },
  });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Gateway listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

main();
