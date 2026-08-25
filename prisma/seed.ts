import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { dbConfigFromUrl } from "../src/lib/db-config";
import bcrypt from "bcryptjs";

const adapter = new PrismaMariaDb(dbConfigFromUrl(process.env.DATABASE_URL as string));
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "horizonhabitatenergie@gmail.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Jimmy Sabbath",
      password: hashed,
      role: "ADMIN",
    },
  });

  console.log(`Admin user ready: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
