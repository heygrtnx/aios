import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ChatService } from './chat.service';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OpenAccessPromptLimitGuard } from '../../middleware/guards/open-access-prompt-limit.guard';
import { SlackService } from 'src/lib/slack/slack.service';
import { Public } from 'src/middleware/decorators/public.decorator';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly slackService: SlackService,
  ) {}

  @Post('prompt')
  @UseGuards(OpenAccessPromptLimitGuard)
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
  @UseGuards(OpenAccessPromptLimitGuard)
  @ApiOperation({ summary: 'Stream a response from the AI (SSE)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        history: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
            },
          },
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              mimeType: { type: 'string' },
              data: {
                type: 'string',
                description: 'Base64-encoded file content',
              },
            },
          },
        },
      },
    },
  })
  async streamResponse(
    @Body()
    body: {
      prompt: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      attachments?: Array<{
        name: string;
        mimeType: string;
        data: string;
      }>;
    },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);

    await this.chatService.handleStreamPrompt(
      body.prompt,
      emit,
      body.history,
      body.attachments,
    );

    res.end();
  }

  @Post('products/upload')
  @UseGuards(OpenAccessPromptLimitGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          file.originalname.match(/\.(csv|json|xlsx|xls)$/i) ||
          [
            'text/csv',
            'application/json',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
          ].includes(file.mimetype)
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Only CSV, JSON, and Excel files are allowed',
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Upload a product file for Google Sheet population' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        history: {
          type: 'string',
          description: 'JSON-stringified chat history array',
        },
      },
      required: ['file'],
    },
  })
  async uploadProducts(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { history?: string },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (body.history) {
      try {
        history = JSON.parse(body.history);
      } catch {
        /* ignore malformed history */
      }
    }

    await this.chatService.handleProductUpload(file, emit, history);

    res.end();
  }

  @Get('rfq/:quoteNumber/download')
  @Public()
  @ApiOperation({ summary: 'Download a quote as a printable HTML page' })
  async downloadQuote(
    @Param('quoteNumber') quoteNumber: string,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.chatService.downloadQuote(quoteNumber);
    if (!html) throw new NotFoundException('Quote not found or has expired.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post('rfq/followups')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process due RFQ follow-up emails (call from a daily cron)' })
  async triggerFollowups() {
    return this.chatService.triggerFollowups();
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

  @Get('slack/add')
  @Public()
  @ApiOperation({ summary: 'Redirect to Slack OAuth install page' })
  addSlackApp(@Res() res: Response) {
    const url = this.slackService.buildInstallUrl();
    return res.redirect(url);
  }

  @Get('slack/events')
  @Public()
  @ApiOperation({ summary: 'Slack OAuth callback — exchanges code for token' })
  async handleSlackOAuth(
    @Query('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(400).send('Missing OAuth code');
    }

    const redirectUri = `${req.protocol}://${req.get('host')}${req.path}`;
    const data = await this.slackService.exchangeOAuthCode(code, redirectUri);

    this.logger.log(
      `Slack OAuth success — team: ${data.team?.name} (${data.team?.id})`,
    );

    return res
      .status(200)
      .send(
        `<html><body><h2>Slack app installed successfully!</h2><p>Team: ${data.team?.name}</p></body></html>`,
      );
  }

  @Post('slack/events')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Slack Event API webhook' })
  async handleSlackEvents(
    @Req() req: Request,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
    @Body() body: any,
  ) {
    const rawBody: string | undefined = (req as any).rawBody;

    if (rawBody !== undefined) {
      const isValid = this.slackService.verifyRequest(
        signature,
        timestamp,
        rawBody,
      );
      if (!isValid) {
        this.logger.warn('Rejected Slack request — invalid signature');
        throw new UnauthorizedException('Invalid Slack signature');
      }
    }

    if (body.type === 'url_verification') {
      return this.chatService.handleSlackChallenge(body.challenge);
    }

    if (body.type === 'event_callback') {
      this.chatService
        .handleSlackEvent(body)
        .catch((err) => this.logger.error('Error handling Slack event', err));
    }

    return { ok: true };
  }
}
