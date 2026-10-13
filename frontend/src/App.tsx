import { Navigate, Route, Routes } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { AppFrame } from '@/components/frame/AppFrame'
import { RunStatusProvider } from '@/components/run/RunStatus'
import { ToastProvider } from '@/components/toast'
import { CoverLetterPage } from '@/pages/CoverLetterPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { JobsPage } from '@/pages/JobsPage'
import { RunDetailPage } from '@/pages/RunDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TodayPage } from '@/pages/TodayPage'
import { TrackerPage } from '@/pages/TrackerPage'

export default function App() {
  return (
    <RunStatusProvider>
      <ToastProvider>
        <Routes>
          <Route element={<AppFrame />}>
            <Route index element={<TodayPage />} />
            <Route path="jobs" element={<Navigate to="/jobs/matches" replace />} />
            <Route path="jobs/:view" element={<JobsPage />} />
            <Route path="letter/:jobId" element={<CoverLetterPage />} />
            <Route path="tracker" element={<TrackerPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:runId" element={<RunDetailPage />} />
            <Route path="settings" element={<Navigate to="/settings/profile" replace />} />
            <Route path="settings/:section" element={<SettingsPage />} />
            {/* Old addresses from before Matches and Inbox were merged into Jobs. */}
            <Route path="matches" element={<Navigate to="/jobs/matches" replace />} />
            <Route path="inbox" element={<Navigate to="/jobs/not-matched" replace />} />
            <Route
              path="*"
              element={
                <div className="p-6">
                  <EmptyState title="Page not found" />
                </div>
              }
            />
          </Route>
        </Routes>
      </ToastProvider>
    </RunStatusProvider>
  )
}
