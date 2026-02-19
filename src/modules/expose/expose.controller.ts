import { Body, Controller, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ExposeService } from './expose.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpenAccessPromptLimitGuard } from '../../middleware/guards/open-access-prompt-limit.guard';

@ApiTags('Expose')
@Controller('expose')
@UseGuards(OpenAccessPromptLimitGuard)
export class ExposeController {
  private readonly logger = new Logger(ExposeController.name);

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
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Pre-search: fetch web context before AI generation
    let searchContext: string | null = null;
    if (this.exposeService.isWebSearchEnabled()) {
      emit({ t: 'searching', query: body.prompt });
      searchContext = await this.exposeService.searchWeb(body.prompt);
      emit({ t: 'search_done' });
    }

    const { fullStream } = this.exposeService.streamResponse(body.prompt, searchContext);

    let textDeltaCount = 0;
    try {
      for await (const part of fullStream) {
        switch (part.type) {
          case 'text-delta':
            textDeltaCount++;
            emit({ t: 'text', v: part.text });
            break;
          case 'tool-call':
            this.logger.log(`Tool call: ${part.toolName}`);
            emit({ t: 'tool_call', tool: part.toolName, args: part.input });
            break;
          case 'tool-result':
            this.logger.log(`Tool result: ${part.toolName}`);
            emit({ t: 'tool_result', tool: part.toolName });
            break;
          case 'reasoning-delta':
            emit({ t: 'reasoning', v: part.text });
            break;
          case 'finish':
            this.logger.log(`Stream finished — text deltas: ${textDeltaCount}, reason: ${part.finishReason}`);
            emit({ t: 'done' });
            break;
          case 'error':
            this.logger.error(`Stream error event: ${JSON.stringify(part.error)}`);
            break;
        }
      }
      if (textDeltaCount === 0) {
        this.logger.warn(
          'Stream finished with no text from the model. Check AI_GATEWAY_API_KEY and model.',
        );
      }
    } catch (err: any) {
      const msg =
        err?.message ??
        err?.cause?.message ??
        (typeof err?.cause?.responseBody === 'string'
          ? err.cause.responseBody
          : null) ??
        'Stream error';
      this.logger.error('Stream error', err?.stack ?? err);
      emit({ t: 'error', msg });
    }

    res.end();
  }
}
