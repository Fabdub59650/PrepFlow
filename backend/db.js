const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'prepflow',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'prepflow',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,        // DATE/DATETIME en string (même règle que FilaFlow)
  decimalNumbers: true,     // DECIMAL renvoyés en nombres, pas en chaînes
});

module.exports = pool;
