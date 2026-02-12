import express from "express";
import { matchesRouter } from "./routes/matches.js";
import { pool } from "./db/db.js";

const app = express();
const PORT = 8000;

app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "Realtime Sports Broadcast API is running." });
});

app.get("/healthcheck/db", async (_req, res) => {
    try {
        await pool.query("select 1 as ok");
        res.status(200).json({ status: "ok", db: "ok" });
    } catch (error) {
        console.error("DB healthcheck failed");
        res.status(503).json({ status: "degraded", db: "down" });
    }
});

app.use("/matches", matchesRouter);

// Return JSON for invalid JSON bodies (instead of Express default HTML error page)
app.use((err, _req, res, _next) => {
    const isJsonSyntaxError = err instanceof SyntaxError && "body" in err;
    if (isJsonSyntaxError) {
        return res.status(400).json({ error: "Invalid JSON body" });
    }

    const status = err?.statusCode || err?.status || 500;
    return res.status(status).json({ error: err?.message || "Internal server error" });
});

app.listen(PORT, () => {
    console.log(`Server listening at http://localhost:${PORT}`);
});
