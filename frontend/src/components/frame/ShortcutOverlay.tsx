import { Keyboard, Lock } from 'lucide-react'
import { Kbd } from '@/components/Kbd'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Shortcut = { label: string; keys: string[] }

const GROUPS: { title: string; tone: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'Review & decision',
    tone: 'text-primary-soft',
    shortcuts: [
      { label: 'Next / previous job', keys: ['j', 'k'] },
      { label: 'Mark applied', keys: ['a'] },
      { label: 'Save to Tracker', keys: ['s'] },
      { label: 'Ignore job', keys: ['i'] },
      { label: 'Flip verdict', keys: ['n'] },
      { label: 'Undo last action', keys: ['u'] },
    ],
  },
  {
    title: 'Navigation',
    tone: 'text-match',
    shortcuts: [
      { label: 'Switch Jobs view', keys: ['1', '4'] },
      { label: 'Focus search', keys: ['/'] },
      { label: 'Open the ad', keys: ['o'] },
      { label: 'Cover letter', keys: ['c'] },
      { label: 'Go to fetch', keys: ['f'] },
      { label: 'Toggle label mode', keys: ['l'] },
    ],
  },
  {
    title: 'Letter & tracker',
    tone: 'text-warn',
    shortcuts: [
      { label: 'Write letter again', keys: ['w'] },
      { label: 'Move tracker stage', keys: ['←', '→'] },
      { label: 'Label: relevant / not', keys: ['y', 'n'] },
      { label: 'This overview', keys: ['?'] },
      { label: 'Close panel or dialog', keys: ['Esc'] },
    ],
  },
]

export function ShortcutOverlay({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4 text-primary-soft" aria-hidden />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Single keys, no modifiers. Press <Kbd>?</Kbd> anywhere to open or close this overview.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 border-t pt-4 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="label-mono mb-3">
                <span className={group.tone}>{group.title}</span>
              </h3>
              <dl className="space-y-2.5 text-sm">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.label} className="flex items-center justify-between gap-3">
                    <dt>{shortcut.label}</dt>
                    <dd className="flex items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <Kbd key={key} className="h-5 min-w-6 text-[11px]">
                          {key}
                        </Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="flex items-center gap-2 border-t pt-3 font-mono text-[11px] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          Shortcuts are off while you type in search, notes or the letter editor.
        </p>
      </DialogContent>
    </Dialog>
  )
}
