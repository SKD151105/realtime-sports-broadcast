import { pool } from "./db.js";

async function main() {
    try {
        await pool.query("select 1 as ok");
        console.log("✅ Database connection OK");
        process.exitCode = 0;
    } catch (error) {
        const err = error;
        console.error("❌ Database connection FAILED");
        console.error("Reason:", {
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
