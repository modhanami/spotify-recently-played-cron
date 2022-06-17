import 'dotenv/config';
import fs from 'fs';
import { JSONFile, Low } from 'lowdb';
import fetch from 'node-fetch';

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
} = process.env;

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing environment variables');
    return process.exit(1);
  }

  const dataPath = './data';
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath);
  }

  const infoSchemafileAdapter = new JSONFile('./info-schema.json');
  const infoSchemaDB = new Low(infoSchemafileAdapter);

  await infoSchemaDB.read();

  const accessToken = await getAccessToken(REFRESH_TOKEN, CLIENT_ID, CLIENT_SECRET);
  const cursorAfter = infoSchemaDB.data.cursor.after;
  const data = await getRecentlyPlayedTracks(accessToken, 50, cursorAfter);

  if (data.items.length === 0) {
    console.log('No new tracks found');
    return process.exit(0);
  }

  const newCursorAfter = data.cursors.after;
  console.log(`previous cursor: ${cursorAfter}`);
  console.log(`new cursor: ${newCursorAfter}`);

  // original data is in descending order, so we need to reverse it
  const sortedItems = data.items.sort((a, b) => {
    const aDate = new Date(a.played_at);
    const bDate = new Date(b.played_at);
    return aDate - bDate;
  });

  const itemsByDate = groupByDate(sortedItems, item => item.played_at.split('T')[0]);

  // write tracks into files for each day
  const dates = Object.keys(itemsByDate);
  for (const date of dates) {
    const items = itemsByDate[date];
    const filePath = `./data/${date}.json`;
    const fileAdapter = new JSONFile(filePath);
    const db = new Low(fileAdapter);

    await db.read();

    if (db.data) {
      db.data.items.push(...items);
    } else {
      db.data = {
        items: items,
      };
    }

    await db.write();
    console.log(`wrote ${items.length} items to ${filePath}`);
  }

  if (newCursorAfter) {
    infoSchemaDB.data.cursor.after = newCursorAfter;
  }

  await infoSchemaDB.write();
}

async function getAccessToken(refresh_token, client_id, client_secret) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
      client_id: client_id,
      client_secret: client_secret,
    }).toString(),
  });

  const data = await response.json();
  const accessToken = data.access_token;

  return accessToken;
}

async function getRecentlyPlayedTracks(accessToken, limit = 50, after = null) {
  const serachParams = new URLSearchParams({
    limit: limit,
  });

  if (after) {
    serachParams.append('after', after);
  }

  const response = await fetch(`https://api.spotify.com/v1/me/player/recently-played?${serachParams.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  return data;
}

function groupByDate(items, dateExtractor) {
  const groups = {};
  items.forEach(item => {
    const date = dateExtractor(item);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(item);
  });
  return groups;
}


main();