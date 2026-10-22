import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { adminPermissionCatalog, type AdminPermission } from '../shared/adminPermissions.js'
import {
  AlertCircle,
  Activity,
  BadgeCheck,
  BarChart3,
  Ban,
  CheckCircle2,
  ClipboardList,
  Flag,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Megaphone,
  Inbox,
  Image,
  Pencil,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCog,
  UserRoundX,
  UsersRound,
} from 'lucide-react'

type Section = 'overview' | 'analytics' | 'users' | 'reports' | 'support' | 'content' | 'health' | 'audit' | 'settings' | 'announcements' | 'admins'
type Permission = AdminPermission
const permissionOptions = adminPermissionCatalog.filter((permission) => permission.id !== 'admins.manage')

const predefinedRanks = ['Administrator kapral', 'Administrator', 'Asystent']

type AdminAccount = {
  id: string
  name: string
  email: string
  rank: string
  permissions: Permission[]
  isSuperAdmin: boolean
  createdAt: number
}

type AdminSession = AdminAccount

type Overview = {
  totalUsers: number
  verifiedUsers: number
  blockedUsers: number
  newUsersToday: number
  activeAnnouncements: number
}

type Analytics = Overview & {
  unverifiedUsers: number
  activeUsers: number
  registrationCount30Days: number
  registrationsByDay: Array<{ date: string; registrations: number }>
  reportsPending: number
  reportsResolved: number
  openSupportTickets: number
}

type Health = {
  status: 'ok' | 'degraded'
  checkedAt: number
  uptimeSeconds: number
  nodeVersion: string
  database: 'connected' | 'local-file' | 'unavailable'
  emailConfigured: boolean
  smsConfigured: boolean
  sessionSecretConfigured: boolean
}

type SupportTicket = {
  id: string
  subject: string
  category: 'account' | 'technical' | 'security' | 'idea' | 'other'
  status: 'open' | 'in_progress' | 'resolved'
  messages: Array<{ id: string; authorType: 'user' | 'admin'; authorName: string; message: string; createdAt: number }>
  user: { id: string; name: string; nickname: string }
  createdAt: number
  updatedAt: number
}

type AuditEntry = {
  id: string
  adminId: string
  adminName: string
  rank: string
  method: string
  path: string
  statusCode: number
  createdAt: number
}

type ModeratedContent = {
  reportId: string
  targetType: ModerationReport['targetType']
  targetId: string
  targetUserId: string
  removedAt: number
  contentPreview: string
  contentUrl: string
  authorName: string
}

type AdminUser = {
  id: string
  name: string
  nickname: string
  avatar: string
  gender: 'female' | 'male' | 'other' | 'undisclosed' | null
  birthDate: string | null
  location: string | null
  phone: string | null
  contactPhone: string | null
  secondContactPhone: string | null
  email: string
  emailVerified: boolean
  profileVerified: boolean
  createdAt: number | null
  deletedAt: number | null
  blockedAt: number | null
  blockedUntil: number | null
  blockedReason: string
  reportCount: number
  ipBlockedUntil: number | null
  canBlockIp: boolean
  isAdmin: boolean
}

type AdminGalleryPhoto = {
  id: string
  url: string
  caption: string
  createdAt: number
  sourcePostId?: string
  mediaId?: string
}

type AdminGalleryAlbum = {
  id: string
  name: string
  createdAt: number
  photos: AdminGalleryPhoto[]
}

type AdminGalleryReview = {
  user: AdminUser
  photos: AdminGalleryPhoto[]
  albums: AdminGalleryAlbum[]
}

type ProfileReport = {
  id: string
  reason: string
  createdAt: number
}

type ReportReasonCategory = 'terms_violation' | 'harassment' | 'hate' | 'violence' | 'spam' | 'privacy' | 'impersonation' | 'sexual_content' | 'other'

type ModerationReport = {
  id: string
  targetType: 'profile' | 'post' | 'photo' | 'video' | 'comment' | 'message'
  targetId: string
  contentPreview: string
  contentUrl: string
  reasonCategory: ReportReasonCategory
  reasonCategoryLabel: string
  reason: string
  createdAt: number
  status: 'pending' | 'resolved'
  decision: 'dismiss' | 'remove_content' | 'warn' | 'block_account' | null
  decisionNote: string
  decidedAt: number | null
  decidedBy?: string | null
  reporter: { id: string; name: string }
  target: { id: string; name: string; nickname: string }
}

const reportTypeLabels: Record<ModerationReport['targetType'], string> = {
  profile: 'Profil',
  post: 'Post',
  photo: 'Zdjęcie',
  video: 'Wideo',
  comment: 'Komentarz',
  message: 'Wiadomość',
}

const reportCategoryLabels: Record<ReportReasonCategory, string> = {
  terms_violation: 'Naruszenie regulaminu',
  harassment: 'Nękanie',
  hate: 'Mowa nienawiści',
  violence: 'Przemoc / groźby',
  spam: 'Spam / oszustwo',
  privacy: 'Naruszenie prywatności',
  impersonation: 'Podszywanie się',
  sexual_content: 'Treści seksualne',
  other: 'Inne',
}

const reportDecisionLabels: Record<NonNullable<ModerationReport['decision']>, string> = {
  dismiss: 'Odrzuć zgłoszenie',
  remove_content: 'Usuń zgłoszoną treść',
  warn: 'Przekaż ostrzeżenie',
  block_account: 'Zablokuj konto autora',
}

type UserFilterKey =
  | 'user'
  | 'registration'
  | 'email'
  | 'emailVerified'
  | 'location'
  | 'birthDate'
  | 'gender'
  | 'phones'
  | 'status'
  | 'profileVerified'
  | 'reports'

const userFilterLabels: Record<UserFilterKey, string> = {
  user: 'Użytkownik',
  registration: 'Rejestracja / usunięcie',
  email: 'E-mail',
  emailVerified: 'E-mail potwierdzony',
  location: 'Miejscowość',
  birthDate: 'Data urodzenia',
  gender: 'Płeć',
  phones: 'Numery telefonu',
  status: 'Status',
  profileVerified: 'Weryfikacja profilu',
  reports: 'Zgłoszenia profilu',
}

function formatBirthDate(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—'
}

function genderLabel(gender: AdminUser['gender']) {
  if (gender === 'female') return 'Kobieta'
  if (gender === 'male') return 'Mężczyzna'
  if (gender === 'other') return 'Inna'
  if (gender === 'undisclosed') return 'Wolę nie podawać'
  return '—'
}

function matchesUserFilter(user: AdminUser, key: UserFilterKey, value: string) {
  const query = value.toLocaleLowerCase('pl')
  const searchableValues: Partial<Record<UserFilterKey, string>> = {
    user: `${user.name} ${user.nickname}`,
    registration: user.deletedAt ? `konto usunięte ${formatDate(user.deletedAt)}` : formatDate(user.createdAt),
    email: user.email,
    location: user.location ?? '',
    birthDate: formatBirthDate(user.birthDate),
    phones: `${user.phone ?? ''} ${user.contactPhone ?? ''} ${user.secondContactPhone ?? ''}`,
  }

  if (key in searchableValues) return (searchableValues[key] ?? '').toLocaleLowerCase('pl').includes(query)
  if (key === 'emailVerified') return value === 'confirmed' ? !user.deletedAt && user.emailVerified : !user.deletedAt && !user.emailVerified
  if (key === 'gender') return user.gender === value
  if (key === 'status') {
    if (value === 'deleted') return Boolean(user.deletedAt)
    if (value === 'blocked') return !user.deletedAt && Boolean(user.blockedAt)
    return !user.deletedAt && !user.blockedAt
  }
  if (key === 'profileVerified') return value === 'verified' ? !user.deletedAt && user.profileVerified : !user.deletedAt && !user.profileVerified
  if (key === 'reports') return value === 'reported' ? !user.deletedAt && user.reportCount > 0 : !user.deletedAt && user.reportCount === 0
  return true
}

type Announcement = {
  id: string
  title: string
  message: string
  createdAt: number
  createdBy: string
  active: boolean
  startsAt: number | null
  endsAt: number | null
  status: 'scheduled' | 'active' | 'ended' | 'disabled'
}

function toLocalDateTimeValue(timestamp: number) {
  const date = new Date(timestamp)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  let payload: { error?: string } & T
  try {
    payload = await response.json() as { error?: string } & T
  } catch {
    throw new Error('Serwer zwrócił nieprawidłową odpowiedź.')
  }
  if (!response.ok) throw new Error(payload.error || 'Nie udało się wykonać operacji.')
  return payload
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function AdminApp() {
  const [section, setSection] = useState<Section>('overview')
  const [authenticated, setAuthenticated] = useState(false)
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([])
  const [supportReply, setSupportReply] = useState('')
  const [activeSupportTicketId, setActiveSupportTicketId] = useState('')
  const [moderatedContent, setModeratedContent] = useState<ModeratedContent[]>([])
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [reports, setReports] = useState<ModerationReport[]>([])
  const [reportStatusFilter, setReportStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending')
  const [reportTypeFilter, setReportTypeFilter] = useState<ModerationReport['targetType'] | 'all'>('all')
  const [reportCategoryFilter, setReportCategoryFilter] = useState<ReportReasonCategory | 'all'>('all')
  const [reportSearch, setReportSearch] = useState('')
  const [reportFromDate, setReportFromDate] = useState('')
  const [reportToDate, setReportToDate] = useState('')
  const [selectedReport, setSelectedReport] = useState<ModerationReport | null>(null)
  const [reportDecision, setReportDecision] = useState<NonNullable<ModerationReport['decision']>>('dismiss')
  const [reportDecisionNote, setReportDecisionNote] = useState('')
  const [notifyReporter, setNotifyReporter] = useState(true)
  const [notifyTarget, setNotifyTarget] = useState(true)
  const [reportBlockDuration, setReportBlockDuration] = useState(7)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [rankPermissionTemplates, setRankPermissionTemplates] = useState<Partial<Record<string, Permission[]>>>({})
  const [search, setSearch] = useState('')
  const [userFilters, setUserFilters] = useState<Partial<Record<UserFilterKey, string>>>({})
  const [activeUserFilter, setActiveUserFilter] = useState<UserFilterKey | null>(null)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [publishImmediately, setPublishImmediately] = useState(true)
  const [scheduledStart, setScheduledStart] = useState(() => toLocalDateTimeValue(Date.now() + 60 * 60 * 1000))
  const [hasEndTime, setHasEndTime] = useState(false)
  const [scheduledEnd, setScheduledEnd] = useState('')
  const [editingAdminId, setEditingAdminId] = useState('')
  const [blockingUser, setBlockingUser] = useState<AdminUser | null>(null)
  const [blockDurationDays, setBlockDurationDays] = useState(7)
  const [blockIp, setBlockIp] = useState(false)
  const [reportReview, setReportReview] = useState<{ user: AdminUser; reports: ProfileReport[] } | null>(null)
  const [galleryReview, setGalleryReview] = useState<AdminGalleryReview | null>(null)
  const [reviewingReports, setReviewingReports] = useState(false)
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminRank, setAdminRank] = useState('Administrator')
  const [customRank, setCustomRank] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPermissions, setAdminPermissions] = useState<Permission[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function can(permission: Permission, admin = currentAdmin) {
    return Boolean(admin?.isSuperAdmin || admin?.permissions.includes(permission))
  }

  function firstAvailableSection(admin: AdminSession): Section {
    if (admin.isSuperAdmin || admin.permissions.includes('overview.view')) return 'overview'
    if (admin.permissions.includes('analytics.view')) return 'analytics'
    if (admin.permissions.includes('users.view')) return 'users'
    if (admin.permissions.includes('reports.view')) return 'reports'
    if (admin.permissions.includes('support.view')) return 'support'
    if (admin.permissions.includes('content.view')) return 'content'
    if (admin.permissions.includes('health.view')) return 'health'
    if (admin.permissions.includes('audit.view')) return 'audit'
    if (admin.permissions.includes('settings.view')) return 'settings'
    if (admin.permissions.includes('announcements.view') || admin.permissions.includes('announcements.manage')) return 'announcements'
    if (admin.permissions.includes('admins.view')) return 'admins'
    return 'overview'
  }

  async function loadPanel(admin = currentAdmin) {
    const requests: Promise<void>[] = []
    if (can('overview.view', admin)) {
      requests.push(apiRequest<Overview>('/api/admin/overview').then(setOverview))
    }
    if (can('analytics.view', admin)) {
      requests.push(apiRequest<Analytics>('/api/admin/analytics').then(setAnalytics))
    }
    if (can('health.view', admin)) {
      requests.push(apiRequest<Health>('/api/admin/health').then(setHealth))
    }
    if (can('audit.view', admin)) {
      requests.push(apiRequest<{ entries: AuditEntry[] }>('/api/admin/audit').then((result) => setAuditEntries(result.entries)))
    }
    if (can('support.view', admin)) {
      requests.push(apiRequest<{ tickets: SupportTicket[] }>('/api/admin/support/tickets').then((result) => setSupportTickets(result.tickets)))
    }
    if (can('content.view', admin)) {
      requests.push(apiRequest<{ items: ModeratedContent[] }>('/api/admin/content/moderated').then((result) => setModeratedContent(result.items)))
    }
    if (can('settings.view', admin)) {
      requests.push(apiRequest<{ settings: { registrationEnabled: boolean } }>('/api/admin/settings').then((result) => setRegistrationEnabled(result.settings.registrationEnabled)))
    }
    if (can('users.view', admin)) {
      requests.push(apiRequest<{ users: AdminUser[] }>('/api/admin/users').then((result) => setUsers(result.users)))
    }
    if (can('reports.view', admin)) {
      requests.push(apiRequest<{ reports: ModerationReport[] }>('/api/admin/reports').then((result) => setReports(result.reports)))
    }
    if (can('announcements.view', admin)) {
      requests.push(apiRequest<{ announcements: Announcement[] }>('/api/admin/announcements').then((result) => setAnnouncements(result.announcements)))
    }
    if (can('admins.view', admin)) {
      requests.push(apiRequest<{ admins: AdminAccount[]; rankPermissionTemplates: Partial<Record<string, Permission[]>> }>('/api/admin/admins').then((result) => {
        setAdmins(result.admins)
        setRankPermissionTemplates(result.rankPermissionTemplates)
      }))
    }
    await Promise.all(requests)
  }

  useEffect(() => {
    let active = true
    apiRequest<{ admin: AdminSession }>('/api/admin/auth/me')
      .then(async ({ admin }) => {
        if (!active) return
        setCurrentAdmin(admin)
        setSection(firstAvailableSection(admin))
        await loadPanel(admin)
        if (active) setAuthenticated(true)
      })
      .catch((loadError: unknown) => {
        if (active && loadError instanceof Error && !loadError.message.includes('Zaloguj się')) setError(loadError.message)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (editingAdminId || adminPermissions.length > 0) return
    const savedPermissions = rankPermissionTemplates[customRank || adminRank]
    if (savedPermissions?.length) setAdminPermissions(savedPermissions)
  }, [adminRank, customRank, editingAdminId, rankPermissionTemplates])

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl')
    const activeFilters = (Object.keys(userFilters) as UserFilterKey[]).filter((key) => Boolean(userFilters[key]))
    return users.filter((user) => {
      const searchableText = `${user.name} ${user.nickname} ${user.email} ${user.location ?? ''} ${user.birthDate ?? ''} ${user.phone ?? ''} ${user.contactPhone ?? ''} ${user.secondContactPhone ?? ''}`.toLocaleLowerCase('pl')
      if (query && !searchableText.includes(query)) return false
      return activeFilters.every((key) => matchesUserFilter(user, key, userFilters[key] ?? ''))
    })
  }, [search, userFilters, users])

  const visibleReports = useMemo(() => {
    const query = reportSearch.trim().toLocaleLowerCase('pl')
    const fromTime = reportFromDate ? new Date(`${reportFromDate}T00:00:00`).getTime() : 0
    const toTime = reportToDate ? new Date(`${reportToDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    return reports.filter((report) => {
      const searchable = `${report.reason} ${report.contentPreview} ${report.reporter.name} ${report.target.name} ${report.target.nickname} ${report.targetId}`.toLocaleLowerCase('pl')
      return (reportStatusFilter === 'all' || report.status === reportStatusFilter)
        && (reportTypeFilter === 'all' || report.targetType === reportTypeFilter)
        && (reportCategoryFilter === 'all' || (report.reasonCategory || 'other') === reportCategoryFilter)
        && (!query || searchable.includes(query))
        && report.createdAt >= fromTime
        && report.createdAt <= toTime
    })
  }, [reportCategoryFilter, reportFromDate, reportSearch, reportStatusFilter, reportToDate, reportTypeFilter, reports])

  function updateUserFilter(key: UserFilterKey, value: string) {
    setUserFilters((filters) => {
      const updated = { ...filters }
      if (value) updated[key] = value
      else delete updated[key]
      return updated
    })
  }

  function renderUserFilterHeader(key: UserFilterKey) {
    const needsPersonalDataPermission = ['location', 'birthDate', 'gender', 'phones'].includes(key)
    const disabled = needsPersonalDataPermission && !can('users.personal_data.view')
    return <th key={key}>
      <button
        className={`table-filter-trigger ${userFilters[key] ? 'filter-active' : ''}`}
        type="button"
        disabled={disabled}
        aria-expanded={activeUserFilter === key}
        title={disabled ? 'Brak uprawnienia do wyświetlania danych osobowych' : `Kliknij, aby filtrować: ${userFilterLabels[key]}`}
        onClick={() => setActiveUserFilter((active) => active === key ? null : key)}
      >
        {userFilterLabels[key]}<Filter size={12} aria-hidden="true" />
      </button>
    </th>
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const { admin: signedInAdmin } = await apiRequest<{ admin: AdminSession }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setCurrentAdmin(signedInAdmin)
      setSection(firstAvailableSection(signedInAdmin))
      await loadPanel(signedInAdmin)
      setAuthenticated(true)
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Nie udało się zalogować.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    setSubmitting(true)
    setError('')
    try {
      await apiRequest('/api/admin/auth/logout', { method: 'POST' })
      setAuthenticated(false)
      setCurrentAdmin(null)
      setOverview(null)
      setUsers([])
      setAnnouncements([])
      setAdmins([])
      setPassword('')
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Nie udało się wylogować.')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleBlock(user: AdminUser, blocked: boolean, durationDays = 7, blockIpAddress = false) {
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/block`, {
        method: 'PATCH',
        body: JSON.stringify({
          blocked,
          reason: 'Decyzja administratora',
          durationDays,
          blockIp: blockIpAddress,
        }),
      })
      setBlockingUser(null)
      setBlockIp(false)
      await loadPanel()
      setSuccess(blocked
        ? `Konto zostało zablokowane na ${durationDays === 90 ? '3 miesiące' : `${durationDays} dni`}${blockIpAddress ? ', a zapisany adres IP również objęto blokadą' : ''}.`
        : 'Blokada konta i powiązana blokada IP zostały zdjęte.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zmienić statusu konta.')
    }
  }

  async function verifyProfile(user: AdminUser) {
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/verification`, {
        method: 'PATCH',
        body: JSON.stringify({ verified: !user.profileVerified }),
      })
      await loadPanel()
      setSuccess(user.profileVerified ? 'Oznaczenie zweryfikowanego profilu zostało usunięte.' : 'Profil użytkownika został zweryfikowany.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zmienić weryfikacji profilu.')
    }
  }

  async function openGalleryReview(user: AdminUser) {
    setError('')
    try {
      const result = await apiRequest<{ photos: AdminGalleryPhoto[]; albums: AdminGalleryAlbum[] }>(`/api/admin/gallery/users/${encodeURIComponent(user.id)}`)
      setGalleryReview({ user, photos: result.photos, albums: result.albums })
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się otworzyć galerii użytkownika.')
    }
  }

  async function removeGalleryPhoto(photo: AdminGalleryPhoto, albumId?: string) {
    if (!galleryReview || !can('gallery.photos.delete')) return
    const description = photo.sourcePostId ? 'zdjęcie z Tablicy i powiązanych albumów' : 'zdjęcie z albumu'
    if (!window.confirm(`Usunąć ${description} użytkownika ${galleryReview.user.name}?`)) return
    setError('')
    setSuccess('')
    try {
      const path = photo.sourcePostId
        ? `/api/admin/gallery/users/${encodeURIComponent(galleryReview.user.id)}/posts/${encodeURIComponent(photo.sourcePostId)}/photo`
        : `/api/admin/gallery/users/${encodeURIComponent(galleryReview.user.id)}/albums/${encodeURIComponent(albumId ?? '')}/photos/${encodeURIComponent(photo.id)}`
      await apiRequest(path, { method: 'DELETE' })
      const result = await apiRequest<{ photos: AdminGalleryPhoto[]; albums: AdminGalleryAlbum[] }>(`/api/admin/gallery/users/${encodeURIComponent(galleryReview.user.id)}`)
      setGalleryReview({ user: galleryReview.user, photos: result.photos, albums: result.albums })
      setSuccess('Zdjęcie zostało usunięte.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się usunąć zdjęcia.')
    }
  }

  function adminGalleryImageUrl(photo: AdminGalleryPhoto) {
    const mediaId = photo.mediaId ?? /\/api\/media\/([\da-f-]{36})/i.exec(photo.url)?.[1]
    return mediaId ? `/api/admin/gallery/media/${encodeURIComponent(mediaId)}` : photo.url
  }

  async function reviewReports(user: AdminUser) {
    setError('')
    try {
      const result = await apiRequest<{ reports: ProfileReport[] }>(`/api/admin/users/${encodeURIComponent(user.id)}/reports`)
      setReportReview({ user, reports: result.reports })
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zweryfikować zgłoszeń.')
    }
  }

  async function completeReportReview() {
    if (!reportReview || reviewingReports) return
    setError('')
    setSuccess('')
    setReviewingReports(true)
    try {
      const result = await apiRequest<{ reviewedCount: number }>(`/api/admin/users/${encodeURIComponent(reportReview.user.id)}/reports/review`, { method: 'PATCH' })
      setReportReview(null)
      await loadPanel()
      setSuccess(`Sprawdzono zgłoszenia profilu (${result.reviewedCount}).`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zweryfikować zgłoszeń.')
    } finally {
      setReviewingReports(false)
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`Usunąć konto użytkownika ${user.name}? Dane osobowe konta zostaną usunięte, a na liście pozostanie anonimowy wpis „Konto usunięte”.`)) return
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      await loadPanel()
      setSuccess('Konto użytkownika zostało usunięte.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się usunąć konta.')
    }
  }

  async function decideReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedReport || submitting) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/reports/${encodeURIComponent(selectedReport.id)}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: reportDecision,
          note: reportDecisionNote,
          notifyReporter,
          notifyTarget,
          durationDays: reportBlockDuration,
        }),
      })
      setSelectedReport(null)
      await loadPanel()
      setSuccess('Decyzja została zapisana. Wybrane osoby otrzymają powiadomienie w YouTopic.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zapisać decyzji dotyczącej zgłoszenia.')
    } finally {
      setSubmitting(false)
    }
  }

  function openReportDecision(report: ModerationReport) {
    setSelectedReport(report)
    setReportDecision('dismiss')
    setReportDecisionNote('')
    setNotifyReporter(true)
    setNotifyTarget(true)
    setReportBlockDuration(7)
  }

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const startsAt = publishImmediately ? Date.now() : new Date(scheduledStart).getTime()
      const endsAt = hasEndTime ? new Date(scheduledEnd).getTime() : null
      if (!Number.isFinite(startsAt)) throw new Error('Ustaw prawidłową datę i godzinę rozpoczęcia.')
      if (hasEndTime && (endsAt === null || !Number.isFinite(endsAt) || endsAt <= startsAt)) throw new Error('Zakończenie musi przypadać po rozpoczęciu komunikatu.')
      await apiRequest('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, message, startsAt, endsAt }),
      })
      setTitle('')
      setMessage('')
      setPublishImmediately(true)
      setScheduledStart(toLocalDateTimeValue(Date.now() + 60 * 60 * 1000))
      setHasEndTime(false)
      setScheduledEnd('')
      await loadPanel()
      setSuccess(publishImmediately
        ? 'Komunikat został opublikowany natychmiast wszystkim użytkownikom.'
        : 'Komunikat został zapisany i ukaże się w zaplanowanym terminie.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się opublikować komunikatu.')
    } finally {
      setSubmitting(false)
    }
  }

  async function deactivateAnnouncement(announcement: Announcement) {
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, { method: 'DELETE' })
      await loadPanel()
      setSuccess('Komunikat został wyłączony.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się wyłączyć komunikatu.')
    }
  }

  function startAdminEdit(admin: AdminAccount) {
    setEditingAdminId(admin.id)
    setAdminName(admin.name)
    setAdminEmail(admin.email)
    setAdminRank(admin.rank)
    setCustomRank(predefinedRanks.includes(admin.rank) ? '' : admin.rank)
    setAdminPassword('')
    setAdminPermissions(admin.permissions)
    setError('')
    setSuccess('')
  }

  function resetAdminForm() {
    setEditingAdminId('')
    setAdminName('')
    setAdminEmail('')
    setAdminRank('Administrator')
    setCustomRank('')
    setAdminPassword('')
    setAdminPermissions([])
  }

  function selectAdminRank(rank: string) {
    setCustomRank(predefinedRanks.includes(rank) ? '' : rank)
    if (predefinedRanks.includes(rank)) setAdminRank(rank)
    if (!editingAdminId && (predefinedRanks.includes(rank) || rankPermissionTemplates[rank])) {
      setAdminPermissions(rankPermissionTemplates[rank] ?? [])
    }
  }

  async function saveAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const rank = customRank.trim() || adminRank
      const body: Record<string, unknown> = {
        name: adminName.trim(),
        email: adminEmail.trim(),
      }
      if (!editingAdminId) {
        if (adminPermissions.length === 0) throw new Error('Przyznaj co najmniej jedno uprawnienie.')
        body.rank = rank
        body.permissions = adminPermissions
        body.password = adminPassword
      } else {
        const editingSelf = editingAdminId === currentAdmin?.id
        if (!editingSelf) {
          if (adminPermissions.length === 0) throw new Error('Przyznaj co najmniej jedno uprawnienie.')
          body.rank = rank
          body.permissions = adminPermissions
        }
        if (adminPassword) body.password = adminPassword
      }
      const result = await apiRequest<{ admin: AdminAccount }>(
        editingAdminId ? `/api/admin/admins/${encodeURIComponent(editingAdminId)}` : '/api/admin/admins',
        { method: editingAdminId ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      )
      if (result.admin.id === currentAdmin?.id) setCurrentAdmin(result.admin)
      resetAdminForm()
      await loadPanel()
      setSuccess(editingAdminId ? 'Dane administratora zostały zapisane.' : 'Konto administratora zostało utworzone.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nie udało się zapisać administratora.')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteAdmin(admin: AdminAccount) {
    if (!window.confirm(`Czy na pewno usunąć konto ${admin.email}?`)) return
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/admins/${encodeURIComponent(admin.id)}`, { method: 'DELETE' })
      await loadPanel()
      setSuccess('Konto administratora zostało usunięte.')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Nie udało się usunąć administratora.')
    }
  }

  async function updateSupportTicket(ticket: SupportTicket, update: { status?: SupportTicket['status']; reply?: string }) {
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/support/tickets/${encodeURIComponent(ticket.id)}`, { method: 'PATCH', body: JSON.stringify(update) })
      setSupportReply('')
      await loadPanel()
      setActiveSupportTicketId(ticket.id)
      setSuccess('Sprawa pomocy została zaktualizowana.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zaktualizować sprawy.')
    }
  }

  async function savePlatformSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    try {
      await apiRequest('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ registrationEnabled }) })
      setSuccess('Ustawienia platformy zostały zapisane.')
      await loadPanel()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się zapisać ustawień.')
    }
  }

  async function restoreModeratedContent(item: ModeratedContent) {
    if (!window.confirm('Przywrócić wpis moderacji? Element może znów być widoczny u użytkowników.')) return
    setError('')
    setSuccess('')
    try {
      await apiRequest(`/api/admin/content/moderated/${encodeURIComponent(item.reportId)}`, { method: 'DELETE' })
      await loadPanel()
      setSuccess('Wpis moderacji został usunięty.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nie udało się przywrócić treści.')
    }
  }

  function togglePermission(permission: Permission) {
    setAdminPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission])
  }

  const pageTitle = section === 'overview' ? 'Przegląd'
    : section === 'analytics' ? 'Statystyki'
      : section === 'users' ? 'Użytkownicy'
        : section === 'reports' ? 'Zgłoszenia'
          : section === 'support' ? 'Centrum pomocy'
            : section === 'content' ? 'Treści'
              : section === 'health' ? 'Stan platformy'
                : section === 'audit' ? 'Dziennik działań'
                  : section === 'settings' ? 'Ustawienia'
                    : section === 'announcements' ? 'Komunikaty' : 'Administratorzy'

  if (loading) {
    return <main className="admin-loading"><span className="admin-mark"><ShieldCheck size={21} /></span><p>Ładowanie panelu…</p></main>
  }

  if (!authenticated) {
    return (
      <main className="login-page">
        <section className="login-card">
          <span className="admin-mark"><ShieldCheck size={21} /></span>
          <p className="eyebrow">ZARZĄDZANIE SPOŁECZNOŚCIĄ</p>
          <h1>Administracja<span>.</span></h1>
          <p className="login-description">Zaloguj się danymi konta administratora.</p>
          {error && <div className="notice error" role="alert"><AlertCircle size={17} />{error}</div>}
          <form className="stack-form" onSubmit={handleLogin}>
            <label>E-mail konta administratora
              <input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>Hasło
              <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Logowanie…' : 'Zaloguj się'}</button>
          </form>
          <p className="login-footnote">Uprawnienia administratora są sprawdzane przez serwer.</p>
        </section>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/">
          <img src="/youtopic-mark.svg" alt="" />
          <span>You<span>Topic</span><small>ADMIN</small></span>
        </a>
        <p className="sidebar-caption">PANEL ZARZĄDZANIA</p>
        <nav aria-label="Nawigacja panelu">
          {can('overview.view') && <button className={section === 'overview' ? 'selected' : ''} onClick={() => setSection('overview')}><LayoutDashboard size={18} />Przegląd</button>}
          {can('analytics.view') && <button className={section === 'analytics' ? 'selected' : ''} onClick={() => setSection('analytics')}><BarChart3 size={18} />Statystyki</button>}
          {can('users.view') && <button className={section === 'users' ? 'selected' : ''} onClick={() => setSection('users')}><UsersRound size={18} />Użytkownicy</button>}
          {can('reports.view') && <button className={section === 'reports' ? 'selected' : ''} onClick={() => setSection('reports')}><Inbox size={18} />Zgłoszenia{reports.filter((report) => report.status === 'pending').length > 0 && <span className="sidebar-report-count">{reports.filter((report) => report.status === 'pending').length}</span>}</button>}
          {can('support.view') && <button className={section === 'support' ? 'selected' : ''} onClick={() => setSection('support')}><LifeBuoy size={18} />Pomoc{supportTickets.filter((ticket) => ticket.status !== 'resolved').length > 0 && <span className="sidebar-report-count">{supportTickets.filter((ticket) => ticket.status !== 'resolved').length}</span>}</button>}
          {can('content.view') && <button className={section === 'content' ? 'selected' : ''} onClick={() => setSection('content')}><ClipboardList size={18} />Treści</button>}
          {can('health.view') && <button className={section === 'health' ? 'selected' : ''} onClick={() => setSection('health')}><Activity size={18} />Stan systemu</button>}
          {can('audit.view') && <button className={section === 'audit' ? 'selected' : ''} onClick={() => setSection('audit')}><ClipboardList size={18} />Dziennik</button>}
          {can('settings.view') && <button className={section === 'settings' ? 'selected' : ''} onClick={() => setSection('settings')}><Settings size={18} />Ustawienia</button>}
          {(can('announcements.view') || can('announcements.manage')) && <button className={section === 'announcements' ? 'selected' : ''} onClick={() => setSection('announcements')}><Megaphone size={18} />Komunikaty</button>}
          {can('admins.view') && <button className={section === 'admins' ? 'selected' : ''} onClick={() => setSection('admins')}><UserRoundCog size={18} />Administratorzy</button>}
        </nav>
        <div className="sidebar-bottom">
          <span className="admin-session"><i />{currentAdmin?.rank || 'Sesja administratora'}</span>
          <button className="logout-button" onClick={handleLogout} disabled={submitting}><LogOut size={17} />Wyloguj</button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div><p className="eyebrow">YOUTOPIC / ADMIN</p><h1>{pageTitle}<span>.</span></h1></div>
          <span className="secure-badge"><ShieldCheck size={15} />Bezpieczny panel</span>
        </header>
        {error && <div className="notice error" role="alert"><AlertCircle size={17} />{error}</div>}
        {success && <div className="notice success" role="status"><CheckCircle2 size={17} />{success}</div>}
        {!(['overview.view', 'analytics.view', 'users.view', 'reports.view', 'support.view', 'content.view', 'health.view', 'audit.view', 'settings.view', 'settings.manage', 'announcements.view', 'announcements.manage', 'admins.view'] as Permission[]).some((permission) => can(permission))
          && <p className="empty-state">To konto nie ma jeszcze dostępu do żadnej sekcji panelu. Poproś Super Administratora o przyznanie uprawnień.</p>}
        {section === 'overview' && overview && (
          <section className="overview-section">
            <div className="welcome-card">
              <div><p className="eyebrow">CENTRUM SPOŁECZNOŚCI</p><h2>Witaj w panelu YouTopic</h2><p>Monitoruj konta i publikuj ważne komunikaty dla społeczności.</p></div>
              <span><ShieldCheck size={28} /></span>
            </div>
            <div className="stats-grid">
              <StatCard label="Wszystkie konta" value={overview.totalUsers} icon={<UsersRound />} />
              <StatCard label="Potwierdzone e-maile" value={overview.verifiedUsers} icon={<CheckCircle2 />} />
              <StatCard label="Nowe dzisiaj" value={overview.newUsersToday} icon={<LayoutDashboard />} />
              <StatCard label="Zablokowane konta" value={overview.blockedUsers} icon={<Ban />} />
            </div>
            {can('announcements.view') || can('announcements.manage')
              ? <div className="overview-note"><Megaphone size={18} /><span><strong>{overview.activeAnnouncements}</strong> aktywnych komunikatów dla użytkowników</span><button onClick={() => setSection('announcements')}>Zarządzaj</button></div>
              : null}
            <p className="data-note">Statystyki kont pochodzą z API. Posty i część interakcji są obecnie prototypowe i przechowywane lokalnie — zarządzanie nimi z tego panelu wymaga najpierw przeniesienia ich do bazy danych.</p>
          </section>
        )}
        {section === 'analytics' && analytics && (
          <section className="overview-section">
            <div className="section-toolbar"><div><h2>Statystyki platformy</h2><p>Dane kont i aktywności administracyjnej z API.</p></div><button className="secondary-button" onClick={() => void loadPanel()}>Odśwież</button></div>
            <div className="stats-grid">
              <StatCard label="Konta łącznie" value={analytics.totalUsers} icon={<UsersRound />} />
              <StatCard label="Aktywne konta" value={analytics.activeUsers} icon={<Activity />} />
              <StatCard label="Potwierdzone e-maile" value={analytics.verifiedUsers} icon={<CheckCircle2 />} />
              <StatCard label="Niepotwierdzone e-maile" value={analytics.unverifiedUsers} icon={<AlertCircle />} />
              <StatCard label="Rejestracje · 30 dni" value={analytics.registrationCount30Days} icon={<BarChart3 />} />
              <StatCard label="Zablokowane konta" value={analytics.blockedUsers} icon={<Ban />} />
              <StatCard label="Oczekujące zgłoszenia" value={analytics.reportsPending} icon={<Flag />} />
              <StatCard label="Otwarte sprawy pomocy" value={analytics.openSupportTickets} icon={<LifeBuoy />} />
            </div>
            <section className="admin-card analytics-chart">
              <div><h3>Nowe konta — ostatnie 30 dni</h3><p>Oparte o daty rejestracji kont w API.</p></div>
              <div className="registration-bars" role="img" aria-label="Wykres liczby rejestracji w ciągu ostatnich 30 dni">
                {analytics.registrationsByDay.map((day) => {
                  const maximum = Math.max(1, ...analytics.registrationsByDay.map((item) => item.registrations))
                  return <div className="registration-bar-column" key={day.date} title={`${day.date}: ${day.registrations}`}><span style={{ height: `${Math.max(day.registrations > 0 ? 6 : 0, day.registrations / maximum * 100)}%` }} /><small>{day.date.slice(8)}</small></div>
                })}
              </div>
            </section>
            <p className="data-note">Panel nie raportuje odsłon, czasu spędzonego w serwisie ani aktywności feedu, ponieważ posty i interakcje są prototypowe i nie są zbierane centralnie.</p>
          </section>
        )}
        {section === 'health' && health && (
          <section className="data-section">
            <div className="section-toolbar"><div><h2>Stan usług</h2><p>Kontrola API wykonana: {formatDate(health.checkedAt)}.</p></div><button className="secondary-button" onClick={() => void loadPanel()}>Sprawdź ponownie</button></div>
            <div className="health-grid">
              <HealthCard label="API" value={health.status === 'ok' ? 'Działa' : 'Ograniczony'} healthy={health.status === 'ok'} />
              <HealthCard label="Baza danych" value={health.database === 'connected' ? 'Połączona' : health.database === 'local-file' ? 'Tryb lokalny · plik' : 'Niedostępna'} healthy={health.database !== 'unavailable'} />
              <HealthCard label="Wysyłka e-mail" value={health.emailConfigured ? 'Skonfigurowana' : 'Brak konfiguracji'} healthy={health.emailConfigured} />
              <HealthCard label="Wysyłka SMS" value={health.smsConfigured ? 'Skonfigurowana' : 'Brak konfiguracji'} healthy={health.smsConfigured} />
              <HealthCard label="Sekret sesji" value={health.sessionSecretConfigured ? 'Skonfigurowany' : 'Tryb lokalny'} healthy={health.sessionSecretConfigured} />
              <HealthCard label="Czas pracy API" value={`${Math.floor(health.uptimeSeconds / 3600)} godz. ${Math.floor(health.uptimeSeconds % 3600 / 60)} min`} healthy />
            </div>
            <p className="data-note">Kontrola konfiguracji nie wysyła testowej wiadomości e-mail ani SMS. Nie wyświetlamy wartości sekretów.</p>
          </section>
        )}
        {section === 'audit' && (
          <section className="data-section">
            <div className="section-toolbar"><div><h2>Historia zmian</h2><p>Ostatnie 200 udanych działań zmieniających dane w panelu.</p></div><button className="secondary-button" onClick={() => void loadPanel()}>Odśwież</button></div>
            <div className="table-wrap"><table><thead><tr><th>Data</th><th>Administrator</th><th>Akcja</th><th>Wynik</th></tr></thead><tbody>
              {auditEntries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.createdAt)}</td><td><strong>{entry.adminName}</strong><small>{entry.rank}</small></td><td><code>{entry.method} {entry.path}</code></td><td>{entry.statusCode}</td></tr>)}
              {auditEntries.length === 0 && <tr><td className="empty-cell" colSpan={4}>Brak zapisanych działań.</td></tr>}
            </tbody></table></div>
          </section>
        )}
        {section === 'settings' && (
          <section className="data-section">
            <form className="announcement-form admin-editor" onSubmit={savePlatformSettings}>
              <div><h2>Ustawienia platformy</h2><p>Zmiana dostępności rejestracji wpływa na nowe konta. Logowanie istniejących użytkowników pozostaje aktywne.</p></div>
              <label className="checkbox-label"><input type="checkbox" checked={registrationEnabled} disabled={!can('settings.manage')} onChange={(event) => setRegistrationEnabled(event.target.checked)} />Pozwól na rejestrację nowych kont</label>
              <div className="form-footer"><small>Ustawienia zapisują się w API i bazie platformy.</small>{can('settings.manage') ? <button className="primary-button" type="submit" disabled={submitting}><Settings size={16} />Zapisz ustawienia</button> : <span className="data-note">Brak uprawnienia do zmiany ustawień.</span>}</div>
            </form>
          </section>
        )}
        {section === 'content' && (
          <section className="data-section">
            <div className="section-toolbar"><div><h2>Rejestr moderacji</h2><p>{moderatedContent.length} ukrytych elementów.</p></div><button className="secondary-button" onClick={() => void loadPanel()}>Odśwież</button></div>
            <p className="data-note">Posty, komentarze i wiadomości nadal są przechowywane lokalnie w przeglądarkach. Panel centralnie zapisuje decyzje moderacyjne i ukrywa zgodne elementy u klientów, ale nie może przeglądać ani usuwać wszystkich kopii treści.</p>
            <div className="report-card-list">{moderatedContent.map((item) => (
              <article className="moderation-report-card" key={item.reportId}>
                <header><div><span className={`report-type-pill report-type-${item.targetType}`}>{item.targetType}</span><strong>{item.authorName}</strong></div><small>{formatDate(item.removedAt)}</small></header>
                {item.contentPreview && <blockquote>{item.contentPreview}</blockquote>}
                {item.contentUrl && <a className="report-content-link" href={item.contentUrl} target="_blank" rel="noreferrer">Otwórz załącznik</a>}
                {can('content.manage') && <button className="secondary-button" onClick={() => void restoreModeratedContent(item)}>Przywróć widoczność</button>}
              </article>
            ))}
            {moderatedContent.length === 0 && <p className="empty-state">Brak treści ukrytych przez moderację.</p>}</div>
          </section>
        )}
        {section === 'support' && (
          <section className="support-center">
            <div className="section-toolbar"><div><h2>Sprawy użytkowników</h2><p>{supportTickets.filter((ticket) => ticket.status !== 'resolved').length} otwartych · {supportTickets.length} łącznie</p></div><button className="secondary-button" onClick={() => void loadPanel()}>Odśwież</button></div>
            <div className="support-ticket-list">{supportTickets.map((ticket) => {
              const active = activeSupportTicketId === ticket.id
              const statusLabel = ticket.status === 'resolved' ? 'Rozwiązana' : ticket.status === 'in_progress' ? 'W trakcie' : 'Otwarta'
              return <article className={`support-ticket ${active ? 'selected' : ''}`} key={ticket.id}>
                <button className="support-ticket-summary" onClick={() => setActiveSupportTicketId(active ? '' : ticket.id)}><span className={`ticket-status status-${ticket.status}`}>{statusLabel}</span><strong>{ticket.subject}</strong><small>{ticket.user.name} · @{ticket.user.nickname} · {formatDate(ticket.updatedAt)}</small></button>
                {active && <div className="support-ticket-detail">
                  <p className="data-note">Kategoria: {ticket.category}</p>
                  <div className="support-ticket-messages">{ticket.messages.map((item) => <div className={`support-message ${item.authorType}`} key={item.id}><strong>{item.authorName} · {item.authorType === 'admin' ? 'administracja' : 'użytkownik'}</strong><p>{item.message}</p><small>{formatDate(item.createdAt)}</small></div>)}</div>
                  {can('support.manage') && <>
                    <label className="report-status-filter">Status
                      <select value={ticket.status} onChange={(event) => void updateSupportTicket(ticket, { status: event.target.value as SupportTicket['status'] })}><option value="open">Otwarta</option><option value="in_progress">W trakcie</option><option value="resolved">Rozwiązana</option></select>
                    </label>
                    {ticket.status !== 'resolved' && <form className="support-reply-form" onSubmit={(event) => { event.preventDefault(); if (supportReply.trim()) void updateSupportTicket(ticket, { reply: supportReply.trim() }) }}><textarea value={supportReply} onChange={(event) => setSupportReply(event.target.value)} placeholder="Odpowiedz użytkownikowi..." maxLength={5000} required /><button className="primary-button" type="submit" disabled={submitting || !supportReply.trim()}><Send size={15} />Wyślij odpowiedź</button></form>}
                  </>}
                </div>}
              </article>
            })}
            {supportTickets.length === 0 && <p className="empty-state">Nie ma jeszcze spraw pomocy od użytkowników.</p>}</div>
          </section>
        )}
        {section === 'reports' && (
          <section className="report-center">
            <div className="section-toolbar">
              <div><h2>Zgłoszenia użytkowników</h2><p>{reports.filter((report) => report.status === 'pending').length} oczekujących · {reports.length} łącznie</p></div>
              <div className="report-filter-group">
                <label className="report-status-filter">Status
                  <select value={reportStatusFilter} onChange={(event) => setReportStatusFilter(event.target.value as 'pending' | 'resolved' | 'all')}>
                    <option value="pending">Oczekujące</option>
                    <option value="resolved">Rozpatrzone</option>
                    <option value="all">Wszystkie</option>
                  </select>
                </label>
                <label className="report-status-filter">Rodzaj
                  <select value={reportTypeFilter} onChange={(event) => setReportTypeFilter(event.target.value as ModerationReport['targetType'] | 'all')}>
                    <option value="all">Wszystkie</option>
                    {(Object.keys(reportTypeLabels) as ModerationReport['targetType'][]).map((type) => <option value={type} key={type}>{reportTypeLabels[type]}</option>)}
                  </select>
                </label>
                <label className="report-status-filter">Kategoria
                  <select value={reportCategoryFilter} onChange={(event) => setReportCategoryFilter(event.target.value as ReportReasonCategory | 'all')}>
                    <option value="all">Wszystkie</option>
                    {(Object.keys(reportCategoryLabels) as ReportReasonCategory[]).map((category) => <option value={category} key={category}>{reportCategoryLabels[category]}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className="report-search-filters">
              <label>Szukaj zgłoszenia<input type="search" value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Użytkownik, powód, treść…" /></label>
              <label>Od<input type="date" value={reportFromDate} onChange={(event) => setReportFromDate(event.target.value)} /></label>
              <label>Do<input type="date" value={reportToDate} onChange={(event) => setReportToDate(event.target.value)} /></label>
            </div>
            {visibleReports.length === 0
              ? <p className="empty-state">Brak zgłoszeń w tej kategorii.</p>
              : <div className="report-card-list">
                {visibleReports.map((report) => (
                  <article className="moderation-report-card" key={report.id}>
                    <header>
                      <div>
                        <span className={`report-type-pill report-type-${report.targetType}`}>{reportTypeLabels[report.targetType]}</span>
                        <span className="report-category-pill">{report.reasonCategoryLabel || reportCategoryLabels[report.reasonCategory || 'other']}</span>
                        <span className={`status-pill ${report.status === 'pending' ? 'blocked' : 'active'}`}>{report.status === 'pending' ? 'Do sprawdzenia' : 'Zakończone'}</span>
                      </div>
                      <small>{formatDate(report.createdAt)}</small>
                    </header>
                    <p className="moderation-report-reason"><strong>Powód:</strong> {report.reason}</p>
                    {report.contentPreview && <blockquote>{report.contentPreview}</blockquote>}
                    {report.contentUrl && <a className="report-content-link" href={report.contentUrl} target="_blank" rel="noreferrer">Otwórz zgłoszone multimedia</a>}
                    <div className="moderation-report-people">
                      <span><small>Zgłaszający</small><strong>{report.reporter.name}</strong></span>
                      <span><small>Osoba / autor treści</small><strong>{report.target.name}</strong>{report.target.nickname && <small>@{report.target.nickname}</small>}</span>
                    </div>
                    {report.status === 'resolved' && <p className="report-decision-summary"><strong>Decyzja:</strong> {report.decision ? reportDecisionLabels[report.decision] : 'Sprawdzone'}{report.decisionNote && ` · ${report.decisionNote}`}<small>{report.decidedAt ? `Rozpatrzono ${formatDate(report.decidedAt)}` : ''}{report.decidedBy ? ` przez ${report.decidedBy}` : ''}</small></p>}
                    {report.status === 'pending' && <div className="report-card-actions">
                      {can('reports.manage') && <button className="primary-button" type="button" onClick={() => openReportDecision(report)}><CheckCircle2 size={15} />Rozpatrz zgłoszenie</button>}
                      <small>{report.targetType !== 'profile' ? 'Treści społecznościowe i wiadomości są obecnie przechowywane lokalnie w prototypie; usunięcie z panelu ukryje je u klientów, którzy mają ten sam element, ale nie zastępuje centralnego magazynu treści.' : ''}</small>
                    </div>}
                  </article>
                ))}
              </div>}
          </section>
        )}
        {section === 'users' && (
          <section className="data-section">
            <div className="section-toolbar">
              <div><h2>Wszyscy użytkownicy platformy</h2><p>{users.filter((user) => !user.deletedAt).length} aktywnych · {users.filter((user) => user.deletedAt).length} usuniętych · wyświetlono {visibleUsers.length} z {users.length}</p></div>
              <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po nazwie lub e-mailu" /></label>
            </div>
            {activeUserFilter && <div className="user-filter-editor" role="region" aria-label={`Filtr: ${userFilterLabels[activeUserFilter]}`}>
              <label htmlFor="user-column-filter">Filtruj kolumnę: <strong>{userFilterLabels[activeUserFilter]}</strong>
                {activeUserFilter === 'emailVerified' || activeUserFilter === 'status' || activeUserFilter === 'profileVerified' || activeUserFilter === 'reports' || activeUserFilter === 'gender'
                  ? <select id="user-column-filter" value={userFilters[activeUserFilter] ?? ''} onChange={(event) => updateUserFilter(activeUserFilter, event.target.value)}>
                    <option value="">Wszystkie</option>
                    {activeUserFilter === 'emailVerified' && <><option value="confirmed">Potwierdzony</option><option value="unconfirmed">Niepotwierdzony</option></>}
                    {activeUserFilter === 'status' && <><option value="active">Aktywny</option><option value="blocked">Zablokowany</option><option value="deleted">Usunięty</option></>}
                    {activeUserFilter === 'profileVerified' && <><option value="verified">Zweryfikowany</option><option value="unverified">Niezweryfikowany</option></>}
                    {activeUserFilter === 'reports' && <><option value="reported">Ma oczekujące zgłoszenia</option><option value="none">Brak zgłoszeń</option></>}
                    {activeUserFilter === 'gender' && <><option value="female">Kobieta</option><option value="male">Mężczyzna</option><option value="other">Inna</option><option value="undisclosed">Wolę nie podawać</option></>}
                  </select>
                  : <input id="user-column-filter" value={userFilters[activeUserFilter] ?? ''} onChange={(event) => updateUserFilter(activeUserFilter, event.target.value)} placeholder={`Wpisz wartość z kolumny „${userFilterLabels[activeUserFilter]}”`} />}
              </label>
              <button className="secondary-button" type="button" onClick={() => updateUserFilter(activeUserFilter, '')}>Wyczyść tę kolumnę</button>
              {Object.values(userFilters).some(Boolean) && <button className="secondary-button" type="button" onClick={() => setUserFilters({})}>Wyczyść wszystkie filtry</button>}
            </div>}
            <div className="table-wrap">
              <table>
                <thead><tr>
                  {renderUserFilterHeader('user')}
                  {renderUserFilterHeader('registration')}
                  {renderUserFilterHeader('email')}
                  {renderUserFilterHeader('emailVerified')}
                  {renderUserFilterHeader('location')}
                  {renderUserFilterHeader('birthDate')}
                  {renderUserFilterHeader('gender')}
                  {renderUserFilterHeader('phones')}
                  {renderUserFilterHeader('status')}
                  {renderUserFilterHeader('profileVerified')}
                  {renderUserFilterHeader('reports')}
                  <th>Akcje</th>
                </tr></thead>
                <tbody>
                  {visibleUsers.map((user) => (
                    <tr key={user.id} className={user.deletedAt ? 'deleted-user-row' : ''}>
                      <td><span className="user-identity"><img src={user.avatar || '/youtopic-mark.svg'} alt="" /><span><strong>{user.name || '—'}{user.profileVerified && <BadgeCheck size={14} className="verified-profile-icon" aria-label="Zweryfikowany profil" />}</strong>{user.nickname && <small>@{user.nickname}</small>}</span></span></td>
                      <td>{user.deletedAt ? <><span>Konto usunięte</span><small>{formatDate(user.deletedAt)}</small></> : formatDate(user.createdAt)}</td>
                      <td>{user.email || '—'}</td>
                      <td>{user.deletedAt ? '—' : <span className={`email-status ${user.emailVerified ? 'email-verified' : 'email-unverified'}`}>{user.emailVerified ? 'Potwierdzony' : 'Niepotwierdzony'}</span>}</td>
                      <td>{user.deletedAt ? '—' : can('users.personal_data.view') ? user.location || '—' : <span className="restricted-data">Brak dostępu</span>}</td>
                      <td>{user.deletedAt ? '—' : can('users.personal_data.view') ? formatBirthDate(user.birthDate) : <span className="restricted-data">Brak dostępu</span>}</td>
                      <td>{user.deletedAt ? '—' : can('users.personal_data.view') ? genderLabel(user.gender) : <span className="restricted-data">Brak dostępu</span>}</td>
                      <td>{user.deletedAt ? '—' : can('users.personal_data.view')
                        ? <div className="user-phone-list">
                          {user.phone && <small>Logowanie: {user.phone}</small>}
                          {user.contactPhone && <small>Kontakt: {user.contactPhone}</small>}
                          {user.secondContactPhone && <small>Kontakt 2: {user.secondContactPhone}</small>}
                          {!user.phone && !user.contactPhone && !user.secondContactPhone && '—'}
                        </div>
                        : <span className="restricted-data">Brak dostępu</span>}</td>
                      <td>{user.deletedAt
                        ? <span className="status-pill pending">Usunięte</span>
                        : <><span className={`status-pill ${user.blockedAt ? 'blocked' : 'active'}`}>{user.blockedAt ? 'Zablokowany' : 'Aktywny'}</span>{user.blockedAt && user.blockedUntil && <small>do {formatDate(user.blockedUntil)}</small>}{user.blockedReason && user.blockedAt && <small>{user.blockedReason}</small>}{user.ipBlockedUntil && <small className="ip-block-note">IP zablokowane do {formatDate(user.ipBlockedUntil)}</small>}</>}</td>
                      <td>{user.deletedAt ? '—' : user.isAdmin ? <span className="admin-account"><ShieldCheck size={14} />Administrator</span> : user.profileVerified
                        ? <>{can('users.verify') && <button className="row-action verification-action verified-action" onClick={() => verifyProfile(user)}><BadgeCheck size={14} />Zweryfikowany</button>}{!can('users.verify') && <span className="email-verified">Zweryfikowany</span>}</>
                        : can('users.verify') ? <button className="row-action verification-action" onClick={() => verifyProfile(user)}>Zweryfikuj</button> : <span>Niezweryfikowany</span>}</td>
                      <td>{user.deletedAt ? '—' : user.reportCount > 0
                        ? <>{can('users.reports.review') ? <button className="row-action report-review-action" onClick={() => reviewReports(user)}><Flag size={14} />Sprawdź ({user.reportCount})</button> : <span className="status-pill blocked">{user.reportCount}</span>}</>
                        : <span>Brak</span>}</td>
                      <td>{user.deletedAt
                        ? <span>—</span>
                        : user.isAdmin
                          ? <div className="user-actions"><span className="admin-account"><ShieldCheck size={14} />Administrator</span>{can('gallery.view') && <button className="row-action gallery-review-action" onClick={() => void openGalleryReview(user)}><Image size={14} />Galeria</button>}</div>
                          : <div className="user-actions">
                            {can('gallery.view') && <button className="row-action gallery-review-action" onClick={() => void openGalleryReview(user)}><Image size={14} />Galeria</button>}
                            {can('users.block') && <button className={`row-action ${user.blockedAt ? 'unblock' : ''}`} onClick={() => {
                              if (user.blockedAt) void toggleBlock(user, false)
                              else { setBlockingUser(user); setBlockDurationDays(7); setBlockIp(false) }
                            }}><Ban size={14} />{user.blockedAt ? 'Odblokuj' : 'Zablokuj'}</button>}
                            {can('users.delete') && <button className="row-action delete-user-action" onClick={() => void deleteUser(user)}><UserRoundX size={14} />Usuń</button>}
                            {can('users.message') && <button className="row-action message-user-action" disabled title="Dostępne po uruchomieniu komunikatora 1:1"><MessageCircle size={14} />Napisz</button>}
                          </div>}</td>
                    </tr>
                  ))}
                  {visibleUsers.length === 0 && <tr><td className="empty-cell" colSpan={12}>Nie znaleziono kont pasujących do wyszukiwania i filtrów.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="data-note">Lista jest pobierana z centralnego API i obejmuje wszystkie konta zarejestrowane na YouTopic, nie tylko użytkowników tej przeglądarki. Profile demonstracyjne zapisane lokalnie nie są kontami platformy. Miejscowość, data urodzenia, płeć i numery telefonów wymagają uprawnienia „Wyświetlanie danych osobowych”. Blokada konta unieważnia istniejące sesje i wygasa automatycznie po wybranym okresie. Blokada IP dotyczy zapisanego adresu z ostatniego logowania; panel administracyjny pozostaje dostępny.</p>
          </section>
        )}
        {blockingUser && (
          <div className="modal-backdrop" onClick={() => setBlockingUser(null)}>
            <section className="block-user-dialog" role="dialog" aria-modal="true" aria-labelledby="block-user-title" onClick={(event) => event.stopPropagation()}>
              <header><div><p className="eyebrow">DZIAŁANIA MODERACYJNE</p><h2 id="block-user-title">Zablokuj konto</h2></div><button type="button" className="secondary-button" onClick={() => setBlockingUser(null)}>Anuluj</button></header>
              <p className="block-user-summary"><strong>{blockingUser.name}</strong> · @{blockingUser.nickname}</p>
              <label className="block-duration-label">Czas blokady
                <select value={blockDurationDays} onChange={(event) => setBlockDurationDays(Number(event.target.value))}>
                  <option value={7}>7 dni</option>
                  <option value={30}>30 dni</option>
                  <option value={90}>3 miesiące</option>
                </select>
              </label>
              <label className={`checkbox-label block-ip-option ${!blockingUser.canBlockIp ? 'disabled-option' : ''}`}>
                <input type="checkbox" checked={blockIp} disabled={!blockingUser.canBlockIp} onChange={(event) => setBlockIp(event.target.checked)} />
                Zablokuj również ostatni znany adres IP
              </label>
              {!blockingUser.canBlockIp && <p className="data-note">Adres IP zostanie zapamiętany po kolejnym logowaniu użytkownika.</p>}
              <p className="data-note">Blokada IP obejmie także inne konta korzystające z tego samego adresu i wygaśnie razem z blokadą konta.</p>
              <button className="primary-button" type="button" disabled={submitting} onClick={() => void toggleBlock(blockingUser, true, blockDurationDays, blockIp)}><Ban size={16} />{submitting ? 'Zapisywanie…' : 'Potwierdź blokadę'}</button>
            </section>
          </div>
        )}
        {reportReview && (
          <div className="modal-backdrop" onClick={() => setReportReview(null)}>
            <section className="report-review-dialog" role="dialog" aria-modal="true" aria-labelledby="report-review-title" onClick={(event) => event.stopPropagation()}>
              <header><div><p className="eyebrow">MODERACJA SPOŁECZNOŚCI</p><h2 id="report-review-title">Zgłoszenia profilu</h2></div><button type="button" className="secondary-button" onClick={() => setReportReview(null)}>Zamknij</button></header>
              <p className="block-user-summary"><strong>{reportReview.user.name}</strong> · @{reportReview.user.nickname}</p>
              <div className="report-review-list">
                {reportReview.reports.length === 0
                  ? <p className="empty-state">Brak oczekujących zgłoszeń. Lista mogła zostać zaktualizowana przez innego administratora.</p>
                  : reportReview.reports.map((report) => (
                    <article className="report-review-item" key={report.id}>
                      <p>{report.reason}</p>
                      <small>{formatDate(report.createdAt)}</small>
                    </article>
                  ))}
              </div>
              {reportReview.reports.length > 0 && <button className="primary-button" type="button" disabled={reviewingReports} onClick={() => void completeReportReview()}><CheckCircle2 size={16} />{reviewingReports ? 'Zapisywanie…' : 'Oznacz jako sprawdzone'}</button>}
            </section>
          </div>
        )}
        {galleryReview && (
          <div className="modal-backdrop" onClick={() => setGalleryReview(null)}>
            <section className="gallery-review-dialog" role="dialog" aria-modal="true" aria-labelledby="gallery-review-title" onClick={(event) => event.stopPropagation()}>
              <header><div><p className="eyebrow">MODERACJA ZDJĘĆ</p><h2 id="gallery-review-title">Galeria użytkownika</h2></div><button type="button" className="secondary-button" onClick={() => setGalleryReview(null)}>Zamknij</button></header>
              <p className="block-user-summary"><strong>{galleryReview.user.name}</strong> · @{galleryReview.user.nickname}</p>
              <section className="gallery-review-group">
                <h3>Zdjęcia z Tablicy ({galleryReview.photos.length})</h3>
                {galleryReview.photos.length === 0 ? <p className="empty-state">Brak zdjęć z Tablicy.</p> : <div className="gallery-review-grid">{galleryReview.photos.map((photo) => <article key={photo.id}>
                  <img src={adminGalleryImageUrl(photo)} alt={photo.caption || 'Zdjęcie użytkownika'} />
                  <small>{formatDate(photo.createdAt)}</small>
                  {can('gallery.photos.delete') && <button className="row-action delete-user-action" type="button" onClick={() => void removeGalleryPhoto(photo)}><Trash2 size={13} />Usuń zdjęcie</button>}
                </article>)}</div>}
              </section>
              {galleryReview.albums.map((album) => <section className="gallery-review-group" key={album.id}>
                <h3>{album.name} ({album.photos.length})</h3>
                {album.photos.length === 0 ? <p className="empty-state">Album nie zawiera zdjęć.</p> : <div className="gallery-review-grid">{album.photos.map((photo) => <article key={photo.id}>
                  <img src={adminGalleryImageUrl(photo)} alt={photo.caption || 'Zdjęcie użytkownika'} />
                  <small>{formatDate(photo.createdAt)}</small>
                  {can('gallery.photos.delete') && <button className="row-action delete-user-action" type="button" onClick={() => void removeGalleryPhoto(photo, album.id)}><Trash2 size={13} />Usuń zdjęcie</button>}
                </article>)}</div>}
              </section>)}
              {!galleryReview.photos.length && !galleryReview.albums.length && <p className="empty-state">Użytkownik nie ma jeszcze zdjęć ani albumów.</p>}
              {can('gallery.photos.delete') && <p className="data-note">Usunięcie zdjęcia z Tablicy usuwa je również z powiązanych albumów. Zdjęcie z prywatnej Band lub Pokoju nie jest dostępne w tej galerii.</p>}
            </section>
          </div>
        )}
        {selectedReport && (
          <div className="modal-backdrop" onClick={() => setSelectedReport(null)}>
            <form className="report-decision-dialog" role="dialog" aria-modal="true" aria-labelledby="report-decision-title" onSubmit={decideReport} onClick={(event) => event.stopPropagation()}>
              <header><div><p className="eyebrow">ROZPATRZENIE ZGŁOSZENIA</p><h2 id="report-decision-title">{reportTypeLabels[selectedReport.targetType]} · {selectedReport.target.name}</h2></div><button type="button" className="secondary-button" onClick={() => setSelectedReport(null)}>Anuluj</button></header>
              <p className="block-user-summary"><strong>Kategoria:</strong> {selectedReport.reasonCategoryLabel || reportCategoryLabels[selectedReport.reasonCategory || 'other']}</p>
              <p className="block-user-summary"><strong>Powód:</strong> {selectedReport.reason}</p>
              {selectedReport.contentPreview && <blockquote>{selectedReport.contentPreview}</blockquote>}
              {selectedReport.contentUrl && <a className="report-content-link" href={selectedReport.contentUrl} target="_blank" rel="noreferrer">Otwórz zgłoszone multimedia</a>}
              <label className="block-duration-label">Decyzja
                <select value={reportDecision} onChange={(event) => setReportDecision(event.target.value as NonNullable<ModerationReport['decision']>)}>
                  <option value="dismiss">Odrzuć zgłoszenie</option>
                  <option value="remove_content" disabled={selectedReport.targetType === 'profile'}>Usuń zgłoszoną treść</option>
                  <option value="warn">Przekaż ostrzeżenie</option>
                  <option value="block_account" disabled={!can('users.block')}>Zablokuj konto autora</option>
                </select>
              </label>
              {reportDecision === 'block_account' && <label className="block-duration-label">Czas blokady
                <select value={reportBlockDuration} onChange={(event) => setReportBlockDuration(Number(event.target.value))}>
                  <option value={7}>7 dni</option><option value={30}>30 dni</option><option value={90}>3 miesiące</option>
                </select>
              </label>}
              <label className="block-duration-label">Uzasadnienie decyzji (opcjonalnie)
                <textarea value={reportDecisionNote} onChange={(event) => setReportDecisionNote(event.target.value)} maxLength={500} rows={3} placeholder="Notatka zostanie dołączona do powiadomienia." />
              </label>
              <div className="report-notification-options">
                <label className="checkbox-label"><input type="checkbox" checked={notifyReporter} onChange={(event) => setNotifyReporter(event.target.checked)} />Powiadom osobę zgłaszającą</label>
                <label className="checkbox-label"><input type="checkbox" checked={notifyTarget} onChange={(event) => setNotifyTarget(event.target.checked)} />Powiadom osobę, której dotyczy zgłoszenie</label>
              </div>
              <button className="primary-button" type="submit" disabled={submitting || (reportDecision === 'block_account' && !can('users.block'))}><CheckCircle2 size={16} />{submitting ? 'Zapisywanie…' : 'Zapisz decyzję'}</button>
            </form>
          </div>
        )}
        {section === 'announcements' && (
          <section className="announcement-section">
            <div className="section-toolbar"><div><h2>Komunikaty dla użytkowników</h2><p>Opublikowane komunikaty pojawiają się na stronie YouTopic.</p></div></div>
            {can('announcements.manage') && <form className="announcement-form" onSubmit={createAnnouncement}>
              <label>Tytuł
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="np. Planowana przerwa techniczna" />
              </label>
              <label>Treść komunikatu
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={4} required placeholder="Wpisz wiadomość widoczną dla zalogowanych użytkowników…" />
              </label>
              <div className="schedule-options">
                <label className="checkbox-label"><input type="checkbox" checked={publishImmediately} onChange={(event) => setPublishImmediately(event.target.checked)} />Opublikuj natychmiast</label>
                {!publishImmediately && <label>Data i godzina rozpoczęcia
                  <input type="datetime-local" value={scheduledStart} min={toLocalDateTimeValue(Date.now())} onChange={(event) => setScheduledStart(event.target.value)} required />
                </label>}
                <label className="checkbox-label"><input type="checkbox" checked={hasEndTime} onChange={(event) => setHasEndTime(event.target.checked)} />Ustaw datę zakończenia</label>
                {hasEndTime && <label>Data i godzina zakończenia
                  <input type="datetime-local" value={scheduledEnd} min={!publishImmediately ? scheduledStart : toLocalDateTimeValue(Date.now())} onChange={(event) => setScheduledEnd(event.target.value)} required />
                </label>}
              </div>
              <div className="form-footer"><small>{publishImmediately ? 'Komunikat pojawi się od razu u zalogowanych użytkowników.' : 'Komunikat pojawi się automatycznie o wybranej godzinie.'}</small><button className="primary-button" type="submit" disabled={submitting}><Megaphone size={16} />{publishImmediately ? 'Opublikuj teraz' : 'Zaplanuj komunikat'}</button></div>
            </form>}
            {can('announcements.view') && <div className="announcement-list">
              <h3>Historia komunikatów</h3>
              {announcements.length === 0 && <p className="empty-state">Nie opublikowano jeszcze komunikatów.</p>}
              {announcements.map((announcement) => (
                <article className={`announcement-card ${announcement.status === 'disabled' || announcement.status === 'ended' ? 'inactive' : ''}`} key={announcement.id}>
                  <div className="announcement-card-heading"><div><span className={`status-pill ${announcement.status === 'active' ? 'active' : announcement.status === 'scheduled' ? 'scheduled' : announcement.status === 'ended' ? 'ended' : 'pending'}`}>{announcement.status === 'active' ? 'Aktywny' : announcement.status === 'scheduled' ? 'Zaplanowany' : announcement.status === 'ended' ? 'Zakończony' : 'Wyłączony'}</span><small>{formatDate(announcement.createdAt)} · {announcement.createdBy}</small></div>
                    {announcement.active && <button className="icon-action" onClick={() => deactivateAnnouncement(announcement)} aria-label={`Wyłącz komunikat: ${announcement.title}`} title="Wyłącz komunikat"><Trash2 size={16} /></button>}</div>
                  <h4>{announcement.title}</h4><p>{announcement.message}</p>
                  <div className="announcement-schedule"><span>Start: {formatDate(announcement.startsAt ?? announcement.createdAt)}</span><span>Zakończenie: {formatDate(announcement.endsAt)}</span></div>
                </article>
              ))}
            </div>}
          </section>
        )}
        {section === 'admins' && (
          <section className="admin-management-section">
            <div className="section-toolbar">
              <div><h2>Konta administratorów</h2><p>Rangę i uprawnienia może zmieniać wyłącznie Super Administrator.</p></div>
            </div>
            {currentAdmin?.isSuperAdmin && (
              <form className="announcement-form admin-editor" onSubmit={saveAdmin}>
                <div className="admin-editor-heading">
                  <div><h3>{editingAdminId ? 'Edytuj konto administratora' : 'Dodaj administratora'}</h3><p>Logowanie odbywa się przez e-mail i hasło przypisane do panelu.</p></div>
                  {editingAdminId && <button className="secondary-button" type="button" onClick={resetAdminForm}>Anuluj edycję</button>}
                </div>
                <div className="admin-form-grid">
                  <label>Nazwa wyświetlana
                    <input value={adminName} onChange={(event) => setAdminName(event.target.value)} maxLength={120} required />
                  </label>
                  <label>E-mail logowania
                    <input type="email" autoComplete="username" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} required />
                  </label>
                  <label>Ranga
                    <input list="admin-rank-options" value={customRank || adminRank} disabled={Boolean(editingAdminId && admins.find((admin) => admin.id === editingAdminId)?.isSuperAdmin)} onChange={(event) => {
                      selectAdminRank(event.target.value)
                    }} placeholder="Wpisz własną rangę" required />
                    <datalist id="admin-rank-options">{predefinedRanks.map((rank) => <option value={rank} key={rank} />)}</datalist>
                    {!editingAdminId && (rankPermissionTemplates[customRank || adminRank]?.length ?? 0) > 0 && <small>Uprawnienia zapisane dla tej rangi zostaną przypisane automatycznie.</small>}
                  </label>
                  <label>{editingAdminId ? 'Nowe hasło (opcjonalnie)' : 'Hasło początkowe'}
                    <input type="password" autoComplete="new-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} minLength={editingAdminId ? 12 : 12} maxLength={256} required={!editingAdminId} />
                  </label>
                </div>
                {!admins.find((admin) => admin.id === editingAdminId)?.isSuperAdmin && (
                  <fieldset className="permission-fieldset">
                    <legend>Uprawnienia</legend>
                    <div className="permission-grid">
                      {permissionOptions.map((permission) => (
                        <label className="checkbox-label" key={permission.id}>
                          <input type="checkbox" checked={adminPermissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} />
                          {permission.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {editingAdminId && admins.find((admin) => admin.id === editingAdminId)?.isSuperAdmin && <p className="data-note">Ranga i pełne uprawnienia Super Administratora są niezmienne. Możesz zmienić własny e-mail logowania, nazwę oraz hasło.</p>}
                <div className="form-footer"><small>Hasło musi mieć co najmniej 12 znaków.</small><button className="primary-button" type="submit" disabled={submitting}><UserPlus size={16} />{submitting ? 'Zapisywanie…' : editingAdminId ? 'Zapisz zmiany' : 'Utwórz konto'}</button></div>
              </form>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Administrator</th><th>Ranga</th><th>Uprawnienia</th><th>Dodano</th>{currentAdmin?.isSuperAdmin && <th>Akcje</th>}</tr></thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id}>
                      <td><strong>{admin.name}</strong><small>{admin.email}{admin.id === currentAdmin?.id ? ' · Twoje konto' : ''}</small></td>
                      <td>{admin.rank}</td>
                      <td>{admin.isSuperAdmin ? 'Pełny dostęp' : admin.permissions.map((permission) => permissionOptions.find((option) => option.id === permission)?.label || permission).join(', ') || 'Brak'}</td>
                      <td>{formatDate(admin.createdAt)}</td>
                      {currentAdmin?.isSuperAdmin && <td className="admin-actions">
                        <button className="row-action" onClick={() => startAdminEdit(admin)}><Pencil size={14} />Edytuj</button>
                        {!admin.isSuperAdmin && <button className="row-action" onClick={() => deleteAdmin(admin)}><Trash2 size={14} />Usuń</button>}
                      </td>}
                    </tr>
                  ))}
                  {admins.length === 0 && <tr><td className="empty-cell" colSpan={currentAdmin?.isSuperAdmin ? 5 : 4}>Nie znaleziono kont administratorów.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return <article className="stat-card"><span className="stat-icon">{icon}</span><p>{label}</p><strong>{value.toLocaleString('pl-PL')}</strong></article>
}

function HealthCard({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return <article className={`health-card ${healthy ? 'healthy' : 'unhealthy'}`}><span><i />{label}</span><strong>{value}</strong></article>
}

export default AdminApp
