// Recreates the disposable e2e database before the playground server starts.
import pg from 'pg'

const admin = new pg.Client({ connectionString: process.env.CONFIGURATION_TEST_DATABASE_URL })
await admin.connect()
await admin.query('drop database if exists "configuration_e2e" with (force)')
await admin.query('create database "configuration_e2e"')
await admin.end()
