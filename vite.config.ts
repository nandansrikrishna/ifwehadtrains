import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'

type DevTrack = { endpoints?: unknown; coordinates?: unknown }

function isValidTrack(track: DevTrack): boolean {
  const validEndpoints = Array.isArray(track.endpoints) && track.endpoints.length === 2
  const validCoordinates =
    Array.isArray(track.coordinates) &&
    track.coordinates.length >= 2 &&
    track.coordinates.every((point) => Array.isArray(point) && point.length === 2)

  return validEndpoints && validCoordinates
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let payload = ''
    req.on('data', (chunk) => {
      payload += chunk
    })
    req.on('end', () => resolve(payload))
    req.on('error', reject)
  })
}

const tracksPath = path.resolve(process.cwd(), 'src/tracks.json')

async function readTracks(): Promise<unknown[]> {
  return JSON.parse(await fs.readFile(tracksPath, 'utf8')) as unknown[]
}

async function writeTracks(tracks: unknown[]): Promise<void> {
  await fs.writeFile(tracksPath, `${JSON.stringify(tracks, null, 4)}\n`, 'utf8')
}

function appendTracksDevPlugin(): Plugin {
  return {
    name: 'append-tracks-dev-plugin',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/append-tracks', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)

          const parsed = JSON.parse(body) as { tracks?: DevTrack[] }
          const incomingTracks = Array.isArray(parsed.tracks) ? parsed.tracks : []
          if (incomingTracks.length === 0) {
            res.statusCode = 400
            res.end('No tracks provided')
            return
          }

          for (const track of incomingTracks) {
            if (!isValidTrack(track)) {
              res.statusCode = 400
              res.end('Invalid track payload')
              return
            }
          }

          const existing = await readTracks()
          const updatedTracks = [...existing, ...incomingTracks]
          await writeTracks(updatedTracks)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ appended: incomingTracks.length }))
        } catch {
          res.statusCode = 500
          res.end('Failed to append tracks')
        }
      })

      server.middlewares.use('/__dev/update-track', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const parsed = JSON.parse(body) as { index?: unknown; track?: DevTrack }
          const index = typeof parsed.index === 'number' ? parsed.index : Number(parsed.index)
          const track = parsed.track

          if (!Number.isInteger(index) || index < 0 || !track || !isValidTrack(track)) {
            res.statusCode = 400
            res.end('Invalid update payload')
            return
          }

          const existing = await readTracks()
          if (index >= existing.length) {
            res.statusCode = 404
            res.end('Track index out of range')
            return
          }

          existing[index] = track
          await writeTracks(existing)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ updated: index }))
        } catch {
          res.statusCode = 500
          res.end('Failed to update track')
        }
      })

      server.middlewares.use('/__dev/delete-track', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const parsed = JSON.parse(body) as { index?: unknown }
          const index = typeof parsed.index === 'number' ? parsed.index : Number(parsed.index)

          if (!Number.isInteger(index) || index < 0) {
            res.statusCode = 400
            res.end('Invalid delete payload')
            return
          }

          const existing = await readTracks()
          if (index >= existing.length) {
            res.statusCode = 404
            res.end('Track index out of range')
            return
          }

          existing.splice(index, 1)
          await writeTracks(existing)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ deleted: index }))
        } catch {
          res.statusCode = 500
          res.end('Failed to delete track')
        }
      })

      server.middlewares.use('/__dev/insert-track', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const body = await readRequestBody(req)
          const parsed = JSON.parse(body) as { index?: unknown; track?: DevTrack }
          const index = typeof parsed.index === 'number' ? parsed.index : Number(parsed.index)
          const track = parsed.track

          if (!Number.isInteger(index) || index < 0 || !track || !isValidTrack(track)) {
            res.statusCode = 400
            res.end('Invalid insert payload')
            return
          }

          const existing = await readTracks()
          if (index > existing.length) {
            res.statusCode = 404
            res.end('Track index out of range')
            return
          }

          existing.splice(index, 0, track)
          await writeTracks(existing)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ inserted: index }))
        } catch {
          res.statusCode = 500
          res.end('Failed to insert track')
        }
      })
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), appendTracksDevPlugin()],
})
