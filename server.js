const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { pool, testConnection, initializeDatabase } = require('./config/db');
const User = require('./models/user');
require('dotenv').config();

// Initialize the app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Improved request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  if (req.method === 'POST' && (req.url === '/api/register' || req.url === '/api/login')) {
    // Log request data for debugging (but hide passwords)
    const safeData = { ...req.body };
    if (safeData.password) safeData.password = '********';
    console.log(`Request data:`, safeData);
  }
  
  // Also log response status
  const originalSend = res.send;
  res.send = function(data) {
    console.log(`[${timestamp}] Response status: ${res.statusCode}`);
    return originalSend.call(this, data);
  };
  
  next();
});

// Serve the database viewer web interface at root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

// Health check route with improved database testing
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection with more details
    const isConnected = await testConnection();
    
    // Check if 'users' table exists and is accessible
    let tableStatus = 'unknown';
    if (isConnected) {
      try {
        const [tables] = await pool.query(`
          SELECT TABLE_NAME 
          FROM information_schema.TABLES 
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
        `, [process.env.DB_NAME]);
        
        tableStatus = tables.length > 0 ? 'exists' : 'missing';
      } catch (error) {
        tableStatus = `error: ${error.message}`;
      }
    }
    
    res.json({
      status: 'healthy',
      message: 'ScanSphere API is running',
      database: isConnected ? 'connected' : 'disconnected',
      users_table: tableStatus,
      config: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
      }
    });
  } catch (error) {
    res.json({
      status: 'healthy',
      message: 'ScanSphere API is running',
      database: `error: ${error.message}`
    });
  }
});

// Get all users API endpoint (for admin purposes)
app.get('/api/users', async (req, res) => {
  try {
    console.log('Retrieving all users');
    
    // Get all users from database (including passwords for debugging)
    const [users] = await pool.query(`
      SELECT id, username, email, password, created_at 
      FROM users 
      ORDER BY id DESC
    `);
    
    console.log(`Found ${users.length} users`);
    
    res.json({
      success: true,
      count: users.length,
      users: users
    });
  } catch (error) {
    console.error('Error retrieving users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create a test user (for development purposes)
app.post('/api/test-user', async (req, res) => {
  try {
    // Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only available in development mode'
      });
    }
    
    const testUser = {
      username: `test_user_${Date.now()}`,
      email: `test_${Date.now()}@example.com`,
      password: 'password123'
    };
    
    console.log(`Creating test user: ${testUser.username}`);
    
    // Create the test user
    const newUser = await User.create(testUser);
    
    res.status(201).json({
      success: true,
      message: 'Test user created successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Error creating test user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Register route
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Input validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: username, email, and password are required'
      });
    }
    
    console.log(`Attempting to register user: ${email}`);
    
    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    // Create new user
    console.log('Creating new user...');
    const newUser = await User.create({ username, email, password });
    console.log(`User created with ID: ${newUser.id}`);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific errors with more informative messages
    if (error.message.includes('Username already taken')) {
      return res.status(400).json({
        success: false,
        message: 'Username already taken'
      });
    } else if (error.message.includes('Email already registered')) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email and password are required'
      });
    }
    
    console.log(`Attempting to login user: ${email}`);
    
    // Check if user exists
    const user = await User.findByEmail(email);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check password - simple plaintext comparison
    console.log('Verifying password...');
    const isMatch = (password === user.password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '1h' }
    );
    
    console.log(`User login successful: ${email}`);
    
    // Flask application URL for direct redirection
    // Use environment variable or default to Netlify URL
    const netlifyUrl = process.env.NETLIFY_URL || 'https://your-netlify-app-url.netlify.app';
    const redirectUrl = `${netlifyUrl}/?token=${token}&username=${encodeURIComponent(user.username)}&email=${encodeURIComponent(user.email)}&user_id=${user.id}`;
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        password: user.password // Include password in response for demonstration
      },
      token,
      redirectUrl: redirectUrl  // Add the redirect URL to the response with token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An internal server error occurred'
    });
  }
});

// Forgot password route
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Input validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    console.log(`Password reset requested for: ${email}`);
    
    // Check if user exists (but don't tell the client)
    await User.findByEmail(email);
    
    // We always return success for security reasons
    // In a real app, you would send an email with reset link
    res.json({
      success: true,
      message: 'If your email is registered, you will receive a reset link'
    });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    // Still return success for security reasons
    res.json({
      success: true,
      message: 'If your email is registered, you will receive a reset link'
    });
  }
});

// Initialize the database and start the server
const PORT = process.env.PORT || 5001;

// Create a safe wrapper for the database - fallback to in-memory if database is unavailable
let inMemoryUserStore = [];
let isDatabaseAvailable = false;

// Middleware to check database connectivity before database operations
const databaseCheckMiddleware = async (req, res, next) => {
  if (req.url.startsWith('/api/') && !req.url.startsWith('/api/health')) {
    if (!isDatabaseAvailable) {
      // Retry database connection
      isDatabaseAvailable = await testConnection(1, 1000);
      
      if (!isDatabaseAvailable && (req.method !== 'GET')) {
        // Only allow GET operations when database is down, block writes
        return res.status(503).json({
          success: false,
          message: 'Database temporarily unavailable. Please try again later.',
          status: 'db_unavailable'
        });
      }
    }
  }
  next();
};

// Add the middleware
app.use(databaseCheckMiddleware);

async function startServer() {
  try {
    console.log('====================================');
    console.log('STARTING SERVER');
    console.log('====================================');
    console.log('Environment:', process.env.NODE_ENV || 'not set');
    console.log('Database host:', process.env.DB_HOST || 'not set');
    console.log('Database name:', process.env.DB_NAME || 'not set');
    console.log('Database user:', process.env.DB_USER || 'not set');
    console.log('====================================\n');
    
    // Test database connection
    console.log('Testing database connection...');
    isDatabaseAvailable = await testConnection();
    
    if (!isDatabaseAvailable) {
      console.error('\n⚠️ Database connection failed. The server will start anyway.');
      console.error('The application will operate with reduced functionality.');
      console.error('Database operations will be retried periodically.');
      console.error('Run node simple-test.js for a comprehensive MySQL connection test.\n');
      
      // Schedule periodic database connection attempts in the background
      scheduleReconnect();
    } else {
      // Initialize database and tables
      console.log('Initializing database and tables...');
      const dbInitialized = await initializeDatabase();
      
      if (!dbInitialized) {
        console.error('\n⚠️ Failed to initialize database schema.');
        console.error('The server will start, but database functionality may be limited.');
        console.error('Run node simple-test.js for a comprehensive database test.\n');
      } else {
        console.log('\n✅ Database initialization successful!\n');
      }
    }
    
    // Create the public directory if it doesn't exist
    const fs = require('fs');
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
      console.log('Created public directory for static files');
    }
    
    // Create a server and handle port conflicts gracefully
    const server = app.listen(PORT, () => {
      console.log(`\n====================================`);
      console.log(`SERVER RUNNING ON PORT ${PORT}`);
      console.log(`====================================`);
      console.log(`Web Interface: http://localhost:${PORT}/`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`API Base URL: http://localhost:${PORT}/api`);
      console.log(`User list: http://localhost:${PORT}/api/users`);
      console.log(`Database Status: ${isDatabaseAvailable ? '✅ Connected' : '❌ Disconnected (will retry)'}`);
      console.log(`====================================\n`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n⚠️ Port ${PORT} is already in use. Trying an alternative port...\n`);
        
        // Try an alternative port
        const alternativePort = parseInt(PORT) + 1;
        app.listen(alternativePort, () => {
          console.log(`\n====================================`);
          console.log(`SERVER RUNNING ON ALTERNATIVE PORT ${alternativePort}`);
          console.log(`====================================`);
          console.log(`Web Interface: http://localhost:${alternativePort}/`);
          console.log(`Health check: http://localhost:${alternativePort}/api/health`);
          console.log(`API Base URL: http://localhost:${alternativePort}/api`);
          console.log(`User list: http://localhost:${alternativePort}/api/users`);
          console.log(`Database Status: ${isDatabaseAvailable ? '✅ Connected' : '❌ Disconnected (will retry)'}`);
          console.log(`====================================\n`);
        }).on('error', (err) => {
          console.error(`\n❌ Failed to start server: ${err.message}\n`);
          console.error('Please manually kill the process using port', PORT, 'or change the PORT in .env file');
          console.error('On Windows, you can use: taskkill /F /PID <pid> (after finding the PID with: netstat -ano | findstr', PORT + ')');
          console.error('On Linux/Mac, you can use: lsof -i :', PORT, '&& kill <pid>\n');
          process.exit(1);
        });
      } else {
        console.error(`\n❌ Server error: ${err.message}\n`);
        process.exit(1);
      }
    });
    
    // Set up graceful shutdown
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    
    function gracefulShutdown() {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      
      // Force close after 5 seconds
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 5000);
    }
    
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

// Schedule periodic reconnection attempts if the database is down
function scheduleReconnect() {
  const reconnectInterval = 30000; // 30 seconds
  
  console.log(`Scheduling database reconnection attempt in ${reconnectInterval / 1000} seconds...`);
  
  setTimeout(async () => {
    console.log('Attempting to reconnect to database...');
    isDatabaseAvailable = await testConnection(2);
    
    if (isDatabaseAvailable) {
      console.log('✅ Successfully reconnected to database!');
      
      // Initialize database after reconnection
      const dbInitialized = await initializeDatabase();
      if (dbInitialized) {
        console.log('✅ Database initialization successful after reconnect.');
      }
    } else {
      console.log('❌ Database reconnection failed. Will try again later.');
      scheduleReconnect(); // Schedule another attempt
    }
  }, reconnectInterval);
}

startServer(); 