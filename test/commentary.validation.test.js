import test from "node:test";
import assert from "node:assert/strict";
import { createCommentarySchema, listCommentaryQuerySchema } from "../src/validation/commentary.js";

test("listCommentaryQuerySchema accepts valid limit", () => {
    const result = listCommentaryQuerySchema.safeParse({ limit: "25" });
    assert.equal(result.success, true);
    assert.equal(result.data.limit, 25);
});

test("listCommentaryQuerySchema rejects too-large limit", () => {
    const result = listCommentaryQuerySchema.safeParse({ limit: 101 });
    assert.equal(result.success, false);
});

test("createCommentarySchema requires message", () => {
    const result = createCommentarySchema.safeParse({});
    assert.equal(result.success, false);
});

test("createCommentarySchema accepts valid payload", () => {
    const payload = {
        minute: 12,
        sequence: 3,
        period: "H1",
        eventType: "goal",
        actor: "Player 9",
        team: "Lions",
        message: "Goal scored",
        metadata: { xg: 0.3 },
        tags: ["highlight", "goal"],
    };

    const result = createCommentarySchema.safeParse(payload);
    assert.equal(result.success, true);
});
