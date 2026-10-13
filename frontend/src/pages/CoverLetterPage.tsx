import { Check, Copy, Download, FileText, Loader2, RefreshCw, Save, TriangleAlert, X, Zap } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { CoverLetter, Job } from '@/api/client'
import {
  fetchCoverLetterPdf,
  useCoverLetter,
  useJob,
  useSaveCoverLetter,
  useWriteCoverLetter,
} from '@/api/hooks'
import { Chip, SourceLink } from '@/components/Chip'
import { JobBody } from '@/components/jobs/JobDetail'
import { Kbd } from '@/components/Kbd'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatRelativeDay } from '@/lib/format'
import { useShortcuts } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

const LANGUAGE = { de: 'German', en: 'English' }
const ONE_PAGE_WORDS = 350
// What the model leaves for the owner to fill in: [Ihr Name], [Your name], …
const PLACEHOLDER = /\[[^\][\n]{1,40}\]/g

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function saveFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

type Confirm = 'copy' | 'close' | null

function Editor({ job, letter, onClose }: { job: Job; letter: CoverLetter; onClose: () => void }) {
  const write = useWriteCoverLetter(job.id)
  const save = useSaveCoverLetter(job.id)
  // The draft belongs to one version of the letter; a rewritten letter starts fresh.
  const [draft, setDraft] = useState({ of: letter.updated_at, text: letter.text })
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)

  const text = draft.of === letter.updated_at ? draft.text : letter.text
  const words = countWords(text)
  const placeholders = text.match(PLACEHOLDER) ?? []
  const changed = text.trim() !== letter.text
  const tooLong = words > ONE_PAGE_WORDS

  // The PDF is made from the saved letter, so unsaved edits are saved first.
  const pdf = useMutation({
    mutationFn: async () => {
      if (changed && text.trim() !== '') await save.mutateAsync(text)
      const file = await fetchCoverLetterPdf(job.id)
      saveFile(file.filename, file.blob)
    },
  })

  const error = write.error ?? save.error ?? pdf.error
  const copy = () => void navigator.clipboard.writeText(text).then(() => setCopied(true))
  const requestCopy = () => (placeholders.length > 0 ? setConfirm('copy') : copy())
  const requestClose = () => (changed ? setConfirm('close') : onClose())
  const saveNow = () => {
    if (changed && text.trim() !== '') save.mutate(text)
  }

  useShortcuts({
    w: () => !write.isPending && write.mutate(),
    s: saveNow,
    Escape: requestClose,
  })

  return (
    <section aria-label="Cover letter" className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
        <h2 className="label-mono flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary-soft" aria-hidden />
          Cover letter · {LANGUAGE[letter.language]} · {letter.edited ? 'edited by you' : 'draft'}
        </h2>
        <Button variant="ghost" size="sm" onClick={requestClose} aria-keyshortcuts="Escape">
          <X aria-hidden /> Close <Kbd>Esc</Kbd>
        </Button>
      </header>

      <p className="flex shrink-0 items-start gap-3 border-b bg-warn/10 px-6 py-3 text-sm text-warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Draft</strong> — check every statement against the posting and
          your profile. The model can claim experience you do not have.
        </span>
        {placeholders.length > 0 ? (
          <span className="ml-auto shrink-0 font-mono text-xs" title={placeholders.join(' ')}>
            ● {placeholders.length} placeholder{placeholders.length === 1 ? '' : 's'} left: {placeholders[0]}
            {' · '}
            <Link to="/settings/profile" className="underline underline-offset-4">
              add your name in Settings
            </Link>
          </span>
        ) : null}
      </p>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 font-mono text-xs"
          aria-label="Length"
        >
          <span className={cn('font-medium', tooLong && 'text-warn')}>{words} words</span>
          <div
            role="meter"
            aria-label="Share of one page"
            aria-valuemin={0}
            aria-valuemax={ONE_PAGE_WORDS}
            aria-valuenow={words}
            className="h-1.5 min-w-40 flex-1 overflow-hidden rounded-full bg-surface-highest"
          >
            <div
              className={cn('h-full rounded-full', tooLong ? 'bg-warn' : 'bg-match')}
              style={{ width: `${Math.min(100, (words / ONE_PAGE_WORDS) * 100)}%` }}
            />
          </div>
          <span className={tooLong ? 'text-warn' : 'text-match'}>
            {tooLong
              ? `longer than one page (about ${ONE_PAGE_WORDS} words)`
              : `${Math.round((words / ONE_PAGE_WORDS) * 100)}% of one page (${ONE_PAGE_WORDS} words)`}
          </span>
        </div>

        <textarea
          aria-label="Cover letter text"
          className="block min-h-[55vh] w-full resize-y rounded-lg border bg-card px-10 py-8 text-[15px] leading-7 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          value={text}
          disabled={write.isPending}
          onChange={(event) => {
            setDraft({ of: letter.updated_at, text: event.target.value })
            setCopied(false)
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-3">
        <p className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <Zap className="size-3.5 text-primary-soft" aria-hidden />
          Written by {letter.model} in {(letter.latency_ms / 1000).toFixed(0)} s
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={write.isPending} onClick={() => write.mutate()} aria-keyshortcuts="w">
            {write.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {write.isPending ? 'Writing…' : 'Write again'} <Kbd>W</Kbd>
          </Button>
          <Button variant="outline" disabled={pdf.isPending || write.isPending} onClick={() => pdf.mutate()}>
            {pdf.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Download PDF
          </Button>
          <Button variant="outline" disabled={!changed || text.trim() === '' || save.isPending} onClick={saveNow} aria-keyshortcuts="s">
            <Save aria-hidden /> Save changes <Kbd>S</Kbd>
          </Button>
          <Button onClick={requestCopy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </footer>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'copy' ? 'The letter still contains a placeholder' : 'Close without saving?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'copy'
                ? `${placeholders.join(', ')} has not been replaced yet. Copy the text anyway?`
                : 'Your changes to the letter have not been saved.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirm === 'copy' ? 'Cancel' : 'Keep editing'}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm === 'copy' ? copy : onClose}>
              {confirm === 'copy' ? 'Copy anyway' : 'Discard changes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function WritePane({ job, onClose }: { job: Job; onClose: () => void }) {
  const write = useWriteCoverLetter(job.id)
  useShortcuts({ Escape: onClose, w: () => !write.isPending && write.mutate() })
  return (
    <section aria-label="Cover letter" className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <h2 className="label-mono">Cover letter · not written yet</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X aria-hidden /> Close <Kbd>Esc</Kbd>
        </Button>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center">
          <FileText className="mx-auto size-8 text-primary-soft" aria-hidden />
          <p className="text-sm text-muted-foreground">
            The local LLM writes a draft of at most one page in{' '}
            <strong className="font-medium text-foreground">{job.language === 'de' ? 'German' : 'English'}</strong>,
            the language of this job posting, from your profile in Settings. This can take a minute; the
            posting stays readable on the left.
          </p>
          {write.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {write.error.message}
            </p>
          ) : null}
          <Button size="lg" className="px-4" disabled={write.isPending} onClick={() => write.mutate()}>
            {write.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
            {write.isPending ? 'Writing…' : 'Write cover letter'}
          </Button>
        </div>
      </div>
    </section>
  )
}

/** The posting on the left, the letter on the right, so every claim can be checked. */
export function CoverLetterPage() {
  const jobId = Number(useParams().jobId)
  const navigate = useNavigate()
  const job = useJob(jobId)
  const letter = useCoverLetter(jobId, true)
  const close = () => void navigate(-1)

  if (job.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {job.error.message}
      </p>
    )
  }
  if (!job.data) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>

  const meta = [job.data.company, job.data.location, job.data.posted_at ? `posted ${formatRelativeDay(job.data.posted_at)}` : null]
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <section aria-label="Posting" className="flex min-h-0 flex-col border-b lg:w-[46%] lg:border-r lg:border-b-0">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
          <h2 className="label-mono flex items-center gap-2">
            <FileText className="size-4" aria-hidden /> Posting (read-only)
          </h2>
          <div className="flex gap-2">
            {job.data.sources.map((source) => (
              <SourceLink key={`${source.source}:${source.url}`} source={source} className="h-7 px-2" />
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-2">
            <p className="font-mono text-[11px] text-muted-foreground">{meta.filter(Boolean).join(' • ')}</p>
            <h1 className="text-2xl leading-8 font-semibold tracking-tight">{job.data.title}</h1>
            {job.data.description_is_snippet ? <Chip tone="warn">Snippet only — the letter is based on little text</Chip> : null}
          </div>
          <JobBody job={job.data} />
        </div>
      </section>
      {letter.isError ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          {letter.error.message}
        </p>
      ) : letter.isPending ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : letter.data ? (
        <Editor job={job.data} letter={letter.data} onClose={close} />
      ) : (
        <WritePane job={job.data} onClose={close} />
      )}
    </div>
  )
}
