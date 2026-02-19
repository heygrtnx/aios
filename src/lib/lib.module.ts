import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { WhatsappModule } from './whatsapp/wa.module';
import { RedisModule } from './redis/redis.module';
import { SlackModule } from './slack/slack.module';

@Module({
  imports: [PrismaModule, AiModule, WhatsappModule, RedisModule, SlackModule],
})
export class LibModule {}
