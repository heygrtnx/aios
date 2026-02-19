import { Injectable, Logger } from '@nestjs/common';
import { AiService } from 'src/lib/ai/ai.service';
import { WhatsappService } from 'src/lib/whatsapp/wa.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async generateResponse(prompt: string): Promise<string> {
    return this.aiService.generateResponse(prompt);
  }

  async handleStreamPrompt(
    prompt: string,
    emit: (data: object) => void,
  ): Promise<void> {
    let searchContext: string | null = null;
    if (this.aiService.isWebSearchEnabled()) {
      emit({ t: 'searching', query: prompt });
      searchContext = await this.aiService.searchWeb(prompt);
      emit({ t: 'search_done' });
    }

    const { fullStream } = this.aiService.streamResponse(prompt, searchContext);

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
    const messageSender: string = message.from;
    const messageID: string = message.id;

    await this.whatsappService.markMessageAsRead(messageID);

    if (message.type === 'text') {
      await this.whatsappService.sendWhatsAppMessage(
        messageSender,
        message.text.body,
        messageID,
      );
    }
  }
}
