import { execFile, spawn, type ChildProcess } from 'node:child_process'

const PROVIDERS = [
  { name: 'com.deepin.SessionManager', path: '/com/deepin/SessionManager', args: ['org.freedesktop.DBus.Properties.Get', 'com.deepin.SessionManager', 'Locked'] },
  { name: 'org.ukui.ScreenSaver', path: '/', args: ['org.ukui.ScreenSaver.GetLockState'] }
] as const
type Provider = typeof PROVIDERS[number]

export function parseLockReply(reply: string): boolean | null {
  const match = /^\(\s*<?(true|false)>?\s*,?\s*\)\s*$/.exec(reply.trim())
  return match ? match[1] === 'true' : null
}

/** 只探测有明确锁状态语义的桌面接口；缺命令或接口时保守禁用。 */
export class LinuxScreenLock {
  locked: boolean | null = null
  private provider: Provider | null = null
  private monitor: ChildProcess | null = null
  private poll: ReturnType<typeof setInterval> | undefined
  private pending: Promise<boolean | null> | null = null
  private revision = 0
  private closed = false

  constructor(private readonly changed: (locked: boolean | null) => void) {}

  async start(): Promise<void> {
    for (const provider of PROVIDERS) {
      if (this.closed) return
      const locked = await this.read(provider)
      if (locked === null) continue
      this.provider = provider
      if (await this.watch(provider)) {
        await this.refresh()
        if (this.locked !== null) this.poll = setInterval(() => { void this.refresh() }, 5000)
        return
      }
      this.monitor?.kill()
      this.monitor = null
    }
    this.update(null)
  }

  refresh(): Promise<boolean | null> {
    if (!this.provider || this.closed || !this.monitor) return Promise.resolve(null)
    if (this.pending) return this.pending
    const revision = this.revision
    this.pending = this.read(this.provider).then(value => {
      // 新锁屏信号优先于更早发出的属性查询，迟到 false 不得重新放行。
      if (!this.closed && this.monitor && revision === this.revision) this.update(value)
      return this.locked
    }).finally(() => { this.pending = null })
    return this.pending
  }

  close(): void {
    this.closed = true
    clearInterval(this.poll)
    this.monitor?.kill()
    this.monitor = null
    this.locked = null
  }

  private update(value: boolean | null): void {
    const previous = this.locked
    this.locked = value
    if (value !== previous) { this.revision++; this.changed(value) }
  }

  private read(provider: Provider): Promise<boolean | null> {
    return new Promise(resolve => {
      execFile('gdbus', ['call', '--session', '--dest', provider.name, '--object-path', provider.path,
        '--method', ...provider.args], { timeout: 1500, maxBuffer: 4096, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => resolve(error ? null : parseLockReply(stdout)))
    })
  }

  private watch(provider: Provider): Promise<boolean> {
    return new Promise(resolve => {
      let initialized = false
      let buffer = ''
      const monitor = spawn('gdbus', ['monitor', '--session', '--dest', provider.name, '--object-path', provider.path],
        { env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] })
      this.monitor = monitor
      const timer = setTimeout(() => finish(false), 1500)
      const finish = (ok: boolean): void => {
        if (initialized) return
        initialized = true
        clearTimeout(timer)
        resolve(ok)
      }
      const lost = (): void => {
        finish(false)
        if (this.monitor === monitor && !this.closed) {
          this.monitor = null
          clearInterval(this.poll)
          this.update(null)
          monitor.kill()
        }
      }
      monitor.on('error', lost)
      monitor.on('exit', lost)
      monitor.stderr?.on('data', lost)
      monitor.stdout?.on('data', (chunk: Buffer) => {
        if (this.closed || this.monitor !== monitor) return
        buffer += chunk.toString('utf8')
        if (buffer.length > 8192) { lost(); return }
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.includes('has no owner')) { lost(); return }
          if (line.includes('is owned by')) { finish(true); continue }
          if (/\.lock\s*\(|Locked.*<true>|ActiveChanged\s*\(true/.test(line)) this.update(true)
          if (line.startsWith(provider.path + ':')) void this.refresh()
        }
      })
    })
  }
}
