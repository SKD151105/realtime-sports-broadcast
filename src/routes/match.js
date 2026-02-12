import { Router } from "express";
import { desc, eq } from "drizzle-orm";

import {
    createMatchSchema,
    listMatchesQuerySchema,
    matchIdParamSchema,
    updateScoreSchema,
    MATCH_STATUS,
} from "../validation/matches.js";
import { createCommentarySchema, listCommentaryQuerySchema } from "../validation/commentary.js";

import { matches, commentary } from "../db/schema.js";
import { db } from "../db/db.js";
import { formatZodError } from "../utils/formatZodError.js";
import { getMatchStatus, syncMatchStatus } from "../utils/match-status.js";
import { logger } from "../utils/logger.js";

export const matchRouter = Router();

const MAX_LIMIT = 100;

matchRouter.get("/", async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid query.", details: parsed.error.issues });
    }

    const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

    try {
        const data = await db
            .select()
            .from(matches)
            .orderBy(desc(matches.createdAt))
            .limit(limit);

        return res.json({ data });
    } catch (e) {
        logger.error("Failed to list matches", { error: e });
        return res.status(500).json({ error: "Failed to list matches." });
    }
});

matchRouter.post("/", async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid payload.", details: parsed.error.issues });
    }

    const { startTime, endTime, homeScore, awayScore } = parsed.data;
    const startTimeDate = new Date(startTime);
    const endTimeDate = new Date(endTime);

    try {
        const [event] = await db
            .insert(matches)
            .values({
                ...parsed.data,
                startTime: startTimeDate,
                endTime: endTimeDate,
                homeScore: homeScore ?? 0,
                awayScore: awayScore ?? 0,
                status: getMatchStatus(startTimeDate, endTimeDate),
            })
            .returning();

        if (res.app.locals.broadcastMatchCreated) {
            res.app.locals.broadcastMatchCreated(event);
        }

        return res.status(201).json({ data: event });
    } catch (e) {
        logger.error("Failed to create match", { error: e });
        return res.status(500).json({ error: "Failed to create match." });
    }
});

matchRouter.patch("/:id/score", async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return res
            .status(400)
            .json({ error: "Invalid match id", details: formatZodError(paramsParsed.error) });
    }

    const bodyParsed = updateScoreSchema.safeParse(req.body);
    if (!bodyParsed.success) {
        return res
            .status(400)
            .json({ error: "Invalid payload", details: formatZodError(bodyParsed.error) });
    }

    const matchId = paramsParsed.data.id;

    try {
        const [existing] = await db
            .select({
                id: matches.id,
                status: matches.status,
                startTime: matches.startTime,
                endTime: matches.endTime,
            })
            .from(matches)
            .where(eq(matches.id, matchId))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: "Match not found" });
        }

        await syncMatchStatus(existing, async (nextStatus) => {
            await db.update(matches).set({ status: nextStatus }).where(eq(matches.id, matchId));
        });

        if (existing.status !== MATCH_STATUS.LIVE) {
            return res.status(409).json({ error: "Match is not live" });
        }

        const [updated] = await db
            .update(matches)
            .set({
                homeScore: bodyParsed.data.homeScore,
                awayScore: bodyParsed.data.awayScore,
            })
            .where(eq(matches.id, matchId))
            .returning();

        if (res.app.locals.broadcastScoreUpdate) {
            res.app.locals.broadcastScoreUpdate(matchId, {
                homeScore: updated.homeScore,
                awayScore: updated.awayScore,
            });
        }

        return res.json({ data: updated });
    } catch (err) {
        logger.error("Failed to update score", { error: err, matchId });
        return res.status(500).json({ error: "Failed to update score" });
    }
});

matchRouter.get("/:id/commentary", async (req, res) => {
    const matchId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(matchId) || matchId <= 0) {
        return res.status(400).json({ error: "Invalid match id" });
    }

    const parsedQuery = listCommentaryQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
        return res.status(400).json({ error: "Invalid query.", details: parsedQuery.error.issues });
    }

    const limit = Math.min(parsedQuery.data.limit ?? 50, MAX_LIMIT);

    try {
        const data = await db
            .select()
            .from(commentary)
            .where(eq(commentary.matchId, matchId))
            .orderBy(desc(commentary.createdAt))
            .limit(limit);

        return res.json({ data });
    } catch (error) {
        logger.error("Failed to list commentary", { error, matchId });
        return res.status(500).json({ error: "Failed to list commentary." });
    }
});

matchRouter.post("/:id/commentary", async (req, res) => {
    const matchId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(matchId) || matchId <= 0) {
        return res.status(400).json({ error: "Invalid match id" });
    }

    const parsed = createCommentarySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid payload.", details: parsed.error.issues });
    }

    try {
        const [row] = await db
            .insert(commentary)
            .values({
                matchId,
                minute: parsed.data.minute,
                sequence: parsed.data.sequence,
                period: parsed.data.period,
                eventType: parsed.data.eventType,
                actor: parsed.data.actor,
                team: parsed.data.team,
                message: parsed.data.message,
                metadata: parsed.data.metadata,
                tags: parsed.data.tags,
            })
            .returning();

        if (res.app.locals.broadcastCommentary) {
            res.app.locals.broadcastCommentary(matchId, row);
        }

        return res.status(201).json({ data: row });
    } catch (e) {
        logger.error("Failed to create commentary", { error: e, matchId });
        return res.status(500).json({ error: "Failed to create commentary." });
    }
});
