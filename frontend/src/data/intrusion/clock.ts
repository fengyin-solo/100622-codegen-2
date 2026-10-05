// 周界模块的时间工具：统一用「YYYY-MM-DD HH:mm:ss」，内部比较换算成毫秒。

export function parseTime(text: string): number {
  if (!text) {
    return Number.NaN
  }
  const normalized = text.trim().replace(/\//g, '-')
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) {
    const t = Date.parse(normalized.replace(' ', 'T'))
    return Number.isNaN(t) ? Number.NaN : t
  }
  const [, y, mo, d, h, mi, s] = m
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  ).getTime()
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatTime(epoch: number): string {
  const d = new Date(epoch)
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

// 夜间无人值守时段：22:00 到次日 06:00。
export function isNightTime(text: string): boolean {
  const d = new Date(parseTime(text))
  const h = d.getHours()
  return h >= 22 || h < 6
}
