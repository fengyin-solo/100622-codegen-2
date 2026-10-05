import { CAMERAS, LEGACY_NOTES, SEED_ALARMS } from './seed'
import { INTRUSION_STATUSES, type IntrusionAlarm, type ReportReceipt } from './types'

// 周界模块独立持久化：与既有业务表分开，避免污染通用 EntryRow 数据。
const STORE_KEY = 'hydropower-plant-om:perimeter'

type PerimeterDB = {
  seq: number
  reportSeq: number
  alarms: IntrusionAlarm[]
  reports: ReportReceipt[]
  version: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fallbackDB(): PerimeterDB {
  return {
    seq: SEED_ALARMS.reduce((max, item) => Math.max(max, item.id), 0),
    reportSeq: 0,
    alarms: clone(SEED_ALARMS),
    reports: [],
    version: 1,
  }
}

// 处置链只允许按顺序走到某一档。记录若被外部改成「跳级/回退」的非法状态，
// 这里按它已留下的流转轨迹，恢复到最后一个合法档，并补一条系统纠正轨迹。
function repairChain(alarm: IntrusionAlarm): IntrusionAlarm {
  const reached: string[] = []
  for (const ev of alarm.flow) {
    const idx = INTRUSION_STATUSES.indexOf(ev.to as (typeof INTRUSION_STATUSES)[number])
    if (idx >= 0 && (idx === 0 || reached.includes(INTRUSION_STATUSES[idx - 1]))) {
      if (!reached.includes(ev.to)) {
        reached.push(ev.to)
      }
    }
  }
  const legal = reached.length ? reached[reached.length - 1] : '待确认'
  const statusIdx = INTRUSION_STATUSES.indexOf(alarm.status as (typeof INTRUSION_STATUSES)[number])
  const legalIdx = INTRUSION_STATUSES.indexOf(legal as (typeof INTRUSION_STATUSES)[number])
  const repaired = { ...alarm }
  if (statusIdx !== legalIdx) {
    repaired.flow = [
      ...alarm.flow,
      {
        time: alarm.flow.length ? alarm.flow[alarm.flow.length - 1].time : alarm.registeredTime,
        from: alarm.status,
        to: legal,
        action: '系统纠正',
        actor: { name: '系统', post: '值班员' as const, crew: alarm.owningCrew },
        note: `检测到中途状态被改为「${alarm.status}」，不符合只进不退的处置链，已按顺序恢复到「${legal}」`,
      },
    ]
    repaired.status = legal as IntrusionAlarm['status']
  }
  repaired.archived = repaired.status === '已复核'
  repaired.pending = repaired.status !== '已复核'
  return repaired
}

let cache: PerimeterDB | null = null

function readDB(): PerimeterDB {
  const base = fallbackDB()
  if (typeof window === 'undefined' || !window.localStorage) {
    return base
  }
  const raw = window.localStorage.getItem(STORE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(base))
    return base
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PerimeterDB>
    const db: PerimeterDB = {
      seq: Number(parsed.seq ?? base.seq),
      reportSeq: Number(parsed.reportSeq ?? 0),
      alarms: Array.isArray(parsed.alarms) ? (parsed.alarms as IntrusionAlarm[]) : clone(base.alarms),
      reports: Array.isArray(parsed.reports) ? (parsed.reports as ReportReceipt[]) : [],
      version: 1,
    }
    db.alarms = db.alarms.map(repairChain)
    return db
  } catch {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(base))
    return base
  }
}

export function db(): PerimeterDB {
  if (cache === null) {
    cache = readDB()
  }
  return cache
}

export function persist(next: PerimeterDB): void {
  next.alarms = next.alarms.map(repairChain)
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next))
  }
}

export function resetPerimeter(): PerimeterDB {
  const fresh = fallbackDB()
  persist(fresh)
  return fresh
}

export function cameras() {
  return CAMERAS
}

export function legacyNotes() {
  return LEGACY_NOTES
}

export function storageKeyPerimeter(): string {
  return STORE_KEY
}
