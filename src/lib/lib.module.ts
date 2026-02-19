import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { WhatsappModule } from './whatsapp/wa.module';

@Module({
  imports: [PrismaModule, AiModule, WhatsappModule],
})
export class LibModule {}
