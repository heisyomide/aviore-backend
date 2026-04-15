// prisma.config.ts
import "dotenv/config";   // ← This must be the VERY FIRST line
import { defineConfig, env } from "prisma/config";

console.log("DEBUG: DIRECT_URL loaded =", !!process.env.DIRECT_URL ? "YES" : "NO");
console.log("DEBUG: DIRECT_URL starts with postgresql:// =", process.env.DIRECT_URL?.startsWith("postgresql://") || false);

export default defineConfig({
  schema: "prisma/schema.prisma",

  datasource: {
    url: env("DIRECT_URL"),     // Use env() — it will throw a clear error if missing
  },

  migrations: {
    path: "prisma/migrations",
  },
});