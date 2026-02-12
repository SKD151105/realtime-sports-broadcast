import "dotenv/config";
import { logger } from "./utils/logger.js";

const arcjetKey = process.env.ARCJET_KEY;
const configuredMode = process.env.ARCJET_MODE ?? process.env.ARCJECT_MODE;
const arcjetMode = configuredMode === "DRY_RUN" ? "DRY_RUN" : "LIVE";

let arcjetLib = null;
if (arcjetKey) {
    try {
        arcjetLib = await import("@arcjet/node");
    } catch (e) {
        logger.warn(
            "@arcjet/node not installed; Arcjet protection disabled. Install it to enable Arcjet.",
        );
    }
}

const buildArcjet = (rules) => {
    if (!arcjetKey || !arcjetLib) return null;

    const {
        default: arcjet,
        detectBot,
        shield,
        slidingWindow,
    } = arcjetLib;

    return arcjet({
        key: arcjetKey,
        rules: [
            shield({ mode: arcjetMode }),
            detectBot({
                mode: arcjetMode,
                allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:PREVIEW"],
            }),
            ...rules({ slidingWindow }),
        ],
    });
};

export const httpArcjet = buildArcjet(({ slidingWindow }) => [
    slidingWindow({ mode: arcjetMode, interval: "10s", max: 50 }),
]);

export const wsArcjet = buildArcjet(({ slidingWindow }) => [
    slidingWindow({ mode: arcjetMode, interval: "2s", max: 5 }),
]);

export function securityMiddleware() {
    return async (req, res, next) => {
        if (!httpArcjet) return next();

        try {
            const decision = await httpArcjet.protect(req);

            if (decision.isDenied()) {
                if (decision.reason.isRateLimit()) {
                    return res.status(429).json({ error: 'Too many requests.' });
                }

                return res.status(403).json({ error: 'Forbidden.' });
            }
        } catch (e) {
            logger.error('Arcjet middleware error', { error: e });
            return res.status(503).json({ error: 'Service Unavailable' });
        }

        next();
    }
}