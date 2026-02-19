import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpenAccessPromptLimitGuard } from '../../middleware/guards/open-access-prompt-limit.guard';

@ApiTags('Chat')
@Controller('chat')
@UseGuards(OpenAccessPromptLimitGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('prompt')
  @ApiOperation({ summary: 'Generate a response from the AI' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
    },
  })
  async generateResponse(@Body() body: { prompt: string }) {
    return this.chatService.generateResponse(body.prompt);
  }

  @Post('prompt/stream')
  @ApiOperation({ summary: 'Stream a response from the AI (SSE)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
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

    const emit = (data: object) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);

    await this.chatService.handleStreamPrompt(body.prompt, emit);

    res.end();
  }

  @Get('webhook')
  @ApiOperation({ summary: 'WhatsApp webhook verification challenge' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.chatService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle incoming WhatsApp messages' })
  async handleWebhook(@Body() body: any) {
    await this.chatService.handleIncomingMessage(body);
    return 'OK';
  }
}
