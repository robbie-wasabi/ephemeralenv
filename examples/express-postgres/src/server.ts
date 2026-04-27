import { createServer, type ServerResponse } from 'node:http'
import pg from 'pg'

const port = readPort()
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: false
})

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    const result = await pool.query('select id, email, name from users order by id')
    sendJson(res, result.rows)
    return
  }

  if (req.url === '/health') {
    sendJson(res, { ok: true })
    return
  }

  sendJson(res, { service: 'express-postgres-example', url: process.env.SITE_URL ?? null })
})

server.listen(port, () => {
  console.log(`Postgres example listening on http://localhost:${port}`)
})

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

function readPort(): number {
  const portArgIndex = process.argv.indexOf('--port')
  const raw = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.PORT
  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--port is required')
  }

  return parsed
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function shutdown(): void {
  server.close(() => {
    pool.end().finally(() => process.exit(0))
  })
}
