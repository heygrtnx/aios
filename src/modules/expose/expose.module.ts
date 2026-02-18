import { Module } from '@nestjs/common';
import { ExposeService } from './expose.service';
import { ExposeController } from './expose.controller';
import { OpenAccessPromptLimitGuard } from '../../middleware/guards/open-access-prompt-limit.guard';

@Module({
  controllers: [ExposeController],
  providers: [ExposeService, OpenAccessPromptLimitGuard],
})
export class ExposeModule {}
