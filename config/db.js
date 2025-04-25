const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Scansphere',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
  multipleStatements: false,
  dateStrings: true
};

console.log('MySQL Connection Config:');
console.log(`- Host: ${dbConfig.host}`);
console.log(`- User: ${dbConfig.user}`);
console.log(`- Database: ${dbConfig.database}`);
console.log(`- Port: ${dbConfig.port}`);

let pool = null;

function setupPool() {
  if (pool) {
    try {
      pool.end();
    } catch (error) {
      console.log('No existing pool to close or error closing pool:', error.message);
    }
  }

  try {
    pool = mysql.createPool(dbConfig);

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err.message);
      if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
        console.log('Attempting to reconnect to database...');
        setTimeout(() => {
          setupPool();
        }, 5000);
      }
    });

    return pool;
  } catch (error) {
    console.error('Error creating database pool:', error.message);
    return null;
  }
}

setupPool();

async function testConnection(retries = 3, delay = 3000) {
  if (!pool) {
    setupPool();
  }

  let attempts = 0;

  while (attempts < retries) {
    try {
      const connection = await pool.getConnection();
      console.log(`Database connection established successfully to ${dbConfig.database}`);
      const [result] = await connection.query('SELECT 1 as value');
      console.log(`Test query result: ${result[0].value}`);
      connection.release();
      return true;
    } catch (error) {
      attempts++;
      console.error(`Database connection attempt ${attempts}/${retries} failed:`, error.message);
      if (attempts >= retries) {
        console.error('Connection details:', {
          host: dbConfig.host,
          user: dbConfig.user,
          database: dbConfig.database,
          port: dbConfig.port
        });
        console.log('MySQL troubleshooting tips:');
        console.log('1. Make sure MySQL server is running');
        console.log('2. Verify your MySQL credentials in .env file');
        console.log('3. Check if MySQL is accepting connections from this host');
        console.log('4. Make sure no firewall is blocking port 3306');
        return false;
      }
      console.log(`Retrying connection in ${delay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      setupPool();
    }
  }

  return false;
}

async function initializeDatabase() {
  if (!pool) {
    console.log('No database pool available. Setting up...');
    setupPool();
  }

  try {
    console.log('Starting database initialization...');

    const canConnect = await testConnection(1);
    if (!canConnect) {
      console.error('Cannot proceed with database initialization due to connection issues');
      return false;
    }

    try {
      console.log('Creating users table if it does not exist...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(80) NOT NULL,
          email VARCHAR(120) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Users table ensured');

      const [columnsInfo] = await pool.query('DESCRIBE users');
      console.log('Current table structure:');
      columnsInfo.forEach(col => {
        console.log(`- ${col.Field}: ${col.Type}${col.Null === 'NO' ? ' NOT NULL' : ''}${col.Key === 'PRI' ? ' PRIMARY KEY' : ''}${col.Key === 'UNI' ? ' UNIQUE' : ''}`);
      });

      return true;
    } catch (error) {
      console.error('Error creating users table:', error.message);
      return false;
    }
  } catch (error) {
    console.error('Error initializing database:', error.message);
    return false;
  }
}

async function safeQuery(sql, params = []) {
  try {
    if (!pool) {
      console.log('No active pool, attempting to recreate...');
      setupPool();
    }
    const result = await pool.query(sql, params);
    return result;
  } catch (error) {
    if (error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ECONNREFUSED') {
      console.log('Connection lost during query, attempting to reconnect...');
      setupPool();
      throw new Error('Database connection lost. Please try again.');
    }
    throw error;
  }
}

module.exports = {
  pool: { query: safeQuery },
  testConnection,
  initializeDatabase,
  getConfig: () => ({ ...dbConfig })
};
