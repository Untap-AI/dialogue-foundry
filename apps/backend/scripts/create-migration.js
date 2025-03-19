#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Get the migration name from command line args or prompt
const getMigrationName = () => {
  return new Promise((resolve) => {
    if (process.argv.length > 2) {
      resolve(process.argv[2]);
    } else {
      rl.question('Migration name (snake_case): ', (answer) => {
        resolve(answer);
      });
    }
  });
};

const createMigration = async () => {
  try {
    const migrationName = await getMigrationName();
    
    if (!migrationName) {
      console.error('Migration name is required');
      rl.close();
      return;
    }
    
    // Create timestamp for the migration (YYYYMMDDHHMMSS format)
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    
    const migrationFileName = `${timestamp}_${migrationName}.sql`;
    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    
    // Create the migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    
    // Create up migration file
    const sqlContent = `-- Migration: ${migrationName}
-- Created at: ${now.toISOString()}

-- Up Migration
-- Write your SQL migration here (using IF EXISTS/IF NOT EXISTS for idempotence)



-- Down Migration (Optional)
-- Add SQL statements to revert the changes if needed (prefixed with -- for comments)
-- To run down migrations, you'll need to manually uncomment these lines
-- 
-- DROP TABLE IF EXISTS your_table;

`;
    
    fs.writeFileSync(path.join(migrationsDir, migrationFileName), sqlContent);
    
    console.log(`Migration created: ${migrationFileName}`);
    console.log(`- ${path.join(migrationsDir, migrationFileName)}`);
    
    rl.close();
  } catch (error) {
    console.error('Error creating migration:', error);
    rl.close();
  }
};

createMigration(); 