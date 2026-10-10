import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

let mongoStatus = {
  connected: false,
  urlConfigured: false,
  mode: 'local_fallback',
  host: null,
  database: null,
  message: 'Initializing MongoDB connection...',
  lastError: null
};

export async function connectDB() {
  const rawUrl = (process.env.DB_URL || process.env.MONGODB_URI || '').trim();
  const dbUrl = rawUrl.replace(/^["']|["']$/g, '').trim();

  if (!dbUrl || dbUrl.includes('<username>') || dbUrl.includes('<password>')) {
    mongoStatus = {
      connected: false,
      urlConfigured: Boolean(dbUrl),
      mode: 'local_fallback',
      host: null,
      database: null,
      message: 'MongoDB Atlas URI (DB_URL) is not configured in server/.env. Running with local storage fallback.',
      lastError: null
    };
    console.log('\n================================================================');
    console.log(' [MongoDB Atlas Status]');
    console.log(' DB_URL is currently empty in server/.env.');
    console.log(' Platform running safely using high-speed local data persistence.');
    console.log(' Once you add your MongoDB Atlas URI to DB_URL, it will automatically connect.');
    console.log('================================================================\n');
    return false;
  }

  mongoStatus.urlConfigured = true;

  try {
    console.log('[MongoDB Atlas] Connecting to Atlas cluster...');
    
    // Connect with a reasonable timeout so server boots quickly even if network has delay
    await mongoose.connect(dbUrl, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });

    const conn = mongoose.connection;
    mongoStatus = {
      connected: true,
      urlConfigured: true,
      mode: 'atlas',
      host: conn.host,
      database: conn.name,
      message: `Connected successfully to MongoDB Atlas database "${conn.name}" on host "${conn.host}".`,
      lastError: null
    };

    console.log('\n================================================================');
    console.log(` [MongoDB Atlas Status] Successfully Connected!`);
    console.log(` Host:     ${conn.host}`);
    console.log(` Database: ${conn.name}`);
    console.log(' All platform collections will read/write live to MongoDB Atlas.');
    console.log('================================================================\n');

    return true;
  } catch (err) {
    mongoStatus = {
      connected: false,
      urlConfigured: true,
      mode: 'local_fallback',
      host: null,
      database: null,
      message: `Failed to connect to MongoDB Atlas (${err.message}). Using local storage fallback.`,
      lastError: err.message
    };

    console.warn('\n================================================================');
    console.warn(' [MongoDB Atlas Connection Warning]');
    console.warn(` Could not connect to Atlas: ${err.message}`);
    console.warn(' The server will continue running uninterrupted using local storage fallback.');
    console.warn(' Verify your Atlas connection string, IP Access List (0.0.0.0/0), and credentials in server/.env');
    console.warn('================================================================\n');

    return false;
  }
}

// Connection event listeners
mongoose.connection.on('disconnected', () => {
  if (mongoStatus.connected) {
    console.warn('[MongoDB Atlas] Connection disconnected.');
    mongoStatus.connected = false;
    mongoStatus.mode = 'local_fallback';
  }
});

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB Atlas] Connection restored.');
  mongoStatus.connected = true;
  mongoStatus.mode = 'atlas';
});

export function getMongoStatus() {
  return {
    ...mongoStatus,
    readyState: mongoose.connection.readyState, // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    timestamp: new Date().toISOString()
  };
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export default { connectDB, getMongoStatus, isMongoConnected };
