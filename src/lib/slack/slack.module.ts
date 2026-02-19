import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SlackService } from './slack.service';

@Global()
@Module({
  imports: [HttpModule],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
