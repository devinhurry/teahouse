<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { tr } from './utils/i18n'
import { applyPerformanceProfile } from './utils/performance-profile'
import { SCREEN_MAX_FRAME_BYTES, SCREEN_MAX_PIXELS } from '../../shared/protocol'
import { isScreenMode, type ScreenImage, type ScreenSample, type ScreenSource, type ScreenState } from '../../shared/remote-view'

const state = ref<ScreenState | null>(null)
const sources = ref<ScreenSource[]>([])
const selected = ref('')
const selecting = ref(false)
const preparing = ref(false)
const fit = ref(true)
const received = ref(false)
const stale = ref(false)
const canvas = ref<HTMLCanvasElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const error = ref('')
const sourceName = ref('')
const subscriptions: Array<() => void> = []
let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let encoder: HTMLCanvasElement | null = null
let sampling = false
let displaying = false
let disposed = false
let generation = 0
let staleTimer: ReturnType<typeof setTimeout> | undefined
let pan: { x: number; y: number; left: number; top: number } | null = null
const sharer = computed(() => state.value?.role === 'sharer')
const title = computed(() => sharer.value
  ? tr('{0} 正在查看你的屏幕', { 0: state.value?.peerName ?? '' })
  : tr('查看 {0} 的屏幕', { 0: state.value?.peerName ?? '' }))
watchEffect(() => { document.title = tr('屏幕协助') })

function live(id: string, run: number): boolean {
  return !disposed && run === generation && state.value?.sessionId === id && state.value.phase !== 'ended'
}
function acceptState(next: ScreenState | null): void {
  if (!next || disposed || (state.value && next.revision < state.value.revision)) return
  state.value = next
  if (next.phase === 'ended') cleanup()
}
function cleanup(): void {
  generation += 1
  clearTimeout(staleTimer)
  stale.value = false
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  if (video) { video.pause(); video.srcObject = null; video.remove(); video = null }
  if (encoder) { encoder.width = encoder.height = 0; encoder = null }
  if (canvas.value) canvas.value.width = canvas.value.height = 0
  sources.value = []
  received.value = false
}
function stop(): void {
  const id = state.value?.sessionId
  cleanup()
  if (id) void window.pantry.stopScreen(id)
}
function decline(): void {
  if (state.value) void window.pantry.respondScreen(state.value.sessionId, false)
}
function fail(id: string, reason: 'permission-denied' | 'capture-failed' = 'capture-failed'): void {
  cleanup()
  void window.pantry.failScreen(id, reason)
}
async function choose(): Promise<void> {
  if (!state.value || selecting.value) return
  selecting.value = true
  error.value = ''
  const id = state.value.sessionId
  const run = generation
  try {
    const result = await window.pantry.getScreenSources(id)
    if (live(id, run)) sources.value = result
  } catch { if (live(id, run)) error.value = tr('无法获取屏幕，请重试') }
  finally { selecting.value = false }
}
async function share(): Promise<void> {
  if (!state.value || !selected.value || preparing.value) return
  const id = state.value.sessionId
  const run = generation
  sourceName.value = sources.value.find(source => source.id === selected.value)?.name ?? ''
  preparing.value = true
  try {
    if (!await window.pantry.respondScreen(id, true, selected.value) || !live(id, run)) return
    sources.value = []
    const media = await navigator.mediaDevices.getDisplayMedia({ audio: false,
      video: { frameRate: { ideal: 10, max: 10 }, width: { ideal: 1600 }, height: { ideal: 1600 } } })
    if (!live(id, run)) { media.getTracks().forEach(track => track.stop()); return }
    stream = media
    media.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (live(id, run)) fail(id)
    }, { once: true }))
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = media
    await video.play()
    if (!live(id, run)) return
    if (!video.videoWidth || !video.videoHeight) throw new Error('屏幕帧不可用')
    encoder = document.createElement('canvas')
    if (!await window.pantry.screenReady(id)) cleanup()
  } catch (cause) {
    if (live(id, run)) fail(id, cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'permission-denied' : 'capture-failed')
  } finally { preparing.value = false }
}
async function sample(request: ScreenSample): Promise<void> {
  const run = generation
  if (!live(request.sessionId, run) || !stream || !video || !encoder || sampling) return
  sampling = true
  try {
    for (const [edge, quality] of [[1600, 0.60], [1600, 0.50], [1280, 0.50]]) {
      const ratio = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight), Math.sqrt(SCREEN_MAX_PIXELS / (video.videoWidth * video.videoHeight)))
      const width = Math.max(1, Math.floor(video.videoWidth * ratio))
      const height = Math.max(1, Math.floor(video.videoHeight * ratio))
      if (encoder.width !== width) encoder.width = width
      if (encoder.height !== height) encoder.height = height
      const context = encoder.getContext('2d', { alpha: false })
      if (!context) throw new Error('画布不可用')
      context.drawImage(video, 0, 0, width, height)
      const blob = await new Promise<Blob | null>(resolve => encoder!.toBlob(resolve, 'image/jpeg', quality))
      if (!live(request.sessionId, run)) return
      if (!blob) throw new Error('编码失败')
      if (blob.size > SCREEN_MAX_FRAME_BYTES) continue
      const bytes = await blob.arrayBuffer()
      if (!live(request.sessionId, run)) return
      await window.pantry.sendScreenFrame(request.sessionId, request.seq, bytes)
      return
    }
    fail(request.sessionId)
  } catch { if (live(request.sessionId, run)) fail(request.sessionId) }
  finally { sampling = false }
}
async function display(image: ScreenImage): Promise<void> {
  const run = generation
  if (!live(image.sessionId, run) || !canvas.value || displaying) return
  displaying = true
  const url = URL.createObjectURL(new Blob([image.bytes], { type: 'image/jpeg' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!live(image.sessionId, run) || !canvas.value) return
    if (img.naturalWidth !== image.width || img.naturalHeight !== image.height) throw new Error('画面尺寸不符')
    const target = canvas.value
    if (target.width !== image.width) target.width = image.width
    if (target.height !== image.height) target.height = image.height
    const context = target.getContext('2d', { alpha: false })
    if (!context) throw new Error('画布不可用')
    context.drawImage(img, 0, 0)
    received.value = true
    stale.value = false
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => { if (live(image.sessionId, run)) stale.value = true }, 2000)
    // DOM/画布更新后消费；最小化时不等待可能暂停的 requestAnimationFrame。
    await window.pantry.consumeScreenFrame(image.sessionId, image.seq)
  } catch { if (live(image.sessionId, run)) fail(image.sessionId) }
  finally { URL.revokeObjectURL(url); displaying = false }
}
function changeMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value
  if (state.value && isScreenMode(mode)) void window.pantry.setScreenMode(state.value.sessionId, mode)
}
function keydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
  if (event.target instanceof HTMLSelectElement) return
  event.preventDefault()
  stop()
}
function startPan(event: PointerEvent): void {
  if (fit.value || event.button !== 0 || !viewport.value) return
  pan = { x: event.clientX, y: event.clientY, left: viewport.value.scrollLeft, top: viewport.value.scrollTop }
  viewport.value.setPointerCapture(event.pointerId)
}
function movePan(event: PointerEvent): void {
  if (!pan || !viewport.value) return
  viewport.value.scrollLeft = pan.left + pan.x - event.clientX
  viewport.value.scrollTop = pan.top + pan.y - event.clientY
}

onMounted(async () => {
  subscriptions.push(window.pantry.onScreenState(acceptState), window.pantry.onScreenSample(request => { void sample(request) }),
    window.pantry.onScreenImage(image => { void display(image) }), window.pantry.onSettingsUpdated(settings => {
      document.documentElement.dataset.theme = settings.theme
    }))
  document.addEventListener('keydown', keydown)
  acceptState(await window.pantry.getScreenState())
  if (state.value?.role === 'viewer') await window.pantry.screenReady(state.value.sessionId)
  const [settings, info] = await Promise.all([window.pantry.getSettings(), window.pantry.getAppInfo()])
  if (disposed) return
  document.documentElement.dataset.theme = settings.theme
  applyPerformanceProfile(info)
})
onUnmounted(() => { disposed = true; cleanup(); subscriptions.forEach(stop => stop()); document.removeEventListener('keydown', keydown) })
window.addEventListener('beforeunload', cleanup, { once: true })
</script>

<template>
  <main v-if="state" class="remote" :class="{ sharing: sharer }">
    <header class="toolbar">
      <div class="identity"><strong>{{ tr('屏幕协助') }}</strong><span>{{ state.peerName }} · {{ state.peerIp }}</span></div>
      <button class="stop" @click="stop">{{ sharer ? tr('停止共享') : tr('结束查看') }}</button>
    </header>
    <section v-if="sharer && state.phase === 'awaiting-consent'" class="consent" aria-live="polite">
      <h1>{{ tr('{0} 想查看你的屏幕', { 0: state.peerName }) }}</h1>
      <p>{{ tr('仅查看本次选择的屏幕，你可以随时停止。') }}</p>
      <div v-if="sources.length" class="sources" role="radiogroup" :aria-label="tr('选择屏幕')">
        <label v-for="source in sources" :key="source.id" :class="{ selected: selected === source.id }">
          <input v-model="selected" type="radio" name="source" :value="source.id" />
          <img :src="source.thumbnail" alt="" />
          <span>{{ source.name }}</span>
        </label>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button @click="decline">{{ tr('拒绝') }}</button>
        <button v-if="!sources.length" class="primary" :disabled="selecting" @click="choose">{{ selecting ? tr('正在获取屏幕…') : tr('选择屏幕') }}</button>
        <button v-else class="primary" :disabled="!selected || preparing" @click="share">{{ tr('开始共享') }}</button>
      </div>
    </section>
    <section v-else-if="sharer" class="consent" aria-live="polite">
      <span class="live-dot" aria-hidden="true"></span>
      <h1>{{ state.phase === 'active' ? title : tr('正在准备屏幕连接…') }}</h1>
      <p>{{ sourceName }}</p><p>{{ tr('你可以继续操作电脑，关闭此窗口即停止共享。') }}</p>
    </section>
    <template v-else>
      <div class="controls">
        <label>{{ tr('流畅度') }}
          <select :value="state.mode" @change="changeMode">
            <option value="auto">{{ tr('自动') }}</option>
            <option value="economy">{{ tr('节省资源（3 帧/秒）') }}</option>
            <option value="standard">{{ tr('标准（5 帧/秒）') }}</option>
            <option value="smooth">{{ tr('流畅（10 帧/秒）') }}</option>
          </select>
        </label>
        <span class="target">{{ tr('目标 {0} 帧/秒', { 0: state.targetFps }) }}</span>
        <button :aria-pressed="fit" @click="fit = true">{{ tr('适应窗口') }}</button>
        <button :aria-pressed="!fit" @click="fit = false">100%</button>
      </div>
      <p v-if="stale" class="stale" role="status">{{ tr('画面暂未更新') }}</p>
      <div ref="viewport" class="viewport" :class="{ fit }" tabindex="0" :aria-label="title"
        @pointerdown="startPan" @pointermove="movePan" @pointerup="pan = null" @lostpointercapture="pan = null" @contextmenu.prevent>
        <div class="picture"><canvas ref="canvas" v-show="received" role="img" :aria-label="title"></canvas></div>
        <p v-if="!received" class="waiting" role="status">{{ state.phase === 'requesting' ? tr('等待对方同意…') : tr('正在连接屏幕…') }}</p>
      </div>
      <footer>{{ tr('仅查看画面，可通过聊天指导对方操作') }}</footer>
    </template>
  </main>
</template>

<style scoped>
.remote { height: 100vh; display: flex; flex-direction: column; background: var(--bg-window); color: var(--text-1); font-size: var(--font-md); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.identity { display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
.identity span { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-sm); }
button, select { border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--bg-window); color: var(--text-1); font: inherit; padding: 8px 12px; cursor: pointer; }
button:hover { background: var(--surface-hover); }
button:focus-visible, select:focus-visible, .viewport:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--primary); color: var(--bg-window); }
button.stop { flex-shrink: 0; color: var(--danger); border-color: var(--danger); }
button[aria-pressed='true'] { background: var(--primary-weak); border-color: var(--primary); }
.consent { flex: 1; padding: 24px; overflow: auto; }
h1 { font-size: var(--font-lg); line-height: 1.6; overflow-wrap: anywhere; }
p { color: var(--text-2); line-height: 1.7; }
.actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
.sources { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.sources label { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 2px solid var(--line); border-radius: var(--radius-control); cursor: pointer; }
.sources label.selected { border-color: var(--primary); background: var(--primary-weak); }
.sources input { position: absolute; top: 14px; left: 14px; accent-color: var(--primary); }
.sources img { width: 100%; aspect-ratio: 8 / 5; object-fit: contain; }
.sources span { overflow-wrap: anywhere; font-size: var(--font-sm); }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 20px; }
.controls label { display: flex; align-items: center; gap: 8px; }
.target { color: var(--text-2); font-size: var(--font-sm); flex: 1; }
.stale { margin: 0; padding: 6px 20px; color: var(--danger); background: var(--bg-window); }
.viewport { position: relative; flex: 1; min-height: 0; overflow: auto; background: var(--bg-chat); touch-action: none; }
.picture { display: grid; place-items: center; min-width: 100%; min-height: 100%; width: max-content; }
canvas { display: block; cursor: grab; }
.fit { overflow: hidden; }
.fit .picture { width: 100%; height: 100%; }
.fit canvas { width: 100%; height: 100%; min-height: 0; object-fit: contain; cursor: default; }
.waiting { position: absolute; inset: 35% 0 auto; text-align: center; pointer-events: none; }
footer { padding: 10px 20px; color: var(--text-2); font-size: var(--font-xs); border-top: 1px solid var(--line); }
.live-dot { display: block; width: 10px; height: 10px; background: var(--primary); border-radius: var(--radius-pill); }
</style>
