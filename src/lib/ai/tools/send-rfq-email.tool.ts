import { tool } from 'ai';
import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../redis/redis.service';
import type { SendMailsService } from '../../email/sendMail.service';
import type { RfqData, RfqFollowup } from './rfq.tool';
import { RFQ_DATA_TTL } from './rfq.tool';

function fmt(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const RFQ_FOLLOWUP_TTL = 60 * 60 * 24 * 7;

export function createSendRfqEmailTool(
  config: ConfigService,
  redis: RedisService,
  mailer: SendMailsService,
) {
  return tool({
    description:
      'Send the draft quote to the customer by email and schedule follow-up emails. ' +
      'Call this ONLY after processRfq has run and the user confirms they want the quote emailed. ' +
      'Requires the quoteNumber from the processRfq result and the recipient email address.',
    inputSchema: z.object({
      quoteNumber: z
        .string()
        .describe('The quote reference number returned by processRfq'),
      recipientEmail: z
        .string()
        .describe("The customer's email address to send the quote to"),
    }),

    execute: async ({ quoteNumber, recipientEmail }) => {
      try {
        // ── Fetch stored quote data ───────────────────────────────────────────
        const rfqData: RfqData | null = await redis.get(`rfq:data:${quoteNumber}`);
        if (!rfqData) {
          return {
            success: false,
            message: `Quote ${quoteNumber} not found or has expired. Please re-submit the RFQ.`,
          };
        }

        // ── Send quote email ─────────────────────────────────────────────────
        const platformName = config.get<string>('PLATFORM_NAME') || 'Sales Team';
        const subject = `Your Quote — ${quoteNumber}`;

        const formattedLineItems = rfqData.lineItems.map((li) => ({
          ...li,
          unitPriceFormatted: li.unitPrice != null ? fmt(li.unitPrice) : null,
          lineTotalFormatted: li.lineTotal != null ? fmt(li.lineTotal) : null,
        }));

        await mailer.sendEmail(recipientEmail, subject, 'rfqQuote', {
          quoteNumber: rfqData.quoteNumber,
          quoteDate: rfqData.quoteDate,
          validUntil: rfqData.validUntil,
          contactName: rfqData.contactName,
          contactPhone: rfqData.contactPhone,
          contactEmail: rfqData.contactEmail,
          lineItems: formattedLineItems,
          shipTo: rfqData.shipTo,
          deliveryDate: rfqData.deliveryDate,
          notes: rfqData.notes,
          total: rfqData.total,
          hasAllPrices: rfqData.hasAllPrices,
          platformName,
        });

        // ── Update follow-up cadence with recipient email + status ────────────
        const followup: RfqFollowup | null = await redis.get(`rfq:followup:${quoteNumber}`);
        if (followup) {
          followup.recipientEmail = recipientEmail;
          followup.status = 'email_sent';
          await redis.set(`rfq:followup:${quoteNumber}`, followup, RFQ_FOLLOWUP_TTL);
        }

        // ── Also update quote data so re-send knows the email ─────────────────
        rfqData.contactEmail = recipientEmail;
        await redis.set(`rfq:data:${quoteNumber}`, rfqData, RFQ_DATA_TTL);

        const followUpDates = followup?.followUpDates ?? [];

        return {
          success: true,
          message: `Quote ${quoteNumber} sent to ${recipientEmail}.`,
          followUpDates,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to send quote email: ${err?.message ?? 'unknown error'}`,
        };
      }
    },
  });
}
