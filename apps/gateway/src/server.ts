import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { stopAutoPoller } from "./polling/autoPoller.js";
import { stopMonthlyConsolidator } from "./polling/monthlyConsolidator.js";

// Load .env file from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../../.env");
dotenvConfig({ path: envPath });

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
      // Stop background jobs first (P0-06: graceful shutdown)
      const logger = {
        info: (msg: string) => app.log.info(msg),
        warn: (msg: string) => app.log.warn(msg),
        error: (obj: unknown, msg: string) => app.log.error(obj, msg),
      };
      stopAutoPoller(logger);
      stopMonthlyConsolidator(logger);

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

// P0-08: Add error handler to prevent unhandled rejection on startup failure
main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
