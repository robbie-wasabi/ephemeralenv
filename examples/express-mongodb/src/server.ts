import { createServer, type ServerResponse } from 'node:http'
import { MongoClient } from 'mongodb'

const port = readPort()
const uri = process.env.MONGODB_URI

if (!uri) {
  throw new Error('MONGODB_URI is required')
}

const client = new MongoClient(uri)
await client.connect()

const server = createServer(async (req, res) => {
  if (req.url === '/users') {
    const users = await client.db().collection('users').find({}, { projection: { _id: 0 } }).toArray()
    sendJson(res, users)
    return
  }

  if (req.url === '/health') {
    sendJson(res, { ok: true })
    return
  }

  sendJson(res, { service: 'express-mongodb-example', url: process.env.SITE_URL ?? null })
})

server.listen(port, () => {
  console.log(`Mongo example listening on http://localhost:${port}`)
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
    client.close().finally(() => process.exit(0))
  })
}
