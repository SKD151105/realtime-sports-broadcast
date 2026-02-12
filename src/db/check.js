import { pool } from "./db.js";
import { logger } from "../utils/logger.js";

async function main() {
    try {
        await pool.query("select 1 as ok");
        logger.info("Database connection OK");
        process.exitCode = 0;
    } catch (error) {
        const err = error;
        logger.error("Database connection FAILED", {
            name: err?.name,
            code: err?.code,
            message: err?.message,
            detail: err?.detail,
            hint: err?.hint,
        });
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
