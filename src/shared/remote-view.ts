import type { ScreenEndReason, ScreenRejectReason } from './protocol'

export type ScreenMode = 'auto' | 'economy' | 'standard' | 'smooth'
export type ScreenPhase = 'requesting' | 'awaiting-consent' | 'preparing' | 'connecting' | 'active' | 'ended'
export type ScreenReason = ScreenEndReason | ScreenRejectReason
export interface ScreenState {
  revision: number
  sessionId: string
  peerId: string
  peerName: string
  peerIp: string
  role: 'viewer' | 'sharer'
  phase: ScreenPhase
  mode: ScreenMode
  targetFps: number
  reason?: ScreenReason
}
export interface ScreenAvailability { view: boolean; share: boolean; reason: string }
export interface ScreenSource { id: string; name: string; thumbnail: string }
export interface ScreenImage { sessionId: string; seq: number; width: number; height: number; bytes: ArrayBuffer }
export interface ScreenSample { sessionId: string; seq: number }
export interface ScreenRequestResult { ok: boolean; reason?: 'busy' | 'offline' | 'unsupported' | 'rate-limited' }

export function isScreenMode(value: unknown): value is ScreenMode {
  return value === 'auto' || value === 'economy' || value === 'standard' || value === 'smooth'
}
