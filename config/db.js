const mysql = require('mysql2/promise');
require('dotenv').config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'sql12.freesqldatabase.com',
  user: process.env.DB_USER || 'sql12775423',
  password: process.env.DB_PASSWORD || 'RIUssUD3pL',
  database: process.env.DB_NAME || 'sql12775423',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
  multipleStatements: false,
  dateStrings: true,
};

// Logging the DB config (safe - no password shown)
console.log('MySQL Connection Config:');
console.log(`- Host: ${dbConfig.host}`);
console.log(`- User: ${dbConfig.user}`);
console.log(`- Database: ${dbConfig.database}`);
console.log(`- Port: ${dbConfig.port}`);

// Global pool
let pool = null;

// Create and return a MySQL pool
function setupPool() {
  if (pool) {
    try {
      pool.end();
    } catch (err) {
      console.log('Error closing existing pool:', err.message);
    }
  }

  try {
    pool = mysql.createPool(dbConfig);
    pool.on('error', (err) => {
      console.error('Database pool error:', err.message);
      if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
        console.log('Reconnecting to database...');
        setTimeout(setupPool, 5000);
      }
    });

    return pool;
  } catch (err) {
    console.error('Failed to setup database pool:', err.message);
    return null;
  }
}

// Initialize pool
setupPool();

// Test DB connection
async function testConnection(retries = 3, delay = 3000) {
  if (!pool) setupPool();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await pool.getConnection();
      const [result] = await conn.query('SELECT 1 as ok');
      conn.release();
      console.log(`✅ DB Connected: ${result[0].ok}`);
      return true;
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);
      if (attempt < retries) {
        await new Promise(res => setTimeout(res, delay));
        setupPool();
      }
    }
  }

  console.error('All connection attempts failed');
  return false;
}

// Safe query wrapper
async function safeQuery(sql, params = []) {
  try {
    if (!pool) setupPool();
    return await pool.query(sql, params);
  } catch (err) {
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
      console.error('Lost DB connection, reconnecting...');
      setupPool();
    }
    throw err;
  }
}

module.exports = {
  pool: { query: safeQuery },
  testConnection,
  getConfig: () => ({ ...dbConfig }),
};
