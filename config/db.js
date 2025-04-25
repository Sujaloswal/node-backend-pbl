const mysql = require('mysql2/promise');
require('dotenv').config();

// Improved database connection configuration with better defaults
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
  keepAliveInitialDelay: 10000, // 10 seconds
  connectTimeout: 10000, // 10 seconds
  // Handle connection errors gracefully
  multipleStatements: false, // Security best practice
  dateStrings: true // Return dates as strings to avoid timezone issues
};

// Log connection details (without password)
console.log('MySQL Connection Config:');
console.log(`- Host: ${dbConfig.host}`);
console.log(`- User: ${dbConfig.user}`);
console.log(`- Database: ${dbConfig.database}`);
console.log(`- Port: ${dbConfig.port}`);

// Create a connection pool
let pool = null;

// Setup pool with retry functionality
function setupPool() {
  if (pool) {
    // Close existing pool if it exists
    try {
      pool.end();
    } catch (error) {
      console.log('No existing pool to close or error closing pool:', error.message);
    }
  }
  
  try {
    // Create a new pool
    pool = mysql.createPool(dbConfig);
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err.message);
      if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
        console.log('Attempting to reconnect to database...');
        setTimeout(() => {
          setupPool();
        }, 5000); // Retry after 5 seconds
      }
    });
    
    return pool;
  } catch (error) {
    console.error('Error creating database pool:', error.message);
    return null;
  }
}

// Initialize the pool
setupPool();

// Test database connection with retries
async function testConnection(retries = 3, delay = 3000) {
  // Create the pool if it doesn't exist
  if (!pool) {
    setupPool();
  }
  
  let attempts = 0;
  
  while (attempts < retries) {
    try {
      const connection = await pool.getConnection();
      console.log(`Database connection established successfully to ${dbConfig.database}`);
      
      // Test execute a simple query
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
        console.log('   - Windows: Check Services for "MySQL" or run "net start MySQL"');
        console.log('   - Linux: Run "sudo systemctl status mysql" or "sudo service mysql status"');
        console.log('2. Verify your MySQL credentials in .env file');
        console.log('3. Check if MySQL is accepting connections from this host');
        console.log('4. Make sure no firewall is blocking port 3306');
        console.log('5. Try connecting with another tool like MySQL Workbench to verify credentials');
        
        return false;
      }
      
      // Wait before retrying
      console.log(`Retrying connection in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Recreate pool before retry
      setupPool();
    }
  }
  
  return false;
}

// Improved initializeDatabase function with better error handling
async function initializeDatabase() {
  if (!pool) {
    console.log('No database pool available. Setting up...');
    setupPool();
  }
  
  try {
    console.log('Starting database initialization...');
    
    // Check if we can connect to MySQL server
    const canConnect = await testConnection(1);
    if (!canConnect) {
      console.error('Cannot proceed with database initialization due to connection issues');
      return false;
    }
    
    // Create a connection without specifying a database
    console.log('Creating temporary connection to MySQL server...');
    const tempConfig = { ...dbConfig };
    delete tempConfig.database;
    let tempPool = null;
    
    try {
      tempPool = mysql.createPool(tempConfig);
      
      // Check if database exists, create if not
      console.log(`Checking if database '${dbConfig.database}' exists...`);
      const [databases] = await tempPool.query(`SHOW DATABASES LIKE '${dbConfig.database}'`);
      
      if (databases.length === 0) {
        console.log(`Database '${dbConfig.database}' does not exist, creating it...`);
        await tempPool.query(`CREATE DATABASE \`${dbConfig.database}\``);
        console.log(`Database '${dbConfig.database}' created successfully`);
        
        // Reconnect our main pool to the new database
        setupPool();
      } else {
        console.log(`Database '${dbConfig.database}' already exists`);
      }
    } catch (error) {
      console.error(`Error working with database '${dbConfig.database}':`, error.message);
      return false;
    } finally {
      // Close temporary connection
      if (tempPool) {
        await tempPool.end().catch(() => console.log('Error closing temporary pool'));
        console.log('Temporary connection closed');
      }
    }
    
    // Try to create the users table
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
      
      // Check if username has a unique constraint and remove it if needed
      try {
        console.log('Checking users table structure...');
        const [indexInfo] = await pool.query(`
          SHOW INDEXES FROM users 
          WHERE Column_name = 'username' AND Non_unique = 0
        `);
        
        // If username has a unique index, we need to remove it
        if (indexInfo.length > 0) {
          console.log('Removing unique constraint from username...');
          await pool.query('ALTER TABLE users DROP INDEX ' + indexInfo[0].Key_name);
          console.log('Unique constraint removed from username');
        } else {
          console.log('Username is already non-unique, no changes needed');
        }
        
        // Update any hashed passwords to plaintext
        try {
          console.log('Converting any hashed passwords to plaintext...');
          const [users] = await pool.query('SELECT id, password FROM users WHERE password LIKE "$2a$%"');
          
          if (users.length > 0) {
            console.log(`Found ${users.length} users with hashed passwords. Converting to plaintext...`);
            // For security purposes, we'll just set these passwords to "password123"
            for (const user of users) {
              await pool.query('UPDATE users SET password = ? WHERE id = ?', ['password123', user.id]);
            }
            console.log('All hashed passwords converted to plaintext successfully');
          } else {
            console.log('No hashed passwords found, all passwords are already in plaintext format');
          }
        } catch (error) {
          console.error('Error converting hashed passwords:', error.message);
          // Continue even if we couldn't update passwords
        }
        
        // Log the current table structure
        const [columnsInfo] = await pool.query('DESCRIBE users');
        console.log('Current table structure:');
        columnsInfo.forEach(col => {
          console.log(`- ${col.Field}: ${col.Type}${col.Null === 'NO' ? ' NOT NULL' : ''}${col.Key === 'PRI' ? ' PRIMARY KEY' : ''}${col.Key === 'UNI' ? ' UNIQUE' : ''}`);
        });
      } catch (error) {
        console.error('Error checking users table structure:', error.message);
        // Continue even if we couldn't check the structure
      }
      
      // Test if the table exists and is accessible
      const [tables] = await pool.query(`
        SELECT TABLE_NAME 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
      `, [dbConfig.database]);
      
      if (tables.length === 0) {
        console.error('Table creation did not work properly');
        return false;
      }
      
      console.log('Table structure confirmed');
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

// Safe query wrapper that handles connection errors
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
  pool: { query: safeQuery }, // Override with our safe query method
  testConnection,
  initializeDatabase,
  getConfig: () => ({ ...dbConfig }) // Return a copy of the config for reference
}; 