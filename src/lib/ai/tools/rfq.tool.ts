import { tool } from 'ai';
import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../redis/redis.service';
import type { GoogleSheetsService } from '../../google/sheet/sheet.service';

/** 30-day TTL — keeps download link alive */
export const RFQ_DATA_TTL = 60 * 60 * 24 * 30;
/** 7-day TTL for follow-up cadence */
const RFQ_FOLLOWUP_TTL = 60 * 60 * 24 * 7;

export interface RfqLineItem {
  sku: string;
  qty: number;
  unit: string;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface RfqData {
  quoteNumber: string;
  quoteDate: string;
  validUntil: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  lineItems: RfqLineItem[];
  shipTo: string;
  deliveryDate: string | null;
  notes: string | null;
  total: string;
  hasAllPrices: boolean;
}

export interface RfqFollowup {
  quoteNumber: string;
  recipientEmail: string | null;
  followUpDates: string[];
  followUpSent: boolean[];
  status: 'pending' | 'email_sent';
}

function generateQuoteNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `RFQ-${dateStr}-${suffix}`;
}

function isoDate(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function createRfqTool(
  config: ConfigService,
  redis: RedisService,
  sheets: GoogleSheetsService,
) {
  return tool({
    description:
      'Process a Request for Quote (RFQ). Call this when a user submits an RFQ — ' +
      'they want pricing, list SKUs/products with quantities, or ask for a quote. ' +
      'Extract all available info and pass it here. The tool validates, generates a ' +
      'draft quote, logs to Google Sheets, stores the quote in Redis, and schedules ' +
      'a 3-day follow-up cadence.',
    inputSchema: z.object({
      contactName: z.string().describe('Full name or company name'),
      contactPhone: z.string().optional().describe('Phone number'),
      contactEmail: z.string().optional().describe('Email address'),
      items: z.array(
        z.object({
          sku: z.string().describe('Product SKU or description'),
          qty: z.number().describe('Requested quantity'),
          unit: z.string().optional().describe('Unit of measure'),
          unitPrice: z.number().optional().describe('Unit price if stated'),
        }),
      ),
      shipTo: z.string().describe('Delivery destination'),
      deliveryDate: z.string().optional().describe('Requested delivery date'),
      notes: z.string().optional().describe('Special requirements or notes'),
    }),

    execute: async ({
      contactName,
      contactPhone,
      contactEmail,
      items,
      shipTo,
      deliveryDate,
      notes,
    }) => {
      try {
        // ── Validate ──────────────────────────────────────────────────────────
        if (!contactName?.trim())
          return { success: false, message: 'Contact name is required.' };
        if (!items?.length)
          return { success: false, message: 'At least one item is required.' };
        if (!shipTo?.trim())
          return { success: false, message: 'Ship-to destination is required.' };

        // ── Build quote ───────────────────────────────────────────────────────
        const quoteNumber = generateQuoteNumber();
        const quoteDate = isoDate();
        const validUntil = isoDate(30 * 24 * 60 * 60 * 1000);

        // ── Auto-fill prices from uploaded product catalog ────────────────────
        const catalog: Record<string, { price: number | null; unit: string }> | null =
          await redis.get('product-catalog');

        let hasAllPrices = true;
        let subtotal = 0;
        const missingSkus: string[] = [];

        const lineItems: RfqLineItem[] = items.map((item) => {
          const skuKey = item.sku.trim().toUpperCase();
          const catalogEntry = catalog?.[skuKey] ?? null;

          // Priority: explicit price from AI > catalog price > TBD
          // Treat 0 as "not provided" — AI sometimes passes 0 for unknown prices
          const unitPrice =
            item.unitPrice != null && item.unitPrice > 0
              ? item.unitPrice
              : (catalogEntry?.price ?? null);

          const unit = item.unit ?? catalogEntry?.unit ?? 'pcs';
          const lineTotal = unitPrice != null ? item.qty * unitPrice : null;

          if (unitPrice == null) {
            hasAllPrices = false;
            missingSkus.push(item.sku);
          } else {
            subtotal += lineTotal!;
          }

          return { sku: item.sku, qty: item.qty, unit, unitPrice, lineTotal };
        });

        const total = hasAllPrices ? fmt(subtotal) : 'TBD';

        const itemsTable = lineItems
          .map((li) => {
            const priceCol =
              li.unitPrice != null
                ? ` @ $${fmt(li.unitPrice)} = $${fmt(li.lineTotal!)}`
                : ' — Price: TBD';
            return `• **${li.sku}** — Qty: ${li.qty} ${li.unit}${priceCol}`;
          })
          .join('\n');

        const draftQuote =
          `**Quote Ref: ${quoteNumber}**\n` +
          `Date: ${quoteDate}  ·  Valid Until: ${validUntil}\n\n` +
          `**Contact:** ${contactName}` +
          (contactPhone ? `  ·  ${contactPhone}` : '') +
          (contactEmail ? `  ·  ${contactEmail}` : '') +
          `\n**Ship To:** ${shipTo}\n` +
          (deliveryDate ? `**Delivery:** ${deliveryDate}\n` : '') +
          `\n**Items:**\n${itemsTable}\n\n` +
          `**Total: ${hasAllPrices ? `$${total}` : total}**` +
          (notes ? `\n\n**Notes:** ${notes}` : '');

        // ── Persist full quote data (download + email) ────────────────────────
        const rfqData: RfqData = {
          quoteNumber, quoteDate, validUntil,
          contactName,
          contactPhone: contactPhone ?? null,
          contactEmail: contactEmail ?? null,
          lineItems, shipTo,
          deliveryDate: deliveryDate ?? null,
          notes: notes ?? null,
          total, hasAllPrices,
        };
        await redis.set(`rfq:data:${quoteNumber}`, rfqData, RFQ_DATA_TTL);

        // ── Follow-up cadence ─────────────────────────────────────────────────
        const followUpDates = [
          isoDate(1 * 24 * 60 * 60 * 1000),
          isoDate(2 * 24 * 60 * 60 * 1000),
          isoDate(3 * 24 * 60 * 60 * 1000),
        ];
        const followup: RfqFollowup = {
          quoteNumber,
          recipientEmail: contactEmail ?? null,
          followUpDates,
          followUpSent: [false, false, false],
          status: 'pending',
        };
        await redis.set(`rfq:followup:${quoteNumber}`, followup, RFQ_FOLLOWUP_TTL);

        // ── Log to Google Sheets ──────────────────────────────────────────────
        const sheetId = config.get<string>('GOOGLE_SHEET_ID');
        let loggedToSheets = false;
        if (sheetId) {
          try {
            await sheets.append(sheetId, 'RFQ Log!A:M', [
              quoteNumber, quoteDate, contactName,
              contactPhone ?? '', contactEmail ?? '',
              JSON.stringify(lineItems), shipTo,
              deliveryDate ?? '', notes ?? '',
              'Pending', total, followUpDates[0],
            ]);
            loggedToSheets = true;
          } catch (e: any) {
            console.warn('[RFQ] Sheet log failed:', e?.message);
          }
        }

        // ── Build download URL ────────────────────────────────────────────────
        const nodeEnv = config.get<string>('NODE_ENV') || 'development';
        const port = config.get<number>('PORT') || 3000;
        const rawUrl =
          nodeEnv === 'production'
            ? (config.get<string>('PRODUCTION_URL') || config.get<string>('DEVELOPMENT_URL') || `http://localhost:${port}`)
            : (config.get<string>('DEVELOPMENT_URL') || `http://localhost:${port}`);
        const baseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
        const downloadUrl = `${baseUrl}/v1/chat/rfq/${quoteNumber}/download`;

        return {
          success: true,
          quoteNumber,
          draftQuote,
          followUpDates,
          downloadUrl,
          loggedToSheets,
          contactEmail: contactEmail ?? null,
          missingPriceSkus: missingSkus, // SKUs not found in catalog
          catalogUsed: !!catalog,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to process RFQ: ${err?.message ?? 'unknown error'}`,
        };
      }
    },
  });
}
