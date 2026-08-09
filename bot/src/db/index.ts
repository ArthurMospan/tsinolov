import Database from 'better-sqlite3';
import path from 'path';

// Connect to the database
const dbPath = path.resolve(__dirname, '../../database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

export default db;
