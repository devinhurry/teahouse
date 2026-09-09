import { SYSTEM_MESSAGE_TEMPLATES, type SystemMessage, type SystemMessageKey,
  type SystemPerson, type TranslationParams } from '../shared/i18n'
import type { FileRefView, MessagePreview, PkRefView } from '../shared/ipc'
import { pkLabel } from '../shared/pk'
import { formatTemplate, tr } from './index'

type Translate = (source: string, params?: TranslationParams) => string

function personText(person: SystemPerson, translate: Translate): string {
  return person.role === 'self' ? translate('你') : person.role === 'unknown' ? translate('有人') : person.name
}

export function systemMessageText(message: SystemMessage, translate: Translate = tr): string {
  const params: TranslationParams = {}
  for (const [key, value] of Object.entries(message.params)) {
    if (typeof value === 'string' || typeof value === 'number') params[key] = value
    else if ('people' in value) {
      const names = value.people.map((person) => personText(person, translate)).join(translate('、'))
      params[key] = value.total > value.people.length
        ? translate('{0}等{1}人', { 0: names, 1: value.total }) : names
    } else params[key] = personText(value, translate)
  }
  return translate(SYSTEM_MESSAGE_TEMPLATES[message.key], params)
}

/** 保留可读中文回退文本，新增元数据不需要迁移旧聊天记录。 */
export function systemMessage(key: SystemMessageKey, params: SystemMessage['params'] = {}, file?: FileRefView): {
  content: string
  fileRef: string
} {
  const system: SystemMessage = { v: 1, key, params }
  return { content: systemMessageText(system, formatTemplate), fileRef: JSON.stringify({ ...file, system }) }
}

function isPerson(value: unknown): value is SystemPerson {
  if (!value || typeof value !== 'object') return false
  const p = value as SystemPerson
  return typeof p.name === 'string' && p.name.length <= 4096 &&
    (p.role === undefined || p.role === 'self' || p.role === 'unknown')
}

/** 备份导入/旧版本未知元数据回退原文，不能把任意 JSON 当作模板执行。 */
export function parseSystemMessage(raw: string | null | undefined): SystemMessage | undefined {
  if (!raw || raw.length > 32768) return undefined
  try {
    const value = (JSON.parse(raw) as { system?: SystemMessage }).system
    if (!value || value.v !== 1 || !Object.prototype.hasOwnProperty.call(SYSTEM_MESSAGE_TEMPLATES, value.key) ||
      !value.params || typeof value.params !== 'object' || Array.isArray(value.params)) return undefined
    const names = [...SYSTEM_MESSAGE_TEMPLATES[value.key].matchAll(/\{(\w+)\}/g)].map((match) => match[1])
    if (Object.keys(value.params).length !== new Set(names).size || names.some((key) =>
      !Object.prototype.hasOwnProperty.call(value.params, key))) return undefined
    for (const param of Object.values(value.params)) {
      if (typeof param === 'string' && param.length <= 4096) continue
      if (typeof param === 'number' && Number.isFinite(param)) continue
      if (isPerson(param)) continue
      if (param && typeof param === 'object' && 'people' in param && Array.isArray(param.people) &&
        param.people.length <= 5 && param.people.every(isPerson) && Number.isInteger(param.total) &&
        param.total >= param.people.length && param.total <= 200) continue
      return undefined
    }
    return value
  } catch {
    return undefined
  }
}

export function pkResultText(ref: PkRefView, translate: Translate = tr): string {
  if (ref.game === 'dice') return translate('掷出 {0} 点', { 0: ref.result })
  const labels = { rock: '石头', paper: '布', scissors: '剪刀' }
  return translate('出了{0}', { 0: translate(labels[ref.result as keyof typeof labels]) })
}

export function messageText(message: MessagePreview, translate: Translate = tr): string {
  if (message.kind === 'system') return message.systemRef ? systemMessageText(message.systemRef, translate) : message.text
  if (message.kind === 'image') return translate('[图片]')
  if (message.kind === 'sticker') return translate('[表情]')
  if (message.kind === 'pk' && message.pkRef) return `[PK] ${translate(pkLabel(message.pkRef.game))}`
  if (message.kind === 'file' && message.fileRef) {
    return translate(message.fileRef.dir ? '[文件夹] {0}' : '[文件] {0}', { 0: message.fileRef.name })
  }
  return message.text
}
