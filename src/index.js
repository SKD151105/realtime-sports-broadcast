import express from "express";
import cors from "cors";
import { matchRouter } from "./routes/match.js";
import { pool } from "./db/db.js";
import { attachWebSocketServer } from "./ws/server.js";
import { logger } from "./utils/logger.js";

const app = express();
const PORT = 8000;

const configuredCorsOrigin = process.env.CORS_ORIGIN;

app.use(
    cors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);
            if (configuredCorsOrigin) {
                return callback(null, origin === configuredCorsOrigin);
            }

            // Dev default: allow any localhost/127.0.0.1 port (Vite uses 5173 by default)
            const isLocalhost =
                /^https?:\/\/localhost(?::\d+)?$/i.test(origin) ||
                /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin);

            return callback(null, isLocalhost);
        },
    }),
);
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "Realtime Sports Broadcast API is running." });
});

app.get("/healthcheck/db", async (_req, res) => {
    try {
        await pool.query("select 1 as ok");
        res.status(200).json({ status: "ok", db: "ok" });
    } catch (error) {
        logger.error("DB healthcheck failed", { error });
        res.status(503).json({ status: "degraded", db: "down" });
    }
});

app.use("/matches", matchRouter);

// Return JSON for invalid JSON bodies (instead of Express default HTML error page)
app.use((err, _req, res, _next) => {
    const isJsonSyntaxError = err instanceof SyntaxError && "body" in err;
    if (isJsonSyntaxError) {
        return res.status(400).json({ error: "Invalid JSON body" });
    }

    const status = err?.statusCode || err?.status || 500;
    return res.status(status).json({ error: err?.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
    logger.info("Server listening", { url: `http://localhost:${PORT}` });
});

// Enable WebSocket upgrades on /ws
const ws = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = ws.broadcastMatchCreated;
app.locals.broadcastCommentary = ws.broadcastCommentary;
app.locals.broadcastScoreUpdate = ws.broadcastScoreUpdate;
