# Supabase Migration System

This directory contains the Supabase database migrations and configuration for the dialogue-foundry project.

## Directory Structure

- `migrations/` - Contains all database migrations as timestamped SQL files
- `functions/` - Edge functions (serverless functions)
- `config.toml` - Supabase configuration file
- `schema.sql` - Full database schema (reference only)

## Migration Workflow

### Starting Supabase

```bash
npm run supabase-start
```

### Creating a New Migration

```bash
npm run new-migration <migration_name>
```

This creates a new migration in the `migrations` directory with the naming convention:
```
migrations/
  20240601123456_migration_name.sql   # SQL statements for the migration
```

### Running Migrations

```bash
npm run db-migrate
```

This applies all pending migrations and updates the TypeScript type definitions.

### Resetting the Database

```bash
npm run db-reset
```

This resets the database to a clean state and applies all migrations.

### Checking Supabase Status

```bash
npm run supabase-status
```

### Stopping Supabase

```bash
npm run supabase-stop
```

## Working with Remote Databases

### Pulling Changes from Remote

```bash
npm run db-pull
```

### Pushing Changes to Remote

```bash
npm run db-push
```

## Database Schema

The main database schema includes:

- `chats` - Chat conversations
- `messages` - Individual messages in a chat

See `schema.sql` for the complete schema definition. 