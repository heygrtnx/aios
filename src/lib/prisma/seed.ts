import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

const prisma = new PrismaService(new ConfigService());

async function main() {
  console.log('🌱 Seeding database...');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    process.exit(1);
  });
