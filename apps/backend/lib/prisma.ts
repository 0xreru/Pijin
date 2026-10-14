import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prismaClientSingleton = () => {
  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.NODE_ENV === "test" || !process.env.NODE_ENV
      ? "postgresql://mock:mock@localhost:5432/mock"
      : undefined);
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

export const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
