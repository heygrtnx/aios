import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { WhatsappModule } from './whatsapp/wa.module';
import { RedisModule } from './redis/redis.module';
@Module({
  imports: [PrismaModule, AiModule, WhatsappModule, RedisModule],
})
export class LibModule {}
