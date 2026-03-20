// Prevent pg from attempting real connections during tests
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
