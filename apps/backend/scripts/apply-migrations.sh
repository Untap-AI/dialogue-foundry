#!/bin/bash

# Apply all migrations in the migrations folder
echo "Applying Supabase migrations..."

# Go to the directory where this script is located
cd "$(dirname "$0")"
cd ../supabase

# Apply all migrations
echo "Applying migrations..."
npx supabase migration up --db-url postgres://postgres:postgres@localhost:54322/postgres

echo "Migrations applied successfully!" 