const LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

function normalizeLevel(level) {
    const value = String(level || "info").toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : "info";
}

function shouldLog(currentLevel, messageLevel) {
    return LEVELS[messageLevel] <= LEVELS[currentLevel];
}

function nowIso() {
    return new Date().toISOString();
}

function serializeError(err) {
    if (!err) return err;
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack,
        };
    }
    return err;
}

function write(streamFn, level, msg, meta) {
    const line = {
        ts: nowIso(),
        level,
        msg,
        ...(meta ? { meta } : null),
    };

    streamFn(JSON.stringify(line));
}

export function createLogger(options = {}) {
    const currentLevel = normalizeLevel(options.level ?? process.env.LOG_LEVEL);
    const baseMeta = options.baseMeta ?? null;

    const log = (level, msg, meta) => {
        if (!shouldLog(currentLevel, level)) return;
        const mergedMeta = baseMeta ? { ...baseMeta, ...(meta || {}) } : meta;
        const normalizedMeta = mergedMeta
            ? Object.fromEntries(
                  Object.entries(mergedMeta).map(([k, v]) => [k, serializeError(v)]),
              )
            : null;

        if (level === "error") return write(console.error, level, msg, normalizedMeta);
        if (level === "warn") return write(console.warn, level, msg, normalizedMeta);
        return write(console.log, level, msg, normalizedMeta);
    };

    return {
        level: currentLevel,
        debug: (msg, meta) => log("debug", msg, meta),
        info: (msg, meta) => log("info", msg, meta),
        warn: (msg, meta) => log("warn", msg, meta),
        error: (msg, meta) => log("error", msg, meta),
        child: (meta) =>
            createLogger({
                level: currentLevel,
                baseMeta: baseMeta ? { ...baseMeta, ...meta } : meta,
            }),
    };
}

export const logger = createLogger();
