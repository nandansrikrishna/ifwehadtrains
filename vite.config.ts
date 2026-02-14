import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

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
          const body = await new Promise<string>((resolve, reject) => {
            let payload = ''
            req.on('data', (chunk) => {
              payload += chunk
            })
            req.on('end', () => resolve(payload))
            req.on('error', reject)
          })

          const parsed = JSON.parse(body) as { tracks?: Array<{ endpoints?: unknown; coordinates?: unknown }> }
          const incomingTracks = Array.isArray(parsed.tracks) ? parsed.tracks : []
          if (incomingTracks.length === 0) {
            res.statusCode = 400
            res.end('No tracks provided')
            return
          }

          for (const track of incomingTracks) {
            const validEndpoints = Array.isArray(track.endpoints) && track.endpoints.length === 2
            const validCoordinates =
              Array.isArray(track.coordinates) &&
              track.coordinates.length >= 2 &&
              track.coordinates.every((point) => Array.isArray(point) && point.length === 2)

            if (!validEndpoints || !validCoordinates) {
              res.statusCode = 400
              res.end('Invalid track payload')
              return
            }
          }

          const tracksPath = path.resolve(process.cwd(), 'src/tracks.json')
          const existing = JSON.parse(await fs.readFile(tracksPath, 'utf8')) as unknown[]
          const updatedTracks = [...existing, ...incomingTracks]
          await fs.writeFile(tracksPath, `${JSON.stringify(updatedTracks, null, 4)}\n`, 'utf8')

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ appended: incomingTracks.length }))
        } catch {
          res.statusCode = 500
          res.end('Failed to append tracks')
        }
      })
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), appendTracksDevPlugin()],
})
