import { Body, Controller, Post } from '@nestjs/common';
import { ExposeService } from './expose.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Expose')
@Controller('expose')
export class ExposeController {
  constructor(private readonly exposeService: ExposeService) {}

  @Post('prompt')
  @ApiOperation({ summary: 'Generate a response from the AI' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
    },
  })
  async generateResponse(@Body() body: { prompt: string }) {
    return this.exposeService.generateResponse(body.prompt);
  }
}
