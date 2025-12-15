const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: 'postgres.namuapucjaqquiuloeix',
  host: 'db.namuapucjaqquiuloeix.supabase.co',
  database: 'postgres',
  password: 'David@30/08/2003',
  port: 5432,
  family: 4, // Forcing IPv4
});

module.exports = pool;