import { tr } from './i18n'
import type { ScreenState } from '../../../shared/remote-view'

export function screenStatusText(state: ScreenState): string {
  if (state.phase === 'requesting') return tr('屏幕协助：等待对方同意')
  if (state.phase === 'awaiting-consent') return tr('屏幕协助：请在协助窗口选择屏幕或拒绝')
  if (state.phase === 'preparing' || state.phase === 'connecting') return tr('屏幕协助：正在连接')
  if (state.phase === 'active') return tr('屏幕协助进行中')
  switch (state.reason) {
    case 'declined': return tr('对方已拒绝查看请求')
    case 'busy': return tr('对方正在进行另一场屏幕协助')
    case 'unsupported': return tr('当前系统暂不能进行屏幕协助')
    case 'permission-denied': return tr('系统未授予屏幕录制权限，请在系统设置中允许后重新请求')
    case 'capture-failed':
    case 'capture-ended': return tr('屏幕采集已停止或不可用，请重新请求')
    case 'timeout': return tr('屏幕协助超时，连接已结束')
    case 'disconnected': return tr('屏幕连接已断开，请重新请求')
    case 'locked': return tr('因锁屏或锁屏检测失效，屏幕协助已结束')
    case 'suspended': return tr('因电脑休眠，屏幕协助已结束')
    case 'protocol-error': return tr('屏幕画面校验失败，连接已结束')
    default: return tr('屏幕协助已结束')
  }
}
