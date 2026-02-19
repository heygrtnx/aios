import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ExposeService } from './expose.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpenAccessPromptLimitGuard } from '../../middleware/guards/open-access-prompt-limit.guard';

@ApiTags('Expose')
@Controller('expose')
@UseGuards(OpenAccessPromptLimitGuard)
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

  @Post('prompt/stream')
  @ApiOperation({ summary: 'Stream a response from the AI (text/plain)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
    },
  })
  async streamResponse(
    @Body() body: { prompt: string },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { fullStream } = this.exposeService.streamResponse(body.prompt);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const part of fullStream) {
        switch (part.type) {
          case 'text-delta':
            emit({ t: 'text', v: part.textDelta });
            break;
          case 'tool-call':
            emit({ t: 'tool_call', tool: part.toolName, args: part.args });
            break;
          case 'tool-result':
            emit({ t: 'tool_result', tool: part.toolName });
            break;
          case 'reasoning':
            emit({ t: 'reasoning', v: part.textDelta });
            break;
          case 'finish':
            emit({ t: 'done' });
            break;
        }
      }
    } catch (err: any) {
      emit({ t: 'error', msg: err?.message ?? 'Stream error' });
    }

    res.end();
  }
}
