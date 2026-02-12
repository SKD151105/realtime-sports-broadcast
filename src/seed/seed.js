import "dotenv/config";
import fs from "fs/promises";
import { pathToFileURL } from "url";
import { logger } from "../utils/logger.js";

const DELAY_MS = Number.parseInt(process.env.DELAY_MS || "250", 10);
const DELAY_MIN_MS = Number.parseInt(process.env.SEED_DELAY_MIN_MS || "0", 10);
const DELAY_MAX_MS = Number.parseInt(process.env.SEED_DELAY_MAX_MS || "0", 10);
const NEW_MATCH_DELAY_MIN_MS = 2000;
const NEW_MATCH_DELAY_MAX_MS = 3000;
const DEFAULT_MATCH_DURATION_MINUTES = Number.parseInt(
    process.env.SEED_MATCH_DURATION_MINUTES || "120",
    10,
);
const FORCE_LIVE =
    process.env.SEED_FORCE_LIVE !== "0" &&
    process.env.SEED_FORCE_LIVE !== "false";
const UPDATE_SCORES =
    process.env.SEED_UPDATE_SCORES === "1" ||
    String(process.env.SEED_UPDATE_SCORES || "").toLowerCase() === "true";
const LOOP =
    process.env.SEED_LOOP === "1" ||
    String(process.env.SEED_LOOP || "").toLowerCase() === "true";
const TARGET_STATUS = String(process.env.SEED_TARGET_STATUS || "all").toLowerCase();
const BACKFILL_EXISTING =
    process.env.SEED_BACKFILL_EXISTING === "1" ||
    String(process.env.SEED_BACKFILL_EXISTING || "").toLowerCase() === "true";
const SKIP_NONEMPTY =
    process.env.SEED_SKIP_NONEMPTY === "1" ||
    String(process.env.SEED_SKIP_NONEMPTY || "").toLowerCase() === "true";
const API_URL = process.env.API_URL || "http://localhost:8000";
const DEFAULT_DATA_FILE = new URL("../data/data.json", import.meta.url);

async function readJsonFile(fileUrl) {
    const raw = await fs.readFile(fileUrl, "utf8");
    return JSON.parse(raw);
}

async function loadSeedData() {
    let parsed;
    try {
        parsed = await readJsonFile(DEFAULT_DATA_FILE);
    } catch (error) {
        logger.warn("Seed data file not found; using empty seed dataset.");
        return { feed: [], matches: [] };
    }

    if (Array.isArray(parsed)) {
        return { feed: parsed, matches: [] };
    }

    if (Array.isArray(parsed.commentary)) {
        return { feed: parsed.commentary, matches: parsed.matches ?? [] };
    }

    if (Array.isArray(parsed.feed)) {
        return { feed: parsed.feed, matches: parsed.matches ?? [] };
    }

    throw new Error(
        "Seed data must be an array or contain a commentary/feed array.",
    );
}

async function fetchMatches(limit = 100) {
    const response = await fetch(`${API_URL}/matches?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch matches: ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.matches)) return payload.matches;
    return [];
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isLiveMatch(match) {
    const start = parseDate(match.startTime);
    const end = parseDate(match.endTime);
    if (!start || !end) {
        return false;
    }
    const now = new Date();
    return now >= start && now < end;
}

function isFinishedMatch(match) {
    const end = parseDate(match.endTime);
    if (!end) return false;
    return new Date() >= end;
}

function isUpcomingMatch(match) {
    const start = parseDate(match.startTime);
    if (!start) return false;
    return new Date() < start;
}

function matchPassesTarget(match) {
    if (!TARGET_STATUS || TARGET_STATUS === "all") return true;
    if (TARGET_STATUS === "live") return isLiveMatch(match);
    if (TARGET_STATUS === "finished") return isFinishedMatch(match);
    if (TARGET_STATUS === "upcoming") return isUpcomingMatch(match);
    return true;
}

function buildMatchTimes(seedMatch) {
    const now = new Date();
    const durationMs = DEFAULT_MATCH_DURATION_MINUTES * 60 * 1000;

    let start = parseDate(seedMatch.startTime);
    let end = parseDate(seedMatch.endTime);

    if (!start && !end) {
        if (TARGET_STATUS === "finished" && !FORCE_LIVE) {
            end = new Date(now.getTime() - 10 * 60 * 1000);
            start = new Date(end.getTime() - durationMs);
        } else {
            start = new Date(now.getTime() - 5 * 60 * 1000);
            end = new Date(start.getTime() + durationMs);
        }
    } else {
        if (start && !end) {
            end = new Date(start.getTime() + durationMs);
        }
        if (!start && end) {
            start = new Date(end.getTime() - durationMs);
        }
    }

    if (FORCE_LIVE && start && end) {
        if (!(now >= start && now < end)) {
            start = new Date(now.getTime() - 5 * 60 * 1000);
            end = new Date(start.getTime() + durationMs);
        }
    }

    if (!start || !end) {
        throw new Error("Seed match must include valid startTime and endTime.");
    }

    return {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
    };
}

async function createMatch(seedMatch) {
    const { startTime, endTime } = buildMatchTimes(seedMatch);

    const response = await fetch(`${API_URL}/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sport: seedMatch.sport,
            homeTeam: seedMatch.homeTeam,
            awayTeam: seedMatch.awayTeam,
            startTime,
            endTime,
            homeScore: seedMatch.homeScore ?? 0,
            awayScore: seedMatch.awayScore ?? 0,
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to create match: ${response.status}`);
    }
    const responsePayload = await response.json();
    return responsePayload.data ?? responsePayload.match ?? responsePayload;
}

async function insertCommentary(matchId, entry) {
    const payload = {
        message: entry.message ?? "Update",
    };
    if (entry.minute !== undefined && entry.minute !== null) {
        payload.minute = entry.minute;
    }
    if (entry.sequence !== undefined && entry.sequence !== null) {
        payload.sequence = entry.sequence;
    }
    if (entry.period !== undefined && entry.period !== null) {
        payload.period = entry.period;
    }
    if (entry.eventType !== undefined && entry.eventType !== null) {
        payload.eventType = entry.eventType;
    }
    if (entry.actor !== undefined && entry.actor !== null) {
        payload.actor = entry.actor;
    }
    if (entry.team !== undefined && entry.team !== null) {
        payload.team = entry.team;
    }
    if (entry.metadata !== undefined && entry.metadata !== null) {
        payload.metadata = entry.metadata;
    }
    if (entry.tags !== undefined && entry.tags !== null) {
        payload.tags = entry.tags;
    }

    const response = await fetch(`${API_URL}/matches/${matchId}/commentary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Failed to create commentary: ${response.status}`);
    }
    const responsePayload = await response.json();
    return responsePayload.data ?? responsePayload.commentary ?? responsePayload;
}

function extractRuns(entry) {
    if (Number.isFinite(entry.runs)) {
        return entry.runs;
    }
    if (entry.metadata && Number.isFinite(entry.metadata.runs)) {
        return entry.metadata.runs;
    }
    if (entry.eventType === "four") {
        return 4;
    }
    if (entry.eventType === "six") {
        return 6;
    }
    if (entry.eventType === "run") {
        return 1;
    }
    return null;
}

function scoreDeltaFromEntry(entry, match) {
    if (entry.scoreDelta && typeof entry.scoreDelta === "object") {
        return {
            home: Number(entry.scoreDelta.home || 0),
            away: Number(entry.scoreDelta.away || 0),
        };
    }

    if (entry.eventType === "goal") {
        if (entry.team === match.homeTeam) {
            return { home: 1, away: 0 };
        }
        if (entry.team === match.awayTeam) {
            return { home: 0, away: 1 };
        }
    }

    const runs = extractRuns(entry);
    if (runs !== null) {
        if (entry.team === match.homeTeam) {
            return { home: runs, away: 0 };
        }
        if (entry.team === match.awayTeam) {
            return { home: 0, away: runs };
        }
    }

    return null;
}

function fakeScoreDelta(matchState) {
    const nextSide = matchState.fakeNext === "home" ? "away" : "home";
    matchState.fakeNext = nextSide;
    const points = 1;
    return nextSide === "home"
        ? { home: points, away: 0 }
        : { home: 0, away: points };
}

function inningsRank(period) {
    if (!period) {
        return 0;
    }
    const lower = String(period).toLowerCase();
    const match = lower.match(/(\d+)(st|nd|rd|th)/);
    if (match) {
        return Number(match[1]) || 0;
    }
    if (lower.includes("first")) {
        return 1;
    }
    if (lower.includes("second")) {
        return 2;
    }
    if (lower.includes("third")) {
        return 3;
    }
    if (lower.includes("fourth")) {
        return 4;
    }
    return 0;
}

function cricketBattingTeam(entry, match) {
    const rank = inningsRank(entry.period);
    if (rank === 1) {
        return match.homeTeam;
    }
    if (rank === 2) {
        return match.awayTeam;
    }
    return null;
}

// function cricketScoreDelta(entry, match) {
//   const battingTeam = cricketBattingTeam(entry, match);
//   let delta = scoreDeltaFromEntry(entry, match);
//   if (!delta) {
//     if (!battingTeam) {
//       return null;
//     }
//     const points = 1;
//     return battingTeam === match.homeTeam
//       ? { home: points, away: 0 }
//       : { home: 0, away: points };
//   }
//
//   if (!battingTeam) {
//     return delta;
//   }
//
//   if (battingTeam === match.homeTeam) {
//     return { home: delta.home, away: 0 };
//   }
//   return { home: 0, away: delta.away };
// }

function normalizeCricketFeed(entries, match) {
    const sorted = [...entries].sort((a, b) => {
        const inningsDiff = inningsRank(a.period) - inningsRank(b.period);
        if (inningsDiff !== 0) {
            return inningsDiff;
        }
        const seqA = Number.isFinite(a.sequence)
            ? a.sequence
            : Number.MAX_SAFE_INTEGER;
        const seqB = Number.isFinite(b.sequence)
            ? b.sequence
            : Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) {
            return seqA - seqB;
        }
        const minA = Number.isFinite(a.minute) ? a.minute : Number.MAX_SAFE_INTEGER;
        const minB = Number.isFinite(b.minute) ? b.minute : Number.MAX_SAFE_INTEGER;
        return minA - minB;
    });

    const grouped = new Map();
    for (const entry of sorted) {
        const key = inningsRank(entry.period);
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(entry);
    }

    const ordered = [];
    const inningsKeys = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const key of inningsKeys) {
        const inningsEntries = grouped.get(key) || [];
        const primaryTeam = inningsEntries.find(
            (entry) => entry.team === match.homeTeam || entry.team === match.awayTeam,
        )?.team;
        const secondaryTeam =
            primaryTeam === match.homeTeam ? match.awayTeam : match.homeTeam;

        const neutral = inningsEntries.filter(
            (entry) => !entry.team || entry.team === "neutral",
        );
        const primary = inningsEntries.filter(
            (entry) => entry.team === primaryTeam,
        );
        const secondary = inningsEntries.filter(
            (entry) => entry.team === secondaryTeam,
        );
        const other = inningsEntries.filter(
            (entry) =>
                entry.team &&
                entry.team !== "neutral" &&
                entry.team !== primaryTeam &&
                entry.team !== secondaryTeam,
        );

        ordered.push(...neutral, ...primary, ...secondary, ...other);
    }

    return ordered;
}

function replaceTrailingTeam(message, replacements) {
    if (typeof message !== "string") {
        return message;
    }
    const match = message.match(/\(([^)]+)\)\s*$/);
    if (!match) {
        return message;
    }
    const nextTeam = replacements.get(match[1]);
    if (!nextTeam) {
        return message;
    }
    return message.replace(/\([^)]+\)\s*$/, `(${nextTeam})`);
}

function cloneCommentaryEntries(entries, templateMatch, targetMatch) {
    const replacements = new Map([
        [templateMatch.homeTeam, targetMatch.homeTeam],
        [templateMatch.awayTeam, targetMatch.awayTeam],
    ]);

    return entries.map((entry) => {
        const next = { ...entry, matchId: targetMatch.id };
        if (entry.team === templateMatch.homeTeam) {
            next.team = targetMatch.homeTeam;
        } else if (entry.team === templateMatch.awayTeam) {
            next.team = targetMatch.awayTeam;
        }
        next.message = replaceTrailingTeam(entry.message, replacements);
        return next;
    });
}

function buildTemplateEntriesBySport(feed, seedMatches) {
    const byMatchId = new Map();
    for (const entry of feed) {
        if (!Number.isInteger(entry.matchId)) {
            continue;
        }
        if (!byMatchId.has(entry.matchId)) {
            byMatchId.set(entry.matchId, []);
        }
        byMatchId.get(entry.matchId).push(entry);
    }

    const templatesBySport = new Map();
    if (Array.isArray(seedMatches)) {
        for (const match of seedMatches) {
            const sportKey = String(match.sport || "").toLowerCase();
            if (!sportKey) {
                continue;
            }
            if (templatesBySport.has(sportKey)) {
                continue;
            }
            const entries = byMatchId.get(match.id);
            if (entries && entries.length > 0) {
                templatesBySport.set(sportKey, { match, entries });
            }
        }
    }

    return templatesBySport;
}

async function hasAnyCommentary(matchId) {
    const response = await fetch(`${API_URL}/matches/${matchId}/commentary?limit=1`);
    if (!response.ok) {
        return false;
    }
    const payload = await response.json().catch(() => null);
    const items = payload?.data;
    return Array.isArray(items) && items.length > 0;
}

async function expandFeedForExistingMatches(feed, seedMatches, matchMap) {
    const templatesBySport = buildTemplateEntriesBySport(feed, seedMatches);
    if (templatesBySport.size === 0) {
        return feed;
    }

    const expanded = [...feed];
    const seenMatchIds = new Set();

    for (const { match } of matchMap.values()) {
        if (!match || !Number.isInteger(match.id)) {
            continue;
        }
        if (seenMatchIds.has(match.id)) {
            continue;
        }
        seenMatchIds.add(match.id);

        const sportKey = String(match.sport || "").toLowerCase();
        const template = sportKey ? templatesBySport.get(sportKey) : null;
        if (!template) {
            continue;
        }

        if (SKIP_NONEMPTY) {
            const nonEmpty = await hasAnyCommentary(match.id);
            if (nonEmpty) {
                continue;
            }
        }

        expanded.push(
            ...cloneCommentaryEntries(template.entries, template.match, match),
        );
    }

    return expanded;
}

function expandFeedForMatches(feed, seedMatches) {
    if (!Array.isArray(seedMatches) || seedMatches.length === 0) {
        return feed;
    }

    const byMatchId = new Map();
    for (const entry of feed) {
        if (!Number.isInteger(entry.matchId)) {
            continue;
        }
        if (!byMatchId.has(entry.matchId)) {
            byMatchId.set(entry.matchId, []);
        }
        byMatchId.get(entry.matchId).push(entry);
    }

    const matchById = new Map();
    const templateBySport = new Map();
    for (const match of seedMatches) {
        matchById.set(match.id, match);
        if (!templateBySport.has(match.sport) && byMatchId.has(match.id)) {
            templateBySport.set(match.sport, match);
        }
    }

    const expanded = [...feed];
    for (const match of seedMatches) {
        if (byMatchId.has(match.id)) {
            continue;
        }
        const templateMatch = templateBySport.get(match.sport);
        if (!templateMatch) {
            continue;
        }
        const templateEntries = byMatchId.get(templateMatch.id) || [];
        expanded.push(
            ...cloneCommentaryEntries(templateEntries, templateMatch, match),
        );
    }

    return expanded;
}

function buildRandomizedFeed(feed, matchMap) {
    const buckets = new Map();
    for (const entry of feed) {
        const key = Number.isInteger(entry.matchId) ? entry.matchId : null;
        if (!buckets.has(key)) {
            buckets.set(key, []);
        }
        buckets.get(key).push(entry);
    }

    for (const [matchId, entries] of buckets) {
        if (!Number.isInteger(matchId)) {
            continue;
        }
        const target = matchMap.get(matchId);
        const sport = target?.match?.sport?.toLowerCase();
        if (sport === "cricket" && target?.match) {
            buckets.set(matchId, normalizeCricketFeed(entries, target.match));
        }
    }

    const matchIds = Array.from(buckets.keys());
    const randomized = [];
    let lastMatchId = null;

    while (randomized.length < feed.length) {
        const candidates = matchIds.filter(
            (id) => (buckets.get(id) || []).length > 0,
        );
        if (candidates.length === 0) {
            break;
        }

        let selectable = candidates;
        if (lastMatchId !== null && candidates.length > 1) {
            const withoutLast = candidates.filter((id) => id !== lastMatchId);
            if (withoutLast.length > 0) {
                selectable = withoutLast;
            }
        }

        const choice = selectable[Math.floor(Math.random() * selectable.length)];
        const nextEntry = buckets.get(choice).shift();
        randomized.push(nextEntry);
        lastMatchId = choice;
    }

    return randomized;
}

function getMatchEntry(entry, matchMap) {
    if (!Number.isInteger(entry.matchId)) {
        return null;
    }
    return matchMap.get(entry.matchId) ?? null;
}

async function updateMatchScore(matchId, homeScore, awayScore) {
    const response = await fetch(`${API_URL}/matches/${matchId}/score`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ homeScore, awayScore }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Failed to update score: ${response.status} ${text ? `- ${text}` : ""}`,
        );
    }
}

function randomMatchDelay() {
    const range = NEW_MATCH_DELAY_MAX_MS - NEW_MATCH_DELAY_MIN_MS;
    return NEW_MATCH_DELAY_MIN_MS + Math.floor(Math.random() * (range + 1));
}

function randomDelayBetween(minMs, maxMs) {
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs <= 0 || maxMs <= 0) {
        return 0;
    }
    const low = Math.min(minMs, maxMs);
    const high = Math.max(minMs, maxMs);
    const range = high - low;
    return low + Math.floor(Math.random() * (range + 1));
}

function getEntryDelayMs() {
    const randomized = randomDelayBetween(DELAY_MIN_MS, DELAY_MAX_MS);
    if (randomized > 0) return randomized;
    return Number.isFinite(DELAY_MS) ? Math.max(0, DELAY_MS) : 0;
}

export async function runSeed() {
    logger.info("Seeding via API", {
        apiUrl: API_URL,
        forceLive: FORCE_LIVE,
        updateScores: UPDATE_SCORES,
        loop: LOOP,
        targetStatus: TARGET_STATUS,
        backfillExisting: BACKFILL_EXISTING,
        skipNonempty: SKIP_NONEMPTY,
    });

    const { feed, matches: seedMatches } = await loadSeedData();
    const matchesList = await fetchMatches();

    const matchMap = new Map();
    const matchKeyMap = new Map();
    for (const match of matchesList) {
        if (FORCE_LIVE && !isLiveMatch(match)) {
            continue;
        }
        if (!matchPassesTarget(match)) {
            continue;
        }
        const key = `${match.sport}|${match.homeTeam}|${match.awayTeam}`;
        if (!matchKeyMap.has(key)) {
            matchKeyMap.set(key, match);
        }
        matchMap.set(match.id, {
            match,
            score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
            fakeNext: Math.random() < 0.5 ? "home" : "away",
        });
    }

    if (Array.isArray(seedMatches) && seedMatches.length > 0) {
        for (const seedMatch of seedMatches) {
            const key = `${seedMatch.sport}|${seedMatch.homeTeam}|${seedMatch.awayTeam}`;
            let match = matchKeyMap.get(key);
            if (!match || (FORCE_LIVE && !isLiveMatch(match))) {
                match = await createMatch(seedMatch);
                matchKeyMap.set(key, match);
                const delayMs = randomMatchDelay();
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            if (match && !matchPassesTarget(match)) {
                continue;
            }

            if (Number.isInteger(seedMatch.id)) {
                matchMap.set(seedMatch.id, {
                    match,
                    score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
                    fakeNext: Math.random() < 0.5 ? "home" : "away",
                });
            }
            matchMap.set(match.id, {
                match,
                score: { home: match.homeScore ?? 0, away: match.awayScore ?? 0 },
                fakeNext: Math.random() < 0.5 ? "home" : "away",
            });
        }
    }

    if (matchMap.size === 0) {
        throw new Error("No matches found or created in the database.");
    }

    let expandedFeed = expandFeedForMatches(feed, seedMatches);

    if (BACKFILL_EXISTING && !LOOP) {
        expandedFeed = await expandFeedForExistingMatches(expandedFeed, seedMatches, matchMap);
    }

    let stopRequested = false;
    const requestStop = () => {
        stopRequested = true;
        logger.info("Stopping seed loop...");
    };
    process.once("SIGINT", requestStop);
    process.once("SIGTERM", requestStop);

    let iteration = 0;
    while (!stopRequested) {
        iteration += 1;
        const randomizedFeed = buildRandomizedFeed(expandedFeed, matchMap);

        for (let i = 0; i < randomizedFeed.length; i += 1) {
            if (stopRequested) break;

            const entry = randomizedFeed[i];
            const target = getMatchEntry(entry, matchMap);
            if (!target) {
                logger.warn("Skipping entry: matchId missing or not found", {
                    message: entry.message,
                    matchId: entry.matchId,
                });
                continue;
            }
            const match = target.match;

            const row = await insertCommentary(match.id, entry);
            logger.info("Commentary inserted", { matchId: match.id, message: row.message });

            if (UPDATE_SCORES) {
                const isCricket = String(match.sport).toLowerCase() === "cricket";
                const delta = isCricket
                    ? scoreDeltaFromEntry(entry, match)
                    : (scoreDeltaFromEntry(entry, match) ?? fakeScoreDelta(target));

                if (delta) {
                    target.score.home += delta.home;
                    target.score.away += delta.away;
                    try {
                        await updateMatchScore(match.id, target.score.home, target.score.away);
                        logger.info("Score updated", {
                            matchId: match.id,
                            homeScore: target.score.home,
                            awayScore: target.score.away,
                        });
                    } catch (error) {
                        logger.warn("Score update skipped", { matchId: match.id, error });
                    }
                }
            }

            const delayMs = getEntryDelayMs();
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        if (!LOOP) {
            break;
        }

        logger.debug("Seed loop iteration complete", { iteration });
    }
}

function isMainModule() {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    try {
        return import.meta.url === pathToFileURL(argvPath).href;
    } catch {
        return false;
    }
}

if (isMainModule()) {
    runSeed().catch((err) => {
        logger.error("Seed error", { error: err });
        process.exit(1);
    });
}