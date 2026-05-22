import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const SPREADSHEET_ID = '1AVxdNbYmgD-rAFYagD7m9XRTvz10KrBWzEiOC4jeflk';
const SHEET_NAME = '全体';

async function testConnection() {
  try {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    }

    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get the first 3 rows to check column structure
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z3`,
    });

    const rows = response.data.values;
    console.log('✅ Connection successful!');
    console.log('Header row:', rows?.[0]);
    console.log('Row 2 (sample):', rows?.[1]);
    console.log('Total columns:', rows?.[0]?.length);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
