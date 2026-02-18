import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
@Module({
  imports: [PrismaModule, AiModule],
})
export class LibModule {}
