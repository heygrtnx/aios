import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
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
    const { textStream } = this.exposeService.streamResponse(body.prompt);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    // SDK returns AsyncIterableStream (ReadableStream); Node 18+ can pipe via fromWeb.
    // Cast via unknown to avoid DOM vs Node stream/web ReadableStream type conflict.
    const nodeStream =
      typeof (textStream as ReadableStream).getReader === 'function'
        ? Readable.fromWeb(textStream as unknown as Parameters<typeof Readable.fromWeb>[0])
        : Readable.from(textStream as AsyncIterable<string>);
    nodeStream.pipe(res);
    return new Promise<void>((resolve, reject) => {
      res.on('finish', () => resolve());
      res.on('error', reject);
      nodeStream.on('error', reject);
    });
  }
}
