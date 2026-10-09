import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const compose = readFileSync(new URL('../../compose.yml', import.meta.url), 'utf8')
const backend = compose.match(/^  backend:\n([\s\S]*?)(?=^  \S|$(?![\s\S]))/m)?.[1]

test('the persistent backend uses an init to reap orphaned subprocesses', () => {
  assert.ok(backend)
  assert.equal(/^    init: true$/m.test(backend), true, 'Go must not own PID 1 without a process reaper')
  assert.equal(/^    stop_grace_period: 30s$/m.test(backend), true, 'shutdown must have time to drain HTTP and flush logs')
})

// Exercise reparenting with the real Docker runtime rather than a shell PID 1
// that could accidentally reap the fixture's children itself.
test('Docker init eliminates the orphan zombies reproduced without init', {
  skip: process.env.WHARNEX_DOCKER_PROCESS_TEST !== '1', timeout: 60_000,
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wharnex-process-init-'))
  const source = path.join(root, 'probe.go'), binary = path.join(root, 'probe')
  try {
    writeFileSync(source, `package main
import("fmt";"os";"os/exec";"strings";"time")
func main(){
 for i:=0;i<16;i++{
  if err:=exec.Command("/bin/sh","-c","sleep 0.01 &").Run();err!=nil{panic(err)}
 }
 time.Sleep(300*time.Millisecond)
 entries,_:=os.ReadDir("/proc");zombies:=0
 for _,entry:=range entries{
  data,err:=os.ReadFile("/proc/"+entry.Name()+"/stat");if err!=nil{continue}
  raw:=string(data);end:=strings.LastIndex(raw,")");if end<0{continue}
  fields:=strings.Fields(raw[end+1:]);if len(fields)>0&&fields[0]=="Z"{zombies++}
 }
 fmt.Printf("zombies=%d\\n",zombies)
 if zombies>0{os.Exit(1)}
}
`)
    execFileSync('go', ['build', '-o', binary, source], {
      cwd: root, timeout: 30_000,
      env: { ...process.env, CGO_ENABLED: '0', GOMAXPROCS: '2' },
    })
    const image = execFileSync('docker', ['inspect', '-f', '{{.Image}}', 'wharnex-backend-1'], { encoding: 'utf8' }).trim()
    const run = (init) => spawnSync('docker', ['run', '--rm', ...init,
      '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--pids-limit=128', '--memory=128m', '--read-only',
      '-v', `${root}:/probe:ro`, '--entrypoint=/probe/probe', image,
    ], { encoding: 'utf8', timeout: 15_000 })
    const before = run([]), after = run(['--init'])
    assert.equal(before.status, 1, `baseline must reproduce zombies: ${before.stderr}`)
    assert.match(before.stdout, /zombies=[1-9]\d*/)
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stdout.trim(), 'zombies=0')
    console.log(`without init: ${before.stdout.trim()}; with init: ${after.stdout.trim()}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
