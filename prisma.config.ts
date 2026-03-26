import { defineConfig } from "@prisma/config";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables early
dotenv.config({ path: path.join(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // In Prisma 7, this is where the engine looks for the URL during generation
    url: process.env.DIRECT_URL,
  },
  migrations: {
    // This tells Prisma to use ts-node to run your seed script
    seed: "ts-node prisma/seed.ts",
  },
});