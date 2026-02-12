// One-shot recap backfill for finished matches.
// This seeds commentary into matches that are already finished so the UI has recap content.
process.env.SEED_FORCE_LIVE = "false";
process.env.SEED_UPDATE_SCORES = "false";
process.env.SEED_LOOP = "false";
process.env.SEED_TARGET_STATUS = "finished";

// Backfill existing finished matches (idempotent: skips matches that already have commentary).
process.env.SEED_BACKFILL_EXISTING = "true";
process.env.SEED_SKIP_NONEMPTY = "true";

// Run quickly.
process.env.SEED_DELAY_MIN_MS = process.env.SEED_DELAY_MIN_MS || "20";
process.env.SEED_DELAY_MAX_MS = process.env.SEED_DELAY_MAX_MS || "80";

const { runSeed } = await import("./seed.js");
await runSeed();
