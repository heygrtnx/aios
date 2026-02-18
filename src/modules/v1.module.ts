import { Module } from '@nestjs/common';
import { ExposeModule } from './expose/expose.module';

@Module({
  imports: [ExposeModule],
})
export class V1Module {}
