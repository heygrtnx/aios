import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleSheetsService {
  private sheets;

  constructor(private config: ConfigService) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.config.get<string>('GOOGLE_CLIENT_EMAIL'),
        private_key: this.config
          .get<string>('GOOGLE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({
      version: 'v4',
      auth,
    });
  }

  async read(sheetId: string, range: string) {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    return res.data.values;
  }

  async append(sheetId: string, range: string, values: any[]) {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  }

  async batchAppend(sheetId: string, range: string, rows: any[][]) {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }

  /** Writes rows to an exact range starting at the given cell (e.g. 'Sheet1!A1'). */
  async batchWrite(sheetId: string, startCell: string, rows: string[][]) {
    if (rows.length === 0) return;
    const numCols = Math.max(...rows.map((r) => r.length));
    const endCol = this.columnLetter(numCols);
    const range = `${startCell}:${endCol}${rows.length}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }

  private columnLetter(col: number): string {
    let result = '';
    while (col > 0) {
      const mod = (col - 1) % 26;
      result = String.fromCharCode(65 + mod) + result;
      col = Math.floor((col - 1) / 26);
    }
    return result;
  }

  async clear(sheetId: string, range: string) {
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range,
    });
  }
}
