import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { createMatchSchema, listMatchesQuerySchema } from '../validation/matches.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { commentary, matches } from '../db/schema.js';
import { db } from '../db/db.js';
import { getMatchStatus } from '../utils/matchStatus.js';
import { logger } from '../utils/logger.js';

export const matchesRouter = Router();

const MAX_LIMIT = 100;

matchesRouter.get('/', async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues });
    }

    const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

    try {
        const data = await db
            .select()
            .from(matches)
            .orderBy(desc(matches.startTime))
            .limit(limit);

        return res.json({ matches: data });
    } catch (error) {
        logger.error('Failed to list matches', { error });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

matchesRouter.post('/', async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues });
    }

    const { startTime, endTime, homeScore, awayScore } = parsed.data;

    try {
        const [event] = await db.insert(matches).values({
            ...parsed.data,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            status: getMatchStatus(startTime, endTime),
        }).returning();

        res.status(201).json({ match: event });
    } catch (error) {
        logger.error('Failed to create match', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

matchesRouter.get('/:id/commentary', async (req, res) => {
    const matchId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(matchId) || matchId <= 0) {
        return res.status(400).json({ error: 'Invalid match id' });
    }

    const parsedQuery = listCommentaryQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
        return res.status(400).json({ error: parsedQuery.error.issues });
    }

    const limit = Math.min(parsedQuery.data.limit ?? 50, MAX_LIMIT);

    try {
        const data = await db
            .select()
            .from(commentary)
            .where(eq(commentary.matchId, matchId))
            .orderBy(desc(commentary.createdAt))
            .limit(limit);

        return res.json({ commentary: data });
    } catch (error) {
        logger.error('Failed to list commentary', { error, matchId });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

matchesRouter.post('/:id/commentary', async (req, res) => {
    const matchId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(matchId) || matchId <= 0) {
        return res.status(400).json({ error: 'Invalid match id' });
    }

    const parsed = createCommentarySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues });
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

        return res.status(201).json({ commentary: row });
    } catch (error) {
        logger.error('Failed to create commentary', { error, matchId });
        return res.status(500).json({ error: 'Internal server error' });
    }
});
