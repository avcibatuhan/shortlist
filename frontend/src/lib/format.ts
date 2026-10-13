const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
})
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "$0.02", "$0.045" — run costs are often below a cent, so up to three decimals. */
export function formatUsd(amount: number): string {
  return usd.format(amount)
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** "2026-10" -> "October 2026" */
export function formatMonth(month: string): string {
  return monthYear.format(new Date(`${month}-01T00:00:00Z`))
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Whole days between two moments, by calendar day in local time. */
export function daysBetween(iso: string, now: Date = new Date()): number {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((day(now) - day(new Date(iso))) / 86_400_000)
}

/** "today", "yesterday", "3d ago", then "12 Oct". */
export function formatRelativeDay(iso: string, now: Date = new Date()): string {
  const days = daysBetween(iso, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return shortDate.format(new Date(iso))
}

/** "today 12:34", "yesterday 18:24", "12 Oct 18:24". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const days = daysBetween(iso, now)
  const day = days <= 0 ? 'today' : days === 1 ? 'yesterday' : shortDate.format(new Date(iso))
  return `${day} ${clock.format(new Date(iso))}`
}

/** Share as a whole percent; a small non-zero share is "<1%", never "0%". */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%'
  const percent = Math.round((part / whole) * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}
