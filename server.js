/**
 * DART Fish Counter Backend
 * 
 * Fetches live fish passage data from Columbia Basin Research DART database
 * and serves it as JSON to the React frontend.
 * 
 * Installation:
 *   npm install express cors node-fetch csv-parse dotenv
 * 
 * Usage:
 *   node server.js
 *   Server runs on http://localhost:3001
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Map frontend species names to DART query parameters
const speciesMap = {
  'Chinook': 'chin',
  'Coho': 'coho',
  'Sockeye': 'sock',
  'Steelhead': 'steel',
  'Pink': 'pink',
  'Chum': 'chum',
  'Shad': 'shad'
};

// Map frontend dam names to DART project codes
const damMap = {
  'Bonneville': 'BON',
  'The Dalles': 'TDA',
  'John Day': 'JDA',
  'McNary': 'MCN',
  'Ice Harbor': 'IHA',
  'Lower Granite': 'LGS',
  'Priest Rapids': 'PRA',
  'Wells': 'WEL'
};

/**
 * Fetch adult passage data from DART
 * Constructs a query URL and fetches CSV data
 */
async function fetchDARTData(dam, species, startDate, endDate) {
  try {
    const damCode = damMap[dam];
    const speciesCode = speciesMap[species];

    if (!damCode || !speciesCode) {
      throw new Error(`Invalid dam (${dam}) or species (${species})`);
    }

    // Parse dates for DART query format
    const [startYear, startMonth, startDay] = startDate.split('-');
    const [endYear, endMonth, endDay] = endDate.split('-');

    // DART adult passage daily data query endpoint
    // The "Generate Query Result Link Only" feature creates URLs like this:
    // https://www.cbr.washington.edu/dart/query/adult_daily?...
    // 
    // Parameters typically include:
    // - project: dam code (e.g., BON, TDA, etc.)
    // - species: species code (e.g., chin, steel, etc.)
    // - startmonth, startday, startyear
    // - endmonth, endday, endyear
    // - output: csv (or html)
    
    const dartUrl = new URL('https://www.cbr.washington.edu/dart/query/adult_daily');
    
    // Add query parameters for adult passage daily data
    dartUrl.searchParams.append('project', damCode);
    dartUrl.searchParams.append('species', speciesCode);
    dartUrl.searchParams.append('startmonth', startMonth);
    dartUrl.searchParams.append('startday', startDay);
    dartUrl.searchParams.append('startyear', startYear);
    dartUrl.searchParams.append('endmonth', endMonth);
    dartUrl.searchParams.append('endday', endDay);
    dartUrl.searchParams.append('endyear', endYear);
    dartUrl.searchParams.append('output', 'csv');

    console.log(`Fetching DART data from: ${dartUrl.toString()}`);

    const response = await fetch(dartUrl.toString(), {
      headers: {
        'User-Agent': 'DART-Fish-Counter/1.0'
      },
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`DART API returned status ${response.status}`);
    }

    const csvText = await response.text();

    // Parse CSV data
    // DART CSV typically has columns like: Date, Project, Species, Count, 10YearAvg, etc.
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    // Transform DART data into our format
    const formattedData = records
      .filter(record => {
        // Skip header rows or metadata
        return record.Date && 
               !record.Date.toLowerCase().includes('date') &&
               record.Date.match(/^\d{4}-\d{2}-\d{2}$/);
      })
      .map(record => {
        // Parse numeric values, handle various DART formats
        const count = parseInt(record.Count || record['Adult Passage'] || 0) || 0;
        const avg10yr = parseInt(record['10-Year'] || record['10 Year Average'] || 0) || 0;
        
        return {
          date: record.Date,
          count: count,
          average10yr: avg10yr,
          dam: dam,
          species: species
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return formattedData;

  } catch (error) {
    console.error('Error fetching DART data:', error);
    throw error;
  }
}

/**
 * API endpoint: POST /api/query
 * Request body:
 *   { dam, species, startDate, endDate }
 * Response: Array of daily passage records
 */
app.post('/api/query', async (req, res) => {
  try {
    const { dam, species, startDate, endDate } = req.body;

    if (!dam || !species || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required parameters: dam, species, startDate, endDate'
      });
    }

    const data = await fetchDARTData(dam, species, startDate, endDate);

    // Calculate summary statistics
    if (data.length === 0) {
      return res.json({
        data: [],
        summary: null,
        message: 'No data found for this query'
      });
    }

    const counts = data.map(d => d.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = Math.round(total / counts.length);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    const avg10yr = Math.round(
      data.reduce((sum, d) => sum + d.average10yr, 0) / data.length
    );

    const summary = {
      total,
      average: avg,
      max,
      min,
      days: data.length,
      comparison: avg10yr > 0 ? ((avg - avg10yr) / avg10yr * 100).toFixed(1) : 0
    };

    res.json({ data, summary });

  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch data from DART'
    });
  }
});

/**
 * API endpoint: GET /api/species
 * Returns available species
 */
app.get('/api/species', (req, res) => {
  res.json({
    species: Object.keys(speciesMap)
  });
});

/**
 * API endpoint: GET /api/dams
 * Returns available dams
 */
app.get('/api/dams', (req, res) => {
  res.json({
    dams: Object.keys(damMap)
  });
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'DART Fish Counter Backend' });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

app.listen(PORT, () => {
  console.log(`DART Fish Counter backend running on http://localhost:${PORT}`);
  console.log(`POST /api/query - Fetch fish passage data`);
  console.log(`GET /api/species - List available species`);
  console.log(`GET /api/dams - List available dams`);
  console.log(`GET /api/health - Health check`);
});
