import { eq } from "drizzle-orm";
import { db, pool } from "./db/db.js";
import { demoUsers } from "./db/schema.js";

async function main() {
    try {
        console.log("Running CRUD demo");

        const [user] = await db
            .insert(demoUsers)
            .values({ name: "Admin", email: "admin@example.com" })
            .returning();

        console.log("CREATE:", user);

        const found = await db
            .select()
            .from(demoUsers)
            .where(eq(demoUsers.id, user.id));

        console.log("READ:", found[0]);

        const [updated] = await db
            .update(demoUsers)
            .set({ name: "Super Admin" })
            .where(eq(demoUsers.id, user.id))
            .returning();

        console.log("UPDATE:", updated);

        await db.delete(demoUsers).where(eq(demoUsers.id, user.id));
        console.log("DELETE: user removed");
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}

main();
