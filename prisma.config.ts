import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  datasource: {
    url: env("DATABASE_URL"),   // ← Use the 6543 pooled one here
  },

  migrations: {
    path: "prisma/migrations",
  },
});