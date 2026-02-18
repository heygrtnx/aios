import { Module } from '@nestjs/common';
import { ExposeService } from './expose.service';
import { ExposeController } from './expose.controller';

@Module({
  controllers: [ExposeController],
  providers: [ExposeService],
})
export class ExposeModule {}
