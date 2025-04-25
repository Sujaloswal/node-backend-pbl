const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');

class User {
  /**
   * Find a user by email
   * @param {string} email 
   * @returns {Promise<Object|null>}
   */
  static async findByEmail(email) {
    try {
      console.log(`Finding user by email: ${email}`);
      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      console.log(`User lookup result: ${rows.length > 0 ? 'found' : 'not found'}`);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding user by email:', error);
      throw new Error(`Database error when finding user: ${error.message}`);
    }
  }
  
  /**
   * Find a user by ID
   * @param {number} id 
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    try {
      console.log(`Finding user by ID: ${id}`);
      const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
      console.log(`User ID lookup result: ${rows.length > 0 ? 'found' : 'not found'}`);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw new Error(`Database error when finding user by ID: ${error.message}`);
    }
  }
  
  /**
   * Get all users
   * @param {Function} [callback] Optional callback for non-Promise usage
   * @returns {Promise<Array>|void} Returns Promise with users array if no callback provided
   */
  static async getAllUsers(callback) {
    try {
      console.log('Getting all users from database');
      const [rows] = await pool.query('SELECT id, username, email, password, created_at FROM users ORDER BY created_at DESC');
      console.log(`Found ${rows.length} users`);
      
      const result = {
        count: rows.length,
        users: rows
      };
      
      // If callback is provided, use it (for legacy code)
      if (typeof callback === 'function') {
        callback(null, result);
        return;
      }
      
      // Otherwise return the users array for Promise-based usage
      return rows;
    } catch (error) {
      console.error('Error getting all users:', error);
      
      // Handle callback if provided
      if (typeof callback === 'function') {
        callback(error, null);
        return;
      }
      
      // Otherwise throw for Promise-based usage
      throw new Error(`Database error when retrieving users: ${error.message}`);
    }
  }
  
  /**
   * Create a new user
   * @param {Object} userData 
   * @param {string} userData.username
   * @param {string} userData.email
   * @param {string} userData.password
   * @returns {Promise<Object>}
   */
  static async create(userData) {
    try {
      // Basic validation
      if (!userData.username || !userData.email || !userData.password) {
        throw new Error('Missing required fields: username, email, and password are required');
      }
      
      // Check if email already exists
      const existingUser = await this.findByEmail(userData.email);
      if (existingUser) {
        throw new Error('Email already registered');
      }
      
      // Store password in plaintext (no hashing)
      console.log('Storing password in plaintext format...');
      const password = userData.password;
      
      // Insert user into database
      console.log(`Inserting user with email ${userData.email} into database...`);
      
      const [result] = await pool.query(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [userData.username, userData.email, password]
      );
      
      if (!result || !result.insertId) {
        throw new Error('Failed to insert user into database');
      }
      
      console.log(`User created successfully with ID: ${result.insertId}`);
      
      // Return the new user (with password for debugging)
      return { 
        id: result.insertId, 
        username: userData.username, 
        email: userData.email,
        password: password
      };
    } catch (error) {
      // Handle duplicate key errors
      if (error.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('email')) {
          throw new Error('Email already registered');
        } else {
          throw new Error('A user with these details already exists');
        }
      }
      
      // If it's already our custom error, just rethrow it
      if (error.message === 'Email already registered') {
        throw error;
      }
      
      // Handle other errors
      console.error('Error creating user:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }
  
  /**
   * Verify a user's password
   * @param {string} password - Plain text password
   * @param {string} storedPassword - Stored password
   * @returns {Promise<boolean>}
   */
  static async verifyPassword(password, storedPassword) {
    try {
      console.log('Verifying password using plaintext comparison...');
      // Simple direct comparison - no hashing
      return password === storedPassword;
    } catch (error) {
      console.error('Error verifying password:', error);
      throw new Error('Password verification failed');
    }
  }

  /**
   * Create the users table if it doesn't exist
   * @returns {Promise<boolean>}
   */
  static async createTable() {
    try {
      const sql = `
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(80) NOT NULL,
          email VARCHAR(120) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      await pool.query(sql);
      console.log('Users table ensured');
      return true;
    } catch (error) {
      console.error('Error creating users table:', error);
      return false;
    }
  }
}

module.exports = User; 