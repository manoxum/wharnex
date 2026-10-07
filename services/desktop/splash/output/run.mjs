import { captureStartup } from './capture.mjs'
const [command, ...args] = process.argv.slice(2)
if (!command) process.exitCode = 1
else process.exitCode = await captureStartup(command, args, { file: process.env.WHARNEX_SPLASH_OUTPUT_FILE })
