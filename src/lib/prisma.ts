import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { dbConfigFromUrl } from "./db-config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
