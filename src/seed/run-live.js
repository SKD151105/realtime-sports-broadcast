// Cross-platform wrapper to seed LIVE matches + score updates.
process.env.SEED_FORCE_LIVE = "true";
process.env.SEED_UPDATE_SCORES = "true";
process.env.SEED_LOOP = "true";
process.env.SEED_TARGET_STATUS = "live";

// Keep the UI feeling live without spamming.
process.env.SEED_DELAY_MIN_MS = process.env.SEED_DELAY_MIN_MS || "2000";
process.env.SEED_DELAY_MAX_MS = process.env.SEED_DELAY_MAX_MS || "3000";

const { runSeed } = await import("./seed.js");
await runSeed();
