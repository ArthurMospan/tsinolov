import db from './index';
import fs from 'fs';
import path from 'path';

const initDb = () => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    db.exec(schema);
    console.log('✅ Database initialized successfully.');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  }
};

initDb();
