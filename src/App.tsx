import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import {
  Bookmark,
  BadgeCheck,
  BellOff,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Compass,
  Copy,
  Eye,
  Flag,
  Heart,
  Home,
  Image,
  LifeBuoy,
  LockKeyhole,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  Minimize2,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Square,
  Trash2,
  UsersRound,
  Video,
  X,
  Bell,
} from 'lucide-react'

type Person = {
  id?: string
  profileVerified?: boolean
  name: string
  firstName?: string
  middleName?: string
  lastName?: string
  secondLastName?: string
  handle: string
  nickname?: string
  location?: string
  bio?: string
  contactPhone?: string
  secondContactPhone?: string
  avatar: string
  coverImage?: string
  socialLinks?: Partial<Record<SocialPlatform, string>>
  profileVisibility?: ProfileVisibilitySettings
  socialPrivacy?: SocialPrivacy
  gender?: Gender
  online?: boolean
  crewMembers: number
  crewSize: number
}

type Gender = 'female' | 'male' | 'other' | 'undisclosed'

type SocialPlatform = 'Instagram' | 'TikTok' | 'YouTube' | 'Facebook' | 'X' | 'LinkedIn' | 'Twitch'
type SocialProfileLink = { id: number; platform: SocialPlatform; url: string }
type ProfileAudience = 'public' | 'crew' | 'private'
type SocialPrivacy = { profileAudience: ProfileAudience; crewInviteAudience: 'everyone' | 'nobody' }
type ProfileVisibilitySettings = {
  location: ProfileAudience
  bio: ProfileAudience
  contactPhone: ProfileAudience
  secondContactPhone: ProfileAudience
  socialLinks: ProfileAudience
  crewMembers: ProfileAudience
  crewSize: ProfileAudience
}

const socialPlatforms: SocialPlatform[] = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'LinkedIn', 'Twitch']
const defaultProfileVisibility: ProfileVisibilitySettings = {
  location: 'public',
  bio: 'public',
  contactPhone: 'private',
  secondContactPhone: 'private',
  socialLinks: 'public',
  crewMembers: 'public',
  crewSize: 'public',
}

type Post = {
  id: number
  createdAt?: number
  serverBacked?: boolean
  author: Person
  time: string
  topic: string
  text: string
  image?: string
  video?: string
  likes: number
  comments: Array<string | PostComment>
  boosts: number
  boostedBy?: string[]
  liked: boolean
  saved: boolean
  bandId?: string
  seenBy?: string[]
  seenPeople?: Person[]
  externalUrl?: string
  pinnedAt?: number
  sharedFrom?: { author: Person; topic: string; postId: number }
  profileTarget?: Person
}

type GalleryPhoto = {
  id: string
  url: string
  caption: string
  createdAt: number
  sourcePostId?: string
  mediaId?: string
  albumId?: string
}

type GalleryAlbum = {
  id: string
  name: string
  createdAt: number
  photos: GalleryPhoto[]
}

type PostComment = {
  id: number
  author: Person
  text?: string
  audioData?: string
  audioUrl?: string
  audioType?: string
  audioDuration?: number
  likes?: number
  likedBy?: string[]
  replyToId?: number
  legacy?: boolean
}

type ReportNotification = {
  id: string
  targetType: string
  message: string
  createdAt: number
}

type SocialNotification = {
  id: string
  actor: Person | null
  type: 'like' | 'boost' | 'comment' | 'comment_like' | 'crew_invitation' | 'crew_accepted' | 'chat_message'
  message: string
  postId?: string
  chatHandle?: string
  crewInvitationId?: string
  createdAt: number
  readAt: number | null
}

type PostCursor = { before: number; beforeId: number }

type ModeratedItem = {
  targetType: string
  targetId: string
  targetUserId: string
}

function reportTypeName(targetType: string) {
  return ({ profile: 'profil', post: 'post', photo: 'zdjęcie', video: 'wideo', comment: 'komentarz', message: 'wiadomość' } as Record<string, string>)[targetType] ?? 'treść'
}

type ReportReasonCategory = 'terms_violation' | 'harassment' | 'hate' | 'violence' | 'spam' | 'privacy' | 'impersonation' | 'sexual_content' | 'other'

const reportCategoryOptions: Array<{ id: ReportReasonCategory; label: string }> = [
  { id: 'terms_violation', label: 'Narusza regulamin' },
  { id: 'harassment', label: 'Nękanie' },
  { id: 'hate', label: 'Mowa nienawiści' },
  { id: 'violence', label: 'Przemoc / groźby' },
  { id: 'spam', label: 'Spam / oszustwo' },
  { id: 'privacy', label: 'Naruszenie prywatności' },
  { id: 'impersonation', label: 'Podszywanie się' },
  { id: 'sexual_content', label: 'Treści seksualne' },
  { id: 'other', label: 'Inne' },
]

type Announcement = {
  id: string
  title: string
  message: string
  createdAt: number
}

type Band = {
  id: string
  name: string
  adminHandle: string
  memberHandles: string[]
}

type BandStory = {
  id: number
  bandId: string
  author: Person
  text: string
  media?: string
  mediaKind?: 'image' | 'video'
  expiresAt: number
  seenBy: string[]
  seenPeople?: Person[]
}

type PersonalStory = Omit<BandStory, 'bandId'>

const storageKeys = {
  bandStories: 'youtopic-band-stories',
  personalStories: 'youtopic-personal-stories',
  users: 'youtopic-users',
  followedTopics: (handle: string) => `youtopic-followed-topics-${handle}`,
  dismissedAnnouncements: 'youtopic-dismissed-announcements',
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function saveStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

type ChatMessage = {
  id: number | string
  author: Person
  scope: 'public' | 'room'
  recipientHandle?: string
  text: string
  time: string
  createdAt: number
}

const phoneDialCodes = [
  { country: 'PL', dialCode: '+48', label: 'Polska (+48)' },
  { country: 'GB', dialCode: '+44', label: 'Wielka Brytania (+44)' },
  { country: 'DE', dialCode: '+49', label: 'Niemcy (+49)' },
  { country: 'UA', dialCode: '+380', label: 'Ukraina (+380)' },
  { country: 'CZ', dialCode: '+420', label: 'Czechy (+420)' },
  { country: 'SK', dialCode: '+421', label: 'Słowacja (+421)' },
  { country: 'LT', dialCode: '+370', label: 'Litwa (+370)' },
  { country: 'FR', dialCode: '+33', label: 'Francja (+33)' },
  { country: 'ES', dialCode: '+34', label: 'Hiszpania (+34)' },
  { country: 'IT', dialCode: '+39', label: 'Włochy (+39)' },
  { country: 'NL', dialCode: '+31', label: 'Holandia (+31)' },
  { country: 'SE', dialCode: '+46', label: 'Szwecja (+46)' },
  { country: 'NO', dialCode: '+47', label: 'Norwegia (+47)' },
  { country: 'US', dialCode: '+1', label: 'Stany Zjednoczone (+1)' },
  { country: 'CA', dialCode: '+1', label: 'Kanada (+1)' },
]

function formatPostTime(createdAt?: number) {
  if (!createdAt || !Number.isFinite(createdAt)) return 'Data niedostępna'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(createdAt)
}

type CrewInvitation = {
  id: string
  from: Person
  to: Person
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  respondedAt?: number
}

type CrewLink = [string, string]
type NavigationSnapshot = {
  youtopic: true
  guard?: boolean
  view: View
  homeTab: 'board' | 'chat' | 'band'
  chatMode: 'public' | 'room'
  activeChatHandle: string
  selectedTopic: string
  profileHandle: string
  search: string
}

type View = 'home' | 'explore' | 'topiki' | 'crew' | 'band' | 'notifications' | 'support' | 'saved' | 'profile'

type SupportTicket = {
  id: string
  subject: string
  category: 'account' | 'technical' | 'security' | 'idea' | 'other'
  status: 'open' | 'in_progress' | 'resolved'
  messages: Array<{ id: string; authorType: 'user' | 'admin'; authorName: string; message: string; createdAt: number }>
  createdAt: number
  updatedAt: number
}

const people: Person[] = [
  { name: 'Olek Wiśniewski', handle: 'olek.w', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=faces', gender: 'male', online: true, crewMembers: 0, crewSize: 0 },
  { name: 'Zosia Kowalska', handle: 'zosia.k', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop&crop=faces', gender: 'female', online: true, crewMembers: 0, crewSize: 0 },
  { name: 'Michał Zieliński', handle: 'michal.z', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop&crop=faces', gender: 'male', crewMembers: 0, crewSize: 0 },
  { name: 'Lena Wójcik', handle: 'lena.w', avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100&h=100&fit=crop&crop=faces', gender: 'female', online: true, crewMembers: 0, crewSize: 0 },
  { name: 'Ewa Kaczmarek', handle: 'ewa.k', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces', gender: 'female', crewMembers: 0, crewSize: 0 },
]

function crewPairKey(firstHandle: string, secondHandle: string) {
  return [firstHandle, secondHandle].sort().join('::')
}

function normalizeTopicName(topic: string) {
  return topic.trim().replace(/^#+\s*/, '').replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL')
}

function topicCountLabel(count: number, forms: [string, string, string]) {
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (count === 1) return `${count} ${forms[0]}`
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) return `${count} ${forms[1]}`
  return `${count} ${forms[2]}`
}

function mergePeople(...groups: Person[][]) {
  return [...new Map(groups.flat().map((person) => [person.handle, person])).values()]
}

async function resizeProfileImage(file: File, maxDimension: number) {
  if (!file.type.startsWith('image/')) throw new Error('Wybierz plik graficzny.')
  if (file.size > 12 * 1024 * 1024) throw new Error('Zdjęcie może mieć maksymalnie 12 MB przed zmniejszeniem.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Nie udało się przygotować zdjęcia.')
    for (const dimensionScale of [1, 0.9, 0.8]) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale * dimensionScale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale * dimensionScale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.84, 0.8, 0.76, 0.72]) {
        const image = canvas.toDataURL('image/jpeg', quality)
        if (image.length <= 900_000) return image
      }
    }
    throw new Error('Zdjęcie jest nadal zbyt duże. Wybierz mniejszy plik.')
  } finally {
    bitmap.close()
  }
}

function normalizePostComments(post: Post): PostComment[] {
  return post.comments.map((comment, index) => typeof comment === 'string'
    ? { id: -(post.id * 1000 + index + 1), author: people[1], text: comment, likes: 0, likedBy: [], legacy: true }
    : { likes: 0, likedBy: [], ...comment })
}

function normalizeExternalUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function presenceLabel(person: Person) {
  if (!person.online) return 'Jest niedostępny'
  if (person.gender === 'female') return 'Aktywna teraz'
  if (person.gender === 'male') return 'Aktywny teraz'
  return 'Jest online'
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Tablica', icon: Home },
  { id: 'explore', label: 'Odkrywaj', icon: Compass },
  { id: 'topiki', label: 'Topiki', icon: Clapperboard },
  { id: 'crew', label: 'Ekipa', icon: UsersRound },
  { id: 'band', label: 'Banda', icon: LockKeyhole },
  { id: 'notifications', label: 'Powiadomienia', icon: Bell },
  { id: 'support', label: 'Centrum pomocy', icon: LifeBuoy },
  { id: 'saved', label: 'Zapisane', icon: Bookmark },
]

const dateLabel = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date()).toLocaleUpperCase('pl')

function App() {
  const [currentUser, setCurrentUser] = useState<Person | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let active = true
    const loadingFallback = window.setTimeout(() => {
      if (active) setAuthReady(true)
    }, 900)
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() as Promise<{ user: Person }> : null)
      .then((result) => {
        if (!active) return
        if (result?.user) setCurrentUser(result.user)
        setAuthReady(true)
      })
      .catch(() => { if (active) setAuthReady(true) })
    return () => {
      active = false
      window.clearTimeout(loadingFallback)
    }
  }, [])

  if (!authReady) return <main className="auth-loading"><img src="/youtopic-mark.svg" alt="" /><span>Ładowanie YouTopic...</span></main>
  if (!currentUser) return <AuthScreen onAuthenticated={setCurrentUser} />

  return <SocialApp currentUser={currentUser} onCurrentUserUpdate={setCurrentUser} onLogout={async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setCurrentUser(null)
  }} />
}

function SocialApp({ currentUser, onCurrentUserUpdate, onLogout }: { currentUser: Person; onCurrentUserUpdate: (person: Person) => void; onLogout: () => void }) {
  const [view, setView] = useState<View>('home')
  const [homeTab, setHomeTab] = useState<'board' | 'chat' | 'band'>('board')
  const [feedMode, setFeedMode] = useState<'for-you' | 'following'>(() => loadStored<string>(`youtopic-feed-mode-${currentUser.handle}`, 'for-you') === 'following' ? 'following' : 'for-you')
  const [selectedTopic, setSelectedTopic] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError] = useState('')
  const [postsRetryKey, setPostsRetryKey] = useState(0)
  const [postsCursor, setPostsCursor] = useState<PostCursor | null>(null)
  const [hasMorePosts, setHasMorePosts] = useState(false)
  const [loadingMorePosts, setLoadingMorePosts] = useState(false)
  const [postsPageError, setPostsPageError] = useState('')
  const [pendingPostNavigationId, setPendingPostNavigationId] = useState<number | null>(null)
  const [allUsers, setAllUsers] = useState(() => mergePeople(people, loadStored<Person[]>(storageKeys.users, []), [currentUser]))
  const [crewLinks, setCrewLinks] = useState<CrewLink[]>([])
  const [bands, setBands] = useState<Band[]>([])
  const [activeBandId, setActiveBandId] = useState('')
  const [isCreatingBand, setIsCreatingBand] = useState(false)
  const [bandName, setBandName] = useState('')
  const [bandTopic, setBandTopic] = useState('')
  const [bandLink, setBandLink] = useState('')
  const [selectedBandHandles, setSelectedBandHandles] = useState<string[]>([])
  const [shareBandPostId, setShareBandPostId] = useState<number | null>(null)
  const [bandStories, setBandStories] = useState(() => loadStored<BandStory[]>(storageKeys.bandStories, []).filter((story) => story.expiresAt > Date.now()))
  const [personalStories, setPersonalStories] = useState(() => loadStored<PersonalStory[]>(storageKeys.personalStories, []).filter((story) => story.expiresAt > Date.now()))
  const [storyDraft, setStoryDraft] = useState('')
  const [storyMedia, setStoryMedia] = useState<{ url: string; kind: 'image' | 'video' } | null>(null)
  const [isComposingPersonalStory, setIsComposingPersonalStory] = useState(false)
  const [personalStoryDraft, setPersonalStoryDraft] = useState('')
  const [personalStoryMedia, setPersonalStoryMedia] = useState('')
  const [personalStoryError, setPersonalStoryError] = useState('')
  const [activeStoryKey, setActiveStoryKey] = useState<string | null>(null)
  const [storyProgress, setStoryProgress] = useState(0)
  const [clockNow, setClockNow] = useState(Date.now())
  const [openViewers, setOpenViewers] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [draftTopic, setDraftTopic] = useState('')
  const [isChoosingDraftTopic, setIsChoosingDraftTopic] = useState(false)
  const [media, setMedia] = useState<{ url: string; kind: 'image' | 'video'; name: string; file: File } | null>(null)
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({})
  const [replyingTo, setReplyingTo] = useState<Record<number, PostComment | null>>({})
  const [recordingPostId, setRecordingPostId] = useState<number | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceDraft, setVoiceDraft] = useState<{ postId: number; url: string; audioData: string; audioType: string; duration: number; blob: Blob } | null>(null)
  const [openComments, setOpenComments] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [platformUsers, setPlatformUsers] = useState<Person[]>([currentUser])
  const [userSearchResults, setUserSearchResults] = useState<Person[]>([])
  const [profile, setProfile] = useState<Person>(currentUser)
  const [profileTab, setProfileTab] = useState<'posts' | 'gallery'>('posts')
  const [profileBoostTarget, setProfileBoostTarget] = useState<Person | null>(null)
  const [reportDraft, setReportDraft] = useState<{
    targetType: 'profile' | 'post' | 'photo' | 'video' | 'comment' | 'message'
    targetId: string
    targetUserId: string
    targetName: string
    contentPreview: string
    contentUrl: string
    reasonCategory: ReportReasonCategory
    reason: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [reportNotifications, setReportNotifications] = useState<ReportNotification[]>([])
  const [socialNotifications, setSocialNotifications] = useState<SocialNotification[]>([])
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([])
  const [supportSubject, setSupportSubject] = useState('')
  const [supportCategory, setSupportCategory] = useState<SupportTicket['category']>('account')
  const [supportMessage, setSupportMessage] = useState('')
  const [supportBusy, setSupportBusy] = useState(false)
  const [moderatedItems, setModeratedItems] = useState<ModeratedItem[]>([])
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>(() => loadStored<string[]>(storageKeys.dismissedAnnouncements, []))
  const [activeChatHandle, setActiveChatHandle] = useState('')
  const [mutedChatHandles, setMutedChatHandles] = useState<string[]>([])
  const [blockedUsers, setBlockedUsers] = useState<Person[]>([])
  const [chatMode, setChatMode] = useState<'public' | 'room'>('public')
  const [roomMinimized, setRoomMinimized] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [crewInvitations, setCrewInvitations] = useState<CrewInvitation[]>([])
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>(() => loadStored<string[]>(`youtopic-dismissed-suggestions-${currentUser.handle}`, []))
  const [chatDraft, setChatDraft] = useState('')
  const [followedTopics, setFollowedTopics] = useState(() => loadStored<string[]>(storageKeys.followedTopics(currentUser.handle), []))
  const [activeTopikiIndex, setActiveTopikiIndex] = useState(0)
  const [autoAdvanceTopiki, setAutoAdvanceTopiki] = useState(() => loadStored<boolean>(`youtopic-auto-advance-topiki-${currentUser.handle}`, false))
  const [pendingTopikiPostId, setPendingTopikiPostId] = useState<number | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState(currentUser.nickname ?? currentUser.handle)
  const [firstNameDraft, setFirstNameDraft] = useState(currentUser.firstName ?? currentUser.name.split(' ')[0] ?? '')
  const [middleNameDraft, setMiddleNameDraft] = useState(currentUser.middleName ?? '')
  const [lastNameDraft, setLastNameDraft] = useState(currentUser.lastName ?? currentUser.name.split(' ').slice(1).join(' '))
  const [secondLastNameDraft, setSecondLastNameDraft] = useState(currentUser.secondLastName ?? '')
  const [profileError, setProfileError] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [locationDraft, setLocationDraft] = useState(currentUser.location ?? '')
  const [contactPhoneDraft, setContactPhoneDraft] = useState(currentUser.contactPhone ?? '')
  const [secondContactPhoneDraft, setSecondContactPhoneDraft] = useState(currentUser.secondContactPhone ?? '')
  const [bioDraft, setBioDraft] = useState(currentUser.bio ?? '')
  const [avatarDraft, setAvatarDraft] = useState(currentUser.avatar)
  const [coverImageDraft, setCoverImageDraft] = useState(currentUser.coverImage ?? '')
  const [socialLinksDraft, setSocialLinksDraft] = useState<SocialProfileLink[]>(() => Object.entries(currentUser.socialLinks ?? {}).map(([platform, url], index) => ({ id: index, platform: platform as SocialPlatform, url })))
  const [profileVisibilityDraft, setProfileVisibilityDraft] = useState<ProfileVisibilitySettings>(() => ({ ...defaultProfileVisibility, ...currentUser.profileVisibility, contactPhone: currentUser.profileVisibility?.contactPhone ?? 'private', secondContactPhone: currentUser.profileVisibility?.secondContactPhone ?? 'private' }))
  const [socialPrivacyDraft, setSocialPrivacyDraft] = useState<SocialPrivacy>(() => ({ profileAudience: currentUser.socialPrivacy?.profileAudience ?? 'public', crewInviteAudience: currentUser.socialPrivacy?.crewInviteAudience ?? 'everyone' }))
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const linkedProfileHandledRef = useRef(false)
  const storyFileInput = useRef<HTMLInputElement>(null)
  const storyTextInput = useRef<HTMLInputElement>(null)
  const personalStoryFileInput = useRef<HTMLInputElement>(null)
  const topikiFeedRef = useRef<HTMLDivElement>(null)
  const feedSentinelRef = useRef<HTMLDivElement>(null)
  const loadingMorePostsRef = useRef(false)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStartedAtRef = useRef(0)
  const voiceCancelledRef = useRef(false)
  const storyTouchStartXRef = useRef<number | null>(null)
  const allUsersRef = useRef(allUsers)
  allUsersRef.current = allUsers
  const navigationRef = useRef<NavigationSnapshot>({
    youtopic: true,
    view,
    homeTab,
    chatMode,
    activeChatHandle,
    selectedTopic,
    profileHandle: profile.handle,
    search,
  })

  useEffect(() => {
    let active = true
    const refreshAnnouncements = async () => {
      try {
        const response = await fetch('/api/announcements', { credentials: 'include', cache: 'no-store' })
        const result = await response.json() as { announcements?: Announcement[]; error?: string }
        if (!response.ok) throw new Error(result.error || 'Nie udało się pobrać komunikatów.')
        if (active) setAnnouncements(result.announcements ?? [])
      } catch (error: unknown) {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać komunikatów.')
      }
    }
    void refreshAnnouncements()
    const refreshTimer = window.setInterval(() => { void refreshAnnouncements() }, 15_000)
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') void refreshAnnouncements() }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])

  useEffect(() => {
    let active = true
    let hasLoaded = false
    setPostsLoading(true)
    setPostsError('')
    setPostsPageError('')
    setPostsCursor(null)
    setHasMorePosts(false)
    const refreshPosts = async () => {
      try {
        const result = await authRequest<{ posts: Post[]; hasMore: boolean; nextCursor: PostCursor | null }>('/api/posts?limit=30')
        if (!active) return
        setPosts((current) => {
          const freshIds = new Set(result.posts.map((post) => post.id))
          return [...result.posts, ...current.filter((post) => !freshIds.has(post.id))]
            .sort((first, second) => (second.createdAt ?? second.id) - (first.createdAt ?? first.id))
        })
        if (!hasLoaded) {
          setPostsCursor(result.nextCursor)
          setHasMorePosts(result.hasMore)
          setPostsPageError('')
        }
        hasLoaded = true
        setPostsLoading(false)
        setPostsError('')
      } catch (error: unknown) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Nie udało się pobrać postów z serwera.'
          if (!hasLoaded) setPostsLoading(false)
          setPostsError(message)
        }
      }
    }
    void refreshPosts()
    const timer = window.setInterval(() => { void refreshPosts() }, 15_000)
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') void refreshPosts() }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [currentUser.id, postsRetryKey])

  useEffect(() => {
    const target = feedSentinelRef.current
    if (!target || !hasMorePosts || postsLoading || loadingMorePosts || postsPageError
      || view === 'notifications' || view === 'support' || (view === 'home' && homeTab === 'chat')) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || !postsCursor || loadingMorePostsRef.current) return
      loadingMorePostsRef.current = true
      setLoadingMorePosts(true)
      const query = new URLSearchParams({ limit: '30', before: String(postsCursor.before), beforeId: String(postsCursor.beforeId) })
      authRequest<{ posts: Post[]; hasMore: boolean; nextCursor: PostCursor | null }>(`/api/posts?${query}`)
        .then((result) => {
          setPosts((current) => {
            const knownIds = new Set(current.map((post) => post.id))
            return [...current, ...result.posts.filter((post) => !knownIds.has(post.id))]
              .sort((first, second) => (second.createdAt ?? second.id) - (first.createdAt ?? first.id))
          })
          setPostsCursor(result.nextCursor)
          setHasMorePosts(result.hasMore)
          setPostsPageError('')
        })
        .catch((error: unknown) => setPostsPageError(error instanceof Error ? error.message : 'Nie udało się załadować kolejnych wpisów.'))
        .finally(() => {
          loadingMorePostsRef.current = false
          setLoadingMorePosts(false)
        })
    }, { rootMargin: '500px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMorePosts, homeTab, loadingMorePosts, postsCursor, postsLoading, postsPageError, view])

  useEffect(() => {
    if (view !== 'support') return
    let active = true
    authRequest<{ tickets: SupportTicket[] }>('/api/support/tickets')
      .then(({ tickets }) => { if (active) setSupportTickets(tickets) })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać spraw pomocy.')
      })
    return () => { active = false }
  }, [view])

  useEffect(() => {
    let active = true
    const refreshModeration = async () => {
      try {
        const [notificationResult, moderatedResult] = await Promise.all([
          authRequest<{ notifications: ReportNotification[] }>('/api/report-notifications'),
          authRequest<{ items: ModeratedItem[] }>('/api/moderation/removed-content'),
        ])
        if (active) {
          setReportNotifications(notificationResult.notifications)
          setModeratedItems(moderatedResult.items)
        }
      } catch (moderationError) {
        if (active) setNotice(moderationError instanceof Error ? moderationError.message : 'Nie udało się pobrać informacji o moderacji.')
      }
    }
    void refreshModeration()
    const timer = window.setInterval(() => { void refreshModeration() }, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (recordingPostId === null) return
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - voiceStartedAtRef.current) / 1000)
      setRecordingSeconds(Math.min(elapsed, 60))
      if (elapsed >= 60 && voiceRecorderRef.current?.state === 'recording') {
        voiceRecorderRef.current.stop()
        setNotice('Nagranie zatrzymano po 60 sekundach')
        window.setTimeout(() => setNotice(''), 2600)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [recordingPostId])

  const crewHandles = allUsers.filter((person) => person.handle !== currentUser.handle && crewLinks.some((link) => crewPairKey(link[0], link[1]) === crewPairKey(currentUser.handle, person.handle))).map((person) => person.handle)
  const isBlockedUser = (person: Person) => Boolean(person.id && blockedUsers.some((user) => user.id === person.id))
  const chatContacts = allUsers.filter((person) => person.handle !== currentUser.handle && !isBlockedUser(person))
  const activeChat = chatContacts.find((person) => person.handle === activeChatHandle) ?? null
  const isMessageModerated = (message: ChatMessage) => moderatedItems.some((item) =>
    item.targetType === 'message' && item.targetId === `message:${message.id}` && item.targetUserId === message.author.id)
  const publicChatMessages = chatMessages.filter((message) => message.scope === 'public' && !isMessageModerated(message) && !isBlockedUser(message.author))
  const roomMessages = chatMessages.filter((message) => message.scope === 'room' && !isMessageModerated(message) && activeChat && ((message.author.handle === currentUser.handle && message.recipientHandle === activeChat.handle) || (message.author.handle === activeChat.handle && message.recipientHandle === currentUser.handle)))
  const incomingCrewInvitations = crewInvitations.filter((invitation) => invitation.to.handle === currentUser.handle && invitation.status === 'pending')
  const unreadNotificationCount = socialNotifications.filter((notification) => !notification.readAt).length
  const unreadChatCounts = socialNotifications.reduce((counts, notification) => {
    if (notification.type === 'chat_message' && !notification.readAt && notification.chatHandle) {
      counts.set(notification.chatHandle, (counts.get(notification.chatHandle) ?? 0) + 1)
    }
    return counts
  }, new Map<string, number>())
  const suppressedSuggestionHandles = crewInvitations.filter((invitation) => invitation.from.handle === currentUser.handle && (invitation.status === 'pending' || (invitation.status === 'declined' && clockNow - (invitation.respondedAt ?? 0) < 24 * 60 * 60 * 1000))).map((invitation) => invitation.to.handle)
  const activeRoomInvitation = activeChat && crewInvitations.find((invitation) => invitation.status === 'pending' && crewPairKey(invitation.from.handle, invitation.to.handle) === crewPairKey(currentUser.handle, activeChat.handle))
  const accessibleBands = bands.filter((item) => item.adminHandle === currentUser.handle || item.memberHandles.includes(currentUser.handle))
  const profileBoostCounts = posts.reduce((counts, post) => {
    if (post.profileTarget) counts.set(post.profileTarget.handle, (counts.get(post.profileTarget.handle) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
  const suggestedProfiles = platformUsers
    .filter((person) => person.handle !== currentUser.handle && !isBlockedUser(person) && !crewHandles.includes(person.handle) && !dismissedSuggestions.includes(person.handle) && !suppressedSuggestionHandles.includes(person.handle))
    .sort((first, second) => (profileBoostCounts.get(second.handle) ?? 0) - (profileBoostCounts.get(first.handle) ?? 0))
  const band = accessibleBands.find((item) => item.id === activeBandId) ?? accessibleBands[0] ?? null
  const bandMembers = band ? allUsers.filter((person) => band.memberHandles.includes(person.handle)) : []
  const bandPosts = band ? posts.filter((post) => post.bandId === band.id) : []
  const currentBandStories = useMemo(() => bandStories.filter((story) => story.bandId === band?.id && story.expiresAt > clockNow), [bandStories, band?.id, clockNow])
  const currentPersonalStories = useMemo(() => personalStories.filter((story) => story.expiresAt > clockNow && (story.author.handle === currentUser.handle || crewHandles.includes(story.author.handle))), [clockNow, crewHandles, currentUser.handle, personalStories])
  const storyQueue = useMemo(() => [
    ...currentPersonalStories.map((story) => ({ key: `personal-${story.id}`, source: 'personal' as const, story })),
    ...currentBandStories.map((story) => ({ key: `band-${story.id}`, source: 'band' as const, story })),
  ].sort((first, second) => second.story.expiresAt - first.story.expiresAt), [currentBandStories, currentPersonalStories])
  const activeStoryIndex = storyQueue.findIndex((entry) => entry.key === activeStoryKey)
  const viewedStory = activeStoryIndex >= 0 ? storyQueue[activeStoryIndex].story : undefined

  useEffect(() => {
    if (!activeStoryKey) {
      setStoryProgress(0)
      return
    }
    if (activeStoryIndex < 0) {
      setActiveStoryKey(null)
      return
    }

    let elapsed = 0
    let previousTick = Date.now()
    setStoryProgress(0)
    const timer = window.setInterval(() => {
      const now = Date.now()
      if (document.visibilityState === 'visible') elapsed += now - previousTick
      previousTick = now
      setStoryProgress(Math.min((elapsed / 15000) * 100, 100))
      if (elapsed >= 15000) {
        window.clearInterval(timer)
        moveStory(1)
      }
    }, 100)

    return () => window.clearInterval(timer)
  }, [activeStoryIndex, activeStoryKey, storyQueue])

  useEffect(() => {
    if (!activeStoryKey) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveStoryKey(null)
      else if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveStory(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveStory(-1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeStoryKey, storyQueue])
  const unreadBandCount = accessibleBands.reduce((count, item) => {
    const itemPosts = item.id === band?.id ? bandPosts : posts.filter((post) => post.bandId === item.id)
    return count + itemPosts.filter((post) => post.author.handle !== currentUser.handle && !post.seenBy?.includes(currentUser.handle)).length
  }, 0)
  const isBandView = view === 'band' || (view === 'home' && homeTab === 'band')
  const showPostFeed = view === 'home'
    ? homeTab === 'board' || (homeTab === 'band' && Boolean(band) && !isCreatingBand)
    : view === 'band'
      ? Boolean(band) && !isCreatingBand
      : view === 'explore' || view === 'topiki' || view === 'crew' || view === 'saved' || view === 'profile'
  const showProfilePosts = view !== 'profile' || profileTab === 'posts'

  useEffect(() => {
    let active = true
    const refreshSocialDirectory = async () => {
      try {
        const [{ users }, crew, bandResult] = await Promise.all([
          authRequest<{ users: Person[] }>('/api/users'),
          authRequest<{ links: CrewLink[]; invitations: CrewInvitation[]; memberCount: number }>('/api/crew'),
          authRequest<{ bands: Band[] }>('/api/bands'),
        ])
        if (!active) return
        const userWithCrewCount = { ...currentUser, crewMembers: crew.memberCount, crewSize: crew.memberCount }
        const peopleOnPlatform = mergePeople(users, [userWithCrewCount])
        setPlatformUsers(peopleOnPlatform)
        setAllUsers((current) => mergePeople(people, current, peopleOnPlatform))
        setProfile((current) => current.handle === currentUser.handle
          ? userWithCrewCount
          : peopleOnPlatform.find((person) => person.handle === current.handle) ?? current)
        setCrewLinks(crew.links)
        setCrewInvitations(crew.invitations)
        setBands(bandResult.bands)
      } catch (error: unknown) {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać kont i zaproszeń z serwera.')
      }
    }
    void refreshSocialDirectory()
    const timer = window.setInterval(() => { void refreshSocialDirectory() }, 30_000)
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') void refreshSocialDirectory() }
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [currentUser.id, currentUser.handle])

  useEffect(() => {
    let active = true
    const refreshNotifications = async () => {
      try {
        const [{ notifications }, crew] = await Promise.all([
          authRequest<{ notifications: SocialNotification[] }>('/api/notifications'),
          authRequest<{ links: CrewLink[]; invitations: CrewInvitation[] }>('/api/crew'),
        ])
        if (active) {
          setSocialNotifications(notifications)
          setCrewInvitations(crew.invitations)
          setCrewLinks(crew.links)
        }
      } catch (error: unknown) {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać powiadomień.')
      }
    }
    void refreshNotifications()
    const timer = window.setInterval(() => { void refreshNotifications() }, 15_000)
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshNotifications() }
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [currentUser.id])

  useEffect(() => {
    let active = true
    if (view !== 'home' || homeTab !== 'chat' || chatMode !== 'public') return
    const refreshChat = async () => {
      try {
        const { messages } = await authRequest<{ messages: ChatMessage[] }>('/api/chat?scope=public')
        if (!active) return
        setChatMessages((current) => [...current.filter((message) => message.scope !== 'public'), ...messages])
      } catch (error: unknown) {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać wiadomości czatu.')
      }
    }
    void refreshChat()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshChat() }, 7000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [chatMode, currentUser.id, homeTab, view])

  useEffect(() => {
    let active = true
    if (view !== 'home' || homeTab !== 'chat' || !activeChatHandle || (chatMode !== 'room' && !roomMinimized)) return
    if (!crewLinks.some((link) => crewPairKey(link[0], link[1]) === crewPairKey(currentUser.handle, activeChatHandle))) return
    const refreshRoom = async () => {
      try {
        const { messages } = await authRequest<{ messages: ChatMessage[] }>(`/api/chat?scope=room&with=${encodeURIComponent(activeChatHandle)}`)
        if (!active) return
        setChatMessages((current) => [
          ...current.filter((message) => message.scope !== 'room'
            || message.recipientHandle !== activeChatHandle && message.author.handle !== activeChatHandle),
          ...messages,
        ])
      } catch (error: unknown) {
        if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać prywatnych wiadomości.')
      }
    }
    void refreshRoom()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshRoom() }, 7000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activeChatHandle, chatMode, crewLinks, currentUser.handle, homeTab, roomMinimized, view])

  useEffect(() => {
    let active = true
    Promise.all([
      authRequest<{ users: Person[] }>('/api/blocks'),
      authRequest<{ handles: string[] }>('/api/chat/mutes'),
    ]).then(([blocks, mutes]) => {
      if (!active) return
      setBlockedUsers(blocks.users)
      setMutedChatHandles(mutes.handles)
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się pobrać ustawień blokad i wyciszeń.')
    })
    return () => { active = false }
  }, [currentUser.id])

  useEffect(() => {
    const query = search.trim()
    if (!query) {
      setUserSearchResults([])
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      authRequest<{ users: Person[] }>(`/api/users?q=${encodeURIComponent(query)}`)
        .then(({ users }) => { if (active) setUserSearchResults(users) })
        .catch((error: unknown) => {
          if (active) setNotice(error instanceof Error ? error.message : 'Nie udało się wyszukać użytkowników.')
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search])

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const snapshot = event.state as Partial<NavigationSnapshot> | null
      if (snapshot?.youtopic && snapshot.guard) {
        const current = { ...snapshot, guard: false } as NavigationSnapshot
        navigationRef.current = current
        window.history.pushState(current, '', window.location.href)
        return
      }
      if (!snapshot?.youtopic || !snapshot.view || !snapshot.homeTab) {
        window.history.pushState(navigationRef.current, '', window.location.href)
        return
      }
      const restored = snapshot as NavigationSnapshot
      navigationRef.current = restored
      setView(restored.view)
      setHomeTab(restored.homeTab)
      setChatMode(restored.chatMode)
      setActiveChatHandle(restored.activeChatHandle)
      setRoomMinimized(restored.chatMode === 'public' && Boolean(restored.activeChatHandle))
      setSelectedTopic(restored.selectedTopic)
      setSearch(restored.search)
      setProfile(allUsersRef.current.find((person) => person.handle === restored.profileHandle) ?? currentUser)
      if (restored.view === 'topiki') setActiveTopikiIndex(0)
    }
    window.history.replaceState({ ...navigationRef.current, guard: true }, '', window.location.href)
    window.history.pushState(navigationRef.current, '', window.location.href)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [currentUser])

  useEffect(() => {
    navigationRef.current = { ...navigationRef.current, view, homeTab, chatMode, activeChatHandle, selectedTopic, profileHandle: profile.handle, search }
    window.history.replaceState(navigationRef.current, '', window.location.href)
  }, [activeChatHandle, chatMode, homeTab, profile.handle, search, selectedTopic, view])

  useEffect(() => {
    saveStored(storageKeys.users, allUsers.filter((person) => !people.some((sample) => sample.handle === person.handle)))
  }, [allUsers])

  useEffect(() => {
    saveStored(`youtopic-auto-advance-topiki-${currentUser.handle}`, autoAdvanceTopiki)
  }, [autoAdvanceTopiki, currentUser.handle])

  useEffect(() => {
    saveStored(`youtopic-dismissed-suggestions-${currentUser.handle}`, dismissedSuggestions)
  }, [currentUser.handle, dismissedSuggestions])

  useEffect(() => {
    saveStored(storageKeys.followedTopics(currentUser.handle), followedTopics)
  }, [currentUser.handle, followedTopics])

  useEffect(() => {
    saveStored(`youtopic-feed-mode-${currentUser.handle}`, feedMode)
  }, [currentUser.handle, feedMode])

  useEffect(() => {
    if (linkedProfileHandledRef.current) return
    const profileHandle = new URLSearchParams(window.location.search).get('profile')
    const linkedProfile = profileHandle ? allUsers.find((person) => person.handle === profileHandle) : null
    if (linkedProfile) {
      linkedProfileHandledRef.current = true
      const url = new URL(window.location.href)
      url.searchParams.delete('profile')
      window.history.replaceState(window.history.state, '', url)
      pushNavigation({ view: 'profile', profileHandle: linkedProfile.handle, search: '' })
      setProfile(linkedProfile)
      setView('profile')
    }
  }, [allUsers])

  useEffect(() => {
    const savedStories = bandStories
      .filter((story) => story.expiresAt > clockNow && (!story.media?.startsWith('blob:') || Boolean(story.text)))
      .map((story) => story.media?.startsWith('blob:') ? { ...story, media: undefined, mediaKind: undefined } : story)
    saveStored(storageKeys.bandStories, savedStories)
  }, [bandStories, clockNow])

  useEffect(() => {
    saveStored(storageKeys.personalStories, personalStories.filter((story) => story.expiresAt > clockNow))
  }, [personalStories, clockNow])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    function syncSharedBands(event: StorageEvent) {
      if (event.key === storageKeys.followedTopics(currentUser.handle)) setFollowedTopics(loadStored(storageKeys.followedTopics(currentUser.handle), []))
      if (event.key === storageKeys.bandStories) setBandStories(loadStored<BandStory[]>(storageKeys.bandStories, []).filter((story) => story.expiresAt > Date.now()))
      if (event.key === storageKeys.users) setAllUsers(mergePeople(people, loadStored<Person[]>(storageKeys.users, []), [currentUser]))
    }
    window.addEventListener('storage', syncSharedBands)
    return () => window.removeEventListener('storage', syncSharedBands)
  }, [currentUser.handle])

  const topikiPosts = useMemo(() => posts
    .filter((post) => !post.bandId && Boolean(post.video) && !moderatedItems.some((item) =>
      (item.targetType === 'post' && item.targetId === `post:${post.id}` || item.targetType === 'video' && item.targetId === `video:${post.id}`)
      && item.targetUserId === post.author.id))
    .sort((first, second) => (second.boosts + second.likes) - (first.boosts + first.likes) || second.boosts - first.boosts || second.likes - first.likes || second.id - first.id), [moderatedItems, posts])
  const proposedTopiki = topikiPosts.filter((post) => post.author.handle !== currentUser.handle && !crewHandles.includes(post.author.handle) && !post.boostedBy?.some((handle) => handle === currentUser.handle || crewHandles.includes(handle)))
  const topicCatalog = useMemo(() => {
    const topics = new Map<string, { name: string; count: number; videos: number }>()
    for (const post of posts) {
      if (post.bandId || !post.topic.trim() || normalizeTopicName(post.topic) === 'z twojego świata') continue
      const key = normalizeTopicName(post.topic)
      const existing = topics.get(key)
      if (existing) {
        existing.count += 1
        existing.videos += Number(Boolean(post.video))
      } else {
        topics.set(key, { name: post.topic.trim(), count: 1, videos: Number(Boolean(post.video)) })
      }
    }
    return [...topics.values()].sort((first, second) => second.count - first.count || first.name.localeCompare(second.name, 'pl'))
  }, [posts])
  const matchingUsers = userSearchResults.slice(0, 5)
  const matchingTopics = search.trim()
    ? topicCatalog.filter((topic) => topic.name.toLocaleLowerCase('pl-PL').includes(search.trim().toLocaleLowerCase('pl-PL'))).slice(0, 4)
    : []
  const sidebarTopics = [...topicCatalog].sort((first, second) => Number(followedTopics.includes(normalizeTopicName(second.name))) - Number(followedTopics.includes(normalizeTopicName(first.name))) || second.count - first.count).slice(0, 4)

  const filteredPosts = useMemo(() => {
    let result = posts.filter((post) => !moderatedItems.some((item) =>
      item.targetType === 'post' && item.targetId === `post:${post.id}` && item.targetUserId === post.author.id))
    if (isBandView) result = result.filter((post) => post.bandId === band?.id)
    else {
      result = result.filter((post) => !post.bandId)
      if (view === 'home' && homeTab === 'board' && feedMode === 'following') {
        result = followedTopics.length
          ? result.filter((post) => followedTopics.includes(normalizeTopicName(post.topic)))
          : []
      } else if (view === 'home' || view === 'crew') {
        result = result.filter((post) => post.author.handle === currentUser.handle || crewHandles.includes(post.author.handle) || post.boostedBy?.some((handle) => handle === currentUser.handle || crewHandles.includes(handle)))
      }
    }
    if (view === 'topiki') result = topikiPosts
    if (view === 'saved') result = result.filter((post) => post.saved)
    if (view === 'profile') result = result.filter((post) => post.author.handle === profile.handle)
    if (view === 'explore' && selectedTopic) result = result.filter((post) => normalizeTopicName(post.topic) === normalizeTopicName(selectedTopic))
    if (search.trim()) {
      const query = search.toLocaleLowerCase('pl')
      result = result.filter((post) => `${post.author.name} ${post.topic} ${post.text}`.toLocaleLowerCase('pl').includes(query))
    }
    if (isBandView) result = [...result].sort((first, second) => Number(Boolean(second.pinnedAt)) - Number(Boolean(first.pinnedAt)) || (second.pinnedAt ?? 0) - (first.pinnedAt ?? 0))
    return result
  }, [band?.id, crewHandles, currentUser.handle, feedMode, followedTopics, homeTab, isBandView, moderatedItems, posts, profile.handle, search, selectedTopic, topikiPosts, view])

  useEffect(() => {
    if (pendingPostNavigationId === null) return
    const post = filteredPosts.find((item) => item.id === pendingPostNavigationId)
    if (!post) return
    document.getElementById(`post-${pendingPostNavigationId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingPostNavigationId(null)
  }, [filteredPosts, pendingPostNavigationId])

  useEffect(() => {
    if (view !== 'topiki') return
    const feed = topikiFeedRef.current
    if (!feed) return
    if (pendingTopikiPostId !== null) {
      const pendingIndex = filteredPosts.findIndex((post) => post.id === pendingTopikiPostId)
      if (pendingIndex >= 0) {
        feed.querySelector<HTMLElement>(`[data-topiki-index="${pendingIndex}"]`)?.scrollIntoView({ block: 'start' })
        setActiveTopikiIndex(pendingIndex)
        setPendingTopikiPostId(null)
      }
    }
    const cards = [...feed.querySelectorAll<HTMLElement>('[data-topiki-index]')]
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          setActiveTopikiIndex(Number((entry.target as HTMLElement).dataset.topikiIndex))
        }
      }
    }, { root: feed, threshold: [0, 0.65, 1] })
    cards.forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [filteredPosts, pendingTopikiPostId, view])

  function pushNavigation(patch: Partial<Omit<NavigationSnapshot, 'youtopic'>>) {
    const next = { ...navigationRef.current, ...patch, youtopic: true as const }
    if (Object.keys(patch).every((key) => next[key as keyof NavigationSnapshot] === navigationRef.current[key as keyof NavigationSnapshot])) return
    navigationRef.current = next
    window.history.pushState(next, '', window.location.href)
  }

  function showView(nextView: View) {
    pushNavigation({
      view: nextView,
      homeTab: nextView === 'home' ? 'board' : navigationRef.current.homeTab,
      chatMode: 'public',
      selectedTopic: '',
      profileHandle: currentUser.handle,
      search: '',
    })
    setView(nextView)
    setSearch('')
    setSelectedTopic('')
    if (nextView === 'topiki') setActiveTopikiIndex(0)
    if (nextView === 'home') setHomeTab('board')
    if (nextView === 'band') {
      setIsCreatingBand(false)
      if (band) markBandSeen(band.id)
    }
    if (nextView !== 'profile') setProfile(currentUser)
  }

  async function submitSupportTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSupportBusy(true)
    try {
      const { ticket } = await authRequest<{ ticket: SupportTicket }>('/api/support/tickets', {
        subject: supportSubject,
        category: supportCategory,
        message: supportMessage,
      })
      setSupportTickets((current) => [ticket, ...current])
      setSupportSubject('')
      setSupportMessage('')
      setNotice('Wysłaliśmy sprawę do zespołu YouTopic.')
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się wysłać sprawy.')
    } finally {
      setSupportBusy(false)
    }
  }

  function openTopic(topic: string) {
    pushNavigation({ view: 'explore', homeTab: 'board', selectedTopic: topic, profileHandle: currentUser.handle, search: '' })
    setView('explore')
    setHomeTab('board')
    setSearch('')
    setSelectedTopic(topic)
    setProfile(currentUser)
  }

  async function openNotificationPost(postId: string) {
    try {
      const { post } = await authRequest<{ post: Post }>(`/api/posts/${encodeURIComponent(postId)}`)
      setPosts((current) => current.some((item) => item.id === post.id)
        ? current.map((item) => item.id === post.id ? post : item)
        : [post, ...current])
      const destination: View = post.bandId ? 'band' : 'explore'
      if (post.bandId) setActiveBandId(post.bandId)
      pushNavigation({ view: destination, homeTab: 'board', selectedTopic: post.bandId ? '' : post.topic, search: '' })
      setView(destination)
      setHomeTab('board')
      setSelectedTopic(post.bandId ? '' : post.topic)
      setSearch('')
      setPendingPostNavigationId(post.id)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się otworzyć posta z powiadomienia.')
    }
  }

  function toggleFollowTopic(topic: string) {
    const key = normalizeTopicName(topic)
    setFollowedTopics((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  function navigateTopiki(direction: -1 | 1) {
    const nextIndex = Math.max(0, Math.min(filteredPosts.length - 1, activeTopikiIndex + direction))
    const feed = topikiFeedRef.current
    if (!feed || !filteredPosts[nextIndex]) return
    setActiveTopikiIndex(nextIndex)
    feed.querySelector<HTMLElement>(`[data-topiki-index="${nextIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openTopikiFromPost(postId: number) {
    if (!topikiPosts.some((post) => post.id === postId)) return
    pushNavigation({ view: 'topiki', search: '' })
    setPendingTopikiPostId(postId)
    setActiveTopikiIndex(topikiPosts.findIndex((post) => post.id === postId))
    setSearch('')
    setView('topiki')
  }

  function openProfile(person: Person) {
    const selectedProfile = allUsers.find((candidate) => candidate.handle === person.handle) ?? person
    pushNavigation({ view: 'profile', profileHandle: selectedProfile.handle, search: '' })
    setProfile(selectedProfile)
    setProfileTab('posts')
    setView('profile')
    setSearch('')
  }

  function reportContent(targetType: 'profile' | 'post' | 'photo' | 'video' | 'comment' | 'message', targetId: string, target: Person, contentPreview = '', contentUrl = '') {
    if (!target.id || target.handle === currentUser.handle) {
      setNotice('Tę treść można zgłosić po powiązaniu jej autora z kontem platformy.')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    setReportDraft({
      targetType,
      targetId,
      targetUserId: target.id,
      targetName: target.name,
      contentPreview: contentPreview.slice(0, 1000),
      contentUrl: /^https?:\/\//i.test(contentUrl) ? contentUrl.slice(0, 2048) : '',
      reasonCategory: 'other',
      reason: '',
    })
  }

  async function submitReportDraft() {
    if (!reportDraft) return
    const reason = reportDraft.reason.trim()
    if (!reason) {
      setNotice('Dodaj krótkie uzasadnienie zgłoszenia.')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    try {
      await authRequest('/api/reports', {
        targetType: reportDraft.targetType,
        targetId: reportDraft.targetId,
        targetUserId: reportDraft.targetUserId,
        reasonCategory: reportDraft.reasonCategory,
        reason,
        contentPreview: reportDraft.contentPreview,
        contentUrl: reportDraft.contentUrl,
      })
      setReportDraft(null)
      setNotice('Dziękujemy. Zgłoszenie zostało przekazane do zespołu moderacji.')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (reportError) {
      setNotice(reportError instanceof Error ? reportError.message : 'Nie udało się wysłać zgłoszenia.')
      window.setTimeout(() => setNotice(''), 3000)
    }
  }

  function reportProfile(person: Person) {
    if (!person.id) return
    void reportContent('profile', `profile:${person.id}`, person)
  }

  async function copyProfileLink(person: Person) {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('profile', person.handle)
    try {
      await navigator.clipboard.writeText(url.toString())
      setNotice('Link profilu skopiowany')
    } catch {
      setNotice('Nie udało się skopiować linku profilu')
    }
    setProfileBoostTarget(null)
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function boostProfileOnBoard(person: Person) {
    if (person.handle === currentUser.handle) return
    if (!person.id) {
      setNotice('Można polecać tylko aktywne profile użytkowników YouTopic.')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    try {
      const { post } = await authRequest<{ post: Post }>('/api/posts', {
        topic: 'POLECANY PROFIL',
        text: `${currentUser.name} poleca profil ${person.name}.`,
        profileTargetUserId: person.id,
      })
      setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
      setProfileBoostTarget(null)
      pushNavigation({ view: 'home', homeTab: 'board', profileHandle: currentUser.handle, selectedTopic: '', search: '' })
      setView('home')
      setHomeTab('board')
      setNotice(`Polecenie profilu ${person.name} opublikowane na tablicy`)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się polecić profilu.')
    }
    window.setTimeout(() => setNotice(''), 3000)
  }

  async function toggleCrew(person: Person) {
    const isMember = crewHandles.includes(person.handle)
    if (isMember) {
      try {
        await authDelete<{ ok: true }>(`/api/crew/${encodeURIComponent(person.handle)}`)
        setCrewLinks((current) => current.filter((link) => crewPairKey(link[0], link[1]) !== crewPairKey(currentUser.handle, person.handle)))
        setNotice(`Usunięto ${person.name} z Ekipy`)
      } catch (error: unknown) {
        setNotice(error instanceof Error ? error.message : 'Nie udało się usunąć osoby z Ekipy.')
      }
    } else {
      const pending = crewInvitations.find((invitation) => invitation.from.handle === currentUser.handle && invitation.to.handle === person.handle && invitation.status === 'pending')
      if (pending) await cancelCrewInvitation(person)
      else sendCrewInvitation(person)
      return
    }
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function toggleUserBlock(person: Person) {
    if (!person.id || person.id === currentUser.id) return
    const isBlocked = blockedUsers.some((user) => user.id === person.id)
    try {
      if (isBlocked) {
        await authDelete<{ ok: true }>(`/api/users/${encodeURIComponent(person.id)}/block`)
        setBlockedUsers((current) => current.filter((user) => user.id !== person.id))
        setNotice(`Odblokowano @${person.nickname ?? person.handle}`)
      } else {
        await authRequest<{ ok: true }>(`/api/users/${encodeURIComponent(person.id)}/block`, {})
        setBlockedUsers((current) => [...current, person])
        setCrewLinks((current) => current.filter((link) => crewPairKey(link[0], link[1]) !== crewPairKey(currentUser.handle, person.handle)))
        setPosts((current) => current.filter((post) => post.author.id !== person.id))
        setChatMessages((current) => current.filter((message) => message.author.id !== person.id))
        setSocialNotifications((current) => current.filter((notification) => notification.actor?.id !== person.id))
        setNotice(`Zablokowano @${person.nickname ?? person.handle}`)
      }
      window.setTimeout(() => setNotice(''), 2600)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zmienić blokady użytkownika.')
    }
  }

  async function toggleChatMute(handle: string) {
    const muted = mutedChatHandles.includes(handle)
    try {
      if (muted) {
        await authDelete<{ ok: true }>(`/api/chat/${encodeURIComponent(handle)}/mute`)
        setMutedChatHandles((current) => current.filter((item) => item !== handle))
      } else {
        await authRequest<{ ok: true }>(`/api/chat/${encodeURIComponent(handle)}/mute`, {})
        setMutedChatHandles((current) => [...current, handle])
        setSocialNotifications((current) => current.map((item) =>
          item.type === 'chat_message' && item.chatHandle === handle
            ? { ...item, readAt: item.readAt ?? Date.now() }
            : item))
      }
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zmienić wyciszenia rozmowy.')
    }
  }

  async function cancelCrewInvitation(person: Person) {
    const invitation = crewInvitations.find((item) => item.from.handle === currentUser.handle && item.to.handle === person.handle && item.status === 'pending')
    if (!invitation) return
    try {
      await authDelete<{ ok: true }>(`/api/crew/invitations/${encodeURIComponent(invitation.id)}`)
      setCrewInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: 'cancelled' } : item))
      setNotice(`Anulowano zaproszenie dla ${person.name}`)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się anulować zaproszenia.')
    }
    window.setTimeout(() => setNotice(''), 2600)
  }

  function openChatRoom(person: Person) {
    void markChatNotificationsRead(person.handle)
    pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'room', activeChatHandle: person.handle })
    setActiveChatHandle(person.handle)
    setChatMode('room')
    setRoomMinimized(false)
    setChatDraft('')
  }

  async function markChatNotificationsRead(handle: string) {
    if (!socialNotifications.some((item) => item.type === 'chat_message' && item.chatHandle === handle && !item.readAt)) return
    try {
      await authPatch<{ ok: true }>('/api/notifications/read', { chatHandle: handle })
      setSocialNotifications((current) => current.map((item) =>
        item.type === 'chat_message' && item.chatHandle === handle && !item.readAt
          ? { ...item, readAt: Date.now() }
          : item))
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się oznaczyć rozmowy jako przeczytanej.')
    }
  }

  function minimizeChatRoom() {
    if (!activeChat) return
    pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'public', activeChatHandle: activeChat.handle })
    setChatMode('public')
    setRoomMinimized(true)
  }

  function restoreChatRoom() {
    if (!activeChat) return
    pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'room', activeChatHandle: activeChat.handle })
    setChatMode('room')
    setRoomMinimized(false)
  }

  function closeChatRoom() {
    pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'public', activeChatHandle: '' })
    setChatMode('public')
    setActiveChatHandle('')
    setRoomMinimized(false)
    setChatDraft('')
  }

  async function sendCrewInvitation(person: Person) {
    if (crewHandles.includes(person.handle)) return
    const alreadyPending = crewInvitations.some((invitation) => invitation.status === 'pending' && crewPairKey(invitation.from.handle, invitation.to.handle) === crewPairKey(currentUser.handle, person.handle))
    if (alreadyPending) {
      setNotice('Zaproszenie do Ekipy już czeka na odpowiedź')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    if (!person.id) {
      setNotice('Tego profilu demonstracyjnego nie można dodać do Ekipy. Wyszukaj konto zarejestrowane na platformie.')
      window.setTimeout(() => setNotice(''), 3500)
      return
    }
    try {
      const { invitation } = await authRequest<{ invitation: CrewInvitation }>('/api/crew/invitations', { toUserId: person.id })
      setCrewInvitations((current) => [...current.filter((item) => item.id !== invitation.id), invitation])
      setNotice(`Wysłano zaproszenie do Ekipy dla ${person.name}`)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się wysłać zaproszenia.')
    }
    window.setTimeout(() => setNotice(''), 2600)
  }

  function dismissSuggestedProfile(person: Person) {
    setDismissedSuggestions((current) => current.includes(person.handle) ? current : [...current, person.handle])
  }

  function beginProfileEdit() {
    setNicknameDraft(currentUser.nickname ?? currentUser.handle)
    setFirstNameDraft(currentUser.firstName ?? currentUser.name.split(' ')[0] ?? '')
    setMiddleNameDraft(currentUser.middleName ?? '')
    setLastNameDraft(currentUser.lastName ?? currentUser.name.split(' ').slice(1).join(' '))
    setSecondLastNameDraft(currentUser.secondLastName ?? '')
    setLocationDraft(currentUser.location ?? '')
    setContactPhoneDraft(currentUser.contactPhone ?? '')
    setSecondContactPhoneDraft(currentUser.secondContactPhone ?? '')
    setBioDraft(currentUser.bio ?? '')
    setAvatarDraft(currentUser.avatar)
    setCoverImageDraft(currentUser.coverImage ?? '')
    setSocialLinksDraft(Object.entries(currentUser.socialLinks ?? {}).map(([platform, url], index) => ({ id: index, platform: platform as SocialPlatform, url })))
    setProfileVisibilityDraft({ ...defaultProfileVisibility, ...currentUser.profileVisibility, contactPhone: currentUser.profileVisibility?.contactPhone ?? 'private', secondContactPhone: currentUser.profileVisibility?.secondContactPhone ?? 'private' })
    setSocialPrivacyDraft({ profileAudience: currentUser.socialPrivacy?.profileAudience ?? 'public', crewInviteAudience: currentUser.socialPrivacy?.crewInviteAudience ?? 'everyone' })
    setProfileError('')
    setIsEditingProfile(true)
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileError('')
    setIsSavingProfile(true)
    try {
      const socialLinks = Object.fromEntries(socialLinksDraft.filter((link) => link.url.trim()).map((link) => [link.platform, link.url.trim()])) as Partial<Record<SocialPlatform, string>>
      const result = await authRequest<{ user: Person }>('/api/profile', {
        nickname: nicknameDraft,
        firstName: firstNameDraft,
        middleName: middleNameDraft,
        lastName: lastNameDraft,
        secondLastName: secondLastNameDraft,
        location: locationDraft,
        contactPhone: contactPhoneDraft,
        secondContactPhone: secondContactPhoneDraft,
        bio: bioDraft,
        avatar: avatarDraft,
        coverImage: coverImageDraft,
        socialLinks,
        profileVisibility: profileVisibilityDraft,
        socialPrivacy: socialPrivacyDraft,
      })
      const updatedUser = result.user
      onCurrentUserUpdate(updatedUser)
      setAllUsers((current) => mergePeople(current, [updatedUser]))
      setPlatformUsers((current) => mergePeople(current, [updatedUser]))
      const refreshPerson = (person: Person) => person.handle === updatedUser.handle ? updatedUser : person
      setPosts((current) => current.map((post) => ({
        ...post,
        author: refreshPerson(post.author),
        comments: post.comments.map((comment) => typeof comment === 'string' ? comment : { ...comment, author: refreshPerson(comment.author) }),
        sharedFrom: post.sharedFrom ? { ...post.sharedFrom, author: refreshPerson(post.sharedFrom.author) } : undefined,
        profileTarget: post.profileTarget ? refreshPerson(post.profileTarget) : undefined,
      })))
      setBandStories((current) => current.map((story) => ({
        ...story,
        author: refreshPerson(story.author),
        seenPeople: story.seenPeople?.map(refreshPerson),
      })))
      setPersonalStories((current) => current.map((story) => ({
        ...story,
        author: refreshPerson(story.author),
        seenPeople: story.seenPeople?.map(refreshPerson),
      })))
      setProfile((current) => current.handle === updatedUser.handle ? updatedUser : current)
      setNicknameDraft(updatedUser.nickname ?? updatedUser.handle)
      setFirstNameDraft(updatedUser.firstName ?? '')
      setMiddleNameDraft(updatedUser.middleName ?? '')
      setLastNameDraft(updatedUser.lastName ?? '')
      setSecondLastNameDraft(updatedUser.secondLastName ?? '')
      setLocationDraft(updatedUser.location ?? '')
      setContactPhoneDraft(updatedUser.contactPhone ?? '')
      setSecondContactPhoneDraft(updatedUser.secondContactPhone ?? '')
      setBioDraft(updatedUser.bio ?? '')
      setAvatarDraft(updatedUser.avatar)
      setCoverImageDraft(updatedUser.coverImage ?? '')
      setSocialLinksDraft(Object.entries(updatedUser.socialLinks ?? {}).map(([platform, url], index) => ({ id: index, platform: platform as SocialPlatform, url })))
      setProfileVisibilityDraft({ ...defaultProfileVisibility, ...updatedUser.profileVisibility, contactPhone: updatedUser.profileVisibility?.contactPhone ?? 'private', secondContactPhone: updatedUser.profileVisibility?.secondContactPhone ?? 'private' })
      setSocialPrivacyDraft({ profileAudience: updatedUser.socialPrivacy?.profileAudience ?? 'public', crewInviteAudience: updatedUser.socialPrivacy?.crewInviteAudience ?? 'everyone' })
      setIsEditingProfile(false)
      setNotice('Profil został zaktualizowany')
      window.setTimeout(() => setNotice(''), 2600)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Nie udało się zapisać profilu.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  function cancelProfileEdit() {
    setNicknameDraft(currentUser.nickname ?? currentUser.handle)
    setFirstNameDraft(currentUser.firstName ?? currentUser.name.split(' ')[0] ?? '')
    setMiddleNameDraft(currentUser.middleName ?? '')
    setLastNameDraft(currentUser.lastName ?? currentUser.name.split(' ').slice(1).join(' '))
    setSecondLastNameDraft(currentUser.secondLastName ?? '')
    setLocationDraft(currentUser.location ?? '')
    setContactPhoneDraft(currentUser.contactPhone ?? '')
    setSecondContactPhoneDraft(currentUser.secondContactPhone ?? '')
    setBioDraft(currentUser.bio ?? '')
    setAvatarDraft(currentUser.avatar)
    setCoverImageDraft(currentUser.coverImage ?? '')
    setSocialLinksDraft(Object.entries(currentUser.socialLinks ?? {}).map(([platform, url], index) => ({ id: index, platform: platform as SocialPlatform, url })))
    setProfileVisibilityDraft({ ...defaultProfileVisibility, ...currentUser.profileVisibility, contactPhone: currentUser.profileVisibility?.contactPhone ?? 'private', secondContactPhone: currentUser.profileVisibility?.secondContactPhone ?? 'private' })
    setSocialPrivacyDraft({ profileAudience: currentUser.socialPrivacy?.profileAudience ?? 'public', crewInviteAudience: currentUser.socialPrivacy?.crewInviteAudience ?? 'everyone' })
    setProfileError('')
    setIsEditingProfile(false)
  }

  async function changeProfileImage(kind: 'avatar' | 'cover', file: File) {
    setProfileError('')
    try {
      const image = await resizeProfileImage(file, kind === 'avatar' ? 512 : 1600)
      if (kind === 'avatar') {
        setAvatarDraft(image)
        setNotice('Podgląd zdjęcia gotowy — kliknij „Zapisz profil”, aby zachować zmianę.')
        window.setTimeout(() => setNotice(''), 3500)
      } else setCoverImageDraft(image)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Nie udało się wczytać zdjęcia.')
    }
  }

  async function respondToCrewInvitation(invitationId: string, accept: boolean): Promise<boolean> {
    const invitation = crewInvitations.find((item) => item.id === invitationId)
    if (!invitation) return false
    try {
      await authRequest<{ ok: true }>(`/api/crew/invitations/${encodeURIComponent(invitationId)}/respond`, { accept })
      setCrewInvitations((current) => current.map((item) => item.id === invitationId ? { ...item, status: accept ? 'accepted' : 'declined', respondedAt: Date.now() } : item))
      if (accept) {
        setCrewLinks((current) => current.some((link) => crewPairKey(link[0], link[1]) === crewPairKey(invitation.from.handle, invitation.to.handle))
          ? current
          : [...current, [invitation.from.handle, invitation.to.handle]])
      }
      return true
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się odpowiedzieć na zaproszenie.')
      return false
    }
  }

  async function sendPublicChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = chatDraft.trim()
    if (!text) return
    try {
      const { message } = await authRequest<{ message: ChatMessage }>('/api/chat', { scope: 'public', text })
      setChatMessages((current) => [...current.filter((item) => item.id !== message.id), message])
      setChatDraft('')
    } catch (error: unknown) {
      showPostError(error, 'Nie udało się wysłać wiadomości.')
    }
  }

  async function sendRoomMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = chatDraft.trim()
    if (!text || !activeChat || !crewHandles.includes(activeChat.handle)) return
    try {
      const { message } = await authRequest<{ message: ChatMessage }>('/api/chat', { scope: 'room', with: activeChat.handle, text })
      setChatMessages((current) => [...current.filter((item) => item.id !== message.id), message])
      setChatDraft('')
    } catch (error: unknown) {
      showPostError(error, 'Nie udało się wysłać wiadomości prywatnej.')
    }
  }

  async function createBand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = bandName.trim()
    if (!name) return
    try {
      const { band: createdBand } = await authRequest<{ band: Band }>('/api/bands', { name, memberHandles: selectedBandHandles })
      setBands((current) => [...current, createdBand])
      setActiveBandId(createdBand.id)
      setIsCreatingBand(false)
      setBandName('')
      setSelectedBandHandles([])
      setNotice(`Utworzono bandę „${name}”`)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się utworzyć bandy.')
    }
    window.setTimeout(() => setNotice(''), 2600)
  }

  function toggleBandInvite(handle: string) {
    setSelectedBandHandles((current) => current.includes(handle)
      ? current.filter((memberHandle) => memberHandle !== handle)
      : [...current, handle])
  }

  async function toggleBandMember(handle: string) {
    if (!band || band.adminHandle !== currentUser.handle) return
    const target = allUsers.find((person) => person.handle === handle)
    if (!target?.id) return
    const member = !band.memberHandles.includes(handle)
    try {
      const { band: updatedBand } = await authPatch<{ band: Band }>(`/api/bands/${encodeURIComponent(band.id)}/members`, { userId: target.id, member })
      setBands((current) => current.map((item) => item.id === updatedBand.id ? updatedBand : item))
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się zmienić składu bandy.')
      window.setTimeout(() => setNotice(''), 3000)
    }
  }

  function markBandSeen(bandId: string) {
    setPosts((current) => current.map((post) => post.bandId === bandId && post.author.handle !== currentUser.handle
      ? { ...post, seenBy: [...new Set([...(post.seenBy ?? []), currentUser.handle])], seenPeople: [...(post.seenPeople ?? []).filter((person) => person.handle !== currentUser.handle), currentUser] }
      : post))
  }

  function chooseStoryMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setStoryMedia({ url: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' : 'image' })
    event.target.value = ''
  }

  function publishBandStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!band || (!storyDraft.trim() && !storyMedia)) return
    setBandStories((current) => [{
      id: Date.now(),
      bandId: band.id,
      author: currentUser,
      text: storyDraft.trim(),
      media: storyMedia?.url,
      mediaKind: storyMedia?.kind,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      seenBy: [currentUser.handle],
      seenPeople: [currentUser],
    }, ...current])
    setStoryDraft('')
    setStoryMedia(null)
  }

  async function choosePersonalStoryMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPersonalStoryError('')
    try {
      setPersonalStoryMedia(await resizeProfileImage(file, 720))
    } catch (error) {
      setPersonalStoryError(error instanceof Error ? error.message : 'Nie udało się wczytać zdjęcia.')
    }
  }

  function publishPersonalStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = personalStoryDraft.trim()
    if (!text && !personalStoryMedia) return
    const nextStories = [{
      id: Date.now(),
      author: currentUser,
      text,
      media: personalStoryMedia || undefined,
      mediaKind: personalStoryMedia ? 'image' as const : undefined,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      seenBy: [currentUser.handle],
      seenPeople: [currentUser],
    }, ...personalStories.filter((story) => story.expiresAt > Date.now())]
    if (!saveStored(storageKeys.personalStories, nextStories)) {
      setPersonalStoryError('Nie udało się zapisać relacji w tej przeglądarce. Wybierz mniejsze zdjęcie lub zwolnij miejsce w pamięci przeglądarki.')
      return
    }
    setPersonalStories(nextStories)
    setPersonalStoryDraft('')
    setPersonalStoryMedia('')
    setPersonalStoryError('')
    setIsComposingPersonalStory(false)
  }

  function openPersonalStory(storyId: number) {
    setActiveStoryKey(`personal-${storyId}`)
    setPersonalStories((current) => current.map((story) => story.id === storyId
      ? { ...story, seenBy: [...new Set([...story.seenBy, currentUser.handle])], seenPeople: [...(story.seenPeople ?? []).filter((person) => person.handle !== currentUser.handle), currentUser] }
      : story))
  }

  function openBandStory(storyId: number) {
    setActiveStoryKey(`band-${storyId}`)
    setBandStories((current) => current.map((story) => story.id === storyId
      ? { ...story, seenBy: [...new Set([...story.seenBy, currentUser.handle])], seenPeople: [...(story.seenPeople ?? []).filter((person) => person.handle !== currentUser.handle), currentUser] }
      : story))
  }

  function markStorySeen(entry: (typeof storyQueue)[number]) {
    if (entry.source === 'personal') openPersonalStory(entry.story.id)
    else openBandStory(entry.story.id)
  }

  function moveStory(direction: -1 | 1) {
    const currentIndex = storyQueue.findIndex((entry) => entry.key === activeStoryKey)
    if (currentIndex < 0) {
      setActiveStoryKey(null)
      return
    }
    const nextStory = storyQueue[currentIndex + direction]
    if (!nextStory) {
      setActiveStoryKey(null)
      return
    }
    markStorySeen(nextStory)
  }

  function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.currentTarget
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    if (kind === 'video' && !['video/mp4', 'video/webm'].includes(file.type)) {
      setNotice('Wybierz film MP4 lub WebM, aby można go było odtworzyć na platformie.')
      window.setTimeout(() => setNotice(''), 3500)
      input.value = ''
      return
    }
    void (async () => {
      try {
        let uploadFile = file
        if (kind === 'image') {
          const resized = await resizeProfileImage(file, 1600)
          const blob = await (await fetch(resized)).blob()
          uploadFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
        }
        setMedia({ url: URL.createObjectURL(uploadFile), kind, name: file.name, file: uploadFile })
      } catch (error: unknown) {
        setNotice(error instanceof Error ? error.message : 'Nie udało się przygotować pliku.')
        window.setTimeout(() => setNotice(''), 3000)
      } finally {
        input.value = ''
      }
    })()
  }

  async function publish(event: FormEvent<HTMLFormElement>, audience: 'feed' | 'band' = 'feed') {
    event.preventDefault()
    const externalUrl = audience === 'band' && bandLink.trim() ? normalizeExternalUrl(bandLink) : ''
    if (audience === 'band' && bandLink.trim() && !externalUrl) {
      setNotice('Wklej prawidłowy link zaczynający się od http:// lub https://')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    if ((!draft.trim() && !media && !externalUrl) || (audience === 'band' && !band)) return
    if (audience === 'feed' || audience === 'band') {
      try {
        if (audience === 'band' && !band) return
        let mediaId: string | undefined
        if (media) {
          const uploaded = await uploadMedia(media.file)
          mediaId = uploaded.id
        }
        const { post } = await authRequest<{ post: Post }>('/api/posts', {
          topic: audience === 'band'
            ? bandTopic.trim()
            : draftTopic.trim().replace(/^#+\s*/, '') || 'Z TWOJEGO ŚWIATA',
          text: draft.trim(),
          imageMediaId: media?.kind === 'image' ? mediaId : undefined,
          videoMediaId: media?.kind === 'video' ? mediaId : undefined,
          externalUrl: audience === 'band' ? externalUrl || undefined : undefined,
          bandId: audience === 'band' ? band.id : undefined,
        })
        setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
        setDraft('')
        setDraftTopic('')
        setIsChoosingDraftTopic(false)
        if (audience === 'band') {
          setBandTopic('')
          setBandLink('')
        }
        if (media) URL.revokeObjectURL(media.url)
        setMedia(null)
        setNotice(audience === 'band' ? 'Post dodany w bandzie i zapisany na serwerze' : 'Post dodany i zapisany na serwerze')
        window.setTimeout(() => setNotice(''), 2600)
      } catch (error: unknown) {
        if (media) URL.revokeObjectURL(media.url)
        setNotice(error instanceof Error ? error.message : 'Nie udało się opublikować posta.')
        window.setTimeout(() => setNotice(''), 4000)
      }
      return
    }
    setPosts((current) => [{
      id: Date.now(),
      author: currentUser,
      time: 'teraz',
      topic: audience === 'band' ? bandTopic.trim().toLocaleUpperCase('pl-PL') : draftTopic.trim().replace(/^#+\s*/, '').toLocaleUpperCase('pl-PL') || 'Z TWOJEGO ŚWIATA',
      text: draft.trim(),
      image: media?.kind === 'image' ? media.url : undefined,
      video: media?.kind === 'video' ? media.url : undefined,
      externalUrl: audience === 'band' ? externalUrl || undefined : undefined,
      likes: 0,
      comments: [],
      boosts: 0,
      liked: false,
      saved: false,
      bandId: audience === 'band' ? band?.id : undefined,
      seenBy: audience === 'band' ? [currentUser.handle] : undefined,
      seenPeople: audience === 'band' ? [currentUser] : undefined,
    }, ...current])
    setDraft('')
    setDraftTopic('')
    setIsChoosingDraftTopic(false)
    setMedia(null)
    if (audience === 'band') {
      setBandTopic('')
      setBandLink('')
    }
    setNotice(audience === 'band' ? 'Post dodany do bandy' : 'Post dodany do tablicy')
    window.setTimeout(() => setNotice(''), 2600)
  }

  function replaceSyncedPost(post: Post) {
    setPosts((current) => current.some((item) => item.id === post.id)
      ? current.map((item) => item.id === post.id ? post : item)
      : [post, ...current])
  }

  function showPostError(error: unknown, fallback: string) {
    setNotice(error instanceof Error ? error.message : fallback)
    window.setTimeout(() => setNotice(''), 3500)
  }

  async function togglePost(id: number, key: 'liked' | 'saved') {
    const post = posts.find((item) => item.id === id)
    if (post?.serverBacked) {
      try {
        const action = key === 'liked' ? 'like' : 'save'
        const result = await authRequest<{ post: Post }>(`/api/posts/${id}/${action}`, {})
        replaceSyncedPost(result.post)
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się zapisać zmiany.')
      }
      return
    }
    setPosts((current) => current.map((post) => post.id === id ? {
      ...post,
      [key]: !post[key],
      likes: key === 'liked' ? post.likes + (post.liked ? -1 : 1) : post.likes,
    } : post))
  }

  async function submitComment(event: FormEvent<HTMLFormElement>, postId: number) {
    event.preventDefault()
    const comment = commentDraft[postId]?.trim()
    if (!comment) return
    const reply = replyingTo[postId]
    const post = posts.find((item) => item.id === postId)
    if (post?.serverBacked) {
      try {
        const result = await authRequest<{ post: Post }>(`/api/posts/${postId}/comments`, { text: comment, replyToId: reply?.id })
        replaceSyncedPost(result.post)
        setCommentDraft((current) => ({ ...current, [postId]: '' }))
        setReplyingTo((current) => ({ ...current, [postId]: null }))
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się dodać komentarza.')
      }
      return
    }
    setPosts((current) => current.map((post) => post.id === postId ? {
      ...post,
      comments: [...post.comments, { id: Date.now(), author: currentUser, text: comment, likes: 0, likedBy: [], replyToId: reply?.id }],
    } : post))
    setCommentDraft((current) => ({ ...current, [postId]: '' }))
    setReplyingTo((current) => ({ ...current, [postId]: null }))
  }

  async function toggleCommentLike(postId: number, commentId: number) {
    const post = posts.find((item) => item.id === postId)
    if (post?.serverBacked) {
      try {
        const { post: updated } = await authRequest<{ post: Post }>(`/api/posts/${postId}/comments/${commentId}/like`, {})
        replaceSyncedPost(updated)
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się polubić komentarza.')
      }
      return
    }
    setPosts((current) => current.map((post) => {
      if (post.id !== postId) return post
      return { ...post, comments: normalizePostComments(post).map((comment) => {
        if (comment.id !== commentId) return comment
        const likedBy = comment.likedBy ?? []
        const alreadyLiked = likedBy.includes(currentUser.handle)
        return { ...comment, likes: Math.max(0, (comment.likes ?? 0) + (alreadyLiked ? -1 : 1)), likedBy: alreadyLiked ? likedBy.filter((handle) => handle !== currentUser.handle) : [...likedBy, currentUser.handle] }
      }) }
    }))
  }

  async function deleteOwnComment(postId: number, commentId: number) {
    const post = posts.find((item) => item.id === postId)
    if (post?.serverBacked) {
      try {
        const { post: updated } = await fetchPostMutation(`/api/posts/${postId}/comments/${commentId}`, 'DELETE')
        replaceSyncedPost(updated)
        setReplyingTo((current) => current[postId]?.id === commentId ? { ...current, [postId]: null } : current)
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się usunąć komentarza.')
      }
      return
    }
    setPosts((current) => current.map((post) => {
      if (post.id !== postId) return post
      const comments = normalizePostComments(post)
      const ownedComment = comments.find((comment) => comment.id === commentId && !comment.legacy && comment.author.handle === currentUser.handle)
      if (!ownedComment) return post
      const removedIds = new Set([commentId])
      let changed = true
      while (changed) {
        changed = false
        for (const comment of comments) {
          if (comment.replyToId && removedIds.has(comment.replyToId) && !removedIds.has(comment.id)) {
            removedIds.add(comment.id)
            changed = true
          }
        }
      }
      return { ...post, comments: comments.filter((comment) => !removedIds.has(comment.id)) }
    }))
    setReplyingTo((current) => current[postId]?.id === commentId ? { ...current, [postId]: null } : current)
  }

  async function startVoiceRecording(postId: number) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice('Ta przeglądarka nie obsługuje nagrywania głosu')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    if (voiceDraft) URL.revokeObjectURL(voiceDraft.url)
    setVoiceDraft(null)
    voiceCancelledRef.current = false
    voiceChunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      voiceStreamRef.current = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      voiceRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const duration = Math.min(60, Math.max(1, Math.round((Date.now() - voiceStartedAtRef.current) / 1000)))
        stream.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
        setRecordingPostId(null)
        setRecordingSeconds(0)
        if (voiceCancelledRef.current) return
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) return
        const url = URL.createObjectURL(blob)
        const reader = new FileReader()
        reader.onload = () => setVoiceDraft({ postId, url, audioData: String(reader.result), audioType: blob.type, duration, blob })
        reader.onerror = () => {
          URL.revokeObjectURL(url)
          setNotice('Nie udało się przygotować nagrania')
          window.setTimeout(() => setNotice(''), 2600)
        }
        reader.readAsDataURL(blob)
      }
      voiceStartedAtRef.current = Date.now()
      setRecordingSeconds(0)
      setRecordingPostId(postId)
      recorder.start(250)
    } catch {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      setNotice('Zezwól na dostęp do mikrofonu, aby nagrać komentarz')
      window.setTimeout(() => setNotice(''), 3000)
    }
  }

  function stopVoiceRecording() {
    if (voiceRecorderRef.current?.state === 'recording') voiceRecorderRef.current.stop()
  }

  function discardVoiceComment() {
    if (voiceRecorderRef.current?.state === 'recording') {
      voiceCancelledRef.current = true
      voiceRecorderRef.current.stop()
    }
    if (voiceDraft) URL.revokeObjectURL(voiceDraft.url)
    setVoiceDraft(null)
  }

  async function submitVoiceComment(event: FormEvent<HTMLFormElement>, postId: number) {
    event.preventDefault()
    if (!voiceDraft || voiceDraft.postId !== postId) return
    const post = posts.find((item) => item.id === postId)
    if (post?.serverBacked) {
      try {
        const uploaded = await uploadMedia(voiceDraft.blob)
        const { post: updated } = await authRequest<{ post: Post }>(`/api/posts/${postId}/comments`, { audioMediaId: uploaded.id })
        replaceSyncedPost(updated)
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się wysłać nagrania.')
        return
      }
      URL.revokeObjectURL(voiceDraft.url)
      setVoiceDraft(null)
      return
    }
    setPosts((current) => current.map((post) => post.id === postId ? {
      ...post,
      comments: [...post.comments, { id: Date.now(), author: currentUser, audioData: voiceDraft.audioData, audioType: voiceDraft.audioType, audioDuration: voiceDraft.duration }],
    } : post))
    URL.revokeObjectURL(voiceDraft.url)
    setVoiceDraft(null)
  }

  async function boostPost(id: number) {
    const existingPost = posts.find((post) => post.id === id)
    if (existingPost?.serverBacked) {
      try {
        const { post } = await authRequest<{ post: Post }>(`/api/posts/${id}/boost`, {})
        replaceSyncedPost(post)
      } catch (error: unknown) {
        showPostError(error, 'Nie udało się podbić posta.')
      }
      return
    }
    if (!existingPost || existingPost.bandId) return
    if (existingPost.boostedBy?.includes(currentUser.handle)) {
      setNotice('Już podbiłeś ten post')
      window.setTimeout(() => setNotice(''), 2600)
      return
    }
    setPosts((current) => {
      const post = current.find((item) => item.id === id)
      if (!post || post.bandId) return current
      return [{ ...post, boosts: post.boosts + 1, boostedBy: [...(post.boostedBy ?? []), currentUser.handle], time: 'przed chwilą' }, ...current.filter((item) => item.id !== id)]
    })
    setNotice('Post podbity na tablicy Ekipy')
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function pinBandPost(postId: number) {
    if (!band || !isBandView) return
    try {
      const { post } = await authRequest<{ post: Post }>(`/api/posts/${postId}/pin`, {})
      replaceSyncedPost(post)
    } catch (error: unknown) {
      showPostError(error, 'Nie udało się zmienić przypięcia posta.')
    }
  }

  async function sharePublicPostToBand(postId: number, targetBandId: string) {
    const sourcePost = posts.find((post) => post.id === postId && !post.bandId)
    const targetBand = accessibleBands.find((item) => item.id === targetBandId)
    if (!sourcePost || !targetBand) return
    try {
      const { post } = await authRequest<{ post: Post }>('/api/posts', {
        bandId: targetBand.id,
        sharedPostId: String(sourcePost.id),
      })
      setPosts((current) => [post, ...current])
      setActiveBandId(targetBand.id)
      setShareBandPostId(null)
      pushNavigation({ view: 'home', homeTab: 'band', chatMode: 'public' })
      setView('home')
      setHomeTab('band')
      setNotice(`Post udostępniono w Bandzie „${targetBand.name}”`)
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się udostępnić posta w bandzie.')
    }
    window.setTimeout(() => setNotice(''), 2600)
  }

  function toggleComments(id: number) {
    setOpenComments((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const viewTitle: Record<View, string> = {
    home: 'Twoja tablica',
    explore: 'Odkrywaj tematy',
    topiki: 'Topiki',
    crew: 'Twoja Ekipa',
    band: band?.name ?? 'Twoja Banda',
    notifications: 'Powiadomienia',
    support: 'Centrum pomocy',
    saved: 'Zapisane posty',
    profile: profile.handle === currentUser.handle ? 'Twój profil' : profile.name,
  }
  const isPostFeedView = view !== 'notifications' && view !== 'support' && !(view === 'home' && homeTab === 'chat')

  function renderPrivateRoom(isMinimized: boolean) {
    if (!activeChat) return null
    return <section className={`chat-private-room ${isMinimized ? 'is-minimized' : ''}`} aria-label={`Prywatny chat @${activeChat.nickname ?? activeChat.handle}`}>
      <header className="chat-room-header">
        <button className="chat-person-button" onClick={isMinimized ? restoreChatRoom : () => openProfile(activeChat)}>
          <img src={activeChat.avatar} alt="" />
          <span><strong>@{activeChat.nickname ?? activeChat.handle}{activeChat.profileVerified && <BadgeCheck className="verified-profile-badge" size={13} aria-label="Zweryfikowany profil" />}</strong><small>{isMinimized ? 'Przywróć chat' : 'Pokój prywatny'}</small></span>
        </button>
        <div className="chat-room-window-actions">
          {!isMinimized && <button type="button" onClick={() => void toggleChatMute(activeChat.handle)} aria-label={mutedChatHandles.includes(activeChat.handle) ? 'Włącz powiadomienia rozmowy' : 'Wycisz powiadomienia rozmowy'} title={mutedChatHandles.includes(activeChat.handle) ? 'Włącz powiadomienia' : 'Wycisz powiadomienia'}>{mutedChatHandles.includes(activeChat.handle) ? <Bell size={16} /> : <BellOff size={16} />}</button>}
          <button type="button" onClick={isMinimized ? restoreChatRoom : minimizeChatRoom} aria-label={isMinimized ? 'Otwórz chat' : 'Minimalizuj chat'} title={isMinimized ? 'Otwórz chat' : 'Minimalizuj chat'}>{isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</button>
          <button type="button" onClick={closeChatRoom} aria-label="Zamknij chat" title="Zamknij chat"><X size={17} /></button>
        </div>
      </header>
      {!isMinimized && <>
        {activeRoomInvitation?.to.handle === currentUser.handle && <div className="room-invitation-banner">{activeRoomInvitation.from.nickname ?? activeRoomInvitation.from.handle} zaprasza Cię do Ekipy.<button onClick={() => respondToCrewInvitation(activeRoomInvitation.id, true)}>Akceptuj</button><button className="decline-invite" onClick={() => respondToCrewInvitation(activeRoomInvitation.id, false)}>Odrzuć</button></div>}
        {activeRoomInvitation?.from.handle === currentUser.handle && <div className="room-invitation-status">Zaproszenie do Ekipy czeka na odpowiedź.</div>}
        <div className="chat-room-messages" aria-live="polite">
          {!crewHandles.includes(activeChat.handle) && <div className="chat-intro"><span><LockKeyhole size={19} /></span><strong>Rozmowa prywatna</strong><p>Wiadomości 1:1 będą dostępne po zaakceptowaniu zaproszenia do Ekipy.</p></div>}
          {roomMessages.map((message) => <article className={`room-message ${message.author.handle === currentUser.handle ? 'from-you' : ''}`} key={message.id}>{message.author.handle !== currentUser.handle && <img src={message.author.avatar} alt="" />}<div><p>{message.text}</p><small>{message.time}</small>{message.author.id && message.author.id !== currentUser.id && <button className="chat-report-button" onClick={() => reportContent('message', `message:${message.id}`, message.author, message.text)} aria-label="Zgłoś wiadomość" title="Zgłoś wiadomość"><Flag size={13} />Zgłoś</button>}</div></article>)}
        </div>
        <div className="room-actions">{crewHandles.includes(activeChat.handle) ? <span className="room-crew-status"><Check size={15} /> Jesteście w Ekipie</span> : activeRoomInvitation ? <span className="room-crew-status">Zaproszenie wysłane</span> : <button onClick={() => void sendCrewInvitation(activeChat)}><UsersRound size={15} /> Zaproś do Ekipy</button>}</div>
        <form className="chat-composer" onSubmit={sendRoomMessage}><input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder={crewHandles.includes(activeChat.handle) ? `Wiadomość do @${activeChat.nickname ?? activeChat.handle}...` : 'Dołączcie do Ekipy, aby rozmawiać prywatnie'} aria-label="Wiadomość prywatna" disabled={!crewHandles.includes(activeChat.handle)} /><button type="submit" disabled={!chatDraft.trim() || !crewHandles.includes(activeChat.handle)} aria-label="Wyślij wiadomość"><Send size={17} /></button></form>
      </>}
    </section>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#tablica" onClick={(event) => { event.preventDefault(); showView('home') }} aria-label="YouTopic, tablica">
          <img className="brand-mark" src="/youtopic-mark.svg" alt="" />
          <span>You<span className="brand-accent">Topic</span></span>
          <span className="beta-badge">beta</span>
        </a>
        <div className="search-area">
          <label className="search-box">
            <Search size={17} strokeWidth={1.8} />
            <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && matchingUsers[0]) openProfile(matchingUsers[0])
              if (event.key === 'Escape') setSearch('')
            }} placeholder="Szukaj ludzi, tematów..." aria-label="Szukaj użytkowników i tematów" autoComplete="off" />
            <kbd>⌘ K</kbd>
          </label>
          {search.trim() && <div className="search-results" role="listbox" aria-label="Wyniki wyszukiwania">
            <div className="search-results-section">
              <strong>UŻYTKOWNICY</strong>
              {matchingUsers.map((person) => {
                const isMember = crewHandles.includes(person.handle)
                const isPending = crewInvitations.some((invitation) => invitation.from.handle === currentUser.handle && invitation.to.handle === person.handle && invitation.status === 'pending')
                return <div className="search-user-result" key={person.handle}>
                  <button className="search-user-open" onClick={() => openProfile(person)}>
                    <img src={person.avatar} alt="" />
                    <span><strong>{person.name}</strong><small>@{person.handle}</small></span>
                  </button>
                  <button className="search-user-add" disabled={isMember || isPending} onClick={() => void sendCrewInvitation(person)}>{isMember ? 'W Ekipie' : isPending ? 'Wysłano' : <><Plus size={13} /> Dodaj</>}</button>
                </div>
              })}
              {matchingUsers.length === 0 && <p className="search-results-empty">Nie znaleziono użytkownika o tej nazwie.</p>}
            </div>
            {matchingTopics.length > 0 && <div className="search-results-section">
              <strong>TEMATY</strong>
              {matchingTopics.map((topic) => <button className="search-topic-result" key={normalizeTopicName(topic.name)} onClick={() => openTopic(topic.name)}><span>#</span>{topic.name}<small>{topic.count}</small></button>)}
            </div>}
          </div>}
        </div>
        <div className="topbar-actions">
          <button className="icon-button notification-top" aria-label={`Powiadomienia${unreadNotificationCount ? `, ${unreadNotificationCount} nieprzeczytanych` : ''}`} onClick={() => showView('notifications')}><Bell size={19} />{unreadNotificationCount > 0 && <i />}</button>
          <button className="profile-chip" onClick={() => openProfile(currentUser)}>
            <img src={currentUser.avatar} alt="" />
            <span>{currentUser.name.split(' ')[0]}</span>
            <ChevronDown size={14} />
          </button>
          <button className="icon-button logout-top" onClick={onLogout} aria-label="Wyloguj się" title="Wyloguj się"><LogOut size={17} /></button>
        </div>
      </header>
      <aside className="beta-announcement" role="note">
        <strong>Wersja beta</strong>
        <span>Testujemy YouTopic — część funkcji może działać niekompletnie. Dziękujemy za zgłaszanie uwag.</span>
      </aside>
      <div className="page-layout">
        <aside className="left-rail">
          <div className="rail-label">MENU GŁÓWNE</div>
          <nav className="primary-nav" aria-label="Menu główne">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-link ${view === id ? 'active' : ''}`} onClick={() => showView(id)}>
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
                {id === 'band' && unreadBandCount > 0 && <span className="band-unread-badge">{unreadBandCount > 9 ? '9+' : unreadBandCount}</span>}
                {id === 'notifications' && unreadNotificationCount > 0 && <span className="nav-count">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}
              </button>
            ))}
          </nav>
          <div className="rail-divider" />
          <div className="rail-label rail-label-row"><span>TEMATY</span><Settings2 size={15} /></div>
          <div className="topic-list">
            {sidebarTopics.map((topic, index) => <div className="rail-topic-row" key={normalizeTopicName(topic.name)}>
              <button className="rail-topic-open" onClick={() => openTopic(topic.name)}><span className={`topic-dot ${['coral', 'green', 'blue', 'coral'][index]}`} /><span>{topic.name}</span><small>{topic.count}</small></button>
              <button className={`rail-topic-follow ${followedTopics.includes(normalizeTopicName(topic.name)) ? 'is-following' : ''}`} onClick={() => toggleFollowTopic(topic.name)} aria-label={followedTopics.includes(normalizeTopicName(topic.name)) ? `Przestań obserwować temat ${topic.name}` : `Obserwuj temat ${topic.name}`} title={followedTopics.includes(normalizeTopicName(topic.name)) ? 'Obserwujesz' : 'Obserwuj'}>{followedTopics.includes(normalizeTopicName(topic.name)) ? <Check size={13} /> : <Plus size={13} />}</button>
            </div>)}
            {topicCatalog.length === 0 && <button className="topic-list-empty" onClick={() => showView('explore')}>Odkrywaj tematy</button>}
          </div>
          <div className="rail-promo">
            <Sparkles size={18} />
            <strong>Rozmowy mają moc.</strong>
            <p>Znajdź swój temat i poznaj ludzi, którzy myślą podobnie.</p>
            <button onClick={() => showView('explore')}>Odkrywaj <span>↗</span></button>
          </div>
          <button className="rail-profile" onClick={() => openProfile(currentUser)}>
            <img src={currentUser.avatar} alt="" />
            <span><strong>{currentUser.name}</strong><small>@{currentUser.handle}</small></span>
            <MoreHorizontal size={18} />
          </button>
        </aside>
        <main className="main-column">
          {announcements.filter((announcement) => !dismissedAnnouncements.includes(announcement.id)).map((announcement) => (
            <section className="community-announcement" key={announcement.id} aria-label="Komunikat administracji">
              <div><p className="eyebrow">KOMUNIKAT YOUTOPIC</p><strong>{announcement.title}</strong><p>{announcement.message}</p></div>
              <button aria-label={`Zamknij komunikat: ${announcement.title}`} onClick={() => {
                const next = [...dismissedAnnouncements, announcement.id]
                setDismissedAnnouncements(next)
                saveStored(storageKeys.dismissedAnnouncements, next)
              }}><X size={17} /></button>
            </section>
          ))}
          <div className="content-heading">
            <div>
              <p className="eyebrow">{dateLabel}</p>
              <h1>{view === 'home' && homeTab === 'band' ? band?.name ?? 'Twoja Banda' : view === 'explore' && selectedTopic ? selectedTopic : viewTitle[view]}<span className="heading-period">.</span></h1>
            </div>
            {view !== 'topiki' && <button className="filter-button"><Settings2 size={16} /> Najnowsze <ChevronDown size={14} /></button>}
          </div>
          {view === 'home' && <div className="home-tabs" role="tablist" aria-label="Widok główny">
            <button className={homeTab === 'board' ? 'active' : ''} role="tab" aria-selected={homeTab === 'board'} onClick={() => { pushNavigation({ view: 'home', homeTab: 'board', chatMode: 'public' }); setHomeTab('board') }}><Home size={16} /> Tablica</button>
            <button className={homeTab === 'chat' ? 'active' : ''} role="tab" aria-selected={homeTab === 'chat'} onClick={() => { pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'public' }); setChatMode('public'); setHomeTab('chat') }}><MessageCircle size={16} /> Chat<span>{chatContacts.length}</span></button>
            <button className={homeTab === 'band' ? 'active' : ''} role="tab" aria-selected={homeTab === 'band'} onClick={() => { pushNavigation({ view: 'home', homeTab: 'band', chatMode: 'public' }); setIsCreatingBand(false); setHomeTab('band'); if (band) markBandSeen(band.id) }}><LockKeyhole size={15} /> Banda{unreadBandCount > 0 && <span className="home-band-count">{unreadBandCount > 9 ? '9+' : unreadBandCount}</span>}</button>
          </div>}
          {view === 'home' && homeTab === 'board' && <div className="feed-mode-tabs" role="tablist" aria-label="Zakres tablicy">
            <button className={feedMode === 'for-you' ? 'active' : ''} role="tab" aria-selected={feedMode === 'for-you'} onClick={() => setFeedMode('for-you')}>Dla Ciebie</button>
            <button className={feedMode === 'following' ? 'active' : ''} role="tab" aria-selected={feedMode === 'following'} onClick={() => setFeedMode('following')}>Obserwowane <span>{followedTopics.length}</span></button>
          </div>}

          {view === 'home' && homeTab === 'board' && (
            <section className="stories" aria-label="Relacje Ekipy">
              <button className="story story-add" type="button" onClick={() => {
                const ownStory = currentPersonalStories.find((story) => story.author.handle === currentUser.handle)
                if (ownStory) openPersonalStory(ownStory.id)
                else {
                  setPersonalStoryError('')
                  setIsComposingPersonalStory(true)
                }
              }}>
                <span className={`story-ring ${currentPersonalStories.some((story) => story.author.handle === currentUser.handle) ? 'story-tone-2' : 'own-story'}`}><img src={currentUser.avatar} alt="" />{!currentPersonalStories.some((story) => story.author.handle === currentUser.handle) && <i><Plus size={14} /></i>}</span>
                <span>{currentPersonalStories.some((story) => story.author.handle === currentUser.handle) ? 'Twoja relacja' : 'Dodaj relację'}</span>
              </button>
              {currentPersonalStories.filter((story, index, stories) => story.author.handle !== currentUser.handle && stories.findIndex((item) => item.author.handle === story.author.handle) === index).map((story, index) => (
                <button className="story" key={story.author.handle} type="button" onClick={() => openPersonalStory(story.id)}>
                  <span className={`story-ring story-tone-${index % 3}`}><img src={story.author.avatar} alt="" /></span>
                  <span>{story.author.name.split(' ')[0]}</span>
                </button>
              ))}
            </section>
          )}

          {view === 'home' && homeTab === 'board' && (
            <form className="composer" onSubmit={publish}>
              <div className="composer-top">
                <button type="button" className="avatar-button" onClick={() => openProfile(currentUser)}><img src={currentUser.avatar} alt="Twój profil" /></button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Co chodzi Ci po głowie, ${currentUser.name.split(' ')[0]}?`} rows={2} />
              </div>
              {isChoosingDraftTopic && <label className="composer-topic-field">TEMAT<input value={draftTopic} onChange={(event) => setDraftTopic(event.target.value)} placeholder="np. Podróże, Kuchnia..." maxLength={50} list="available-topics" /><datalist id="available-topics">{topicCatalog.map((topic) => <option key={normalizeTopicName(topic.name)} value={topic.name} />)}</datalist></label>}
              {media && (
                <div className="media-preview">
                  {media.kind === 'image' ? <img src={media.url} alt="Podgląd załączonego zdjęcia" /> : <video src={media.url} controls />}
                  <button type="button" aria-label="Usuń załącznik" onClick={() => setMedia(null)}><X size={16} /></button>
                  <span>{media.name}</span>
                </div>
              )}
              <div className="composer-bottom">
                <div className="composer-tools">
                  <input ref={fileInput} type="file" accept="image/*,video/*" onChange={chooseMedia} hidden />
                  <button type="button" onClick={() => fileInput.current?.click()}><Image size={17} /><span>Zdjęcie</span></button>
                  <button type="button" onClick={() => fileInput.current?.click()}><Video size={17} /><span>Krótki film</span></button>
                  <button type="button" className="topic-compose" onClick={() => setIsChoosingDraftTopic((current) => !current)} aria-label="Dodaj temat" title="Dodaj temat"><Sparkles size={16} /><span>Temat</span></button>
                </div>
                <button className="publish-button" type="submit" disabled={!draft.trim() && !media}>Opublikuj <Send size={14} /></button>
              </div>
            </form>
          )}

          {view === 'home' && homeTab === 'chat' && <section className="chat-stage">
            {chatMode === 'public' ? <>
              <header className="chat-stage-heading"><div><span className="chat-kicker">ROZMOWA DLA WSZYSTKICH</span><h2>Czat YouTopic</h2><p>Napisz na forum albo wybierz osobę, żeby przejść do prywatnego Pokoju.</p></div><span className="chat-users-count"><UsersRound size={15} />{allUsers.length} osób</span></header>
              {unreadChatCounts.size > 0 && <section className="chat-unread-inbox" aria-label="Nieprzeczytane wiadomości">
                <strong>PRYWATNE WIADOMOŚCI</strong>
                <div>{[...unreadChatCounts].map(([handle, count]) => {
                  const person = allUsers.find((candidate) => candidate.handle === handle)
                  if (!person) return null
                  return <button className="chat-unread-contact" key={handle} onClick={() => openChatRoom(person)}><img src={person.avatar} alt="" /><span>@{person.nickname ?? person.handle}</span><b>{count}</b></button>
                })}</div>
              </section>}
              <div className="chat-public-messages" aria-live="polite">
                {publicChatMessages.map((message) => <article className={`public-chat-message ${message.author.handle === currentUser.handle ? 'from-you' : ''}`} key={message.id}>
                  <button className="public-chat-avatar" onClick={() => openChatRoom(message.author)}><img src={message.author.avatar} alt="" />{message.author.online && <i />}</button>
                  <div className="public-chat-message-body"><div className="public-chat-message-meta"><button onClick={() => openChatRoom(message.author)}>@{message.author.nickname ?? message.author.handle}{message.author.profileVerified && <BadgeCheck className="verified-profile-badge" size={13} aria-label="Zweryfikowany profil" />}</button><time>{message.time}</time></div><p>{message.text}</p></div>
                  {message.author.id && message.author.id !== currentUser.id && <button className="chat-report-button" onClick={() => void reportContent('message', `message:${message.id}`, message.author, message.text)} aria-label="Zgłoś wiadomość" title="Zgłoś wiadomość"><Flag size={15} /></button>}
                  <button className="public-chat-room-link" onClick={() => openChatRoom(message.author)} aria-label={`Napisz prywatnie do ${message.author.name}`} title="Przejdź do Pokoju"><MessageCircle size={16} /></button>
                </article>)}
                {publicChatMessages.length === 0 && <div className="chat-intro"><span><MessageCircle size={19} /></span><strong>Rozpocznij rozmowę</strong><p>Napisz wiadomość jako pierwszy.</p></div>}
              </div>
              <form className="chat-public-composer" onSubmit={sendPublicChatMessage}><input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Napisz do wszystkich..." aria-label="Wiadomość publiczna" /><button type="submit" disabled={!chatDraft.trim()} aria-label="Wyślij wiadomość"><Send size={17} /></button></form>
              {roomMinimized && activeChat && renderPrivateRoom(true)}
            </> : activeChat ? renderPrivateRoom(false) : <div className="chat-no-contacts"><UsersRound size={24} /><strong>Nie znaleziono użytkownika</strong><p>Wróć do czatu publicznego i wybierz inną osobę.</p><button onClick={() => setChatMode('public')}>Wróć do czatu</button></div>}
          </section>}

          {isBandView && band && !isCreatingBand && <section className="band-switcher" aria-label="Twoje bandy">
            {accessibleBands.map((item) => <button className={item.id === band.id ? 'active' : ''} key={item.id} onClick={() => { setActiveBandId(item.id); setIsCreatingBand(false); markBandSeen(item.id) }}><LockKeyhole size={14} />{item.name}</button>)}
            <button className="band-new-button" onClick={() => setIsCreatingBand(true)}><Plus size={15} />Nowa banda</button>
          </section>}

          {isBandView && (!band || isCreatingBand) && <section className="band-setup">
            <div className="band-setup-mark"><LockKeyhole size={24} /></div>
            <p className="band-kicker">PRYWATNA PRZESTRZEŃ</p>
            <h2>{band ? 'Stwórz kolejną Bandę' : 'Stwórz swoją Bandę'}</h2>
            <p className="band-description">Wybierz nazwę i zaproś osoby ze swojej Ekipy. Tylko członkowie zobaczą posty i rozmowy.</p>
            {band && <button className="band-cancel-create" onClick={() => setIsCreatingBand(false)}>Wróć do {band.name}</button>}
            <form className="band-setup-form" onSubmit={createBand}>
              <label>Nazwa bandy<input value={bandName} onChange={(event) => setBandName(event.target.value)} placeholder="np. Weekendowi odkrywcy" maxLength={40} required /></label>
              <fieldset className="band-invite-list">
                <legend>Dodaj ekipowiczów <span>{selectedBandHandles.length} wybranych</span></legend>
                {allUsers.filter((person) => crewHandles.includes(person.handle)).map((person) => <label className="band-invite-person" key={person.handle}>
                  <input type="checkbox" checked={selectedBandHandles.includes(person.handle)} onChange={() => toggleBandInvite(person.handle)} />
                  <img src={person.avatar} alt="" />
                  <span><strong>{person.name}</strong><small>@{person.handle}</small></span>
                </label>)}
                {crewHandles.length === 0 && <p className="band-no-crew">Najpierw dodaj osoby do Ekipy, aby móc je zaprosić.</p>}
              </fieldset>
              <button className="band-create-button" type="submit"><LockKeyhole size={16} /> Utwórz Bandę</button>
            </form>
          </section>}

          {isBandView && band && !isCreatingBand && <>
            <section className="band-banner">
              <div className="band-banner-icon"><LockKeyhole size={20} /></div>
              <div className="band-banner-copy"><span>PRYWATNA BANDA</span><h2>{band.name}</h2><p>Tylko Ty i zaproszeni ekipowicze widzicie tę tablicę.</p></div>
              <div className="band-banner-actions">
                <span className="band-member-count"><UsersRound size={15} />{bandMembers.length + 1} osób</span>
                {band.adminHandle === currentUser.handle && <details className="band-invite-control">
                  <summary aria-label="Dodaj ekipowiczów do bandy" title="Dodaj ekipowiczów"><Plus size={17} /></summary>
                  <div className="band-invite-menu"><strong>Dodaj do bandy</strong>
                    {allUsers.filter((person) => crewHandles.includes(person.handle) && !band.memberHandles.includes(person.handle)).map((person) => <button key={person.handle} onClick={() => toggleBandMember(person.handle)}><img src={person.avatar} alt="" />{person.name}<Plus size={14} /></button>)}
                    {allUsers.every((person) => !crewHandles.includes(person.handle) || band.memberHandles.includes(person.handle)) && <small>Wszyscy z Ekipy są już w tej Bandzie.</small>}
                  </div>
                </details>}
              </div>
            </section>
            <section className="band-stories" aria-label="Relacje członków bandy">
              <div className="band-stories-heading"><span>RELACJE BANDY</span><small>Znikają po 24 godzinach</small></div>
              <div className="band-story-list">
                <button className="band-story band-story-create" onClick={() => storyTextInput.current?.focus()}>
                  <span className="band-story-ring"><img src={currentUser.avatar} alt="" /><i><Plus size={13} /></i></span><span>Twoja relacja</span>
                </button>
                {currentBandStories.map((story) => <button className="band-story" key={story.id} onClick={() => openBandStory(story.id)}>
                  <span className="band-story-ring"><img src={story.author.avatar} alt="" /></span><span>{story.author.name.split(' ')[0]}</span>
                </button>)}
              </div>
              <form className="band-story-composer" onSubmit={publishBandStory}>
                <input ref={storyTextInput} value={storyDraft} onChange={(event) => setStoryDraft(event.target.value)} placeholder="Krótka relacja dla bandy..." aria-label="Treść relacji" />
                <input ref={storyFileInput} type="file" accept="image/*,video/*" onChange={chooseStoryMedia} hidden />
                {storyMedia && <span className="story-media-label">{storyMedia.kind === 'image' ? 'Zdjęcie gotowe' : 'Film gotowy'}</span>}
                <button type="button" className="story-attach-button" onClick={() => storyFileInput.current?.click()} aria-label="Dodaj zdjęcie lub film do relacji"><Image size={16} /></button>
                <button type="submit" className="story-publish-button" disabled={!storyDraft.trim() && !storyMedia}>Dodaj relację</button>
              </form>
            </section>
            <form className="composer band-composer" onSubmit={(event) => publish(event, 'band')}>
              <div className="composer-top">
                <button type="button" className="avatar-button" onClick={() => openProfile(currentUser)}><img src={currentUser.avatar} alt="Twój profil" /></button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Podziel się czymś z Bandą, ${currentUser.name.split(' ')[0]}...`} rows={2} />
              </div>
              <label className="band-topic-field">TEMAT<input value={bandTopic} onChange={(event) => setBandTopic(event.target.value)} placeholder="np. Plany na weekend" maxLength={50} required /></label>
              <label className="band-link-field">LINK ZEWNĘTRZNY<input type="url" value={bandLink} onChange={(event) => setBandLink(event.target.value)} placeholder="https://... (opcjonalnie)" /></label>
              {media && <div className="media-preview">
                {media.kind === 'image' ? <img src={media.url} alt="Podgląd załączonego zdjęcia" /> : <video src={media.url} controls />}
                <button type="button" aria-label="Usuń załącznik" onClick={() => setMedia(null)}><X size={16} /></button>
                <span>{media.name}</span>
              </div>}
              <div className="composer-bottom">
                <div className="composer-tools">
                  <input ref={fileInput} type="file" accept="image/*,video/*" onChange={chooseMedia} hidden />
                  <button type="button" onClick={() => fileInput.current?.click()}><Image size={17} /><span>Zdjęcie</span></button>
                  <button type="button" onClick={() => fileInput.current?.click()}><Video size={17} /><span>Krótki film</span></button>
                </div>
                <button className="publish-button" type="submit" disabled={(!draft.trim() && !media && !bandLink.trim()) || !bandTopic.trim()}>Opublikuj w Bandzie <Send size={14} /></button>
              </div>
            </form>
          </>}

          {view === 'explore' && <>
            <section className="explore-banner"><span className="explore-icon"><Compass size={22} /></span><div><strong>{selectedTopic ? `Rozmowy o: ${selectedTopic}` : 'Znajdź swoją rozmowę'}</strong><p>{selectedTopic ? 'Posty i Topiki przypisane do wybranego tematu.' : 'Obserwuj tematy, które Cię ciekawią. Zobaczysz je później w zakładce „Obserwowane”.'}</p></div>{selectedTopic && <button className="clear-topic-filter" onClick={() => setSelectedTopic('')}>Wszystkie tematy</button>}</section>
            {!selectedTopic && <TopicDiscoveryPanel topics={topicCatalog} followedTopics={followedTopics} onOpen={openTopic} onToggleFollow={toggleFollowTopic} />}
            <SuggestedProfiles people={suggestedProfiles} boostCounts={profileBoostCounts} onOpen={openProfile} onAdd={sendCrewInvitation} onDismiss={dismissSuggestedProfile} />
          </>}

          {view === 'crew' && <section className="crew-panel">
            <div className="section-caption">TWOJA EKIPA <span>{crewHandles.length} w Ekipie</span></div>
            {platformUsers.filter((person) => person.handle !== currentUser.handle).map((person) => {
              const isMember = crewHandles.includes(person.handle)
              const isPending = crewInvitations.some((invitation) => invitation.from.handle === currentUser.handle && invitation.to.handle === person.handle && invitation.status === 'pending')
              const memberCount = person.crewMembers
              return <div className="crew-row" key={person.handle}><button className="crew-person" onClick={() => openProfile(person)}><img src={person.avatar} alt="" /><span><strong>{person.name}</strong><small>@{person.handle} · {memberCount} Ekipowiczów</small></span></button><button className={`follow-button ${isMember ? 'following' : ''} ${isPending ? 'invite-pending' : ''}`} onClick={() => toggleCrew(person)}>{isMember ? <><X size={14} /> Usuń z Ekipy</> : isPending ? <><X size={14} /> Anuluj zaproszenie</> : <><Plus size={14} /> Dodaj do Ekipy</>}</button></div>
            })}
            {platformUsers.filter((person) => person.handle !== currentUser.handle).length === 0 && <p className="crew-empty">Nie znaleziono jeszcze innych kont. Skorzystaj z wyszukiwarki, gdy pojawią się nowi użytkownicy.</p>}
          </section>}

          {view === 'notifications' && <section className="notifications-panel">
            {reportNotifications.length > 0 && <>
              <div className="section-caption">DECYZJE ZGŁOSZEŃ <span>{reportNotifications.length}</span></div>
              {reportNotifications.map((notification) => <div className="notification-row report-decision-notification" key={notification.id}>
                <img src="/youtopic-mark.svg" alt="" />
                <p><strong>YouTopic — moderacja</strong><br />{notification.message}<small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(notification.createdAt)}</small></p>
                <Flag size={17} />
              </div>)}
            </>}
            <div className="section-caption">AKTYWNOŚĆ <span>{unreadNotificationCount ? `${unreadNotificationCount} nieprzeczytanych` : 'Wszystko przeczytane'}</span></div>
            {socialNotifications.map((notification) => {
              const Icon = notification.type === 'like' || notification.type === 'comment_like' ? Heart
                : notification.type === 'boost' ? ArrowUp
                  : notification.type === 'chat_message' ? MessageCircle
                    : UsersRound
              const invitation = notification.type === 'crew_invitation'
                ? incomingCrewInvitations.find((item) => item.id === notification.crewInvitationId
                  || item.from.handle === notification.actor?.handle)
                : undefined
              const markRead = () => {
                if (notification.readAt) return
                void authPatch<{ ok: true }>('/api/notifications/read', { id: notification.id })
                  .then(() => setSocialNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: Date.now() } : item)))
                  .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Nie udało się oznaczyć powiadomienia.'))
              }
              return <div className={`notification-row ${notification.readAt ? '' : 'is-unread'} ${invitation ? 'has-notification-actions' : ''}`} key={notification.id}>
                <img src={notification.actor?.avatar ?? '/youtopic-mark.svg'} alt="" />
                <button className="notification-main" type="button" onClick={() => {
                  if (notification.type === 'chat_message' && notification.chatHandle) {
                    const person = allUsers.find((candidate) => candidate.handle === notification.chatHandle)
                      ?? (notification.actor?.handle === notification.chatHandle ? notification.actor : undefined)
                    if (!person) {
                      setNotice('Nie znaleziono użytkownika z tej rozmowy. Odśwież stronę i spróbuj ponownie.')
                    } else {
                      void markChatNotificationsRead(person.handle)
                      setAllUsers((current) => current.some((candidate) => candidate.handle === person.handle) ? current : [...current, person])
                      pushNavigation({ view: 'home', homeTab: 'chat', chatMode: 'room', activeChatHandle: person.handle })
                      setView('home')
                      setHomeTab('chat')
                      setChatMode('room')
                      setActiveChatHandle(person.handle)
                      setRoomMinimized(false)
                      setChatDraft('')
                    }
                  }
                  if (notification.postId) void openNotificationPost(notification.postId)
                  if (notification.type === 'crew_accepted') {
                    pushNavigation({ view: 'crew', homeTab: 'board', chatMode: 'public', activeChatHandle: '' })
                    setView('crew')
                  }
                  markRead()
                }}>
                  <p><strong>{notification.actor?.nickname ?? notification.actor?.handle ?? 'Użytkownik'}</strong> {notification.message}<small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(notification.createdAt)}</small></p>
                </button>
                {invitation
                  ? <div className="notification-actions"><button type="button" onClick={() => { void respondToCrewInvitation(invitation.id, true).then((success) => { if (success) markRead() }) }}>Akceptuj</button><button type="button" className="decline-invite" onClick={() => { void respondToCrewInvitation(invitation.id, false).then((success) => { if (success) markRead() }) }}>Odrzuć</button></div>
                  : notification.readAt ? <Icon size={17} /> : <span className="notification-unread" />}
              </div>
            })}
            {socialNotifications.length === 0 && <p className="support-empty">Nie masz jeszcze powiadomień o aktywności.</p>}
            <SuggestedProfiles people={suggestedProfiles} boostCounts={profileBoostCounts} onOpen={openProfile} onAdd={sendCrewInvitation} onDismiss={dismissSuggestedProfile} />
          </section>}

          {view === 'support' && <section className="support-panel">
            <div className="support-intro"><span><LifeBuoy size={22} /></span><div><strong>W czym możemy pomóc?</strong><p>Opisz problem lub pomysł. Odpowiedź zespołu znajdziesz tutaj.</p></div></div>
            <form className="support-request-form" onSubmit={submitSupportTicket}>
              <label>Temat sprawy<input value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)} maxLength={120} required placeholder="Krótko opisz sprawę" /></label>
              <label>Kategoria<select value={supportCategory} onChange={(event) => setSupportCategory(event.target.value as SupportTicket['category'])}><option value="account">Konto</option><option value="technical">Problem techniczny</option><option value="security">Bezpieczeństwo</option><option value="idea">Pomysł lub sugestia</option><option value="other">Inne</option></select></label>
              <label>Opis<textarea value={supportMessage} onChange={(event) => setSupportMessage(event.target.value)} minLength={10} maxLength={5000} rows={5} required placeholder="Podaj szczegóły, które pomogą nam rozwiązać sprawę..." /></label>
              <button className="publish-button" type="submit" disabled={supportBusy}>{supportBusy ? 'Wysyłanie…' : 'Wyślij do pomocy'} <Send size={15} /></button>
            </form>
            <div className="section-caption">TWOJE SPRAWY <button type="button" onClick={() => {
              void authRequest<{ tickets: SupportTicket[] }>('/api/support/tickets')
                .then(({ tickets }) => setSupportTickets(tickets))
                .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Nie udało się odświeżyć spraw.'))
            }}>Odśwież</button></div>
            {supportTickets.length === 0 && <p className="support-empty">Nie masz jeszcze wysłanych spraw.</p>}
            <div className="support-own-tickets">{supportTickets.map((ticket) => <article className="support-own-ticket" key={ticket.id}>
              <header><strong>{ticket.subject}</strong><span className={`ticket-status status-${ticket.status}`}>{ticket.status === 'resolved' ? 'Rozwiązana' : ticket.status === 'in_progress' ? 'W trakcie' : 'Otwarta'}</span></header>
              <small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(ticket.updatedAt)}</small>
              {ticket.messages.map((item) => <div className={`support-own-message ${item.authorType}`} key={item.id}><strong>{item.authorType === 'admin' ? `Zespół YouTopic · ${item.authorName}` : 'Ty'}</strong><p>{item.message}</p></div>)}
            </article>)}</div>
          </section>}

          {view === 'profile' && <ProfileHeader person={profile} isOwn={profile.handle === currentUser.handle} isCrewMember={crewHandles.includes(profile.handle)} isBlocked={blockedUsers.some((user) => user.id === profile.id)} blockedPeople={blockedUsers} onToggleBlock={(person) => void toggleUserBlock(person)} isEditingProfile={isEditingProfile} nicknameDraft={nicknameDraft} firstNameDraft={firstNameDraft} middleNameDraft={middleNameDraft} lastNameDraft={lastNameDraft} secondLastNameDraft={secondLastNameDraft} locationDraft={locationDraft} contactPhoneDraft={contactPhoneDraft} secondContactPhoneDraft={secondContactPhoneDraft} bioDraft={bioDraft} avatarDraft={avatarDraft} coverImageDraft={coverImageDraft} socialLinksDraft={socialLinksDraft} profileVisibilityDraft={profileVisibilityDraft} socialPrivacyDraft={socialPrivacyDraft} profileError={profileError} isSavingProfile={isSavingProfile} onEditProfile={beginProfileEdit} onNicknameDraftChange={setNicknameDraft} onFirstNameDraftChange={setFirstNameDraft} onMiddleNameDraftChange={setMiddleNameDraft} onLastNameDraftChange={setLastNameDraft} onSecondLastNameDraftChange={setSecondLastNameDraft} onLocationDraftChange={setLocationDraft} onContactPhoneDraftChange={setContactPhoneDraft} onSecondContactPhoneDraftChange={setSecondContactPhoneDraft} onBioDraftChange={setBioDraft} onSocialLinksDraftChange={setSocialLinksDraft} onProfileVisibilityDraftChange={setProfileVisibilityDraft} onSocialPrivacyDraftChange={setSocialPrivacyDraft} onImageChange={changeProfileImage} onSaveProfile={saveProfile} onCancelProfile={cancelProfileEdit} isCrewInvitationPending={crewInvitations.some((invitation) => invitation.from.handle === currentUser.handle && invitation.to.handle === profile.handle && invitation.status === 'pending')} isBandAdmin={Boolean(band && profile.handle === band.adminHandle)} onToggleCrew={() => toggleCrew(profile)} onPromote={() => setProfileBoostTarget(profile)} onReportProfile={() => void reportProfile(profile)} postCount={posts.filter((post) => post.author.handle === profile.handle).length} />}
          {view === 'profile' && <nav className="profile-content-tabs" aria-label="Zawartość profilu">
            <button type="button" className={profileTab === 'posts' ? 'active' : ''} onClick={() => setProfileTab('posts')}>Posty</button>
            <button type="button" className={profileTab === 'gallery' ? 'active' : ''} onClick={() => setProfileTab('gallery')}>Galeria</button>
          </nav>}
          {view === 'profile' && profileTab === 'gallery' && <ProfileGallery
            person={profile}
            isOwn={profile.handle === currentUser.handle}
            onPostPhotoDeleted={(postId) => setPosts((current) => current.flatMap((post) => {
              if (post.id !== Number(postId)) return [post]
              return post.text || post.video || post.externalUrl || post.sharedFrom ? [{ ...post, image: undefined }] : []
            }))}
          />}

          {showPostFeed && showProfilePosts && <div className="feed-label">
            <span>{view === 'topiki' ? 'FILMY SPOŁECZNOŚCI' : view === 'saved' ? 'KOLEKCJA' : view === 'profile' ? 'POSTY' : view === 'explore' ? 'NA TEMAT' : isBandView ? 'ZAMKNIĘTA TABLICA BANDY' : view === 'home' ? 'OD EKIPY I POLECONE POSTY' : view === 'crew' ? 'POSTY Z TWOJEJ EKIPY' : 'POSTY Z TABLICY'}</span>
            {view !== 'topiki' && <button>Wszystkie tematy <ChevronDown size={14} /></button>}
          </div>}

          {showPostFeed && showProfilePosts && <div className={view === 'topiki' ? 'topiki-player-shell' : undefined} tabIndex={view === 'topiki' ? 0 : undefined} onKeyDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return
            if (view === 'topiki' && event.key === 'ArrowLeft') { event.preventDefault(); navigateTopiki(-1) }
            if (view === 'topiki' && event.key === 'ArrowRight') { event.preventDefault(); navigateTopiki(1) }
          }}>
            {view === 'topiki' && <div className="topiki-player-controls" aria-label="Nawigacja po Topikach">
              <button type="button" onClick={() => navigateTopiki(-1)} disabled={activeTopikiIndex <= 0 || filteredPosts.length === 0} aria-label="Poprzedni Topik" title="Poprzedni"><ChevronLeft size={21} /></button>
              <button type="button" onClick={() => navigateTopiki(1)} disabled={activeTopikiIndex >= filteredPosts.length - 1} aria-label="Następny Topik" title="Następny"><ChevronRight size={21} /></button>
            </div>}
            <div className={`post-list ${view === 'topiki' ? 'topiki-player-feed' : ''}`} ref={view === 'topiki' ? topikiFeedRef : undefined} tabIndex={view === 'topiki' ? 0 : undefined} aria-label={view === 'topiki' ? 'Odtwarzacz Topików' : undefined}>
            {isPostFeedView && postsLoading && <div className="feed-status" role="status"><span className="feed-status-spinner" />Ładowanie wpisów z serwera…</div>}
            {isPostFeedView && !postsLoading && postsError && <div className="feed-status feed-status-error" role="alert">
              <strong>Nie udało się pobrać tablicy</strong>
              <p>{postsError}</p>
              <button className="empty-state-action" type="button" onClick={() => setPostsRetryKey((key) => key + 1)}>Spróbuj ponownie</button>
            </div>}
            {filteredPosts.map((post, index) => (
              <Fragment key={post.id}>
              <article className={`post-card ${view === 'topiki' ? 'topiki-player-card' : ''}`} id={`post-${post.id}`} data-topiki-index={view === 'topiki' ? index : undefined}>
                <div className="post-header">
                  <button className="post-author" onClick={() => openProfile(post.author)}>
                    <img src={post.author.avatar} alt="" />
                    <span><strong>{post.author.name}{post.author.profileVerified && <BadgeCheck className="verified-profile-badge" size={14} aria-label="Zweryfikowany profil" />}{band && post.bandId === band.id && post.author.handle === band.adminHandle && <span className="admin-badge">Admin</span>}</strong><small>@{post.author.handle} <i>·</i> {formatPostTime(post.createdAt)}</small></span>
                  </button>
                  {post.author.id && post.author.id !== currentUser.id
                    ? <button className="post-menu" aria-label="Zgłoś post" title="Zgłoś post" onClick={() => void reportContent('post', `post:${post.id}`, post.author, post.text)}><Flag size={18} /></button>
                    : <button className="post-menu" aria-label="Więcej opcji"><MoreHorizontal size={20} /></button>}
                </div>
                <button className="post-topic" onClick={() => openTopic(post.topic)}><span className="topic-hash">#</span>{post.topic}</button>
                {post.sharedFrom && <div className="band-shared-origin">Udostępniono z Tablicy: <strong>{post.sharedFrom.author.name}</strong><span>#{post.sharedFrom.topic}</span></div>}
                {post.profileTarget && <button className="promoted-profile-card" onClick={() => openProfile(post.profileTarget!)}><img src={post.profileTarget.avatar} alt="" /><span><small>POLECANY PROFIL</small><strong>{post.profileTarget.name}</strong><small>@{post.profileTarget.handle}</small></span><ArrowUp size={16} /></button>}
                {post.text && (view === 'topiki' ? <TopikiDescription text={post.text} /> : <p className="post-copy">{post.text}</p>)}
                {post.image && !moderatedItems.some((item) => item.targetType === 'photo' && item.targetId === `photo:${post.id}` && item.targetUserId === post.author.id) && <><img className="post-image" src={post.image} alt="Zdjęcie dołączone do posta" loading="lazy" decoding="async" />{post.author.id && post.author.id !== currentUser.id && <button className="media-report-button" type="button" onClick={() => void reportContent('photo', `photo:${post.id}`, post.author, post.text, post.image)}>Zgłoś zdjęcie</button>}</>}
                {post.video && !moderatedItems.some((item) => item.targetType === 'video' && item.targetId === `video:${post.id}` && item.targetUserId === post.author.id) && <>{view === 'topiki'
                  ? <TopikiVideo src={post.video} autoAdvance={autoAdvanceTopiki} onAutoAdvanceChange={setAutoAdvanceTopiki} onEnded={() => navigateTopiki(1)} />
                  : view === 'home' && homeTab === 'board'
                    ? <button type="button" className="topiki-feed-preview" onClick={() => openTopikiFromPost(post.id)} aria-label={`Otwórz Topik autora ${post.author.name}`}><video src={post.video} muted playsInline preload="metadata" /><span><Play size={18} fill="currentColor" />Oglądaj Topik</span></button>
                    : <video className="post-image" src={post.video} controls playsInline preload="none" />}{post.author.id && post.author.id !== currentUser.id && <button className="media-report-button" type="button" onClick={() => void reportContent('video', `video:${post.id}`, post.author, post.text, post.video)}>Zgłoś wideo</button>}</>}
                {post.externalUrl && <a className="post-external-link" href={post.externalUrl} target="_blank" rel="noreferrer"><span>LINK ZEWNĘTRZNY</span><strong>{post.externalUrl}</strong></a>}
                <div className="post-stats"><button onClick={() => toggleComments(post.id)}>{post.comments.length} komentarze</button><span>{boostLabel(post.boosts)}</span></div>
                {isBandView && <div className="post-read-receipts">
                  <button onClick={() => setOpenViewers(openViewers === post.id ? null : post.id)}><Eye size={14} />{post.seenBy?.length ?? 0} widziało</button>
                  {openViewers === post.id && <div className="post-viewer-list">
                    <strong>Wyświetlili</strong>
                    {(post.seenBy ?? []).map((handle) => {
                      const viewer = handle === currentUser.handle ? currentUser : post.seenPeople?.find((person) => person.handle === handle) ?? people.find((person) => person.handle === handle)
                      return viewer && <span key={handle}><img src={viewer.avatar} alt="" />{viewer.name}</span>
                    })}
                    {post.seenBy?.length === 0 && <small>Nikt jeszcze nie widział tego posta.</small>}
                  </div>}
                </div>}
                <div className="post-actions">
                  <button className={post.liked ? 'is-liked' : ''} onClick={() => togglePost(post.id, 'liked')} aria-label={view === 'topiki' ? 'Polub Topik' : 'Polub post'}><Heart size={18} fill={post.liked ? 'currentColor' : 'none'} /><span>{view === 'topiki' ? post.likes : `${post.likes} Lubię to`}</span></button>
                  <button className={openComments.includes(post.id) ? 'action-selected' : ''} onClick={() => toggleComments(post.id)} aria-label="Komentarze"><MessageCircle size={18} /><span>{view === 'topiki' ? post.comments.length : 'Komentuj'}</span></button>
                  {isBandView ? <button className={`pin-band-action ${post.pinnedAt ? 'is-pinned' : ''}`} onClick={() => pinBandPost(post.id)} aria-label={post.pinnedAt ? 'Odepnij post' : 'Przypnij post'} title={post.pinnedAt ? 'Odepnij post' : 'Przypnij post'}><Pin size={17} fill={post.pinnedAt ? 'currentColor' : 'none'} /><span>{post.pinnedAt ? 'Przypięto' : 'Przypnij'}</span></button> : <button onClick={() => boostPost(post.id)} aria-label={view === 'topiki' ? 'Podbij Topik' : 'Podbij post'}><ArrowUp size={17} /><span>{view === 'topiki' ? post.boosts : 'Podbij'}</span></button>}
                  {!isBandView && view === 'home' && homeTab === 'board' && !post.bandId && accessibleBands.length > 0 && <div className="share-band-control"><button onClick={() => setShareBandPostId(shareBandPostId === post.id ? null : post.id)} aria-label="Udostępnij w Bandzie" title="Udostępnij do prywatnej Bandy"><Share2 size={17} /><span>Do Bandy</span></button>{shareBandPostId === post.id && <div className="share-band-menu"><strong>Udostępnij do Bandy</strong>{accessibleBands.map((item) => <button key={item.id} onClick={() => sharePublicPostToBand(post.id, item.id)}><LockKeyhole size={14} />{item.name}</button>)}</div>}</div>}
                  <button className={`save-action ${post.saved ? 'is-saved' : ''}`} aria-label={post.saved ? 'Usuń z zapisanych' : 'Zapisz post'} onClick={() => togglePost(post.id, 'saved')}><Bookmark size={18} fill={post.saved ? 'currentColor' : 'none'} /></button>
                </div>
                {openComments.includes(post.id) && <div className="comments-section">
                  {(() => {
                    const comments = normalizePostComments(post)
                    const visibleComments = comments.filter((comment) => !moderatedItems.some((item) => item.targetType === 'comment' && item.targetId === `comment:${post.id}:${comment.id}` && item.targetUserId === comment.author.id))
                    return visibleComments.filter((comment) => !comment.replyToId).map((comment) => <CommentThread key={comment.id} comment={comment} comments={visibleComments} currentUser={currentUser} onLike={(commentId) => toggleCommentLike(post.id, commentId)} onReply={(reply) => setReplyingTo((current) => ({ ...current, [post.id]: reply }))} onDelete={(commentId) => deleteOwnComment(post.id, commentId)} onReport={(commentId) => {
                      const reportedComment = visibleComments.find((item) => item.id === commentId)
                      if (reportedComment) void reportContent('comment', `comment:${post.id}:${reportedComment.id}`, reportedComment.author, reportedComment.text ?? '')
                    }} />)
                  })()}
                  <form className="comment-form" onSubmit={(event) => submitComment(event, post.id)}>
                    <img src={currentUser.avatar} alt="" />
                    <input value={commentDraft[post.id] ?? ''} onChange={(event) => setCommentDraft((current) => ({ ...current, [post.id]: event.target.value }))} placeholder={replyingTo[post.id] ? `Odpowiedź do ${replyingTo[post.id]?.author.name}...` : 'Napisz komentarz...'} aria-label={replyingTo[post.id] ? 'Treść odpowiedzi' : 'Treść komentarza'} />
                    {replyingTo[post.id] && <button type="button" className="cancel-reply-button" onClick={() => setReplyingTo((current) => ({ ...current, [post.id]: null }))} aria-label="Anuluj odpowiedź"><X size={14} /></button>}
                    <button type="submit" aria-label="Wyślij komentarz" disabled={!commentDraft[post.id]?.trim()}><Send size={16} /></button>
                    <button type="button" className={`voice-record-button ${recordingPostId === post.id ? 'recording' : ''}`} onClick={() => recordingPostId === post.id ? stopVoiceRecording() : startVoiceRecording(post.id)} aria-label={recordingPostId === post.id ? 'Zatrzymaj nagrywanie' : 'Nagraj komentarz głosowy'} title={recordingPostId === post.id ? 'Zatrzymaj nagrywanie' : 'Nagraj komentarz głosowy'}>{recordingPostId === post.id ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}</button>
                    {recordingPostId === post.id && <span className="recording-timer">{formatAudioDuration(recordingSeconds)} / 01:00</span>}
                  </form>
                  {voiceDraft?.postId === post.id && <form className="voice-comment-preview" onSubmit={(event) => submitVoiceComment(event, post.id)}>
                    <span className="voice-preview-label">ODSŁUCHAJ NAGRANIE · {formatAudioDuration(voiceDraft.duration)}</span>
                    <audio controls preload="metadata" src={voiceDraft.url} />
                    <button type="button" className="discard-voice-button" onClick={discardVoiceComment} aria-label="Usuń nagranie"><X size={15} /></button>
                    <button type="submit" className="send-voice-button"><Send size={14} />Wyślij</button>
                  </form>}
                </div>}
              </article>
              {view === 'home' && homeTab === 'board' && index === 0 && <>
                <SuggestedProfiles people={suggestedProfiles} boostCounts={profileBoostCounts} onOpen={openProfile} onAdd={sendCrewInvitation} onDismiss={dismissSuggestedProfile} />
                <SuggestedTopiki posts={proposedTopiki} onOpen={openTopikiFromPost} />
              </>}
              </Fragment>
            ))}
            {isPostFeedView && !postsLoading && !postsError && filteredPosts.length === 0 && !(view === 'home' && homeTab === 'board' && proposedTopiki.length > 0) && <div className="empty-state">
              <span>{view === 'topiki' ? <Clapperboard size={22} /> : view === 'saved' ? <Bookmark size={22} /> : <Compass size={22} />}</span>
              <strong>{view === 'topiki' ? 'Topiki czekają na pierwszy film' : view === 'saved' ? 'Tu będą Twoje zapisane posty' : isBandView ? 'Banda czeka na pierwszy post' : view === 'home' && homeTab === 'board' && feedMode === 'following' ? followedTopics.length ? 'Na razie nie ma nowych postów' : 'Wybierz tematy, które Cię ciekawią' : view === 'home' && homeTab === 'board' ? 'Tablica czeka na pierwszy post' : view === 'explore' && selectedTopic ? 'Ten temat czeka na rozmowę' : 'Nie znaleźliśmy postów'}</strong>
              <p>{view === 'topiki' ? 'Krótkie filmy opublikowane na Tablicy pojawią się tutaj.' : view === 'saved' ? 'Zapisz post, żeby wrócić do niego później.' : isBandView ? 'Dodaj temat, zdjęcie lub krótki film tylko dla członków bandy.' : view === 'home' && homeTab === 'board' && feedMode === 'following' ? followedTopics.length ? 'Gdy pojawią się nowe posty w obserwowanych tematach, zobaczysz je tutaj.' : 'Odwiedź Odkrywanie i zacznij obserwować wybrane tematy.' : view === 'home' && homeTab === 'board' ? 'Wpisy pojawią się tutaj, gdy Ty lub osoby z Twojej Ekipy coś opublikujecie.' : view === 'explore' && selectedTopic ? 'Możesz być pierwszą osobą, która rozpocznie rozmowę na ten temat.' : 'Spróbuj innego hasła albo wróć na tablicę.'}</p>
              {view === 'home' && homeTab === 'board' && feedMode === 'following' && <button className="empty-state-action" onClick={() => showView('explore')}>Odkrywaj tematy</button>}
            </div>}
            {view === 'home' && homeTab === 'board' && !postsLoading && !postsError && filteredPosts.length === 0 && <>
              <SuggestedProfiles people={suggestedProfiles} boostCounts={profileBoostCounts} onOpen={openProfile} onAdd={sendCrewInvitation} onDismiss={dismissSuggestedProfile} />
              <SuggestedTopiki posts={proposedTopiki} onOpen={openTopikiFromPost} />
              {feedMode === 'following' && followedTopics.length === 0 && <TopicDiscoveryPanel topics={topicCatalog} followedTopics={followedTopics} onOpen={openTopic} onToggleFollow={toggleFollowTopic} />}
            </>}
            {hasMorePosts && <div className="feed-page-sentinel" ref={feedSentinelRef} aria-hidden="true" />}
            {loadingMorePosts && <div className="feed-status" role="status"><span className="feed-status-spinner" />Ładowanie kolejnych wpisów…</div>}
            {postsPageError && <div className="feed-status feed-status-error" role="alert"><p>{postsPageError}</p><button className="empty-state-action" type="button" onClick={() => setPostsPageError('')}>Spróbuj ponownie</button></div>}
            </div>
            {view === 'topiki' && <span className="topiki-player-spacer" aria-hidden="true" />}
          </div>}
        </main>

        <aside className="right-rail">
          <section className="right-section online-section">
            <div className="right-title"><h2>Ekipa</h2><button onClick={() => showView('crew')}>Zobacz ekipę</button></div>
            {allUsers.filter((person) => person.online && crewHandles.includes(person.handle)).map((person) => <button className="online-person" key={person.handle} onClick={() => openProfile(person)}><span className="online-avatar"><img src={person.avatar} alt="" /><i /></span><span>{person.name}</span><small>{presenceLabel(person)}</small></button>)}
          </section>
          <section className="right-section topics-section">
            <div className="right-title"><h2>Tematy dla Ciebie</h2><button onClick={() => showView('explore')}>Więcej</button></div>
            {sidebarTopics.slice(0, 3).map((topic) => <button className="suggested-topic" key={normalizeTopicName(topic.name)} onClick={() => openTopic(topic.name)}><span># {topic.name}</span><small>{topicCountLabel(topic.count, ['post', 'posty', 'postów'])} · {topicCountLabel(topic.videos, ['Topik', 'Topiki', 'Topików'])}</small></button>)}
          </section>
          <footer className="right-footer">Informacje <span>·</span> Prywatność <span>·</span> Regulamin<br />© 2026 YouTopic</footer>
        </aside>
      </div>
      {isComposingPersonalStory && <div className="personal-story-backdrop" onClick={() => setIsComposingPersonalStory(false)}>
        <section className="personal-story-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-story-title" onClick={(event) => event.stopPropagation()}>
          <header><div><strong id="personal-story-title">Dodaj relację</strong><small>Zniknie po 24 godzinach</small></div><button type="button" onClick={() => setIsComposingPersonalStory(false)} aria-label="Zamknij"><X size={18} /></button></header>
          <form onSubmit={publishPersonalStory}>
            <textarea autoFocus value={personalStoryDraft} onChange={(event) => setPersonalStoryDraft(event.target.value)} placeholder="Podziel się chwilą z Ekipą..." maxLength={280} aria-label="Treść relacji" />
            {personalStoryMedia && <div className="personal-story-preview"><img src={personalStoryMedia} alt="Podgląd zdjęcia relacji" /><button type="button" onClick={() => setPersonalStoryMedia('')} aria-label="Usuń zdjęcie"><X size={16} /></button></div>}
            <input ref={personalStoryFileInput} type="file" accept="image/*" onChange={(event) => void choosePersonalStoryMedia(event)} hidden />
            {personalStoryError && <p className="profile-editor-error" role="alert">{personalStoryError}</p>}
            <footer><button type="button" className="personal-story-photo" onClick={() => personalStoryFileInput.current?.click()}><Image size={16} /> Dodaj zdjęcie</button><button type="submit" className="story-publish-button" disabled={!personalStoryDraft.trim() && !personalStoryMedia}>Opublikuj relację</button></footer>
          </form>
        </section>
      </div>}
      {viewedStory && <div className="story-viewer-backdrop" onClick={() => setActiveStoryKey(null)}>
        <section
          className="story-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`Relacja: ${viewedStory.author.name}`}
          tabIndex={-1}
          autoFocus
          onClick={(event) => event.stopPropagation()}
          onTouchStart={(event) => { storyTouchStartXRef.current = event.changedTouches[0]?.clientX ?? null }}
          onTouchEnd={(event) => {
            const startX = storyTouchStartXRef.current
            const endX = event.changedTouches[0]?.clientX
            storyTouchStartXRef.current = null
            if (startX !== null && endX !== undefined && Math.abs(startX - endX) > 50) moveStory(startX > endX ? 1 : -1)
          }}
        >
          <div className="story-viewer-progress" aria-hidden="true">
            {storyQueue.map((entry, index) => <span key={entry.key}><i style={{ width: index < activeStoryIndex ? '100%' : index === activeStoryIndex ? `${storyProgress}%` : '0%' }} /></span>)}
          </div>
          <header>
            <span><img src={viewedStory.author.avatar} alt="" />{viewedStory.author.name}</span>
            <button onClick={() => setActiveStoryKey(null)} aria-label="Zamknij relację"><X size={20} /></button>
          </header>
          <div className={`story-viewer-stage ${viewedStory.media ? 'has-media' : ''}`}>
            {viewedStory.media && viewedStory.mediaKind === 'image' && <img className="story-viewer-media" src={viewedStory.media} alt="Zdjęcie w relacji" />}
            {viewedStory.media && viewedStory.mediaKind === 'video' && <video className="story-viewer-media" src={viewedStory.media} autoPlay playsInline />}
            {viewedStory.text && <p>{viewedStory.text}</p>}
          </div>
          <button className="story-nav story-nav-previous" onClick={() => moveStory(-1)} aria-label="Poprzednia relacja" disabled={activeStoryIndex === 0}><ChevronLeft size={26} /></button>
          <button className="story-nav story-nav-next" onClick={() => moveStory(1)} aria-label="Następna relacja"><ChevronRight size={26} /></button>
          <footer>
            <button className="story-view-count" onClick={() => setOpenViewers(openViewers === -viewedStory.id ? null : -viewedStory.id)}><Eye size={14} />{viewedStory.seenBy.length} wyświetleń</button>
            {openViewers === -viewedStory.id && <div className="story-viewer-list">{viewedStory.seenBy.map((handle) => {
              const viewer = handle === currentUser.handle ? currentUser : viewedStory.seenPeople?.find((person) => person.handle === handle) ?? people.find((person) => person.handle === handle)
              return viewer && <span key={handle}><img src={viewer.avatar} alt="" />{viewer.name}</span>
            })}</div>}
            {viewedStory.author.handle === currentUser.handle && <button className="story-view-count" onClick={() => { setActiveStoryKey(null); setIsComposingPersonalStory(true) }}><Plus size={14} />Dodaj kolejną relację</button>}
          </footer>
        </section>
      </div>}
      {profileBoostTarget && <div className="profile-boost-backdrop" onClick={() => setProfileBoostTarget(null)}>
        <section className="profile-boost-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-boost-title" onClick={(event) => event.stopPropagation()}>
          <header><strong id="profile-boost-title">Poleć profil</strong><button onClick={() => setProfileBoostTarget(null)} aria-label="Zamknij"><X size={18} /></button></header>
          <div className="profile-boost-person"><img src={profileBoostTarget.avatar} alt="" /><span><strong>{profileBoostTarget.name}</strong><small>@{profileBoostTarget.handle}</small></span></div>
          <button className="profile-share-choice" onClick={() => copyProfileLink(profileBoostTarget)}><Copy size={17} /><span><strong>Skopiuj link profilu</strong><small>Wyślij profil poza YouTopic</small></span></button>
          <button className="profile-share-choice" onClick={() => boostProfileOnBoard(profileBoostTarget)}><ArrowUp size={17} /><span><strong>Podbij na tablicy</strong><small>Udostępnij polecenie ekipowiczom</small></span></button>
        </section>
      </div>}
      {reportDraft && <div className="report-backdrop" onClick={() => setReportDraft(null)}>
        <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title" onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <strong id="report-dialog-title">Zgłoś {reportTypeName(reportDraft.targetType)}</strong>
              <small>{reportDraft.targetName}</small>
            </div>
            <button type="button" onClick={() => setReportDraft(null)} aria-label="Zamknij zgłoszenie"><X size={18} /></button>
          </header>
          <div className="report-category-grid">
            {reportCategoryOptions.map((option) => <button key={option.id} type="button" className={`report-category-option ${reportDraft.reasonCategory === option.id ? 'active' : ''}`} onClick={() => setReportDraft((current) => current ? { ...current, reasonCategory: option.id } : current)}>{option.label}</button>)}
          </div>
          <label className="report-field">
            <span>Co jest niepokojące?</span>
            <textarea value={reportDraft.reason} onChange={(event) => setReportDraft((current) => current ? { ...current, reason: event.target.value.slice(0, 500) } : current)} placeholder="Napisz krótkie spostrzeżenie dla moderatora..." rows={4} maxLength={500} />
          </label>
          <footer className="report-dialog-footer">
            <button type="button" className="secondary-button" onClick={() => setReportDraft(null)}>Anuluj</button>
            <button type="button" className="primary-button" onClick={() => void submitReportDraft()}>Wyślij zgłoszenie</button>
          </footer>
        </section>
      </div>}
      {notice && <div className="toast"><Check size={16} />{notice}</div>}
      <nav className="mobile-nav" aria-label="Menu mobilne">{navItems.map(({ id, icon: Icon, label }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => showView(id)} aria-label={label}><Icon size={20} />{id === 'band' && unreadBandCount > 0 && <span className="mobile-nav-count">{unreadBandCount > 9 ? '9+' : unreadBandCount}</span>}</button>)}</nav>
    </div>
  )
}

type AuthMode = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password'

async function authRequest<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Nie udało się połączyć z serwerem.')
  return result
}

async function authDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE', credentials: 'include' })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Nie udało się zapisać zmiany.')
  return result
}

async function authPatch<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Nie udało się zapisać zmiany.')
  return result
}

async function fetchPostMutation(path: string, method: 'DELETE'): Promise<{ post: Post }> {
  const response = await fetch(path, { method, credentials: 'include' })
  const result = await response.json().catch(() => ({})) as { post?: Post; error?: string }
  if (!response.ok || !result.post) throw new Error(result.error || 'Nie udało się zapisać zmiany.')
  return { post: result.post }
}

async function uploadMedia(file: Blob): Promise<{ id: string; url: string; contentType: string }> {
  const response = await fetch('/api/media', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Media-Type': file.type },
    body: file,
  })
  const result = await response.json().catch(() => ({})) as { id?: string; url?: string; contentType?: string; error?: string }
  if (!response.ok || !result.id || !result.url || !result.contentType) {
    throw new Error(result.error || 'Nie udało się wysłać pliku na serwer.')
  }
  return { id: result.id, url: result.url, contentType: result.contentType }
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: Person) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')
  const [birthDay, setBirthDay] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState('PL')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetChannel, setResetChannel] = useState<'email' | 'sms'>('email')
  const [resetChallengeId, setResetChallengeId] = useState('')
  const [resetDestination, setResetDestination] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const handledVerificationToken = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('verify')
    const passwordToken = params.get('reset')
    if (passwordToken && !handledVerificationToken.current) {
      handledVerificationToken.current = true
      setResetToken(passwordToken)
      setMode('reset-password')
      return
    }
    if (!token || handledVerificationToken.current) return
    handledVerificationToken.current = true
    setMode('verify-email')
    setBusy(true)
    authRequest<{ message: string }>('/api/auth/verify-email', { token })
      .then((result) => {
        setMode('login')
        setMessage(result.message)
        window.history.replaceState({}, '', window.location.pathname)
      })
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Link weryfikacyjny wygasł.'))
      .finally(() => {
        setBusy(false)
      })
  }, [])

  function birthDateValue() {
    const year = Number(birthYear)
    const month = Number(birthMonth)
    const day = Number(birthDay)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (!year || !month || !day || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
    return `${birthYear}-${birthMonth.padStart(2, '0')}-${birthDay.padStart(2, '0')}`
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (mode === 'forgot-password') {
        const result = await authRequest<{ message: string; challengeId: string }>('/api/auth/forgot-password', { email, channel: resetChannel })
        setResetChallengeId(result.challengeId)
        setResetDestination(resetChannel === 'email' ? 'adres e-mail powiązany z kontem' : 'zweryfikowany numer telefonu')
        setResetCode('')
        setMode('reset-password')
        setMessage(result.message)
      } else if (mode === 'reset-password') {
        const result = await authRequest<{ message: string }>('/api/auth/reset-password', resetToken
          ? { token: resetToken, password, confirmPassword }
          : { challengeId: resetChallengeId, code: resetCode, password, confirmPassword })
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setResetToken('')
        setResetChallengeId('')
        setResetCode('')
        window.history.replaceState({}, '', window.location.pathname)
        setMessage(result.message)
      } else if (mode === 'register') {
        if (!gender) throw new Error('Wybierz płeć lub opcję „Wolę nie podawać”.')
        if (password.length < 7) throw new Error('Hasło musi mieć co najmniej 7 znaków.')
        if (password !== confirmPassword) throw new Error('Powtórzone hasło nie jest takie samo.')
        const birthDate = birthDateValue()
        if (!birthDate) throw new Error('Podaj prawidłowy dzień, miesiąc i rok urodzenia.')
        const birthday = new Date(`${birthDate}T00:00:00`)
        const today = new Date()
        let age = today.getFullYear() - birthday.getFullYear()
        if (today.getMonth() < birthday.getMonth() || (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate())) age -= 1
        if (age < 15) throw new Error('Konto YouTopic mogą założyć osoby, które ukończyły 15 lat.')
        const dialCode = phoneDialCodes.find((country) => country.country === phoneCountry)?.dialCode
        const nationalNumber = phone.replace(/\D/g, '').replace(/^0+/, '')
        const internationalPhone = dialCode ? `${dialCode}${nationalNumber}` : ''
        if (!/^\+[1-9]\d{7,14}$/.test(internationalPhone)) {
          throw new Error('Podaj prawidłowy numer krajowy i wybierz właściwy prefiks kraju.')
        }
        const result = await authRequest<{ message: string }>('/api/auth/register', { firstName, lastName, gender, birthDate, email, phone: internationalPhone, password, confirmPassword })
        setPendingEmail(email)
        setMessage(result.message)
        setMode('verify-email')
      } else if (mode === 'login') {
        const result = await authRequest<{ user: Person }>('/api/auth/login/email', { email, password, rememberMe })
        onAuthenticated(result.user)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Wystąpił błąd. Spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  async function resendEmail() {
    setError('')
    setBusy(true)
    try {
      const result = await authRequest<{ message: string }>('/api/auth/resend-email', { email: pendingEmail })
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się wysłać wiadomości.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen">
    <section className="auth-brand-panel">
      <a className="auth-brand" href="#start" aria-label="YouTopic">
        <img src="/youtopic-mark.svg" alt="" />
        <span>You<span>Topic</span></span>
        <span className="beta-badge">beta</span>
      </a>
      <div className="auth-brand-message">
        <p className="auth-eyebrow">TWOJE MIEJSCE W SIECI</p>
        <h1>Łączy nas<br />to, co nas ciekawi<span>.</span></h1>
        <p className="auth-intro">Dołącz do rozmów swojej Ekipy. Dziel się tym, co ważne dla Ciebie.</p>
      </div>
      <div className="auth-signature"><span>01</span><span>Rozmowy mają swój temat.</span><i /></div>
    </section>
    <section className="auth-form-panel">
      <div className="auth-form-wrap">
        <aside className="beta-announcement" role="note">
          <strong>Wersja beta</strong>
          <span>Serwis jest w fazie testów. Możesz napotkać błędy lub niepełne funkcje.</span>
        </aside>
        <p className="auth-kicker">{mode === 'register' ? 'MIŁO, ŻE DOŁĄCZASZ' : mode === 'verify-email' ? 'POTWIERDŹ SWÓJ ADRES' : mode === 'forgot-password' || mode === 'reset-password' ? 'ODZYSKIWANIE KONTA' : 'WRÓĆ DO SWOJEJ EKIPY'}</p>
        <h2>{mode === 'register' ? 'Utwórz konto' : mode === 'verify-email' ? 'Sprawdź pocztę' : mode === 'forgot-password' ? 'Nie pamiętam hasła' : mode === 'reset-password' ? 'Ustaw nowe hasło' : 'Zaloguj się'}</h2>
        <p className="auth-subtitle">{mode === 'register' ? 'Podaj swoje dane, aby dołączyć do YouTopic.' : mode === 'verify-email' ? `Wysłaliśmy link potwierdzający na ${pendingEmail || email || 'Twój adres e-mail'}. Otwórz go, aby aktywować konto.` : mode === 'forgot-password' ? 'Podaj e-mail przypisany do konta i wybierz, gdzie wysłać kod do zmiany hasła.' : mode === 'reset-password' ? resetToken ? 'Ustaw nowe hasło za pomocą wcześniej wysłanego linku.' : `Wpisz kod wysłany na ${resetDestination || 'wybrany kanał'} i ustaw nowe hasło. Kod jest ważny przez 10 minut.` : 'Zaloguj się przy użyciu adresu e-mail i hasła.'}</p>
        {message && <p className="auth-success" role="status">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}

        {mode === 'verify-email' ? <div className="auth-verification-actions"><span className="auth-verification-icon"><Check size={20} /></span><p>Po kliknięciu linku w wiadomości wróć tutaj i zaloguj się.</p><button className="auth-submit" type="button" onClick={resendEmail} disabled={busy}>Wyślij link ponownie<span>→</span></button><button className="auth-secondary" onClick={() => { setMode('login'); setMessage(''); setError('') }}>Wróć do logowania</button></div>
          : <form className="auth-form" onSubmit={submit}>
            {mode === 'forgot-password' ? <>
              <label>Adres e-mail<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="anna@example.com" required /></label>
              <fieldset className="auth-reset-method"><legend>Gdzie wysłać kod?</legend>
                <label><input type="radio" name="reset-channel" value="email" checked={resetChannel === 'email'} onChange={() => setResetChannel('email')} /><span>E-mail</span></label>
                <label><input type="radio" name="reset-channel" value="sms" checked={resetChannel === 'sms'} onChange={() => setResetChannel('sms')} /><span>SMS</span></label>
              </fieldset>
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Wysyłanie...' : 'Wyślij kod'}<span>→</span></button>
              <button className="auth-secondary" type="button" onClick={() => { setMode('login'); setMessage(''); setError('') }}>Wróć do logowania</button>
            </> : mode === 'reset-password' ? <>
              {!resetToken && <label>Kod z wiadomości<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>}
              <label>Nowe hasło<input autoComplete="new-password" type="password" minLength={7} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label>Powtórz nowe hasło<input autoComplete="new-password" type="password" minLength={7} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
              <button className="auth-submit" type="submit" disabled={busy || (!resetToken && resetCode.length !== 6)}>{busy ? 'Zapisywanie...' : 'Zmień hasło'}<span>→</span></button>
              {!resetToken && <button className="auth-secondary" type="button" onClick={() => { setMode('forgot-password'); setResetChallengeId(''); setResetCode(''); setMessage(''); setError('') }}>Wyślij kod ponownie lub zmień sposób</button>}
            </> : mode === 'register' ? <>
              <div className="auth-name-fields"><label>Imię<input autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label><label>Nazwisko<input autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label></div>
              <fieldset className="auth-gender-fields"><legend>Płeć</legend>{([['female', 'Kobieta'], ['male', 'Mężczyzna'], ['other', 'Inna'], ['undisclosed', 'Wolę nie podawać']] as const).map(([value, label], index) => <label key={value}><input type="radio" name="gender" value={value} checked={gender === value} onChange={() => setGender(value)} required={index === 0} /><span>{label}</span></label>)}</fieldset>
              <fieldset className="auth-birth-fields"><legend>Data urodzenia <span>Musisz mieć co najmniej 15 lat</span></legend><input aria-label="Dzień urodzenia" type="number" min="1" max="31" placeholder="DD" value={birthDay} onChange={(event) => setBirthDay(event.target.value)} required /><select aria-label="Miesiąc urodzenia" value={birthMonth} onChange={(event) => setBirthMonth(event.target.value)} required><option value="">MM</option>{['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'].map((month, index) => <option value={String(index + 1)} key={month}>{month}</option>)}</select><input aria-label="Rok urodzenia" type="number" min="1900" max={new Date().getFullYear()} placeholder="RRRR" value={birthYear} onChange={(event) => setBirthYear(event.target.value)} required /></fieldset>
              <label>Adres e-mail<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="anna@example.com" required /></label>
              <div className="auth-phone-fields"><label>Kraj<select autoComplete="country" value={phoneCountry} onChange={(event) => setPhoneCountry(event.target.value)} required>{phoneDialCodes.map((country) => <option key={country.country} value={country.country}>{country.label}</option>)}</select></label><label>Numer telefonu<input autoComplete="tel-national" inputMode="tel" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="123 456 789" maxLength={20} aria-describedby="registration-phone-hint" required /></label></div>
              <small id="registration-phone-hint" className="auth-phone-hint">Wpisz numer bez prefiksu kraju. Prefiks zostanie dodany automatycznie.</small>
              <div className="auth-name-fields"><label>Hasło<input autoComplete="new-password" type="password" minLength={7} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Powtórz hasło<input autoComplete="new-password" type="password" minLength={7} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label></div>
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Wysyłanie...' : 'Zarejestruj się'}<span>→</span></button>
            </> : <>
              <label>Adres e-mail<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="anna@example.com" required /></label>
              <label>Hasło<input autoComplete="current-password" type="password" minLength={7} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> <span>Zapamiętaj mnie na tym urządzeniu</span></label>
              <button className="auth-secondary auth-forgot-link" type="button" onClick={() => { setMode('forgot-password'); setMessage(''); setError('') }}>Nie pamiętam hasła</button>
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Logowanie...' : 'Zaloguj się'}<span>→</span></button>
            </>}
          </form>}

        {(mode === 'login' || mode === 'register') && <p className="auth-switch">{mode === 'login' ? 'Nie masz jeszcze konta?' : 'Masz już konto?'}<button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Zarejestruj się' : 'Zaloguj się'}</button></p>}
        {mode === 'login' && <p className="auth-demo-note">Logowanie jest obecnie dostępne wyłącznie przez e-mail i hasło. Weryfikację SMS przy logowaniu można będzie włączyć ponownie później. „Zapamiętaj mnie” utrzymuje sesję przez 30 dni; bez tej opcji sesja kończy się po zamknięciu przeglądarki lub po 12 godzinach.</p>}
      </div>
    </section>
  </main>
}

function boostLabel(count: number) {
  if (count === 1) return '1 podbicie'
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return `${count} podbicia`
  return `${count} podbić`
}

function formatAudioDuration(seconds: number) {
  const safeSeconds = Math.min(60, Math.max(0, Math.floor(seconds)))
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function commentReplyLabel(count: number) {
  return count === 1 ? 'odpowiedź' : 'odpowiedzi'
}

function commentLikeLabel(count: number) {
  if (count === 1) return '1 polubienie'
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return `${count} polubienia`
  return `${count} polubień`
}

function CommentThread({ comment, comments, currentUser, onLike, onReply, onDelete, onReport, depth = 0 }: {
  comment: PostComment
  comments: PostComment[]
  currentUser: Person
  onLike: (commentId: number) => void
  onReply: (comment: PostComment) => void
  onDelete: (commentId: number) => void
  onReport: (commentId: number) => void
  depth?: number
}) {
  const replies = comments.filter((item) => item.replyToId === comment.id)
  const isLiked = comment.likedBy?.includes(currentUser.handle) ?? false
  const isAuthor = !comment.legacy && comment.author.handle === currentUser.handle

  return <div className={`comment-thread ${depth > 0 ? 'nested-comment-thread' : ''}`}>
    <div className="comment">
      <img src={comment.author.avatar} alt="" />
      <div className="comment-content">
        {comment.text && <p><strong>{comment.author.name}</strong>{comment.text}</p>}
        {(comment.audioUrl || comment.audioData) && <><strong className="audio-comment-author">{comment.author.name}</strong><audio className="audio-comment-player" controls preload="metadata" src={comment.audioUrl ?? comment.audioData} /></>}
        <div className="comment-actions">
          <button className={isLiked ? 'comment-liked' : ''} onClick={() => onLike(comment.id)} aria-label={isLiked ? 'Usuń polubienie' : 'Polub komentarz'} title={isLiked ? 'Usuń polubienie' : 'Polub komentarz'}><Heart size={13} fill={isLiked ? 'currentColor' : 'none'} /><span>{commentLikeLabel(comment.likes ?? 0)}</span></button>
          <button onClick={() => onReply(comment)}>Odpowiedz</button>
          {comment.author.id && comment.author.id !== currentUser.id && <button onClick={() => onReport(comment.id)}>Zgłoś</button>}
          {isAuthor && <button className="delete-comment-button" onClick={() => onDelete(comment.id)}><Trash2 size={12} />Usuń komentarz</button>}
          <span className="comment-reply-count">{replies.length} {commentReplyLabel(replies.length)}</span>
        </div>
      </div>
    </div>
    {replies.map((reply) => <CommentThread key={reply.id} comment={reply} comments={comments} currentUser={currentUser} onLike={onLike} onReply={onReply} onDelete={onDelete} onReport={onReport} depth={Math.min(depth + 1, 4)} />)}
  </div>
}

function SuggestedTopiki({ posts, onOpen }: { posts: Post[]; onOpen: (postId: number) => void }) {
  if (posts.length === 0) return null
  return <section className="suggested-topiki" aria-label="Proponowane Topiki">
    <div className="suggested-topiki-heading"><strong>PROPONOWANE TOPIKI</strong><span>Popularne filmy spoza Ekipy</span></div>
    <div className="suggested-topiki-list">{posts.slice(0, 4).map((post) => <button className="suggested-topiki-card" key={post.id} onClick={() => onOpen(post.id)} aria-label={`Oglądaj Topik: ${post.author.name}`}>
      <span className="suggested-topiki-thumb"><video src={post.video} muted playsInline preload="metadata" /><span><Play size={14} fill="currentColor" />Oglądaj</span></span>
      <span className="suggested-topiki-info"><strong>{post.author.name}</strong><small>{post.likes} polubień · {post.boosts} podbić</small></span>
    </button>)}</div>
  </section>
}

function TopicDiscoveryPanel({ topics, followedTopics, onOpen, onToggleFollow }: {
  topics: Array<{ name: string; count: number; videos: number }>
  followedTopics: string[]
  onOpen: (topic: string) => void
  onToggleFollow: (topic: string) => void
}) {
  return <section className="topic-discovery" aria-label="Odkrywaj tematy">
    <div className="topic-discovery-heading"><div><span>ODKRYWAJ</span><h2>Tematy dla Ciebie</h2></div><small>{topicCountLabel(topics.length, ['temat', 'tematy', 'tematów'])}</small></div>
    {topics.length > 0 ? <div className="topic-discovery-grid">
      {topics.map((topic) => {
        const isFollowing = followedTopics.includes(normalizeTopicName(topic.name))
        return <article className="topic-discovery-card" key={normalizeTopicName(topic.name)}>
          <button className="topic-discovery-open" onClick={() => onOpen(topic.name)}>
            <span className="topic-discovery-hash">#</span>
            <strong>{topic.name}</strong>
            <small>{topicCountLabel(topic.count, ['post', 'posty', 'postów'])} · {topicCountLabel(topic.videos, ['Topik', 'Topiki', 'Topików'])}</small>
          </button>
          <button className={`topic-follow-button ${isFollowing ? 'is-following' : ''}`} onClick={() => onToggleFollow(topic.name)} aria-pressed={isFollowing}>
            {isFollowing ? <><Check size={14} /> Obserwujesz</> : <><Plus size={14} /> Obserwuj</>}
          </button>
        </article>
      })}
    </div> : <div className="topic-discovery-empty"><strong>Jeszcze nie ma tematów</strong><p>Gdy pojawią się publiczne posty, będzie można je odkrywać i obserwować.</p></div>}
  </section>
}

function TopikiDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const canExpand = text.trim().length > 100

  return <>
    <div className="topiki-description">
      <p>{text}</p>
      {canExpand && <button type="button" onClick={() => setIsExpanded(true)}>Czytaj więcej</button>}
    </div>
    {isExpanded && <div className="topiki-description-backdrop" onClick={() => setIsExpanded(false)}>
      <section className="topiki-description-dialog" role="dialog" aria-modal="true" aria-label="Pełny opis Topiku" onClick={(event) => event.stopPropagation()}>
        <header><strong>Opis filmu</strong><button type="button" onClick={() => setIsExpanded(false)} aria-label="Zamknij opis"><X size={17} /></button></header>
        <p>{text}</p>
      </section>
    </div>}
  </>
}

function TopikiVideo({ src, autoAdvance, onAutoAdvanceChange, onEnded }: { src: string; autoAdvance: boolean; onAutoAdvanceChange: (enabled: boolean) => void; onEnded: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsTimeoutRef = useRef<number | null>(null)
  const manuallyPausedRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)
  const [isTouchControlsVisible, setIsTouchControlsVisible] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return
      if (entry.isIntersecting && entry.intersectionRatio >= 0.65 && !manuallyPausedRef.current) {
        void video.play().then(() => {
          setIsPlaying(true)
          setPlaybackError(false)
        }).catch(() => {
          setIsPlaying(false)
          setPlaybackError(true)
          setIsTouchControlsVisible(true)
        })
      } else {
        video.pause()
        setIsPlaying(false)
        if (!entry.isIntersecting || entry.intersectionRatio < 0.65) manuallyPausedRef.current = false
      }
    }, { threshold: [0, 0.65, 1] })
    observer.observe(video)
    return () => {
      observer.disconnect()
      video.pause()
      if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current)
    }
  }, [src])

  function revealTouchControls() {
    setIsTouchControlsVisible(true)
    if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current)
    controlsTimeoutRef.current = window.setTimeout(() => {
      setIsTouchControlsVisible(false)
      controlsTimeoutRef.current = null
    }, 4000)
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      manuallyPausedRef.current = false
      void video.play().then(() => setPlaybackError(false)).catch(() => {
        setIsPlaying(false)
        setPlaybackError(true)
        setIsTouchControlsVisible(true)
      })
    } else {
      manuallyPausedRef.current = true
      video.pause()
    }
  }

  return <div
    className={`topiki-video-player ${isTouchControlsVisible ? 'is-controls-visible' : ''}`}
    onPointerDown={(event) => {
      if (event.pointerType === 'touch') revealTouchControls()
    }}
    onPointerEnter={(event) => {
      if (event.pointerType === 'mouse') setIsTouchControlsVisible(true)
    }}
    onPointerLeave={(event) => {
      if (event.pointerType === 'mouse') setIsTouchControlsVisible(false)
    }}
  >
    <video
      ref={videoRef}
      className="post-image topiki-video"
      src={src}
      muted
      loop={!autoAdvance}
      playsInline
      autoPlay
      preload="auto"
      onError={() => {
        setIsPlaying(false)
        setPlaybackError(true)
        setIsTouchControlsVisible(true)
      }}
      onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onPlay={() => {
        setIsPlaying(true)
        setPlaybackError(false)
      }}
      onPause={() => setIsPlaying(false)}
      onEnded={() => {
        setIsPlaying(false)
        if (autoAdvance) onEnded()
      }}
    />
    {playbackError && <p className="topiki-video-error" role="status">Nie można odtworzyć tego filmu. Dotknij przycisku, aby spróbować ponownie.</p>}
    <div className="topiki-video-controls" onClick={(event) => event.stopPropagation()}>
      <label className="topiki-auto-switch" title="Automatyczna zmiana Topików">
        <input type="checkbox" role="switch" checked={autoAdvance} onChange={(event) => onAutoAdvanceChange(event.target.checked)} aria-label="Automatyczna zmiana Topików" />
        <span className="topiki-auto-switch-track" aria-hidden="true" />
        <strong>Auto</strong>
      </label>
      <button className={`topiki-play-toggle ${isPlaying ? 'is-playing' : ''}`} type="button" onClick={togglePlayback} aria-label={isPlaying ? 'Wstrzymaj film' : 'Odtwórz film'} title={isPlaying ? 'Wstrzymaj' : 'Odtwórz'}>
        {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>
      <div className="topiki-video-timeline">
        <span>{formatVideoTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => {
            const nextTime = Number(event.target.value)
            if (videoRef.current) videoRef.current.currentTime = nextTime
            setCurrentTime(nextTime)
          }}
          aria-label="Pozycja filmu"
          style={{ '--video-progress': `${duration ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
          disabled={!duration}
        />
        <span>{formatVideoTime(duration)}</span>
      </div>
    </div>
  </div>
}

function formatVideoTime(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainder = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function SuggestedProfiles({ people, boostCounts, onOpen, onAdd, onDismiss }: { people: Person[]; boostCounts: Map<string, number>; onOpen: (person: Person) => void; onAdd: (person: Person) => void; onDismiss: (person: Person) => void }) {
  if (people.length === 0) return null
  return <section className="suggested-profiles" aria-label="Proponowane profile">
    <div className="suggested-profiles-heading"><span>PROPONOWANE</span><small>Osoby spoza Twojej Ekipy</small></div>
    <div className="suggested-profiles-list">{people.slice(0, 3).map((person) => <article className="suggested-profile" key={person.handle}>
      <button className="suggested-profile-person" onClick={() => onOpen(person)}><img src={person.avatar} alt="" /><span><strong>{person.name}</strong><small>@{person.handle}{(boostCounts.get(person.handle) ?? 0) > 0 ? ` · ${boostCounts.get(person.handle)} podbić` : ''}</small></span></button>
      <div className="suggested-profile-actions">
        <button className="suggested-profile-add" onClick={() => onAdd(person)}><Plus size={12} /> Dodaj do Ekipy</button>
        <button className="suggested-profile-dismiss" onClick={() => onDismiss(person)} aria-label={`Odrzuć ${person.name}`} title="Odrzuć"><X size={14} /><span>Odrzuć</span></button>
      </div>
    </article>)}</div>
  </section>
}

function ProfileHeader({ person, isOwn, isCrewMember, isBlocked, blockedPeople, isEditingProfile, nicknameDraft, firstNameDraft, middleNameDraft, lastNameDraft, secondLastNameDraft, locationDraft, contactPhoneDraft, secondContactPhoneDraft, bioDraft, avatarDraft, coverImageDraft, socialLinksDraft, profileVisibilityDraft, socialPrivacyDraft, profileError, isSavingProfile, onEditProfile, onNicknameDraftChange, onFirstNameDraftChange, onMiddleNameDraftChange, onLastNameDraftChange, onSecondLastNameDraftChange, onLocationDraftChange, onContactPhoneDraftChange, onSecondContactPhoneDraftChange, onBioDraftChange, onSocialLinksDraftChange, onProfileVisibilityDraftChange, onSocialPrivacyDraftChange, onImageChange, onSaveProfile, onCancelProfile, isCrewInvitationPending, isBandAdmin, onToggleCrew, onToggleBlock, onPromote, onReportProfile, postCount }: {
  person: Person
  isOwn: boolean
  isCrewMember: boolean
  isBlocked: boolean
  blockedPeople: Person[]
  isEditingProfile: boolean
  nicknameDraft: string
  firstNameDraft: string
  middleNameDraft: string
  lastNameDraft: string
  secondLastNameDraft: string
  locationDraft: string
  contactPhoneDraft: string
  secondContactPhoneDraft: string
  bioDraft: string
  avatarDraft: string
  coverImageDraft: string
  socialLinksDraft: SocialProfileLink[]
  profileVisibilityDraft: ProfileVisibilitySettings
  socialPrivacyDraft: SocialPrivacy
  profileError: string
  isSavingProfile: boolean
  onEditProfile: () => void
  onNicknameDraftChange: (nickname: string) => void
  onFirstNameDraftChange: (name: string) => void
  onMiddleNameDraftChange: (name: string) => void
  onLastNameDraftChange: (name: string) => void
  onSecondLastNameDraftChange: (name: string) => void
  onLocationDraftChange: (location: string) => void
  onContactPhoneDraftChange: (phone: string) => void
  onSecondContactPhoneDraftChange: (phone: string) => void
  onBioDraftChange: (bio: string) => void
  onSocialLinksDraftChange: (links: SocialProfileLink[]) => void
  onProfileVisibilityDraftChange: (visibility: ProfileVisibilitySettings) => void
  onSocialPrivacyDraftChange: (privacy: SocialPrivacy) => void
  onImageChange: (kind: 'avatar' | 'cover', file: File) => Promise<void>
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void
  onCancelProfile: () => void
  isCrewInvitationPending: boolean
  isBandAdmin: boolean
  onToggleCrew: () => void
  onToggleBlock: (person: Person) => void
  onPromote: () => void
  onReportProfile: () => void
  postCount: number
}) {
  const memberCount = person.crewMembers
  const visibility = { ...defaultProfileVisibility, ...person.profileVisibility, contactPhone: person.profileVisibility?.contactPhone ?? 'private', secondContactPhone: person.profileVisibility?.secondContactPhone ?? 'private' }
  const canView = (audience: ProfileAudience) => isOwn || audience === 'public' || (audience === 'crew' && isCrewMember)
  const cover = isEditingProfile && isOwn ? coverImageDraft : person.coverImage
  const avatar = isEditingProfile && isOwn ? avatarDraft : person.avatar
  return <section className="profile-header">
    <div className="profile-cover" style={cover ? { backgroundImage: `linear-gradient(90deg, #18372655, #18372622), url("${cover}")` } : undefined}>{!cover && <span>YT</span>}{isOwn && isEditingProfile && <label className="profile-cover-upload">Zmień zdjęcie w tle<input type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onImageChange('cover', file); event.currentTarget.value = '' }} /></label>}</div>
    <div className="profile-details"><div className="profile-avatar-wrap"><img src={avatar} alt={person.name} />{isOwn && isEditingProfile && <label className="profile-avatar-upload">Zmień zdjęcie<input type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onImageChange('avatar', file); event.currentTarget.value = '' }} /></label>}</div><div className="profile-buttons">{isOwn ? <button className="edit-profile" type="button" onClick={isEditingProfile ? onCancelProfile : onEditProfile}><Settings2 size={15} /> {isEditingProfile ? 'Anuluj edycję' : 'Edytuj profil'}</button> : <button className="profile-block-button" type="button" onClick={() => onToggleBlock(person)}>{isBlocked ? 'Odblokuj' : 'Zablokuj'}</button>}<button className="profile-more" type="button" onClick={person.id && !isOwn ? onReportProfile : undefined} aria-label={person.id && !isOwn ? 'Zgłoś profil' : 'Więcej'} title={person.id && !isOwn ? 'Zgłoś profil' : 'Więcej'}>{person.id && !isOwn ? <Flag size={18} /> : <MoreHorizontal size={20} />}</button></div>
      <h2>{person.name}{person.profileVerified && <BadgeCheck className="verified-profile-badge" size={18} aria-label="Zweryfikowany profil" />}{isBandAdmin && <span className="admin-badge">Admin</span>}</h2><p className="profile-handle">@{person.nickname ?? person.handle}</p>
      {isOwn && isEditingProfile && <form className="profile-editor" onSubmit={onSaveProfile}>
        <div className="profile-name-fields">
          <label>Imię<input value={firstNameDraft} onChange={(event) => onFirstNameDraftChange(event.target.value)} maxLength={80} autoComplete="given-name" required /></label>
          <label>Drugie imię <span>(opcjonalne)</span><input value={middleNameDraft} onChange={(event) => onMiddleNameDraftChange(event.target.value)} maxLength={80} autoComplete="additional-name" /></label>
          <label>Nazwisko<input value={lastNameDraft} onChange={(event) => onLastNameDraftChange(event.target.value)} maxLength={80} autoComplete="family-name" required /></label>
          <label>Drugie nazwisko <span>(opcjonalne)</span><input value={secondLastNameDraft} onChange={(event) => onSecondLastNameDraftChange(event.target.value)} maxLength={80} /></label>
        </div>
        <label>Nick<div className="profile-editor-nickname"><span aria-hidden="true">@</span><input value={nicknameDraft} onChange={(event) => onNicknameDraftChange(event.target.value)} minLength={2} maxLength={24} required autoFocus /></div><small>2–24 znaki: litery, cyfry, kropki, myślniki lub podkreślenia.</small></label>
        <label>Miejscowość<input value={locationDraft} onChange={(event) => onLocationDraftChange(event.target.value)} maxLength={80} placeholder="np. Gdańsk" autoComplete="address-level2" /></label>
        <label>Telefon kontaktowy<input type="tel" value={contactPhoneDraft} onChange={(event) => onContactPhoneDraftChange(event.target.value)} maxLength={24} placeholder="+48123456789" autoComplete="tel" /></label>
        <label>Drugi numer telefonu <span>(opcjonalny)</span><input type="tel" value={secondContactPhoneDraft} onChange={(event) => onSecondContactPhoneDraftChange(event.target.value)} maxLength={24} placeholder="+48123456789" autoComplete="tel" /></label>
        <label>Biografia<textarea value={bioDraft} onChange={(event) => onBioDraftChange(event.target.value)} maxLength={160} rows={3} placeholder="Napisz krótko, co Cię ciekawi…" /><small>{bioDraft.length}/160</small></label>
        <fieldset className="profile-social-editor"><legend>Media społecznościowe</legend>{socialLinksDraft.map((link) => <div className="profile-social-edit-row" key={link.id}>
          <select value={link.platform} onChange={(event) => onSocialLinksDraftChange(socialLinksDraft.map((item) => item.id === link.id ? { ...item, platform: event.target.value as SocialPlatform } : item))} aria-label="Platforma społecznościowa">{socialPlatforms.filter((platform) => platform === link.platform || !socialLinksDraft.some((item) => item.id !== link.id && item.platform === platform)).map((platform) => <option value={platform} key={platform}>{platform}</option>)}</select>
          <input type="url" value={link.url} onChange={(event) => onSocialLinksDraftChange(socialLinksDraft.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item))} placeholder="https://" aria-label={`Link do ${link.platform}`} />
          <button type="button" onClick={() => onSocialLinksDraftChange(socialLinksDraft.filter((item) => item.id !== link.id))} aria-label={`Usuń link ${link.platform}`}><X size={15} /></button>
        </div>)}{socialLinksDraft.length < socialPlatforms.length && <button className="profile-add-social" type="button" onClick={() => onSocialLinksDraftChange([...socialLinksDraft, { id: Math.max(0, ...socialLinksDraft.map((link) => link.id)) + 1, platform: socialPlatforms.find((platform) => !socialLinksDraft.some((link) => link.platform === platform)) ?? socialPlatforms[0], url: '' }])}><Plus size={14} /> Dodaj link</button>}</fieldset>
        <fieldset className="profile-visibility-editor"><legend>Widoczność danych profilu</legend>
          <p>Imię, nazwisko, nick, zdjęcie profilowe i zdjęcie w tle są zawsze publiczne.</p>
          <label className="profile-privacy-select">Kto może znaleźć i zobaczyć profil<select value={socialPrivacyDraft.profileAudience} onChange={(event) => onSocialPrivacyDraftChange({ ...socialPrivacyDraft, profileAudience: event.target.value as ProfileAudience })}><option value="public">Wszyscy</option><option value="crew">Tylko osoby z Ekipy</option><option value="private">Tylko ja</option></select></label>
          <label className="profile-privacy-select">Kto może wysłać zaproszenie do Ekipy<select value={socialPrivacyDraft.crewInviteAudience} onChange={(event) => onSocialPrivacyDraftChange({ ...socialPrivacyDraft, crewInviteAudience: event.target.value as SocialPrivacy['crewInviteAudience'] })}><option value="everyone">Wszyscy</option><option value="nobody">Nikt</option></select></label>
          <VisibilityPicker label="Miejscowość" value={profileVisibilityDraft.location} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, location: value })} />
          <VisibilityPicker label="Biografia" value={profileVisibilityDraft.bio} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, bio: value })} />
          <VisibilityPicker label="Telefon kontaktowy" value={profileVisibilityDraft.contactPhone} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, contactPhone: value })} />
          <VisibilityPicker label="Drugi numer telefonu" value={profileVisibilityDraft.secondContactPhone} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, secondContactPhone: value })} />
          <VisibilityPicker label="Media społecznościowe" value={profileVisibilityDraft.socialLinks} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, socialLinks: value })} />
          <VisibilityPicker label="Liczba osób w Ekipie" value={profileVisibilityDraft.crewMembers} onChange={(value) => onProfileVisibilityDraftChange({ ...profileVisibilityDraft, crewMembers: value, crewSize: value })} />
        </fieldset>
        {blockedPeople.length > 0 && <section className="blocked-people-editor"><strong>Zablokowane konta</strong>{blockedPeople.map((blocked) => <div key={blocked.id}><span>@{blocked.nickname ?? blocked.handle}</span><button type="button" onClick={() => onToggleBlock(blocked)}>Odblokuj</button></div>)}</section>}
        {profileError && <p className="profile-editor-error" role="alert">{profileError}</p>}
        <div className="profile-editor-actions"><button type="button" onClick={onCancelProfile}>Anuluj</button><button type="submit" disabled={isSavingProfile}>{isSavingProfile ? 'Zapisywanie…' : 'Zapisz profil'}</button></div>
      </form>}
      {isOwn && isEditingProfile && <><LoginPhoneChange /><LoginEmailChange /></>}
      {!isEditingProfile && <>
        {canView(visibility.location) && person.location && <p className="profile-location">{person.location}</p>}
        {canView(visibility.contactPhone) && person.contactPhone && <p className="profile-contact">Telefon: <a href={`tel:${person.contactPhone}`}>{person.contactPhone}</a></p>}
        {canView(visibility.secondContactPhone) && person.secondContactPhone && <p className="profile-contact">Drugi telefon: <a href={`tel:${person.secondContactPhone}`}>{person.secondContactPhone}</a></p>}
        {canView(visibility.bio) && (person.bio ? <p className="profile-bio">{person.bio}</p> : !isOwn && <p className="profile-bio">Ciekawość świata, dobre jedzenie i wszystkie odcienie codzienności.</p>)}
        {canView(visibility.socialLinks) && person.socialLinks && Object.entries(person.socialLinks).some(([, url]) => Boolean(url)) && <nav className="profile-social-links" aria-label="Media społecznościowe">{Object.entries(person.socialLinks).filter((entry): entry is [SocialPlatform, string] => Boolean(entry[1])).map(([platform, url]) => <a href={url} key={platform} target="_blank" rel="noreferrer">{platform}<span aria-hidden="true">↗</span></a>)}</nav>}
      </>}
      <div className="profile-counts"><span><strong>{postCount}</strong> posty</span>{canView(visibility.crewMembers) && <span><strong>{memberCount}</strong> osób w Ekipie</span>}</div>
      {!isOwn && <div className="profile-relationship-actions">
        {isCrewMember
          ? <span className="profile-crew-state"><Check size={15} /> W Ekipie</span>
          : isCrewInvitationPending
            ? <><span className="profile-invitation-sent"><Check size={14} /> Wysłano</span><button className="profile-invitation-cancel" type="button" onClick={onToggleCrew}>Anuluj</button></>
            : <button className="profile-add-crew" type="button" disabled={isBlocked} onClick={onToggleCrew}><Plus size={15} /> Dodaj do Ekipy</button>}
        {!isBlocked && <button className="promote-profile-button" type="button" onClick={onPromote}><ArrowUp size={15} /> Podbij profil</button>}
      </div>}
    </div>
  </section>
}

function ProfileGallery({ person, isOwn, onPostPhotoDeleted }: { person: Person; isOwn: boolean; onPostPhotoDeleted: (postId: string) => void }) {
  const galleryRequestId = useRef(0)
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [albums, setAlbums] = useState<GalleryAlbum[]>([])
  const [selectedAlbumId, setSelectedAlbumId] = useState('')
  const [newAlbumName, setNewAlbumName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadGallery() {
    const requestId = ++galleryRequestId.current
    setLoading(true)
    setError('')
    try {
      const result = await authRequest<{ photos: GalleryPhoto[]; albums: GalleryAlbum[] }>(`/api/gallery/${encodeURIComponent(person.handle)}`)
      if (requestId !== galleryRequestId.current) return
      setPhotos(result.photos)
      setAlbums(result.albums)
      setSelectedAlbumId((selected) => selected && result.albums.some((album) => album.id === selected) ? selected : '')
    } catch (loadError) {
      if (requestId !== galleryRequestId.current) return
      setError(loadError instanceof Error ? loadError.message : 'Nie udało się wczytać galerii.')
    } finally {
      if (requestId === galleryRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    void loadGallery()
    return () => { galleryRequestId.current += 1 }
  }, [person.handle])

  const activeAlbum = albums.find((album) => album.id === selectedAlbumId)
  const allPhotos = [...photos, ...albums.flatMap((album) => album.photos
    .filter((photo) => !photo.sourcePostId)
    .map((photo) => ({ ...photo, albumId: album.id })))]
  const visiblePhotos = activeAlbum
    ? activeAlbum.photos.map((photo) => {
      const source = photo.sourcePostId ? photos.find((item) => item.sourcePostId === photo.sourcePostId) : undefined
      return { ...source, ...photo, albumId: activeAlbum.id }
    })
    : [...new Map(allPhotos.map((photo) => [photo.sourcePostId ? `post:${photo.sourcePostId}` : photo.mediaId ?? photo.id, photo])).values()]

  async function createAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const { album } = await authRequest<{ album: GalleryAlbum }>('/api/gallery/albums', { name: newAlbumName })
      setAlbums((current) => [album, ...current])
      setSelectedAlbumId(album.id)
      setNewAlbumName('')
      setSuccess('Album został utworzony.')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Nie udało się utworzyć albumu.')
    } finally {
      setBusy(false)
    }
  }

  async function addPhotoToAlbum(photo: GalleryPhoto, albumId: string) {
    if (!albumId) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await authRequest<{ album: GalleryAlbum }>(`/api/gallery/albums/${encodeURIComponent(albumId)}/photos`, { sourcePostId: photo.sourcePostId })
      setAlbums((current) => current.map((album) => album.id === result.album.id ? result.album : album))
      setSuccess('Zdjęcie dodano do albumu.')
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Nie udało się dodać zdjęcia do albumu.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !selectedAlbumId) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const compressed = await resizeProfileImage(file, 1600)
      const blob = await (await fetch(compressed)).blob()
      const media = await uploadMedia(blob)
      await authRequest(`/api/gallery/albums/${encodeURIComponent(selectedAlbumId)}/photos`, { mediaId: media.id })
      await loadGallery()
      setSuccess('Zdjęcie dodano do albumu.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Nie udało się dodać zdjęcia.')
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto(photo: GalleryPhoto, fromAlbum = false) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      if (fromAlbum && activeAlbum) {
        await authDelete(`/api/gallery/albums/${encodeURIComponent(activeAlbum.id)}/photos/${encodeURIComponent(photo.id)}`)
      } else if (photo.sourcePostId) {
        await authDelete(`/api/gallery/posts/${encodeURIComponent(photo.sourcePostId)}/photo`)
        onPostPhotoDeleted(photo.sourcePostId)
      } else if (photo.albumId) {
        await authDelete(`/api/gallery/albums/${encodeURIComponent(photo.albumId)}/photos/${encodeURIComponent(photo.id)}`)
      }
      await loadGallery()
      setSuccess(fromAlbum ? 'Zdjęcie usunięto z albumu.' : 'Zdjęcie zostało usunięte z galerii.')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Nie udało się usunąć zdjęcia.')
    } finally {
      setBusy(false)
    }
  }

  async function removeAlbum(album: GalleryAlbum) {
    if (!window.confirm(`Usunąć album „${album.name}”? Zdjęcia źródłowe pozostaną na Tablicy.`)) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await authDelete(`/api/gallery/albums/${encodeURIComponent(album.id)}`)
      setAlbums((current) => current.filter((item) => item.id !== album.id))
      setSelectedAlbumId('')
      setSuccess('Album został usunięty. Zdjęcia z Tablicy pozostały bez zmian.')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Nie udało się usunąć albumu.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="profile-gallery" aria-label={`Galeria użytkownika ${person.handle}`}>
    <header className="profile-gallery-heading">
      <div><h3>{activeAlbum ? activeAlbum.name : 'Galeria zdjęć'}</h3><p>Zdjęcia z Tablicy i albumów użytkownika. Prywatne zdjęcia z Band i czatu nie są tu wyświetlane.</p></div>
      <span>{topicCountLabel(visiblePhotos.length, ['zdjęcie', 'zdjęcia', 'zdjęć'])}</span>
    </header>
    {isOwn && <div className="profile-gallery-tools">
      <form className="profile-gallery-create" onSubmit={(event) => void createAlbum(event)}>
        <label htmlFor="profile-gallery-new-album">Nazwa nowego albumu</label>
        <input id="profile-gallery-new-album" value={newAlbumName} onChange={(event) => setNewAlbumName(event.target.value)} maxLength={60} placeholder="np. Wakacje 2026" required />
        <button type="submit" disabled={busy}><Plus size={15} /> Utwórz album</button>
      </form>
      {selectedAlbumId && <label className="profile-gallery-upload">Dodaj nowe zdjęcie<input type="file" accept="image/*" disabled={busy} onChange={(event) => void uploadPhoto(event)} /></label>}
    </div>}
    <nav className="profile-gallery-albums" aria-label="Albumy">
      <button type="button" className={!selectedAlbumId ? 'active' : ''} onClick={() => setSelectedAlbumId('')}>Wszystkie zdjęcia</button>
      {albums.map((album) => <span key={album.id}>
        <button type="button" className={selectedAlbumId === album.id ? 'active' : ''} onClick={() => setSelectedAlbumId(album.id)}>{album.name} <small>{album.photos.length}</small></button>
        {isOwn && selectedAlbumId === album.id && <button type="button" className="profile-gallery-delete-album" disabled={busy} onClick={() => void removeAlbum(album)} aria-label={`Usuń album ${album.name}`} title="Usuń album"><Trash2 size={14} /></button>}
      </span>)}
    </nav>
    {error && <p className="profile-gallery-message error" role="alert">{error}</p>}
    {success && <p className="profile-gallery-message success" role="status">{success}</p>}
    {loading
      ? <p className="profile-gallery-empty" role="status">Ładowanie galerii…</p>
      : visiblePhotos.length === 0
        ? <p className="profile-gallery-empty">{activeAlbum ? 'Ten album nie zawiera jeszcze zdjęć.' : 'Nie ma jeszcze zdjęć w galerii.'}</p>
        : <div className="profile-gallery-grid">{visiblePhotos.map((photo) => <article className="profile-gallery-photo" key={`${photo.albumId ?? 'all'}:${photo.id}`}>
          <img src={photo.url} alt={photo.caption || 'Zdjęcie z galerii'} loading="lazy" />
          {photo.caption && <p>{photo.caption}</p>}
          <small>{formatPostTime(photo.createdAt)}</small>
          {isOwn && <div className="profile-gallery-photo-actions">
            {!activeAlbum && photo.sourcePostId && albums.length > 0 && <select disabled={busy} defaultValue="" aria-label="Dodaj zdjęcie do albumu" onChange={(event) => { const albumId = event.target.value; event.target.value = ''; void addPhotoToAlbum(photo, albumId) }}>
              <option value="" disabled>Dodaj do albumu</option>
              {albums.map((album) => <option value={album.id} key={album.id} disabled={album.photos.some((item) => item.sourcePostId === photo.sourcePostId)}>{album.name}</option>)}
            </select>}
            {activeAlbum && <button type="button" disabled={busy} onClick={() => void removePhoto(photo, true)}>Usuń z albumu</button>}
            {!activeAlbum && <button type="button" disabled={busy} onClick={() => void removePhoto(photo)}><Trash2 size={13} /> Usuń</button>}
          </div>}
        </article>)}</div>}
  </section>
}

function LoginPhoneChange() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (!challengeId) {
        const result = await authRequest<{ challengeId: string; maskedPhone: string; message: string }>('/api/account/phone-change/start', { phone, password })
        setChallengeId(result.challengeId)
        setMaskedPhone(result.maskedPhone)
        setMessage(result.message)
      } else {
        const result = await authRequest<{ message: string }>('/api/account/phone-change/verify', { challengeId, code })
        setChallengeId('')
        setPhone('')
        setPassword('')
        setCode('')
        setMessage(result.message)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zmienić numeru.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="account-security-panel">
    <h3>Numer logowania</h3>
    <p>Po zmianie numeru nadal możesz logować się e-mailem na wcześniej zapamiętanym urządzeniu.</p>
    {message && <p className="auth-success" role="status">{message}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="account-phone-form">
      {!challengeId ? <>
        <label>Nowy numer telefonu<input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+48123456789" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <label>Hasło<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Wysyłanie…' : 'Wyślij kod SMS'}</button>
      </> : <>
        <p>Kod wysłaliśmy na {maskedPhone}.</p>
        <label>Kod SMS<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <button type="button" disabled={busy || code.length !== 4} onClick={() => void submit()}>{busy ? 'Weryfikowanie…' : 'Potwierdź nowy numer'}</button>
        <button type="button" className="auth-secondary" onClick={() => { setChallengeId(''); setCode(''); setError(''); setMessage('') }}>Anuluj</button>
      </>}
    </div>
  </section>
}

function LoginEmailChange() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (!challengeId) {
        const result = await authRequest<{ challengeId: string; maskedEmail: string; message: string }>('/api/account/email-change/start', { email, password })
        setChallengeId(result.challengeId)
        setMaskedEmail(result.maskedEmail)
        setMessage(result.message)
      } else {
        const result = await authRequest<{ message: string }>('/api/account/email-change/verify', { challengeId, code })
        setChallengeId('')
        setEmail('')
        setPassword('')
        setCode('')
        setMessage(result.message)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się zmienić adresu e-mail.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="account-security-panel">
    <h3>E-mail do logowania</h3>
    <p>Podaj hasło i potwierdź nowy adres sześciocyfrowym kodem. Zmiana e-maila nie zmienia numeru telefonu ani zaufanych urządzeń.</p>
    {message && <p className="auth-success" role="status">{message}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="account-phone-form">
      {!challengeId ? <>
        <label>Nowy adres e-mail<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="anna@example.com" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <label>Hasło<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Wysyłanie…' : 'Wyślij kod na nowy e-mail'}</button>
      </> : <>
        <p>Kod wysłaliśmy na {maskedEmail}.</p>
        <label>Kod z e-maila<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void submit()}>{busy ? 'Weryfikowanie…' : 'Potwierdź nowy e-mail'}</button>
        <button type="button" className="auth-secondary" onClick={() => { setChallengeId(''); setCode(''); setError(''); setMessage('') }}>Anuluj</button>
      </>}
    </div>
  </section>
}

function VisibilityPicker({ label, value, onChange }: { label: string; value: ProfileAudience; onChange: (audience: ProfileAudience) => void }) {
  const options: Array<{ value: ProfileAudience; label: string }> = [
    { value: 'public', label: 'Publicznie' },
    { value: 'crew', label: 'Ekipa' },
    { value: 'private', label: 'Prywatnie' },
  ]
  return <div className="profile-visibility-row">
    <strong>{label}</strong>
    <div role="radiogroup" aria-label={`Widoczność: ${label}`}>
      {options.map((option) => <label key={option.value}>
        <input type="radio" name={`visibility-${label}`} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span aria-hidden="true" />
        {option.label}
      </label>)}
    </div>
  </div>
}

export default App