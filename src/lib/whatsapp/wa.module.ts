import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsappService } from './wa.service';

@Global()
@Module({
  imports: [HttpModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
