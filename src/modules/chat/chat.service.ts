import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { AiService, ChatMessage, Attachment } from 'src/lib/ai/ai.service';
import { WhatsappService } from 'src/lib/whatsapp/wa.service';
import { RedisService } from 'src/lib/redis/redis.service';
import { SlackService } from 'src/lib/slack/slack.service';

const HISTORY_LIMIT = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SLACK_EVENT_DEDUP_TTL = 300; // 5 minutes
const PRODUCT_UPLOAD_TTL = 60 * 60; // 1 hour

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly whatsappService: WhatsappService,
    private readonly redisService: RedisService,
    private readonly slackService: SlackService,
  ) {}

  async generateResponse(prompt: string): Promise<string> {
    return this.aiService.generateResponse(prompt);
  }

  async handleStreamPrompt(
    prompt: string,
    emit: (data: object) => void,
    history?: ChatMessage[],
    attachments?: Attachment[],
  ): Promise<void> {
    const userMessage: ChatMessage = { role: 'user', content: prompt };
    if (attachments?.length) userMessage.attachments = attachments;

    const messages: ChatMessage[] = [
      ...(history ?? []).slice(-HISTORY_LIMIT),
      userMessage,
    ];
    const { fullStream } = this.aiService.streamResponseWithHistory(messages);

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
            if (part.toolName === 'webSearch') {
              emit({ t: 'searching' });
            }
            break;
          case 'tool-result':
            this.logger.log(`Tool result: ${part.toolName}`);
            if (part.toolName === 'webSearch') {
              emit({ t: 'search_done' });
            }
            break;
          case 'reasoning-delta':
            emit({ t: 'reasoning', v: part.text });
            break;
          case 'finish':
            this.logger.log(
              `Stream finished — text deltas: ${textDeltaCount}, reason: ${part.finishReason}`,
            );
            emit({ t: 'done' });
            break;
          case 'error':
            this.logger.error(
              `Stream error event: ${JSON.stringify(part.error)}`,
            );
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
  }

  async handleProductUpload(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    emit: (data: object) => void,
    history?: ChatMessage[],
  ): Promise<void> {
    const { rows, columns } = this.parseProductFile(file);

    const uploadKey = randomUUID();
    await this.redisService.set(
      `product-upload:${uploadKey}`,
      rows,
      PRODUCT_UPLOAD_TTL,
    );

    emit({ t: 'upload', uploadKey, rowCount: rows.length, columns });

    const preview = rows
      .slice(0, Math.min(4, rows.length))
      .map((r) => r.join(' | '))
      .join('\n');

    const prompt =
      `[PRODUCT_UPLOAD]\n` +
      `File: "${file.originalname}"\n` +
      `Total rows: ${rows.length} (including header)\n` +
      `Upload key: ${uploadKey}\n` +
      `Columns: ${columns.join(', ')}\n\n` +
      `Preview:\n${preview}\n\n` +
      `I want to upload these products to Google Sheets.`;

    await this.handleStreamPrompt(prompt, emit, history);
  }

  private parseProductFile(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
  }): { rows: any[][]; columns: string[] } {
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (ext === 'json') {
      const raw = JSON.parse(file.buffer.toString('utf-8'));
      const arr: Record<string, any>[] = Array.isArray(raw) ? raw : [raw];
      if (arr.length === 0) throw new Error('Empty JSON file');
      const columns = Object.keys(arr[0]);
      const rows = [
        columns,
        ...arr.map((item) => columns.map((col) => String(item[col] ?? ''))),
      ];
      return { rows, columns };
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
    }) as any[][];

    const filtered = jsonData.filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && cell !== ''),
    );

    if (filtered.length === 0) throw new Error('Empty file');

    const columns = filtered[0].map(String);
    return { rows: filtered, columns };
  }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verificationToken =
      process.env.WHATSAPP_CLOUD_API_WEBHOOK_VERIFICATION_TOKEN;

    if (mode === 'subscribe' && token === verificationToken) {
      return challenge;
    }

    return null;
  }

  async handleIncomingMessage(body: any): Promise<void> {
    const { messages } = body?.entry?.[0]?.changes?.[0]?.value ?? {};
    if (!messages) return;

    const message = messages[0];
    if (message.type !== 'text') return;

    const phoneNumber: string = message.from;
    const messageID: string = message.id;
    const userText: string = message.text.body;

    // Mark as read + show typing indicator
    await this.whatsappService.sendReadWithTyping(messageID);

    // Load history from Redis
    const historyKey = `chat:history:${phoneNumber}`;
    const history: ChatMessage[] =
      (await this.redisService.get(historyKey)) ?? [];

    // Build messages for AI (last N + new user message)
    const aiMessages: ChatMessage[] = [
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    // Generate response with history
    const aiResponse =
      await this.aiService.generateResponseWithHistory(aiMessages);

    // Persist updated history to Redis (with TTL)
    await this.redisService.set(
      historyKey,
      [...aiMessages, { role: 'assistant', content: aiResponse }],
      HISTORY_TTL_SECONDS,
    );

    // Send reply
    await this.whatsappService.sendMessage(phoneNumber, messageID, aiResponse);
  }

  handleSlackChallenge(challenge: string): { challenge: string } {
    return { challenge };
  }

  async handleSlackEvent(body: any): Promise<void> {
    const event = body.event;

    if (!event) {
      this.logger.warn('[Slack] No event in payload');
      return;
    }
    if (event.bot_id || event.subtype) {
      this.logger.debug(
        `[Slack] Ignoring event — bot_id: ${event.bot_id}, subtype: ${event.subtype}`,
      );
      return;
    }
    if (event.type !== 'app_mention' && event.type !== 'message') {
      this.logger.debug(`[Slack] Ignoring unsupported event type: ${event.type}`);
      return;
    }

    const eventId: string = body.event_id;
    if (eventId) {
      const dedupKey = `slack:event:${eventId}`;
      const seen = await this.redisService.get(dedupKey);
      if (seen) {
        this.logger.log(`Duplicate Slack event ${eventId}, skipping`);
        return;
      }
      await this.redisService.set(dedupKey, '1', SLACK_EVENT_DEDUP_TTL);
    }

    const userText: string = (event.text ?? '')
      .replace(/<@[A-Z0-9]+>/g, '')
      .trim();

    if (!userText) {
      this.logger.debug('[Slack] Empty user text after stripping mentions, skipping');
      return;
    }

    const channel: string = event.channel;
    const threadTs: string = event.thread_ts ?? event.ts;
    const userId: string = event.user;

    this.logger.log(`[Slack] ${userId} in ${channel}: "${userText}"`);

    const historyKey = `slack:history:${channel}:${userId}`;
    const history: ChatMessage[] =
      (await this.redisService.get(historyKey)) ?? [];

    const aiMessages: ChatMessage[] = [
      ...history.slice(-HISTORY_LIMIT),
      { role: 'user', content: userText },
    ];

    const aiResponse =
      await this.aiService.generateResponseWithHistory(aiMessages);

    if (!aiResponse?.trim()) {
      this.logger.warn('[Slack] AI returned an empty response, skipping send');
      return;
    }

    await this.redisService.set(
      historyKey,
      [...aiMessages, { role: 'assistant', content: aiResponse }],
      HISTORY_TTL_SECONDS,
    );

    await this.slackService.sendMessage(channel, aiResponse, threadTs);
    this.logger.log(`[Slack] Response sent to ${channel}`);
  }
}
