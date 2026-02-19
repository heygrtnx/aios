import { BadRequestException, Injectable } from '@nestjs/common';
import { catchError, lastValueFrom, map } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AiService } from '../ai/ai.service';

@Injectable()
export class WhatsappService {
  private readonly url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_API_VERSION}/${process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID}/messages`;
  private readonly config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_API_ACCESS_TOKEN}`,
    },
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly aiService: AiService,
  ) {}

  async sendWhatsAppMessage(
    messageSender: string,
    userInput: string,
    messageID: string,
  ) {
    const aiResponse = await this.aiService.generateResponse(userInput);

    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: messageSender,
      context: {
        message_id: messageID,
      },
      type: 'text',
      text: {
        preview_url: false,
        body: aiResponse,
      },
    });

    try {
      const response = this.httpService.post(this.url, data, this.config).pipe(
        map((res) => res.data),
        catchError(() => {
          throw new BadRequestException('Error Posting To WhatsApp Cloud API');
        }),
      );

      await lastValueFrom(response);
    } catch (error) {
      return 'Axle broke!! Abort mission!!';
    }
  }

  async markMessageAsRead(messageID: string) {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageID,
    });

    try {
      const response = this.httpService.post(this.url, data, this.config).pipe(
        map((res) => res.data),
        catchError(() => {
          throw new BadRequestException('Error Marking Message As Read');
        }),
      );

      await lastValueFrom(response);
    } catch (error) {
      return 'Axle broke!! Abort mission!!';
    }
  }
}
