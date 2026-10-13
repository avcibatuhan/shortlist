import {
  CalendarDays,
  ChevronRight,
  Columns3,
  History,
  Keyboard,
  ListChecks,
  RefreshCw,
  Settings,
  BriefcaseBusiness,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useStats } from '@/api/hooks'
import { Chip } from '@/components/Chip'
import { ModelPicker } from '@/components/frame/ModelPicker'
import { ShortcutOverlay } from '@/components/frame/ShortcutOverlay'
import { SystemStatus } from '@/components/frame/SystemStatus'
import { Kbd } from '@/components/Kbd'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { JOB_VIEWS } from '@/lib/job-views'
import { progressText, useRunStatus } from '@/lib/run-status'
import { SETTINGS_SECTIONS } from '@/lib/settings-sections'
import { useShortcuts } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

type NavItem = { path: string; label: string; icon: LucideIcon; badge?: number; primaryBadge?: boolean }

function crumbs(pathname: string): string[] {
  const [first, second, third] = pathname.split('/').filter(Boolean)
  switch (first) {
    case undefined:
      return ['Today']
    case 'jobs':
      return ['Jobs', JOB_VIEWS.find((view) => view.slug === second)?.label ?? 'Matches']
    case 'letter':
      return ['Jobs', 'Cover letter']
    case 'tracker':
      return ['Tracker']
    case 'history':
      return second ? ['History', `Run #${second}`] : ['History']
    case 'settings':
      return ['Settings', SETTINGS_SECTIONS.find((section) => section.slug === second)?.label ?? 'Profile']
    default:
      return [third ?? first]
  }
}

function Sidebar() {
  const stats = useStats()
  const items: NavItem[] = [
    { path: '/', label: 'Today', icon: CalendarDays },
    { path: '/jobs', label: 'Jobs', icon: BriefcaseBusiness, badge: stats.data?.new_matches, primaryBadge: true },
    { path: '/tracker', label: 'Tracker', icon: Columns3, badge: stats.data?.saved },
    { path: '/history', label: 'History', icon: History },
    { path: '/settings', label: 'Settings', icon: Settings },
  ]
  return (
    <aside className="hidden w-[280px] shrink-0 flex-col justify-between gap-4 border-r bg-sidebar p-4 text-sidebar-foreground md:flex">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 border-b pb-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-surface-high text-primary-soft">
            <ListChecks className="size-[18px]" aria-hidden />
          </div>
          <div>
            <div className="text-base leading-tight font-semibold tracking-tight">Shortlist</div>
            <div className="font-mono text-[10px] text-muted-foreground">local · 127.0.0.1</div>
          </div>
        </div>
        <Link
          to="/"
          className="flex h-10 items-center gap-2.5 rounded-md border bg-muted px-3 font-mono text-xs font-medium transition-colors hover:bg-surface-high"
          aria-keyshortcuts="f"
        >
          <RefreshCw className="size-4 text-primary-soft" aria-hidden />
          Fetch new jobs
          <Kbd className="ml-auto">F</Kbd>
        </Link>
        <nav aria-label="Pages" className="flex flex-col gap-1">
          {items.map(({ path, label, icon: Icon, badge, primaryBadge }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-r-md border-l-2 px-3 py-2 text-sm transition-colors duration-150',
                  isActive
                    ? 'border-primary bg-sidebar-accent font-semibold text-sidebar-accent-foreground [&_svg]:text-primary-soft'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
              {badge !== undefined && badge > 0 ? (
                <Chip tone={primaryBadge ? 'primary' : 'neutral'} className="ml-auto rounded-full px-2">
                  {badge}
                </Chip>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </div>
      <SystemStatus />
    </aside>
  )
}

/** Compact page links for narrow windows, where the sidebar is hidden. */
function NarrowNav() {
  const links = [
    ['/', 'Today'],
    ['/jobs', 'Jobs'],
    ['/tracker', 'Tracker'],
    ['/history', 'History'],
    ['/settings', 'Settings'],
  ] as const
  return (
    <nav aria-label="Pages (compact)" className="flex gap-1 overflow-x-auto border-b px-3 py-1.5 md:hidden">
      {links.map(([path, label]) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          className={({ isActive }) =>
            cn(
              'rounded-md px-2.5 py-1 text-sm whitespace-nowrap',
              isActive ? 'bg-accent font-semibold' : 'text-muted-foreground',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function RunPill() {
  const { run, progress } = useRunStatus()
  if (run?.state !== 'running') return null
  return (
    <Link to="/" className="ml-2" aria-label={`Run #${run.id} is active: ${progressText(run, progress)}`}>
      <Chip tone="match" className="rounded-full px-2.5">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
        Run #{run.id} · {progressText(run, progress)}
      </Chip>
    </Link>
  )
}

function TopBar({ onShortcuts }: { onShortcuts: () => void }) {
  const trail = crumbs(useLocation().pathname)
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {trail.map((crumb, index) => (
          <span key={crumb} className="flex items-center gap-2">
            {index > 0 ? <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden /> : null}
            <span className={index === trail.length - 1 ? 'font-medium' : 'text-muted-foreground'}>{crumb}</span>
          </span>
        ))}
        <RunPill />
      </div>
      <div className="flex items-center gap-2">
        <ModelPicker />
        <Button variant="ghost" size="icon" onClick={onShortcuts} aria-label="Keyboard shortcuts" aria-keyshortcuts="?">
          <Keyboard />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  )
}

export function AppFrame() {
  const navigate = useNavigate()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useShortcuts({
    '?': () => setShortcutsOpen((open) => !open),
    f: () => void navigate('/'),
  })

  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onShortcuts={() => setShortcutsOpen(true)} />
        <NarrowNav />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      <ShortcutOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
