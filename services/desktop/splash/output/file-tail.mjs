import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

// Read bounded chunks without discarding earlier lines or splitting UTF-8.
export function createFileTail(file, { startAtEnd = false, chunkBytes = 64 * 1024 } = {}) {
  let offset = 0
  let identity = ''
  let prefix = Buffer.alloc(0)
  let decoder = new StringDecoder('utf8')
  let pending = ''
  let overlong = false
  const metadata = () => {
    const info = statSync(file)
    return { size: info.size, identity: `${info.dev}:${info.ino}` }
  }
  const readPrefix = (fd) => {
    const head = Buffer.alloc(64)
    const count = readSync(fd, head, 0, head.length, 0)
    return head.subarray(0, count)
  }
  if (startAtEnd) {
    let fd
    try {
      const info = metadata(); offset = info.size; identity = info.identity
      fd = openSync(file, 'r'); prefix = readPrefix(fd)
    } catch { /* not created yet */ }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  const read = ({ end = Infinity } = {}) => {
    let fd
    try {
      const info = metadata()
      fd = openSync(file, 'r')
      const currentPrefix = readPrefix(fd)
      if (info.size < offset || (identity && info.identity !== identity) ||
          (prefix.length && !currentPrefix.subarray(0, prefix.length).equals(prefix))) {
        offset = 0; pending = ''; overlong = false; decoder = new StringDecoder('utf8')
      }
      identity = info.identity; prefix = currentPrefix
      const limit = Math.min(info.size, end)
      if (limit <= offset) return { lines: [], caughtUp: true }
      const buffer = Buffer.alloc(Math.min(limit - offset, chunkBytes))
      const count = readSync(fd, buffer, 0, buffer.length, offset)
      offset += count
      const lines = (pending + decoder.write(buffer.subarray(0, count))).split(/\r\n|[\r\n]/)
      pending = lines.pop()
      const complete = []
      for (const line of lines) {
        complete.push(overlong ? '[Linha de saída demasiado longa]' : line)
        overlong = false
      }
      if (pending.length > 32 * 1024) { pending = ''; overlong = true }
      return { lines: complete, caughtUp: offset >= limit }
    } catch { return { lines: [], caughtUp: true } }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  read.boundary = () => { try { return metadata().size } catch { return 0 } }
  return read
}
