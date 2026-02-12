import test from "node:test";
import assert from "node:assert/strict";
import { createMatchSchema, listMatchesQuerySchema } from "../src/validation/matches.js";

test("listMatchesQuerySchema accepts valid limit", () => {
    const result = listMatchesQuerySchema.safeParse({ limit: "10" });
    assert.equal(result.success, true);
    assert.equal(result.data.limit, 10);
});

test("listMatchesQuerySchema rejects invalid limit", () => {
    const result = listMatchesQuerySchema.safeParse({ limit: 0 });
    assert.equal(result.success, false);
});

test("createMatchSchema requires core fields", () => {
    const result = createMatchSchema.safeParse({
        sport: "football",
        homeTeam: "Lions",
        awayTeam: "Tigers",
    });
    assert.equal(result.success, false);
});

test("createMatchSchema accepts valid payload", () => {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
    const payload = {
        sport: "football",
        homeTeam: "Lions",
        awayTeam: "Tigers",
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        homeScore: "0",
        awayScore: 0,
    };

    const result = createMatchSchema.safeParse(payload);
    assert.equal(result.success, true);
});
