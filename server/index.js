import 'dotenv/config'
import crypto from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import nodemailer from 'nodemailer'
import pg from 'pg'
import { adminPermissionCatalog } from '../shared/adminPermissions.js'

const app = express()
const port = Number(process.env.PORT || process.env.API_PORT || 3001)
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173'
const allowedOrigins = new Set((process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((origin) => origin.trim()))
const sessionSecret = process.env.AUTH_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'))
const storePath = resolve('data/auth-store.json')
const database = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 }) : null
const sessionCookie = 'youtopic_session'
const adminSessionCookie = 'youtopic_admin_session'
const trustedDeviceCookie = 'youtopic_trusted_device'
const pendingDeviceCookie = 'youtopic_pending_device'
const sessionLifetime = 12 * 60 * 60 * 1000
const rememberedSessionLifetime = 30 * 24 * 60 * 60 * 1000
const socialPlatforms = new Set(['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'LinkedIn', 'Twitch'])
const profileAudiences = new Set(['public', 'crew', 'private'])
const adminPermissions = new Set(adminPermissionCatalog.map(({ id }) => id))
const codeLifetime = 10 * 60 * 1000
const passwordResetCodeLifetime = 10 * 60 * 1000
const emailLifetime = 24 * 60 * 60 * 1000
const scrypt = promisify(crypto.scrypt)
let storeQueue = Promise.resolve()

if (!sessionSecret) throw new Error('AUTH_SESSION_SECRET is required in production.')
if (process.env.NODE_ENV === 'production' && !database) throw new Error('DATABASE_URL is required in production.')
database?.on('error', (error) => console.error('PostgreSQL connection error:', error))

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true
  if (process.env.NODE_ENV === 'production') return false
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)
  } catch {
    return false
  }
}

async function sendEmailCode(email, firstName, code, purpose) {
  if (!mailer || !process.env.SMTP_FROM) throw new Error('EMAIL_NOT_CONFIGURED')
  const safeFirstName = escapeHtml(firstName)
  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: `Kod YouTopic: ${purpose}`,
    text: `Cześć ${firstName}, Twój kod ${purpose} to ${code}. Kod wygaśnie za 10 minut. Jeśli to nie Ty wysłałeś prośbę, zignoruj tę wiadomość.`,
    html: `<p>Cześć ${safeFirstName},</p><p>Twój kod ${escapeHtml(purpose)}:</p><p style="font-size:24px;font-weight:bold;letter-spacing:5px">${code}</p><p>Kod wygaśnie za 10 minut. Jeśli to nie Ty wysłałeś prośbę, zignoruj tę wiadomość.</p>`,
  })
}

const mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null

app.disable('x-powered-by')
app.use(helmet({ crossOriginEmbedderPolicy: false }))
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
app.use(express.json({ limit: '2mb' }))
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false })
const adminMutationLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })
const supportCreationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false })
app.use('/api', (request, response, next) => {
  const origin = request.get('origin')
  if (origin && !isAllowedOrigin(origin)) return response.status(403).json({ error: 'Niedozwolone źródło żądania.' })
  if (process.env.NODE_ENV === 'production' && request.method !== 'GET' && !origin) return response.status(403).json({ error: 'Brak nagłówka Origin.' })
  if (request.path === '/health' || request.path.startsWith('/admin/')) return next()
  const ipHash = hashIp(request.ip)
  return readStore().then((store) => {
    request.authStore = store
    const block = store.ipBlocks.find((item) => item.ipHash === ipHash && item.expiresAt > Date.now())
    if (block) return response.status(403).json({ error: 'Dostęp z tego adresu IP został czasowo zablokowany.' })
    next()
  }).catch(next)
})

function emptyStore() {
  return { users: [], announcements: [], admins: [], rankPermissionTemplates: {}, reports: [], reportNotifications: [], socialNotifications: [], socialChatMessages: [], socialBands: [], socialAlbums: [], moderatedItems: [], supportTickets: [], auditLog: [], platformSettings: { registrationEnabled: true }, deletedUsers: [], ipBlocks: [], socialPosts: [], socialMedia: [], socialCrewLinks: [], socialCrewInvitations: [], socialBlocks: [], socialMutes: [] }
}

function normalizeStore(store) {
  const admins = Array.isArray(store.admins) ? store.admins : []
  const rankPermissionTemplates = {}
  if (store.rankPermissionTemplates && typeof store.rankPermissionTemplates === 'object' && !Array.isArray(store.rankPermissionTemplates)) {
    for (const [rank, permissions] of Object.entries(store.rankPermissionTemplates)) {
      if (typeof rank === 'string' && rank.trim() && Array.isArray(permissions)) {
        rankPermissionTemplates[rank] = [...new Set(permissions.filter((permission) => typeof permission === 'string' && adminPermissions.has(permission) && permission !== 'admins.manage'))]
      }
    }
  }
  for (const admin of admins) {
    if (!admin.isSuperAdmin && typeof admin.rank === 'string' && admin.rank.trim() && !rankPermissionTemplates[admin.rank]) {
      rankPermissionTemplates[admin.rank] = permissionsForAdmin(admin).filter((permission) => permission !== 'admins.manage')
    }
  }
  return {
    ...store,
    users: Array.isArray(store.users) ? store.users : [],
    announcements: Array.isArray(store.announcements) ? store.announcements : [],
    admins,
    rankPermissionTemplates,
    reports: Array.isArray(store.reports) ? store.reports : [],
    reportNotifications: Array.isArray(store.reportNotifications) ? store.reportNotifications : [],
    moderatedItems: Array.isArray(store.moderatedItems) ? store.moderatedItems : [],
    supportTickets: Array.isArray(store.supportTickets) ? store.supportTickets : [],
    auditLog: Array.isArray(store.auditLog) ? store.auditLog : [],
    platformSettings: {
      registrationEnabled: store.platformSettings?.registrationEnabled !== false,
    },
    deletedUsers: Array.isArray(store.deletedUsers) ? store.deletedUsers : [],
    ipBlocks: Array.isArray(store.ipBlocks) ? store.ipBlocks : [],
    socialPosts: Array.isArray(store.socialPosts) ? store.socialPosts : [],
    socialMedia: Array.isArray(store.socialMedia) ? store.socialMedia : [],
    socialCrewLinks: Array.isArray(store.socialCrewLinks) ? store.socialCrewLinks : [],
    socialCrewInvitations: Array.isArray(store.socialCrewInvitations) ? store.socialCrewInvitations : [],
    socialNotifications: Array.isArray(store.socialNotifications) ? store.socialNotifications : [],
    socialChatMessages: Array.isArray(store.socialChatMessages) ? store.socialChatMessages : [],
    socialBands: Array.isArray(store.socialBands) ? store.socialBands : [],
    socialAlbums: Array.isArray(store.socialAlbums) ? store.socialAlbums : [],
    socialBlocks: Array.isArray(store.socialBlocks) ? store.socialBlocks : [],
    socialMutes: Array.isArray(store.socialMutes) ? store.socialMutes : [],
  }
}

async function initializeDatabase() {
  if (!database) return
  await database.query(`
    CREATE TABLE IF NOT EXISTS youtopic_auth_store (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL
    )
  `)
  await database.query(
    'INSERT INTO youtopic_auth_store (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(emptyStore())],
  )
  await database.query(`
    CREATE TABLE IF NOT EXISTS youtopic_social_media (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      content_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS youtopic_social_posts (
      id BIGSERIAL PRIMARY KEY,
      author_id TEXT NOT NULL,
      data JSONB NOT NULL,
      liked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      saved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      boosted_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      band_id TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS youtopic_social_comment_ids (id BIGSERIAL PRIMARY KEY);
  `)
  await database.query('ALTER TABLE youtopic_social_posts ADD COLUMN IF NOT EXISTS band_id TEXT')
  await database.query("SELECT setval(pg_get_serial_sequence('youtopic_social_posts', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM youtopic_social_posts), 0), 1000000000))")
  await database.query("SELECT setval(pg_get_serial_sequence('youtopic_social_comment_ids', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM youtopic_social_comment_ids), 0), 1000000000))")
}

async function readStore() {
  if (database) {
    const { rows } = await database.query('SELECT state FROM youtopic_auth_store WHERE id = 1')
    return normalizeStore(rows[0]?.state ?? emptyStore())
  }
  try {
    return normalizeStore(JSON.parse(await readFile(storePath, 'utf8')))
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore()
    throw error
  }
}

function updateStore(update) {
  if (database) {
    return database.connect().then(async (client) => {
      try {
        await client.query('BEGIN')
        const { rows } = await client.query('SELECT state FROM youtopic_auth_store WHERE id = 1 FOR UPDATE')
        const store = normalizeStore(rows[0]?.state ?? emptyStore())
        const result = await update(store)
        await client.query('UPDATE youtopic_auth_store SET state = $1::jsonb WHERE id = 1', [JSON.stringify(store)])
        await client.query('COMMIT')
        return result
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          console.error('Auth store transaction rollback failed:', rollbackError)
        }
        throw error
      } finally {
        client.release()
      }
    })
  }
  const operation = storeQueue.then(async () => {
    const store = normalizeStore(await readStore())
    const result = await update(store)
    await mkdir(dirname(storePath), { recursive: true })
    const temporaryPath = `${storePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(store), { mode: 0o600 })
    await rename(temporaryPath, storePath)
    return result
  })
  storeQueue = operation.catch(() => {})
  return operation
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashIp(ipAddress) {
  const normalizedAddress = typeof ipAddress === 'string' ? ipAddress.replace(/^::ffff:/, '') : ''
  return crypto.createHmac('sha256', sessionSecret).update(`ip:${normalizedAddress}`).digest('hex')
}

function isUserBlocked(user, now = Date.now()) {
  return Boolean(user.blockedAt && (!Number.isFinite(user.blockedUntil) || user.blockedUntil > now))
}

function codeDigest(challengeId, code) {
  return crypto.createHmac('sha256', sessionSecret).update(`${challengeId}:${code}`).digest('hex')
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64)
  return `${salt}:${Buffer.from(hash).toString('hex')}`
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false
  const [salt, savedHash] = storedHash.split(':')
  if (!salt || !savedHash) return false
  const hash = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(savedHash, 'hex')
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
}

function defaultNickname(user) {
  return user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || user.id
}

function defaultProfileNickname(user) {
  return user.nickname || defaultNickname(user).slice(0, 24)
}

function safeUser(user) {
  const middleName = user.middleName || ''
  const secondLastName = user.secondLastName || ''
  return {
    id: user.id,
    profileVerified: Boolean(user.profileVerified),
    name: [user.firstName, middleName, user.lastName, secondLastName].filter(Boolean).join(' '),
    firstName: user.firstName,
    middleName,
    lastName: user.lastName,
    secondLastName,
    gender: user.gender,
    handle: defaultNickname(user),
    nickname: defaultProfileNickname(user),
    avatar: user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=faces',
    location: user.location || '',
    bio: user.bio || '',
    contactPhone: user.contactPhone || '',
    secondContactPhone: user.secondContactPhone || '',
    coverImage: user.coverImage || '',
    socialLinks: user.socialLinks || {},
    profileVisibility: user.profileVisibility || {
      location: 'public',
      bio: 'public',
      contactPhone: 'private',
      secondContactPhone: 'private',
      socialLinks: 'public',
      crewMembers: 'public',
      crewSize: 'public',
    },
    socialPrivacy: {
      profileAudience: user.socialPrivacy?.profileAudience ?? 'public',
      crewInviteAudience: user.socialPrivacy?.crewInviteAudience ?? 'everyone',
    },
    online: true,
    crewMembers: 0,
    crewSize: 0,
  }
}

function findCookie(request, name) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null
}

function sessionValue(user, rememberMe, kind = 'user') {
  const lifetime = rememberMe ? rememberedSessionLifetime : sessionLifetime
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + lifetime, ver: user.authVersion ?? 0, kind })).toString('base64url')
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function sessionUserId(request, cookieName = sessionCookie) {
  const value = findCookie(request, cookieName)
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return session.exp > Date.now() ? session : null
  } catch {
    return null
  }
}

function setSession(response, user, rememberMe = false) {
  const lifetime = rememberMe ? rememberedSessionLifetime : sessionLifetime
  response.cookie(sessionCookie, sessionValue(user, rememberMe), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(rememberMe ? { maxAge: lifetime } : {}),
  })
}

function clearSession(response) {
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

function setAdminSession(response, admin) {
  response.cookie(adminSessionCookie, sessionValue(admin, false, 'admin'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

function clearAdminSession(response) {
  response.clearCookie(adminSessionCookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

function deviceCookieOptions(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

function isValidBirthDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false
  const today = new Date()
  let age = today.getUTCFullYear() - date.getUTCFullYear()
  if (today.getUTCMonth() < date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())) age -= 1
  return age >= 15
}

function validPhone(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone)
}

function maskPhone(phone) {
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(0, phone.length - 6))}${phone.slice(-2)}`
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

async function sendVerificationEmail(user, token) {
  if (!mailer || !process.env.SMTP_FROM) throw new Error('EMAIL_NOT_CONFIGURED')
  const link = new URL('/', appUrl)
  link.searchParams.set('verify', token)
  const firstName = escapeHtml(user.firstName)
  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to: user.email,
    subject: 'Potwierdź adres e-mail w YouTopic',
    text: `Cześć ${user.firstName}, potwierdź adres e-mail, otwierając ten link: ${link.toString()}\nLink wygaśnie za 24 godziny.`,
    html: `<p>Cześć ${firstName},</p><p>Potwierdź swój adres e-mail, klikając poniższy przycisk.</p><p><a href="${link.toString()}">Potwierdź adres e-mail</a></p><p>Link wygaśnie za 24 godziny.</p>`,
  })
}

async function sendSms(phone, code, purpose = 'logowania') {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_FROM_NUMBER: from } = process.env
  if (!accountSid || !authToken || !from) throw new Error('SMS_NOT_CONFIGURED')
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const body = new URLSearchParams({ To: phone, From: from, Body: `YouTopic: Twój kod ${purpose} to ${code}. Kod jest ważny przez 10 minut.` })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error('SMS_DELIVERY_FAILED')
}

const requireAuthentication = async (request, response, next) => {
  const session = sessionUserId(request)
  if (!session) return response.status(401).json({ error: 'Zaloguj się ponownie.' })
  const store = request.authStore ?? await readStore()
  const user = store.users.find((item) => item.id === session.sub)
  if (!user) return response.status(401).json({ error: 'Zaloguj się ponownie.' })
  if (isUserBlocked(user)) {
    clearSession(response)
    return response.status(403).json({ error: 'Dostęp do tego konta został ograniczony. Skontaktuj się z administracją YouTopic.' })
  }
  if ((session.ver ?? 0) !== (user.authVersion ?? 0)) return response.status(401).json({ error: 'Zaloguj się ponownie.' })
  request.authUser = user
  next()
}

const mediaUploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
const postCreationLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
const crewMutationLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false })
const socialDirectoryLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false })

function publicSocialPerson(user, store = null) {
  const visibility = user.profileVisibility ?? {}
  const crewMemberCount = store
    ? new Set(store.socialCrewLinks
      .filter((link) => link.firstUserId === user.id || link.secondUserId === user.id)
      .map((link) => link.firstUserId === user.id ? link.secondUserId : link.firstUserId)
      .filter((memberId) => store.users.some((member) => member.id === memberId)
        && !isSocialBlocked(store, user.id, memberId))).size
    : 0
  return {
    id: user.id,
    profileVerified: Boolean(user.profileVerified),
    name: [user.firstName, user.middleName, user.lastName, user.secondLastName].filter(Boolean).join(' '),
    firstName: user.firstName,
    middleName: user.middleName || '',
    lastName: user.lastName,
    secondLastName: user.secondLastName || '',
    handle: defaultNickname(user),
    nickname: defaultProfileNickname(user),
    location: visibility.location === 'public' ? user.location || '' : '',
    bio: visibility.bio === 'public' ? user.bio || '' : '',
    avatar: user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=faces',
    coverImage: user.coverImage || '',
    socialLinks: visibility.socialLinks === 'public' ? user.socialLinks || {} : {},
    profileVisibility: visibility,
    socialPrivacy: {
      profileAudience: user.socialPrivacy?.profileAudience ?? 'public',
      crewInviteAudience: user.socialPrivacy?.crewInviteAudience ?? 'everyone',
    },
    gender: user.gender,
    online: true,
    crewMembers: crewMemberCount,
    crewSize: crewMemberCount,
  }
}

function isSocialBlocked(store, firstUserId, secondUserId) {
  return store.socialBlocks.some((block) =>
    (block.blockerId === firstUserId && block.blockedId === secondUserId)
    || (block.blockerId === secondUserId && block.blockedId === firstUserId))
}

function canViewSocialProfile(store, viewerId, user) {
  if (!user) return false
  const audience = user.socialPrivacy?.profileAudience ?? 'public'
  return audience === 'public' || viewerId === user.id
    || (audience === 'crew' && isCrewMember(store, viewerId, user.id))
}

function blockedUserIds(store, userId) {
  return store.socialBlocks
    .filter((block) => block.blockerId === userId || block.blockedId === userId)
    .map((block) => block.blockerId === userId ? block.blockedId : block.blockerId)
}

function isCrewMember(store, firstUserId, secondUserId) {
  return store.socialCrewLinks.some((link) =>
    (link.firstUserId === firstUserId && link.secondUserId === secondUserId)
    || (link.firstUserId === secondUserId && link.secondUserId === firstUserId))
}

function bandForMember(store, bandId, userId) {
  const band = store.socialBands.find((item) => item.id === bandId)
  return band && (band.adminId === userId || band.memberIds.includes(userId)) ? band : null
}

function publicBand(band, users) {
  const admin = users.find((user) => user.id === band.adminId)
  return {
    id: band.id,
    name: band.name,
    adminHandle: admin ? defaultNickname(admin) : '',
    memberHandles: band.memberIds.map((id) => users.find((user) => user.id === id)).filter(Boolean).map(defaultNickname),
  }
}

function appendSocialNotification(store, userId, actorId, type, message, postId, chatHandle, crewInvitationId) {
  if (!userId || userId === actorId) return
  if (isSocialBlocked(store, userId, actorId)) return
  if (type === 'chat_message' && store.socialMutes.some((mute) => mute.userId === userId && mute.mutedUserId === actorId)) return
  store.socialNotifications.unshift({
    id: crypto.randomUUID(),
    userId,
    actorId,
    type,
    message,
    postId: postId ? String(postId) : undefined,
    chatHandle,
    crewInvitationId,
    createdAt: Date.now(),
    readAt: null,
  })
  store.socialNotifications = store.socialNotifications.slice(0, 5000)
}

function socialPostForUser(post, userId, users) {
  const author = users.find((user) => user.id === post.authorId)
  const likedBy = Array.isArray(post.likedBy) ? post.likedBy : []
  const savedBy = Array.isArray(post.savedBy) ? post.savedBy : []
  const boostedBy = Array.isArray(post.boostedBy) ? post.boostedBy : []
  const comments = (post.comments ?? []).map((comment) => {
    const commentAuthor = users.find((user) => user.id === comment.authorId)
    return {
      ...comment,
      author: commentAuthor ? publicSocialPerson(commentAuthor) : comment.author,
      likedBy: (comment.likedBy ?? []).map((id) => {
        const likedUser = users.find((user) => user.id === id)
        return likedUser ? defaultNickname(likedUser) : ''
      }).filter(Boolean),
      authorId: undefined,
    }
  })
  return {
    ...post.data,
    id: Number(post.id),
    createdAt: post.createdAt ?? post.data.createdAt,
    author: author ? publicSocialPerson(author) : post.author,
    comments,
    likes: likedBy.length,
    liked: likedBy.includes(userId),
    saved: savedBy.includes(userId),
    boosts: Number(post.data.boosts ?? 0),
    boostedBy: boostedBy.map((id) => users.find((user) => user.id === id)?.nickname ?? '').filter(Boolean),
    authorId: undefined,
    likedBy: undefined,
    savedBy: undefined,
    serverBacked: true,
  }
}

async function readSocialPosts(userId, store = null, { before, beforeId, limit = 30 } = {}) {
  store ??= await readStore()
  const accessibleBandIds = store.socialBands
    .filter((band) => band.adminId === userId || band.memberIds.includes(userId))
    .map((band) => band.id)
  const inaccessibleUserIds = blockedUserIds(store, userId).concat(
    store.users.filter((user) => !canViewSocialProfile(store, userId, user)).map((user) => user.id),
  )
  if (database) {
    const { rows } = await database.query(
      `SELECT id, author_id, data, liked_by, saved_by, boosted_by, created_at
       FROM youtopic_social_posts
       WHERE (band_id IS NULL OR band_id = ANY($1::text[]))
         AND author_id <> ALL($2::text[])
         AND ($3::bigint IS NULL OR (created_at, id) < ($3, $4::bigint))
       ORDER BY created_at DESC, id DESC LIMIT $5`,
      [accessibleBandIds, inaccessibleUserIds, before ?? null, beforeId ?? before ?? null, limit],
    )
    return rows.map((row) => socialPostForUser({
      id: row.id,
      createdAt: Number(row.created_at),
      authorId: row.author_id,
      data: row.data,
      likedBy: row.liked_by,
      savedBy: row.saved_by,
      boostedBy: row.boosted_by,
      comments: row.data.comments ?? [],
      author: row.data.author,
    }, userId, store.users))
  }
  return store.socialPosts
    .filter((post) => (!post.data.bandId || accessibleBandIds.includes(post.data.bandId))
      && !inaccessibleUserIds.includes(post.authorId)
      && (before === undefined
        || Number(post.createdAt ?? post.data.createdAt ?? post.id) < before
        || Number(post.createdAt ?? post.data.createdAt ?? post.id) === before && Number(post.id) < (beforeId ?? Number.POSITIVE_INFINITY)))
    .sort((first, second) =>
      Number(second.createdAt ?? second.data.createdAt ?? second.id) - Number(first.createdAt ?? first.data.createdAt ?? first.id)
      || Number(second.id) - Number(first.id))
    .slice(0, limit)
    .map((post) => socialPostForUser(post, userId, store.users))
}

async function readMedia(mediaId, ownerId, allowPublished = false) {
  if (database) {
    const { rows } = await database.query('SELECT owner_id, content_type, data FROM youtopic_social_media WHERE id = $1', [mediaId])
    const media = rows[0]
    if (!media) return null
    if (media.owner_id === ownerId) return media
    if (!allowPublished) return null
    const mediaUrl = `/api/media/${mediaId}`
    const { rows: references } = await database.query(`
      SELECT author_id, band_id
      FROM youtopic_social_posts
      WHERE data->>'image' = $1 OR data->>'video' = $1
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(data->'comments', '[]'::jsonb)) AS comment
          WHERE comment->>'audioUrl' = $1
        )
      LIMIT 100
    `, [mediaUrl])
    const store = await readStore()
    const postVisible = references.some(({ author_id, band_id }) =>
      !isSocialBlocked(store, ownerId, author_id)
      && canViewSocialProfile(store, ownerId, store.users.find((user) => user.id === author_id))
      && (!band_id || bandForMember(store, band_id, ownerId)))
    const albumVisible = store.socialAlbums.some((album) =>
      album.photos.some((photo) => photo.mediaId === mediaId)
      && !isSocialBlocked(store, ownerId, album.ownerId)
      && canViewSocialProfile(store, ownerId, store.users.find((user) => user.id === album.ownerId)))
    return postVisible || albumVisible ? media : null
  }
  const store = await readStore()
  const media = store.socialMedia.find((item) => item.id === mediaId && item.ownerId === ownerId)
  if (media) return { content_type: media.contentType, data: Buffer.from(media.data, 'base64') }
  if (!allowPublished) return null
  const mediaUrl = `/api/media/${mediaId}`
  const isPublished = store.socialPosts.some((post) => {
    const referencesMedia = post.data.image === mediaUrl || post.data.video === mediaUrl
      || (post.comments ?? post.data.comments ?? []).some((comment) => comment.audioUrl === mediaUrl)
    return referencesMedia
      && !isSocialBlocked(store, ownerId, post.authorId)
      && canViewSocialProfile(store, ownerId, store.users.find((user) => user.id === post.authorId))
      && (!post.data.bandId || bandForMember(store, post.data.bandId, ownerId))
  })
  const albumPublished = store.socialAlbums.some((album) =>
    album.photos.some((photo) => photo.mediaId === mediaId)
    && !isSocialBlocked(store, ownerId, album.ownerId)
    && canViewSocialProfile(store, ownerId, store.users.find((user) => user.id === album.ownerId)))
  const publishedMedia = isPublished || albumPublished ? store.socialMedia.find((item) => item.id === mediaId) : null
  return publishedMedia ? { content_type: publishedMedia.contentType, data: Buffer.from(publishedMedia.data, 'base64') } : null
}

async function deleteUnreferencedMedia(mediaId) {
  if (!mediaId) return
  const mediaUrl = `/api/media/${mediaId}`
  if (database) {
    const [{ rows: postReferences }, store] = await Promise.all([
      database.query(`
        SELECT 1 FROM youtopic_social_posts
        WHERE data->>'image' = $1 OR data->>'video' = $1
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(data->'comments', '[]'::jsonb)) AS comment
            WHERE comment->>'audioUrl' = $1
          )
        LIMIT 1
      `, [mediaUrl]),
      readStore(),
    ])
    if (postReferences.length || store.socialAlbums.some((album) => album.photos.some((photo) => photo.mediaId === mediaId))) return
    await database.query('DELETE FROM youtopic_social_media WHERE id = $1', [mediaId])
    return
  }
  await updateStore((store) => {
    const referencedByPost = store.socialPosts.some((post) =>
      post.data.image === mediaUrl || post.data.video === mediaUrl
      || (post.comments ?? post.data.comments ?? []).some((comment) => comment.audioUrl === mediaUrl))
    const referencedByAlbum = store.socialAlbums.some((album) => album.photos.some((photo) => photo.mediaId === mediaId))
    if (!referencedByPost && !referencedByAlbum) {
      store.socialMedia = store.socialMedia.filter((item) => item.id !== mediaId)
    }
  })
}

function validMediaPayload(contentType, data) {
  const signatures = {
    'image/jpeg': data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/png': data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
    'image/gif': data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)),
    'video/mp4': data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp',
    'video/webm': data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    'audio/mp4': data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp',
    'audio/webm': data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    'audio/ogg': data.length >= 4 && data.toString('ascii', 0, 4) === 'OggS',
  }
  if (!signatures[contentType]) return false
  const maxSize = contentType.startsWith('video/') ? 20 * 1024 * 1024 : contentType.startsWith('audio/') ? 5 * 1024 * 1024 : 8 * 1024 * 1024
  return data.length > 0 && data.length <= maxSize && signatures[contentType]
}

app.post('/api/media', requireAuthentication, mediaUploadLimit, express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (request, response) => {
  const contentType = request.get('X-Media-Type')?.toLowerCase()
  const data = request.body
  if (!Buffer.isBuffer(data) || !validMediaPayload(contentType, data)) return response.status(400).json({ error: 'Plik jest nieprawidłowy albo przekracza dozwolony rozmiar (zdjęcie 8 MB, film 20 MB, nagranie 5 MB).' })
  const id = crypto.randomUUID()
  if (database) {
    await database.query('INSERT INTO youtopic_social_media (id, owner_id, content_type, data, created_at) VALUES ($1, $2, $3, $4, $5)', [id, request.authUser.id, contentType, data, Date.now()])
  } else {
    await updateStore((store) => { store.socialMedia.push({ id, ownerId: request.authUser.id, contentType, data: data.toString('base64') }) })
  }
  return response.status(201).json({ id, url: `/api/media/${id}`, contentType })
})

app.get('/api/media/:mediaId', requireAuthentication, async (request, response) => {
  if (!/^[\da-f-]{36}$/i.test(request.params.mediaId)) return response.status(404).json({ error: 'Nie znaleziono pliku.' })
  const media = await readMedia(request.params.mediaId, request.authUser.id, true)
  if (!media) return response.status(404).json({ error: 'Nie znaleziono pliku.' })
  const baseHeaders = { 'Content-Type': media.content_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }
  const range = request.get('range')
  if (range && /^video\//.test(media.content_type)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) {
      response.set({ ...baseHeaders, 'Content-Range': `bytes */${media.data.length}` })
      return response.status(416).end()
    }
    const suffixLength = match[1] ? null : Number(match[2])
    const start = match[1] ? Number(match[1]) : Math.max(0, media.data.length - (suffixLength || 0))
    const end = match[2] && match[1] ? Math.min(Number(match[2]), media.data.length - 1) : media.data.length - 1
    if (start >= media.data.length || end < start) {
      response.set({ ...baseHeaders, 'Content-Range': `bytes */${media.data.length}` })
      return response.status(416).end()
    }
    const chunk = media.data.subarray(start, end + 1)
    response.set({ ...baseHeaders, 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${media.data.length}` })
    return response.status(206).send(chunk)
  }
  response.set({ ...baseHeaders, 'Content-Length': String(media.data.length) })
  return response.send(media.data)
})

function galleryPostPhoto(post) {
  return {
    id: `post:${post.id}`,
    sourcePostId: String(post.id),
    url: post.data.image,
    caption: post.data.text ?? '',
    createdAt: Number(post.createdAt ?? post.data.createdAt ?? post.id),
  }
}

function isGalleryPhotoModerated(store, ownerId, postId) {
  return store.moderatedItems.some((item) => item.targetUserId === ownerId
    && (item.targetId === `post:${postId}` || item.targetId === `photo:${postId}`))
}

app.get('/api/gallery/:handle', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const owner = store.users.find((user) => defaultNickname(user).toLocaleLowerCase('pl-PL') === request.params.handle.toLocaleLowerCase('pl-PL'))
  if (!owner || owner.emailVerified !== true
    || isSocialBlocked(store, request.authUser.id, owner.id)
    || !canViewSocialProfile(store, request.authUser.id, owner)) {
    return response.status(404).json({ error: 'Nie znaleziono dostępnej galerii.' })
  }
  let sourcePosts
  if (database) {
    const { rows } = await database.query(
      `SELECT id, data, created_at FROM youtopic_social_posts
       WHERE author_id = $1 AND band_id IS NULL AND data ? 'image'
       ORDER BY created_at DESC, id DESC LIMIT 500`,
      [owner.id],
    )
    sourcePosts = rows.map((row) => ({ id: row.id, data: row.data, createdAt: Number(row.created_at) }))
  } else {
    sourcePosts = store.socialPosts
      .filter((post) => post.authorId === owner.id && !post.data.bandId && typeof post.data.image === 'string')
      .sort((first, second) => Number(second.createdAt ?? second.id) - Number(first.createdAt ?? first.id))
      .slice(0, 500)
  }
  const albums = store.socialAlbums
    .filter((album) => album.ownerId === owner.id)
    .map(({ id, name, createdAt, photos }) => ({
      id,
      name,
      createdAt,
      photos: photos.filter((photo) => !photo.sourcePostId || !isGalleryPhotoModerated(store, owner.id, photo.sourcePostId)),
    }))
  return response.json({
    photos: sourcePosts.filter((post) => !isGalleryPhotoModerated(store, owner.id, post.id)).map(galleryPostPhoto),
    albums,
    owner: publicSocialPerson(owner, store),
  })
})

app.post('/api/gallery/albums', requireAuthentication, async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 60) : ''
  if (!name) return response.status(400).json({ error: 'Podaj nazwę albumu.' })
  const album = await updateStore((store) => {
    const ownedAlbums = store.socialAlbums.filter((item) => item.ownerId === request.authUser.id)
    if (ownedAlbums.length >= 30) return null
    const created = { id: crypto.randomUUID(), ownerId: request.authUser.id, name, createdAt: Date.now(), photos: [] }
    store.socialAlbums.push(created)
    return { id: created.id, name: created.name, createdAt: created.createdAt, photos: created.photos }
  })
  if (!album) return response.status(409).json({ error: 'Możesz utworzyć maksymalnie 30 albumów.' })
  return response.status(201).json({ album })
})

app.post('/api/gallery/albums/:albumId/photos', requireAuthentication, async (request, response) => {
  const { sourcePostId, mediaId } = request.body ?? {}
  const caption = typeof request.body?.caption === 'string' ? request.body.caption.trim().slice(0, 300) : ''
  if (Boolean(sourcePostId) === Boolean(mediaId) || (sourcePostId && !/^\d+$/.test(String(sourcePostId)))
    || (mediaId && !/^[\da-f-]{36}$/i.test(String(mediaId)))) {
    return response.status(400).json({ error: 'Wybierz zdjęcie opublikowane na Tablicy albo nowe zdjęcie.' })
  }
  let photoSource = null
  if (sourcePostId) {
    if (database) {
      const { rows } = await database.query(
        "SELECT id, author_id, data, band_id, created_at FROM youtopic_social_posts WHERE id = $1 AND author_id = $2 AND band_id IS NULL AND data ? 'image'",
        [sourcePostId, request.authUser.id],
      )
      photoSource = rows[0] ? { postId: String(rows[0].id), url: rows[0].data.image, createdAt: Number(rows[0].created_at) } : null
    } else {
      const post = request.authStore.socialPosts.find((item) => String(item.id) === String(sourcePostId)
        && item.authorId === request.authUser.id && !item.data.bandId && typeof item.data.image === 'string')
      photoSource = post ? { postId: String(post.id), url: post.data.image, createdAt: Number(post.createdAt ?? post.id) } : null
    }
    if (!photoSource) return response.status(404).json({ error: 'Nie znaleziono Twojego zdjęcia z Tablicy.' })
    if (isGalleryPhotoModerated(request.authStore, request.authUser.id, photoSource.postId)) return response.status(404).json({ error: 'To zdjęcie jest niedostępne po decyzji moderacyjnej.' })
  } else {
    const media = await readMedia(mediaId, request.authUser.id)
    if (!media || !media.content_type.startsWith('image/')) return response.status(400).json({ error: 'Nie znaleziono przesłanego zdjęcia.' })
    photoSource = { mediaId, url: `/api/media/${mediaId}`, createdAt: Date.now() }
  }
  const result = await updateStore((store) => {
    const album = store.socialAlbums.find((item) => item.id === request.params.albumId && item.ownerId === request.authUser.id)
    if (!album) return { error: 'Nie znaleziono Twojego albumu.' }
    if (album.photos.length >= 200) return { error: 'Album może zawierać maksymalnie 200 zdjęć.' }
    if (album.photos.some((photo) => photo.sourcePostId === photoSource.postId
      || photo.mediaId === photoSource.mediaId)) return { error: 'To zdjęcie jest już w tym albumie.' }
    const photo = { id: crypto.randomUUID(), ...photoSource, caption, createdAt: Date.now() }
    album.photos.unshift(photo)
    return { photo, album: { id: album.id, name: album.name, createdAt: album.createdAt, photos: album.photos } }
  })
  if (result.error) return response.status(result.error === 'Nie znaleziono Twojego albumu.' ? 404 : 409).json({ error: result.error })
  return response.status(201).json(result)
})

app.delete('/api/gallery/albums/:albumId/photos/:photoId', requireAuthentication, async (request, response) => {
  const removal = await updateStore((store) => {
    const album = store.socialAlbums.find((item) => item.id === request.params.albumId && item.ownerId === request.authUser.id)
    if (!album) return null
    const photo = album.photos.find((item) => item.id === request.params.photoId)
    if (!photo) return null
    album.photos = album.photos.filter((photo) => photo.id !== request.params.photoId)
    return { mediaId: photo.mediaId ?? '' }
  })
  if (!removal) return response.status(404).json({ error: 'Nie znaleziono zdjęcia w Twoim albumie.' })
  await deleteUnreferencedMedia(removal.mediaId)
  return response.json({ ok: true })
})

app.delete('/api/gallery/albums/:albumId', requireAuthentication, async (request, response) => {
  const removedMediaIds = await updateStore((store) => {
    const album = store.socialAlbums.find((item) => item.id === request.params.albumId && item.ownerId === request.authUser.id)
    if (!album) return null
    const mediaIds = album.photos.map((photo) => photo.mediaId).filter(Boolean)
    const originalLength = store.socialAlbums.length
    store.socialAlbums = store.socialAlbums.filter((album) => !(album.id === request.params.albumId && album.ownerId === request.authUser.id))
    return store.socialAlbums.length < originalLength ? mediaIds : null
  })
  if (!removedMediaIds) return response.status(404).json({ error: 'Nie znaleziono Twojego albumu.' })
  await Promise.all(removedMediaIds.map(deleteUnreferencedMedia))
  return response.json({ ok: true })
})

app.delete('/api/gallery/posts/:postId/photo', requireAuthentication, async (request, response) => {
  if (!/^\d+$/.test(request.params.postId)) return response.status(400).json({ error: 'Nieprawidłowy identyfikator posta.' })
  let removed = false
  let removedMediaId = ''
  if (database) {
    const { rows } = await database.query('SELECT author_id, data FROM youtopic_social_posts WHERE id = $1', [request.params.postId])
    const post = rows[0]
    if (!post || post.author_id !== request.authUser.id || !post.data.image) return response.status(404).json({ error: 'Nie znaleziono Twojego zdjęcia.' })
    removedMediaId = /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.image)?.[1] ?? ''
    const updatedData = { ...post.data }
    delete updatedData.image
    if (!updatedData.text && !updatedData.video && !updatedData.externalUrl && !updatedData.sharedFrom) {
      await database.query('DELETE FROM youtopic_social_posts WHERE id = $1 AND author_id = $2', [request.params.postId, request.authUser.id])
    } else {
      await database.query('UPDATE youtopic_social_posts SET data = $1::jsonb WHERE id = $2 AND author_id = $3', [JSON.stringify(updatedData), request.params.postId, request.authUser.id])
    }
    removed = true
  } else {
    removed = await updateStore((store) => {
      const post = store.socialPosts.find((item) => String(item.id) === request.params.postId && item.authorId === request.authUser.id)
      if (!post || !post.data.image) return false
      removedMediaId = /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.image)?.[1] ?? ''
      delete post.data.image
      store.socialAlbums.forEach((album) => {
        album.photos = album.photos.filter((photo) => photo.sourcePostId !== String(post.id))
      })
      if (!post.data.text && !post.data.video && !post.data.externalUrl && !post.data.sharedFrom) {
        store.socialPosts = store.socialPosts.filter((item) => item !== post)
      }
      return true
    })
  }
  if (!removed) return response.status(404).json({ error: 'Nie znaleziono Twojego zdjęcia.' })
  if (database) {
    await updateStore((store) => store.socialAlbums.forEach((album) => {
      album.photos = album.photos.filter((photo) => photo.sourcePostId !== request.params.postId)
    }))
  }
  await deleteUnreferencedMedia(removedMediaId)
  return response.json({ ok: true })
})

app.get('/api/users', requireAuthentication, socialDirectoryLimit, async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().toLocaleLowerCase('pl-PL') : ''
  const store = request.authStore
  const users = store.users
    .filter((user) => user.id !== request.authUser.id && user.emailVerified === true && !isUserBlocked(user)
      && !isSocialBlocked(store, request.authUser.id, user.id)
      && canViewSocialProfile(store, request.authUser.id, user))
    .map((user) => publicSocialPerson(user, store))
    .filter((user) => !query || `${user.name} ${user.handle} ${user.nickname}`.toLocaleLowerCase('pl-PL').includes(query))
    .slice(0, 50)
  return response.json({ users })
})

app.get('/api/blocks', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const ids = store.socialBlocks.filter((item) => item.blockerId === request.authUser.id).map((item) => item.blockedId)
  const users = store.users.filter((user) => ids.includes(user.id)).map(publicSocialPerson)
  return response.json({ users })
})

app.post('/api/users/:userId/block', requireAuthentication, crewMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const target = store.users.find((user) => user.id === request.params.userId && user.emailVerified === true)
    if (!target || target.id === request.authUser.id) return { error: 'Nie znaleziono użytkownika do zablokowania.' }
    if (!store.socialBlocks.some((item) => item.blockerId === request.authUser.id && item.blockedId === target.id)) {
      store.socialBlocks.push({ blockerId: request.authUser.id, blockedId: target.id, createdAt: Date.now() })
    }
    store.socialCrewLinks = store.socialCrewLinks.filter((link) => !(
      (link.firstUserId === request.authUser.id && link.secondUserId === target.id)
      || (link.secondUserId === request.authUser.id && link.firstUserId === target.id)))
    store.socialCrewInvitations = store.socialCrewInvitations.map((invitation) =>
      invitation.status === 'pending'
        && [invitation.fromId, invitation.toId].includes(request.authUser.id)
        && [invitation.fromId, invitation.toId].includes(target.id)
        ? { ...invitation, status: 'cancelled', respondedAt: Date.now() }
        : invitation)
    return { ok: true }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.delete('/api/users/:userId/block', requireAuthentication, crewMutationLimit, async (request, response) => {
  const removed = await updateStore((store) => {
    const before = store.socialBlocks.length
    store.socialBlocks = store.socialBlocks.filter((item) => !(item.blockerId === request.authUser.id && item.blockedId === request.params.userId))
    return store.socialBlocks.length < before
  })
  if (!removed) return response.status(404).json({ error: 'Nie znaleziono blokady.' })
  return response.json({ ok: true })
})

app.get('/api/chat/mutes', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  const handles = store.socialMutes
    .filter((item) => item.userId === request.authUser.id)
    .map((item) => usersById.get(item.mutedUserId))
    .filter(Boolean)
    .map(defaultNickname)
  return response.json({ handles })
})

app.post('/api/chat/:handle/mute', requireAuthentication, crewMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const target = store.users.find((user) => defaultNickname(user) === request.params.handle && user.id !== request.authUser.id)
    if (!target || isSocialBlocked(store, request.authUser.id, target.id)) return { error: 'Nie znaleziono rozmowy do wyciszenia.' }
    if (!store.socialMutes.some((item) => item.userId === request.authUser.id && item.mutedUserId === target.id)) {
      store.socialMutes.push({ userId: request.authUser.id, mutedUserId: target.id, createdAt: Date.now() })
    }
    const mutedAt = Date.now()
    for (const notification of store.socialNotifications) {
      if (notification.userId === request.authUser.id && notification.type === 'chat_message'
        && notification.actorId === target.id && !notification.readAt) notification.readAt = mutedAt
    }
    return { ok: true }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.delete('/api/chat/:handle/mute', requireAuthentication, crewMutationLimit, async (request, response) => {
  const removed = await updateStore((store) => {
    const target = store.users.find((user) => defaultNickname(user) === request.params.handle)
    if (!target) return false
    const before = store.socialMutes.length
    store.socialMutes = store.socialMutes.filter((item) => !(item.userId === request.authUser.id && item.mutedUserId === target.id))
    return before !== store.socialMutes.length
  })
  if (!removed) return response.status(404).json({ error: 'Nie znaleziono wyciszonej rozmowy.' })
  return response.json({ ok: true })
})

app.get('/api/crew', requireAuthentication, socialDirectoryLimit, async (request, response) => {
  const store = request.authStore
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  const links = store.socialCrewLinks
    .filter((link) => link.firstUserId === request.authUser.id || link.secondUserId === request.authUser.id)
    .map((link) => [usersById.get(link.firstUserId), usersById.get(link.secondUserId)])
    .filter((pair) => pair.every(Boolean))
    .filter((pair) => pair.every((user) => canViewSocialProfile(store, request.authUser.id, user)))
    .map((pair) => pair.map((user) => defaultNickname(user)))
  const invitations = store.socialCrewInvitations
    .filter((invitation) => invitation.fromId === request.authUser.id || invitation.toId === request.authUser.id)
    .map((invitation) => ({
      id: invitation.id,
      from: usersById.get(invitation.fromId),
      to: usersById.get(invitation.toId),
      status: invitation.status,
      respondedAt: invitation.respondedAt,
    }))
    .filter((invitation) => invitation.from && invitation.to)
    .map((invitation) => ({ ...invitation, from: publicSocialPerson(invitation.from, store), to: publicSocialPerson(invitation.to, store) }))
  return response.json({ links, invitations, memberCount: links.length })
})

app.post('/api/crew/invitations', requireAuthentication, crewMutationLimit, async (request, response) => {
  const toUserId = typeof request.body?.toUserId === 'string' ? request.body.toUserId : ''
  if (!toUserId || toUserId === request.authUser.id) return response.status(400).json({ error: 'Wybierz użytkownika, którego chcesz dodać do Ekipy.' })
  const result = await updateStore(async (store) => {
    const target = store.users.find((user) => user.id === toUserId && user.emailVerified === true && !isUserBlocked(user))
    if (!target || isSocialBlocked(store, request.authUser.id, target.id)
      || !canViewSocialProfile(store, request.authUser.id, target)) return { error: 'Nie znaleziono aktywnego konta tego użytkownika.' }
    const inviteAudience = target.socialPrivacy?.crewInviteAudience ?? 'everyone'
    if (inviteAudience === 'nobody') {
      return { error: 'Ten użytkownik nie przyjmuje zaproszeń do Ekipy od Ciebie.' }
    }
    const pair = [request.authUser.id, target.id].sort()
    if (store.socialCrewLinks.some((link) => [link.firstUserId, link.secondUserId].sort().join(':') === pair.join(':'))) {
      return { error: 'Jesteście już w swoich Ekipach.' }
    }
    const pending = store.socialCrewInvitations.find((invitation) =>
      invitation.status === 'pending' && [invitation.fromId, invitation.toId].sort().join(':') === pair.join(':'))
    if (pending) return { error: 'Zaproszenie do Ekipy już czeka na odpowiedź.' }
    const invitation = { id: crypto.randomUUID(), fromId: request.authUser.id, toId: target.id, status: 'pending', createdAt: Date.now() }
    store.socialCrewInvitations.push(invitation)
    appendSocialNotification(store, target.id, request.authUser.id, 'crew_invitation', 'zaprasza Cię do swojej Ekipy.', undefined, undefined, invitation.id)
    return { invitation: { ...invitation, from: publicSocialPerson(request.authUser, store), to: publicSocialPerson(target, store) } }
  })
  if (result.error) return response.status(409).json({ error: result.error })
  return response.status(201).json(result)
})

app.post('/api/crew/invitations/:invitationId/respond', requireAuthentication, crewMutationLimit, async (request, response) => {
  const accept = request.body?.accept
  if (typeof accept !== 'boolean') return response.status(400).json({ error: 'Wybierz, czy akceptujesz zaproszenie.' })
  const result = await updateStore((store) => {
    const invitation = store.socialCrewInvitations.find((item) => item.id === request.params.invitationId && item.toId === request.authUser.id && item.status === 'pending')
    if (!invitation) return { error: 'To zaproszenie nie jest już dostępne.' }
    invitation.status = accept ? 'accepted' : 'declined'
    invitation.respondedAt = Date.now()
    if (accept) appendSocialNotification(store, invitation.fromId, request.authUser.id, 'crew_accepted', 'zaakceptował Twoje zaproszenie do Ekipy.')
    if (accept && !store.socialCrewLinks.some((link) =>
      [link.firstUserId, link.secondUserId].sort().join(':') === [invitation.fromId, invitation.toId].sort().join(':'))) {
      store.socialCrewLinks.push({ firstUserId: invitation.fromId, secondUserId: invitation.toId })
    }
    return { ok: true }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.delete('/api/crew/invitations/:invitationId', requireAuthentication, crewMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const invitation = store.socialCrewInvitations.find((item) => item.id === request.params.invitationId && item.fromId === request.authUser.id && item.status === 'pending')
    if (!invitation) return { error: 'Nie znaleziono oczekującego zaproszenia.' }
    invitation.status = 'cancelled'
    invitation.respondedAt = Date.now()
    return { ok: true }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.delete('/api/crew/:handle', requireAuthentication, crewMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const target = store.users.find((user) => defaultNickname(user) === request.params.handle)
    if (!target || target.id === request.authUser.id) return { error: 'Nie znaleziono użytkownika.' }
    const before = store.socialCrewLinks.length
    store.socialCrewLinks = store.socialCrewLinks.filter((link) =>
      !((link.firstUserId === request.authUser.id && link.secondUserId === target.id)
        || (link.secondUserId === request.authUser.id && link.firstUserId === target.id)))
    return store.socialCrewLinks.length < before ? { ok: true } : { error: 'Nie jesteście w swoich Ekipach.' }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.get('/api/bands', requireAuthentication, socialDirectoryLimit, async (request, response) => {
  const store = request.authStore
  const bands = store.socialBands
    .filter((band) => band.adminId === request.authUser.id || band.memberIds.includes(request.authUser.id))
    .map((band) => publicBand(band, store.users))
  return response.json({ bands })
})

app.post('/api/bands', requireAuthentication, crewMutationLimit, async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim().slice(0, 60) : ''
  const memberHandles = Array.isArray(request.body?.memberHandles) ? request.body.memberHandles.filter((handle) => typeof handle === 'string') : []
  if (!name) return response.status(400).json({ error: 'Podaj nazwę bandy.' })
  const result = await updateStore((store) => {
    const requestedMembers = store.users.filter((user) => memberHandles.includes(defaultNickname(user)))
    if (requestedMembers.length !== new Set(memberHandles).size
      || requestedMembers.some((user) => !isCrewMember(store, request.authUser.id, user.id))) {
      return { error: 'Do bandy możesz zaprosić tylko osoby ze swojej Ekipy.' }
    }
    const band = {
      id: crypto.randomUUID(),
      name,
      adminId: request.authUser.id,
      memberIds: [...new Set(requestedMembers.map((user) => user.id))],
      createdAt: Date.now(),
    }
    store.socialBands.push(band)
    return { band: publicBand(band, store.users) }
  })
  if (result.error) return response.status(400).json({ error: result.error })
  return response.status(201).json(result)
})

app.patch('/api/bands/:bandId/members', requireAuthentication, crewMutationLimit, async (request, response) => {
  const userId = typeof request.body?.userId === 'string' ? request.body.userId : ''
  const member = request.body?.member
  if (!userId || userId === request.authUser.id || typeof member !== 'boolean') {
    return response.status(400).json({ error: 'Nieprawidłowa zmiana składu bandy.' })
  }
  const result = await updateStore((store) => {
    const band = store.socialBands.find((item) => item.id === request.params.bandId && item.adminId === request.authUser.id)
    const user = store.users.find((item) => item.id === userId)
    if (!band || !user) return { error: 'Nie znaleziono bandy lub użytkownika.' }
    if (member && !isCrewMember(store, request.authUser.id, userId)) return { error: 'Do bandy możesz dodać tylko osobę ze swojej Ekipy.' }
    band.memberIds = member
      ? [...new Set([...band.memberIds, userId])]
      : band.memberIds.filter((id) => id !== userId)
    return { band: publicBand(band, store.users) }
  })
  if (result.error) return response.status(404).json({ error: result.error })
  return response.json(result)
})

app.get('/api/notifications', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  const notifications = store.socialNotifications
    .filter((item) => item.userId === request.authUser.id)
    .filter((item) => !isSocialBlocked(store, request.authUser.id, item.actorId)
      && !(item.type === 'chat_message' && store.socialMutes.some((mute) => mute.userId === request.authUser.id && mute.mutedUserId === item.actorId)))
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, 100)
    .map(({ id, actorId, type, message, postId, chatHandle, crewInvitationId, createdAt, readAt }) => ({
      id, actor: usersById.has(actorId) ? publicSocialPerson(usersById.get(actorId)) : null,
      type, message, postId, chatHandle, crewInvitationId, createdAt, readAt,
    }))
  response.set('Cache-Control', 'no-store')
  return response.json({ notifications })
})

app.patch('/api/notifications/read', requireAuthentication, async (request, response) => {
  const id = typeof request.body?.id === 'string' ? request.body.id : ''
  const chatHandle = typeof request.body?.chatHandle === 'string' ? request.body.chatHandle : ''
  const now = Date.now()
  await updateStore((store) => {
    for (const notification of store.socialNotifications) {
      const matchesChat = chatHandle && notification.type === 'chat_message' && notification.chatHandle === chatHandle
      if (notification.userId === request.authUser.id && (id ? notification.id === id : matchesChat || !chatHandle)) notification.readAt ??= now
    }
  })
  return response.json({ ok: true })
})

const chatMutationLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })
const reportCategoryLabels = new Map([
  ['terms_violation', 'Naruszenie regulaminu'],
  ['harassment', 'Nękanie lub zastraszanie'],
  ['hate', 'Mowa nienawiści'],
  ['violence', 'Przemoc lub groźby'],
  ['spam', 'Spam lub oszustwo'],
  ['privacy', 'Naruszenie prywatności'],
  ['impersonation', 'Podszywanie się'],
  ['sexual_content', 'Niedozwolone treści seksualne'],
  ['other', 'Inne'],
])

app.get('/api/chat', requireAuthentication, socialDirectoryLimit, async (request, response) => {
  if (request.query.scope !== undefined && !['public', 'room'].includes(request.query.scope)) return response.status(400).json({ error: 'Nieprawidłowy rodzaj rozmowy.' })
  const scope = request.query.scope === 'room' ? 'room' : 'public'
  response.set('Cache-Control', 'no-store')
  const store = request.authStore
  const recipientHandle = typeof request.query.with === 'string' ? request.query.with : ''
  const recipient = scope === 'room' ? store.users.find((user) => defaultNickname(user) === recipientHandle) : null
  if (scope === 'room' && (!recipient || isSocialBlocked(store, request.authUser.id, recipient.id) || !isCrewMember(store, request.authUser.id, recipient.id))) {
    return response.status(403).json({ error: 'Prywatny czat jest dostępny po zaakceptowaniu zaproszenia do Ekipy.' })
  }
  const messages = store.socialChatMessages
    .filter((item) => store.users.some((user) => user.id === item.authorId)
      && (scope !== 'room' || store.users.some((user) => user.id === item.recipientId))
      && (scope !== 'public' || !isSocialBlocked(store, request.authUser.id, item.authorId))
      && item.scope === scope && (scope === 'public'
      || ((item.authorId === request.authUser.id && item.recipientId === recipient.id)
        || (item.authorId === recipient.id && item.recipientId === request.authUser.id))))
    .slice(-200)
    .map((item) => ({
      id: item.id,
      author: publicSocialPerson(store.users.find((user) => user.id === item.authorId)),
      scope: item.scope,
      recipientHandle: item.recipientId ? defaultNickname(store.users.find((user) => user.id === item.recipientId)) : undefined,
      text: item.text,
      time: new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(item.createdAt),
      createdAt: item.createdAt,
    }))
  return response.json({ messages })
})

app.post('/api/chat', requireAuthentication, chatMutationLimit, async (request, response) => {
  if (request.body?.scope !== undefined && !['public', 'room'].includes(request.body.scope)) return response.status(400).json({ error: 'Nieprawidłowy rodzaj rozmowy.' })
  const scope = request.body?.scope === 'room' ? 'room' : 'public'
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  const recipientHandle = typeof request.body?.with === 'string' ? request.body.with : ''
  if (!text || text.length > 2000) return response.status(400).json({ error: 'Wiadomość musi mieć od 1 do 2000 znaków.' })
  const result = await updateStore((store) => {
    const recipient = scope === 'room' ? store.users.find((user) => defaultNickname(user) === recipientHandle) : null
    if (scope === 'room' && (!recipient || isSocialBlocked(store, request.authUser.id, recipient.id) || !isCrewMember(store, request.authUser.id, recipient.id))) {
      return { error: 'Prywatny czat jest dostępny po zaakceptowaniu zaproszenia do Ekipy.', status: 403 }
    }
    const message = {
      id: crypto.randomUUID(),
      authorId: request.authUser.id,
      recipientId: recipient?.id,
      scope,
      text,
      createdAt: Date.now(),
    }
    store.socialChatMessages.push(message)
    if (recipient) appendSocialNotification(
      store,
      recipient.id,
      request.authUser.id,
      'chat_message',
      'wysłał(a) Ci wiadomość.',
      undefined,
      defaultNickname(request.authUser),
    )
    store.socialChatMessages = store.socialChatMessages.slice(-5000)
    return {
      message: {
        id: message.id,
        author: publicSocialPerson(request.authUser),
        scope,
        recipientHandle: recipient ? defaultNickname(recipient) : undefined,
        text,
        time: new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(message.createdAt),
        createdAt: message.createdAt,
      },
    }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.status(201).json(result)
})

app.delete('/api/media/:mediaId', requireAuthentication, async (request, response) => {
  const mediaId = request.params.mediaId
  if (!/^[\da-f-]{36}$/i.test(mediaId)) return response.status(404).json({ error: 'Nie znaleziono pliku.' })
  if (database) {
    const mediaUrl = `/api/media/${mediaId}`
    const { rowCount } = await database.query(`
      DELETE FROM youtopic_social_media
      WHERE id = $1 AND owner_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM youtopic_social_posts
          WHERE data->>'image' = $3 OR data->>'video' = $3
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(data->'comments', '[]'::jsonb)) AS comment
              WHERE comment->>'audioUrl' = $3
            )
        )
    `, [mediaId, request.authUser.id, mediaUrl])
    if (!rowCount) return response.status(404).json({ error: 'Nie znaleziono nieopublikowanego pliku do usunięcia.' })
  } else {
    const deleted = await updateStore((store) => {
      const mediaUrl = `/api/media/${mediaId}`
      const isPublished = store.socialPosts.some((post) => post.data.image === mediaUrl || post.data.video === mediaUrl || post.comments.some((comment) => comment.audioUrl === mediaUrl))
      const before = store.socialMedia.length
      store.socialMedia = store.socialMedia.filter((item) => item.id !== mediaId || item.ownerId !== request.authUser.id || isPublished)
      return store.socialMedia.length < before
    })
    if (!deleted) return response.status(404).json({ error: 'Nie znaleziono nieopublikowanego pliku do usunięcia.' })
  }
  return response.json({ ok: true })
})

app.get('/api/posts', requireAuthentication, async (request, response) => {
  const beforeValue = typeof request.query.before === 'string' ? Number(request.query.before) : undefined
  const beforeIdValue = typeof request.query.beforeId === 'string' ? Number(request.query.beforeId) : undefined
  const limitValue = typeof request.query.limit === 'string' ? Number(request.query.limit) : 30
  if ((beforeValue !== undefined && (!Number.isSafeInteger(beforeValue) || beforeValue < 0))
    || (beforeIdValue !== undefined && (!Number.isSafeInteger(beforeIdValue) || beforeIdValue < 0))
    || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 50) {
    return response.status(400).json({ error: 'Nieprawidłowe parametry stronicowania tablicy.' })
  }
  response.set('Cache-Control', 'no-store')
  const posts = await readSocialPosts(request.authUser.id, request.authStore, { before: beforeValue, beforeId: beforeIdValue, limit: limitValue + 1 })
  const hasMore = posts.length > limitValue
  const page = posts.slice(0, limitValue)
  const last = page.at(-1)
  return response.json({ posts: page, hasMore, nextCursor: hasMore && last ? { before: Number(last.createdAt ?? last.id), beforeId: last.id } : null })
})

app.get('/api/posts/:postId', requireAuthentication, async (request, response) => {
  if (!/^\d+$/.test(request.params.postId)) return response.status(400).json({ error: 'Nieprawidłowy identyfikator posta.' })
  const store = request.authStore
  let post
  if (database) {
    const { rows } = await database.query(
      'SELECT id, author_id, data, liked_by, saved_by, boosted_by, created_at FROM youtopic_social_posts WHERE id = $1',
      [request.params.postId],
    )
    const row = rows[0]
    if (row) post = { id: row.id, createdAt: Number(row.created_at), authorId: row.author_id, data: row.data, comments: row.data.comments ?? [], likedBy: row.liked_by, savedBy: row.saved_by, boostedBy: row.boosted_by }
  } else {
    post = store.socialPosts.find((item) => String(item.id) === request.params.postId)
  }
  if (!post || blockedUserIds(store, request.authUser.id).includes(post.authorId)
    || !canViewSocialProfile(store, request.authUser.id, store.users.find((user) => user.id === post.authorId))
    || post.data.bandId && !bandForMember(store, post.data.bandId, request.authUser.id)) {
    return response.status(404).json({ error: 'Nie znaleziono dostępnego posta.' })
  }
  return response.json({ post: socialPostForUser(post, request.authUser.id, store.users) })
})

app.post('/api/posts', requireAuthentication, postCreationLimit, async (request, response) => {
  const { topic, text, imageMediaId, videoMediaId, externalUrl } = request.body ?? {}
  const bandId = typeof request.body?.bandId === 'string' ? request.body.bandId : ''
  const sharedPostId = typeof request.body?.sharedPostId === 'string' ? request.body.sharedPostId : ''
  const profileTargetUserIdValue = request.body?.profileTargetUserId
  if (profileTargetUserIdValue !== undefined && typeof profileTargetUserIdValue !== 'string') return response.status(400).json({ error: 'Nieprawidłowy profil do polecenia.' })
  const profileTargetUserId = typeof profileTargetUserIdValue === 'string' ? profileTargetUserIdValue : ''
  if (profileTargetUserId && (bandId || sharedPostId)) return response.status(400).json({ error: 'Polecenie profilu można opublikować tylko na publicznej tablicy.' })
  const profileTarget = profileTargetUserId
    ? request.authStore.users.find((user) => user.id === profileTargetUserId && user.emailVerified === true && !isUserBlocked(user))
    : null
  if (profileTargetUserId && (!profileTarget || profileTarget.id === request.authUser.id)) return response.status(404).json({ error: 'Nie znaleziono aktywnego profilu do polecenia.' })
  let sharedSource = null
  if (bandId && !bandForMember(request.authStore, bandId, request.authUser.id)) return response.status(403).json({ error: 'Nie należysz do tej bandy.' })
  if (sharedPostId && bandId) {
    if (database) {
      const { rows } = await database.query('SELECT id, author_id, data FROM youtopic_social_posts WHERE id = $1 AND band_id IS NULL', [sharedPostId])
      sharedSource = rows[0] ? { id: rows[0].id, authorId: rows[0].author_id, data: rows[0].data } : null
    } else {
      const source = request.authStore.socialPosts.find((post) => String(post.id) === sharedPostId && !post.data.bandId)
      sharedSource = source ? { id: source.id, authorId: source.authorId, data: source.data } : null
    }
    if (!sharedSource) return response.status(404).json({ error: 'Nie znaleziono publicznego posta do udostępnienia.' })
  }
  const normalizedTopic = sharedSource?.data.topic ?? (typeof topic === 'string' ? topic.trim().replace(/^#+\s*/, '').slice(0, 80) : '')
  const normalizedText = sharedSource?.data.text ?? (typeof text === 'string' ? text.trim() : '')
  if (!normalizedTopic || normalizedText.length > 5000 || (!normalizedText && !imageMediaId && !videoMediaId && !externalUrl && !sharedSource?.data.image && !sharedSource?.data.video)) return response.status(400).json({ error: 'Podaj temat i treść posta albo dodaj zdjęcie lub film.' })
  if (imageMediaId && videoMediaId) return response.status(400).json({ error: 'Do jednego posta dodaj zdjęcie albo film.' })
  for (const [mediaId, expectedPrefix] of sharedSource ? [] : [[imageMediaId, 'image/'], [videoMediaId, 'video/']]) {
    if (!mediaId) continue
    const media = await readMedia(mediaId, request.authUser.id)
    if (!media || !media.content_type.startsWith(expectedPrefix)) return response.status(400).json({ error: 'Nie znaleziono przesłanego pliku. Dodaj go ponownie.' })
  }
  let normalizedUrl
  if (sharedSource) normalizedUrl = sharedSource.data.externalUrl
  else if (externalUrl) {
    try {
      const parsed = new URL(externalUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
      normalizedUrl = parsed.toString()
    } catch {
      return response.status(400).json({ error: 'Link zewnętrzny jest nieprawidłowy.' })
    }
  }
  const author = publicSocialPerson(request.authUser)
  const now = Date.now()
  const postData = {
    author,
    time: 'teraz',
    topic: normalizedTopic.toLocaleUpperCase('pl-PL'),
    text: normalizedText,
    image: sharedSource?.data.image ?? (imageMediaId ? `/api/media/${imageMediaId}` : undefined),
    video: sharedSource?.data.video ?? (videoMediaId ? `/api/media/${videoMediaId}` : undefined),
    externalUrl: normalizedUrl,
    profileTarget: profileTarget ? publicSocialPerson(profileTarget) : undefined,
    comments: [],
    boosts: 0,
    bandId: bandId || undefined,
    sharedFrom: sharedSource ? { author: sharedSource.data.author, topic: sharedSource.data.topic, postId: Number(sharedSource.id) } : undefined,
  }
  if (database) {
    const { rows } = await database.query(
      `INSERT INTO youtopic_social_posts (author_id, data, band_id, created_at)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING id, author_id, data, liked_by, saved_by, boosted_by, created_at`,
      [request.authUser.id, JSON.stringify(postData), bandId || null, now],
    )
    return response.status(201).json({ post: socialPostForUser({ ...rows[0], createdAt: Number(rows[0].created_at), comments: rows[0].data.comments ?? [] }, request.authUser.id, (await readStore()).users) })
  }
  const post = await updateStore((store) => {
    const created = { id: Date.now(), createdAt: now, authorId: request.authUser.id, author, data: postData, comments: [], likedBy: [], savedBy: [], boostedBy: [] }
    store.socialPosts.unshift(created)
    return socialPostForUser(created, request.authUser.id, store.users)
  })
  return response.status(201).json({ post })
})

async function mutateSocialPost(postId, userId, mutate) {
  if (!/^\d+$/.test(postId)) return null
  if (database) {
    const store = await readStore()
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query('SELECT id, author_id, data, liked_by, saved_by, boosted_by, band_id, created_at FROM youtopic_social_posts WHERE id = $1 FOR UPDATE', [postId])
      if (!rows[0]) {
        await client.query('ROLLBACK')
        return null
      }
      const row = rows[0]
      if (isSocialBlocked(store, userId, row.author_id)
        || !canViewSocialProfile(store, userId, store.users.find((user) => user.id === row.author_id))) {
        await client.query('ROLLBACK')
        return null
      }
      if (row.band_id && !bandForMember(store, row.band_id, userId)) {
        await client.query('ROLLBACK')
        return null
      }
      const post = { id: row.id, createdAt: Number(row.created_at), authorId: row.author_id, data: row.data, comments: row.data.comments ?? [], likedBy: row.liked_by, savedBy: row.saved_by, boostedBy: row.boosted_by }
      const result = await mutate(post, client)
      if (result?.error) {
        await client.query('ROLLBACK')
        return { error: result.error }
      }
      post.data.comments = post.comments
      await client.query('UPDATE youtopic_social_posts SET data = $2::jsonb, liked_by = $3::jsonb, saved_by = $4::jsonb, boosted_by = $5::jsonb WHERE id = $1', [postId, JSON.stringify(post.data), JSON.stringify(post.likedBy), JSON.stringify(post.savedBy), JSON.stringify(post.boostedBy)])
      await client.query('COMMIT')
      return { post, result, users: (await readStore()).users }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  return updateStore(async (store) => {
    const item = store.socialPosts.find((entry) => String(entry.id) === postId)
    if (!item || isSocialBlocked(store, userId, item.authorId)
      || !canViewSocialProfile(store, userId, store.users.find((user) => user.id === item.authorId))
      || item.data.bandId && !bandForMember(store, item.data.bandId, userId)) return null
    const result = await mutate(item, null)
    if (result?.error) return { error: result.error }
    item.data.comments = item.comments
    return { post: item, result, users: store.users }
  })
}

async function socialPostResponse(postId, userId, response, mutate) {
  const updated = await mutateSocialPost(postId, userId, mutate)
  if (!updated) return response.status(404).json({ error: 'Nie znaleziono posta.' })
  if (updated.error) return response.status(400).json({ error: updated.error })
  const result = updated.result && typeof updated.result === 'object' ? { ...updated.result } : {}
  const notification = result.notification
  delete result.notification
  if (notification) {
    await updateStore((store) => appendSocialNotification(store, notification.userId, userId, notification.type, notification.message, postId))
  }
  return response.json({ post: socialPostForUser(updated.post, userId, updated.users), ...result })
}

app.post('/api/posts/:postId/like', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  const index = post.likedBy.indexOf(request.authUser.id)
  if (index >= 0) post.likedBy.splice(index, 1)
  else {
    post.likedBy.push(request.authUser.id)
    return post.authorId === request.authUser.id ? undefined : { notification: { userId: post.authorId, type: 'like', message: 'polubił Twój post.' } }
  }
}))

app.post('/api/posts/:postId/save', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  const index = post.savedBy.indexOf(request.authUser.id)
  if (index >= 0) post.savedBy.splice(index, 1)
  else post.savedBy.push(request.authUser.id)
}))

app.post('/api/posts/:postId/boost', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  if (!post.boostedBy.includes(request.authUser.id)) {
    post.boostedBy.push(request.authUser.id)
    post.data.boosts = Number(post.data.boosts ?? 0) + 1
    return post.authorId === request.authUser.id ? undefined : { notification: { userId: post.authorId, type: 'boost', message: 'podbił Twój post.' } }
  }
}))

app.post('/api/posts/:postId/pin', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  const band = post.data.bandId ? bandForMember(request.authStore, post.data.bandId, request.authUser.id) : null
  if (!band || band.adminId !== request.authUser.id) return { error: 'Tylko administrator bandy może przypinać posty.' }
  post.data.pinnedAt = post.data.pinnedAt ? undefined : Date.now()
}))

app.post('/api/posts/:postId/comments', requireAuthentication, async (request, response) => {
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  const audioMediaId = typeof request.body?.audioMediaId === 'string' ? request.body.audioMediaId : ''
  const replyToId = Number.isSafeInteger(request.body?.replyToId) ? request.body.replyToId : undefined
  if ((!text && !audioMediaId) || text.length > 2000) return response.status(400).json({ error: 'Wpisz komentarz lub dodaj nagranie.' })
  if (audioMediaId) {
    const audio = await readMedia(audioMediaId, request.authUser.id)
    if (!audio || !audio.content_type.startsWith('audio/')) return response.status(400).json({ error: 'Nie znaleziono przesłanego nagrania.' })
  }
  const audio = audioMediaId ? await readMedia(audioMediaId, request.authUser.id) : null
  return socialPostResponse(request.params.postId, request.authUser.id, response, async (post, client) => {
    if (replyToId && !post.comments.some((comment) => comment.id === replyToId)) return { error: 'Nie znaleziono komentarza, na który odpowiadasz.' }
    let id
    if (client) {
      const { rows } = await client.query("SELECT nextval(pg_get_serial_sequence('youtopic_social_comment_ids', 'id')) AS id")
      id = Number(rows[0].id)
    } else id = Date.now()
    post.comments.push({ id, authorId: request.authUser.id, author: publicSocialPerson(request.authUser), text: text || undefined, audioUrl: audioMediaId ? `/api/media/${audioMediaId}` : undefined, audioType: audio?.content_type, replyToId, likes: 0, likedBy: [] })
    return {
      commentId: id,
      ...post.authorId === request.authUser.id ? {} : { notification: { userId: post.authorId, type: 'comment', message: 'skomentował Twój post.' } },
    }
  }).then((result) => result)
})

app.post('/api/posts/:postId/comments/:commentId/like', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  const comment = post.comments.find((item) => String(item.id) === request.params.commentId)
  if (!comment) return { error: 'Nie znaleziono komentarza.' }
  comment.likedBy ??= []
  const index = comment.likedBy.indexOf(request.authUser.id)
  if (index >= 0) comment.likedBy.splice(index, 1)
  else {
    comment.likedBy.push(request.authUser.id)
    const commentAuthorId = comment.authorId
    if (commentAuthorId && commentAuthorId !== request.authUser.id) return { notification: { userId: commentAuthorId, type: 'comment_like', message: 'polubił Twój komentarz.' } }
  }
  comment.likes = comment.likedBy.length
}))

app.delete('/api/posts/:postId/comments/:commentId', requireAuthentication, async (request, response) => socialPostResponse(request.params.postId, request.authUser.id, response, (post) => {
  const commentId = Number(request.params.commentId)
  const comment = post.comments.find((item) => item.id === commentId)
  if (!comment || comment.authorId !== request.authUser.id) return { error: 'Możesz usuwać tylko własne komentarze.' }
  const removedIds = new Set([commentId])
  let changed = true
  while (changed) {
    changed = false
    for (const child of post.comments) {
      if (child.replyToId && removedIds.has(child.replyToId) && !removedIds.has(child.id)) {
        removedIds.add(child.id)
        changed = true
      }
    }
  }
  post.comments = post.comments.filter((item) => !removedIds.has(item.id))
}))

function permissionsForAdmin(admin) {
  if (admin.isSuperAdmin) return [...adminPermissions]
  const permissions = new Set(Array.isArray(admin.permissions) ? admin.permissions.filter((permission) => adminPermissions.has(permission)) : [])
  if (permissions.has('support.manage')) permissions.add('support.view')
  if (permissions.has('settings.manage')) permissions.add('settings.view')
  if (permissions.has('content.manage')) permissions.add('content.view')
  if (permissions.has('gallery.photos.delete')) permissions.add('gallery.view')
  if (permissions.has('gallery.view')) permissions.add('users.view')
  return [...permissions]
}

function safeAdmin(admin) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    rank: admin.isSuperAdmin ? 'Super Administrator' : admin.rank,
    permissions: permissionsForAdmin(admin),
    isSuperAdmin: Boolean(admin.isSuperAdmin),
    createdAt: admin.createdAt,
  }
}

const requireAdminAuthentication = async (request, response, next) => {
  const session = sessionUserId(request, adminSessionCookie)
  if (!session || session.kind !== 'admin') return response.status(401).json({ error: 'Zaloguj się do panelu administratora.' })
  const store = await readStore()
  const admin = store.admins.find((item) => item.id === session.sub)
  if (!admin || (session.ver ?? 0) !== (admin.authVersion ?? 0)) {
    clearAdminSession(response)
    return response.status(401).json({ error: 'Sesja administratora wygasła. Zaloguj się ponownie.' })
  }
  request.adminUser = admin
  next()
}

const requireAdminPermission = (permission) => (request, response, next) => {
  if (request.adminUser.isSuperAdmin || permissionsForAdmin(request.adminUser).includes(permission)) return next()
  return response.status(403).json({ error: 'Twoje konto nie ma uprawnień do tej funkcji.' })
}

const requireSuperAdmin = (request, response, next) => {
  if (request.adminUser.isSuperAdmin) return next()
  return response.status(403).json({ error: 'Tylko Super Administrator może zarządzać kontami administratorów.' })
}

app.use('/api/admin', (request, response, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return next()
  response.once('finish', () => {
    if (!request.adminUser || response.statusCode < 200 || response.statusCode >= 300) return
    const entry = {
      id: crypto.randomUUID(),
      adminId: request.adminUser.id,
      adminName: request.adminUser.name,
      rank: request.adminUser.rank,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      statusCode: response.statusCode,
      createdAt: Date.now(),
    }
    void updateStore((store) => {
      store.auditLog.unshift(entry)
      store.auditLog.length = Math.min(store.auditLog.length, 1000)
    }).catch((error) => console.error('Nie udało się zapisać dziennika działań administratora:', error))
  })
  next()
})

app.get('/api/health', (_request, response) => response.json({ ok: true }))

app.get('/api/announcements', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const now = Date.now()
  response.set('Cache-Control', 'no-store')
  return response.json({
    announcements: store.announcements.filter((announcement) =>
      announcement.active &&
      (!Number.isFinite(announcement.startsAt) || announcement.startsAt <= now) &&
      (!Number.isFinite(announcement.endsAt) || announcement.endsAt > now)),
  })
})

app.post('/api/admin/auth/login', authRateLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = request.body?.password
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 1 || password.length > 256) {
    return response.status(400).json({ error: 'Podaj prawidłowy login i hasło.' })
  }

  let admin = (await readStore()).admins.find((item) => item.email === email)
  if (!admin) {
    const configuredSuperEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase()
    if (!configuredSuperEmail) return response.status(503).json({ error: 'Logowanie administratorów nie jest skonfigurowane.' })
    if (email !== configuredSuperEmail) return response.status(401).json({ error: 'Nieprawidłowy login lub hasło.' })

    const owner = (await readStore()).users.find((item) => item.email === email && item.emailVerified)
    if (!owner || !(await verifyPassword(password, owner.passwordHash))) return response.status(401).json({ error: 'Nieprawidłowy login lub hasło.' })
    admin = await updateStore((store) => {
      const existing = store.admins.find((item) => item.isSuperAdmin)
      if (existing) return null
      const created = {
        id: crypto.randomUUID(),
        name: [owner.firstName, owner.lastName].filter(Boolean).join(' '),
        email,
        passwordHash: owner.passwordHash,
        rank: 'Super Administrator',
        permissions: [...adminPermissions],
        isSuperAdmin: true,
        createdAt: Date.now(),
        authVersion: 0,
      }
      store.admins.push(created)
      return created
    })
    if (!admin) return response.status(401).json({ error: 'Nieprawidłowy login lub hasło.' })
  } else if (!(await verifyPassword(password, admin.passwordHash))) {
    return response.status(401).json({ error: 'Nieprawidłowy login lub hasło.' })
  }

  setAdminSession(response, admin)
  return response.json({ admin: safeAdmin(admin) })
})

app.get('/api/admin/auth/me', requireAdminAuthentication, (request, response) => {
  response.set('Cache-Control', 'no-store')
  return response.json({ admin: safeAdmin(request.adminUser) })
})

app.post('/api/admin/auth/logout', (_request, response) => {
  clearAdminSession(response)
  return response.json({ ok: true })
})

app.get('/api/admin/permissions', requireAdminAuthentication, requireSuperAdmin, (_request, response) => {
  response.set('Cache-Control', 'no-store')
  return response.json({ permissions: adminPermissionCatalog })
})

app.get('/api/admin/overview', requireAdminAuthentication, requireAdminPermission('overview.view'), async (_request, response) => {
  const store = await readStore()
  const now = Date.now()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  response.set('Cache-Control', 'no-store')
  return response.json({
    totalUsers: store.users.length,
    verifiedUsers: store.users.filter((user) => user.emailVerified).length,
    blockedUsers: store.users.filter((user) => isUserBlocked(user)).length,
    newUsersToday: store.users.filter((user) => user.createdAt >= today.getTime()).length,
    activeAnnouncements: store.announcements.filter((announcement) =>
      announcement.active &&
      (!Number.isFinite(announcement.startsAt) || announcement.startsAt <= now) &&
      (!Number.isFinite(announcement.endsAt) || announcement.endsAt > now)).length,
  })
})

app.get('/api/admin/analytics', requireAdminAuthentication, requireAdminPermission('analytics.view'), async (_request, response) => {
  const store = await readStore()
  const now = Date.now()
  const firstDay = new Date(now)
  firstDay.setUTCHours(0, 0, 0, 0)
  firstDay.setUTCDate(firstDay.getUTCDate() - 29)
  const registrationsByDay = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(firstDay)
    date.setUTCDate(date.getUTCDate() + index)
    return { date: date.toISOString().slice(0, 10), registrations: 0 }
  })
  const registrationsByDate = new Map(registrationsByDay.map((item) => [item.date, item]))
  for (const user of store.users) {
    const date = Number.isFinite(user.createdAt) ? new Date(user.createdAt).toISOString().slice(0, 10) : ''
    const day = registrationsByDate.get(date)
    if (day) day.registrations += 1
  }
  const openSupportTickets = store.supportTickets.filter((ticket) => ticket.status !== 'resolved').length
  return response.json({
    totalUsers: store.users.length,
    verifiedUsers: store.users.filter((user) => user.emailVerified).length,
    unverifiedUsers: store.users.filter((user) => !user.emailVerified).length,
    activeUsers: store.users.filter((user) => !isUserBlocked(user)).length,
    blockedUsers: store.users.filter((user) => isUserBlocked(user)).length,
    newUsersToday: store.users.filter((user) => Number.isFinite(user.createdAt) && user.createdAt >= firstDay.getTime() + 29 * 24 * 60 * 60 * 1000).length,
    registrationCount30Days: registrationsByDay.reduce((total, day) => total + day.registrations, 0),
    registrationsByDay,
    reportsPending: store.reports.filter((report) => report.status === 'pending').length,
    reportsResolved: store.reports.filter((report) => report.status !== 'pending').length,
    openSupportTickets,
    activeAnnouncements: store.announcements.filter((announcement) =>
      announcement.active &&
      (!Number.isFinite(announcement.startsAt) || announcement.startsAt <= now) &&
      (!Number.isFinite(announcement.endsAt) || announcement.endsAt > now)).length,
  })
})

app.get('/api/admin/health', requireAdminAuthentication, requireAdminPermission('health.view'), async (_request, response) => {
  let databaseStatus = database ? 'unavailable' : 'local-file'
  if (database) {
    try {
      await database.query('SELECT 1')
      databaseStatus = 'connected'
    } catch {
      databaseStatus = 'unavailable'
    }
  }
  const status = databaseStatus === 'unavailable' ? 'degraded' : 'ok'
  return response.json({
    status,
    checkedAt: Date.now(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    database: databaseStatus,
    emailConfigured: Boolean(mailer && process.env.SMTP_FROM),
    smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    sessionSecretConfigured: Boolean(process.env.AUTH_SESSION_SECRET),
  })
})

app.get('/api/admin/audit', requireAdminAuthentication, requireAdminPermission('audit.view'), async (_request, response) => {
  const store = await readStore()
  return response.json({ entries: store.auditLog.slice(0, 200) })
})

app.get('/api/admin/settings', requireAdminAuthentication, requireAdminPermission('settings.view'), async (_request, response) => {
  const store = await readStore()
  return response.json({ settings: store.platformSettings })
})

app.patch('/api/admin/settings', requireAdminAuthentication, requireAdminPermission('settings.manage'), adminMutationLimit, async (request, response) => {
  const { registrationEnabled } = request.body ?? {}
  if (typeof registrationEnabled !== 'boolean') return response.status(400).json({ error: 'Wybierz prawidłową wartość dostępności rejestracji.' })
  const settings = await updateStore((store) => {
    store.platformSettings.registrationEnabled = registrationEnabled
    return store.platformSettings
  })
  return response.json({ settings })
})

app.get('/api/admin/content/moderated', requireAdminAuthentication, requireAdminPermission('content.view'), async (_request, response) => {
  const store = await readStore()
  const reportsById = new Map(store.reports.map((report) => [report.id, report]))
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  return response.json({
    items: store.moderatedItems.slice().sort((first, second) => second.removedAt - first.removedAt).map((item) => {
      const report = reportsById.get(item.reportId)
      const author = usersById.get(item.targetUserId)
      return {
        ...item,
        contentPreview: report?.contentPreview ?? '',
        contentUrl: report?.contentUrl ?? '',
        authorName: author ? [author.firstName, author.middleName, author.lastName, author.secondLastName].filter(Boolean).join(' ') : 'Konto usunięte',
      }
    }),
  })
})

app.delete('/api/admin/content/moderated/:reportId', requireAdminAuthentication, requireAdminPermission('content.manage'), adminMutationLimit, async (request, response) => {
  const restored = await updateStore((store) => {
    const existingLength = store.moderatedItems.length
    store.moderatedItems = store.moderatedItems.filter((item) => item.reportId !== request.params.reportId)
    return store.moderatedItems.length < existingLength
  })
  if (!restored) return response.status(404).json({ error: 'Nie znaleziono wpisu moderacji do przywrócenia.' })
  return response.json({ ok: true })
})

app.get('/api/admin/users', requireAdminAuthentication, requireAdminPermission('users.view'), async (request, response) => {
  const store = await readStore()
  const canViewPersonalData = request.adminUser.isSuperAdmin || permissionsForAdmin(request.adminUser).includes('users.personal_data.view')
  const activeUsers = store.users.map((user) => ({
    id: user.id,
    name: [user.firstName, user.middleName, user.lastName, user.secondLastName].filter(Boolean).join(' '),
    nickname: defaultProfileNickname(user),
    avatar: user.avatar || '',
    gender: canViewPersonalData ? user.gender ?? null : null,
    birthDate: canViewPersonalData ? user.birthDate ?? null : null,
    location: canViewPersonalData ? user.location ?? '' : null,
    phone: canViewPersonalData ? user.phone ?? '' : null,
    contactPhone: canViewPersonalData ? user.contactPhone ?? '' : null,
    secondContactPhone: canViewPersonalData ? user.secondContactPhone ?? '' : null,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    profileVerified: Boolean(user.profileVerified),
    createdAt: user.createdAt ?? null,
    deletedAt: null,
    blockedAt: isUserBlocked(user) ? user.blockedAt : null,
    blockedUntil: isUserBlocked(user) ? user.blockedUntil ?? null : null,
    blockedReason: user.blockedReason ?? '',
    reportCount: store.reports.filter((report) => report.targetUserId === user.id && report.status === 'pending').length,
    ipBlockedUntil: store.ipBlocks.find((block) => block.userId === user.id && block.expiresAt > Date.now())?.expiresAt ?? null,
    canBlockIp: Boolean(user.lastIpHash),
    isAdmin: store.admins.some((admin) => admin.email === user.email),
  }))
  const deletedUsers = store.deletedUsers.map((user) => ({
    id: user.id,
    name: 'Konto usunięte',
    nickname: '',
    avatar: '',
    gender: null,
    birthDate: null,
    location: null,
    phone: null,
    contactPhone: null,
    secondContactPhone: null,
    email: '',
    emailVerified: false,
    profileVerified: false,
    createdAt: user.createdAt ?? null,
    deletedAt: user.deletedAt,
    blockedAt: null,
    blockedUntil: null,
    blockedReason: '',
    reportCount: 0,
    ipBlockedUntil: null,
    canBlockIp: false,
    isAdmin: false,
  }))
  response.set('Cache-Control', 'no-store')
  return response.json({
    users: [...activeUsers, ...deletedUsers]
      .sort((first, second) => (second.deletedAt ?? second.createdAt ?? 0) - (first.deletedAt ?? first.createdAt ?? 0)),
  })
})

app.get('/api/admin/gallery/users/:userId', requireAdminAuthentication, requireAdminPermission('gallery.view'), async (request, response) => {
  const store = await readStore()
  const owner = store.users.find((user) => user.id === request.params.userId && user.emailVerified === true)
  if (!owner) return response.status(404).json({ error: 'Nie znaleziono aktywnego profilu.' })
  let sourcePosts
  if (database) {
    const { rows } = await database.query(
      `SELECT id, data, created_at FROM youtopic_social_posts
       WHERE author_id = $1 AND band_id IS NULL AND data ? 'image'
       ORDER BY created_at DESC, id DESC LIMIT 500`,
      [owner.id],
    )
    sourcePosts = rows.map((row) => ({ id: row.id, data: row.data, createdAt: Number(row.created_at) }))
  } else {
    sourcePosts = store.socialPosts
      .filter((post) => post.authorId === owner.id && !post.data.bandId && typeof post.data.image === 'string')
      .sort((first, second) => Number(second.createdAt ?? second.id) - Number(first.createdAt ?? first.id))
      .slice(0, 500)
  }
  const albums = store.socialAlbums
    .filter((album) => album.ownerId === owner.id)
    .map(({ id, name, createdAt, photos }) => ({
      id,
      name,
      createdAt,
      photos: photos.filter((photo) => !photo.sourcePostId || !isGalleryPhotoModerated(store, owner.id, photo.sourcePostId)),
    }))
  return response.json({
    photos: sourcePosts.filter((post) => !isGalleryPhotoModerated(store, owner.id, post.id)).map(galleryPostPhoto),
    albums,
    owner: { id: owner.id, name: [owner.firstName, owner.middleName, owner.lastName, owner.secondLastName].filter(Boolean).join(' '), nickname: defaultProfileNickname(owner) },
  })
})

app.get('/api/admin/gallery/media/:mediaId', requireAdminAuthentication, requireAdminPermission('gallery.view'), async (request, response) => {
  if (!/^[\da-f-]{36}$/i.test(request.params.mediaId)) return response.status(404).json({ error: 'Nie znaleziono zdjęcia.' })
  let media
  if (database) {
    const { rows } = await database.query('SELECT content_type, data FROM youtopic_social_media WHERE id = $1', [request.params.mediaId])
    media = rows[0]
  } else {
    const item = (await readStore()).socialMedia.find((photo) => photo.id === request.params.mediaId)
    if (item) media = { content_type: item.contentType, data: Buffer.from(item.data, 'base64') }
  }
  if (!media || !media.content_type.startsWith('image/')) return response.status(404).json({ error: 'Nie znaleziono zdjęcia.' })
  response.set({ 'Content-Type': media.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  return response.send(media.data)
})

app.delete('/api/admin/gallery/users/:userId/posts/:postId/photo', requireAdminAuthentication, requireAdminPermission('gallery.photos.delete'), adminMutationLimit, async (request, response) => {
  if (!/^\d+$/.test(request.params.postId)) return response.status(400).json({ error: 'Nieprawidłowy identyfikator posta.' })
  let removed = false
  let removedMediaId = ''
  if (database) {
    const { rows } = await database.query(
      'SELECT author_id, data FROM youtopic_social_posts WHERE id = $1 AND author_id = $2',
      [request.params.postId, request.params.userId],
    )
    const post = rows[0]
    if (!post || !post.data.image) return response.status(404).json({ error: 'Nie znaleziono zdjęcia na Tablicy.' })
    removedMediaId = /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.image)?.[1] ?? ''
    const updatedData = { ...post.data }
    delete updatedData.image
    if (!updatedData.text && !updatedData.video && !updatedData.externalUrl && !updatedData.sharedFrom) {
      await database.query('DELETE FROM youtopic_social_posts WHERE id = $1 AND author_id = $2', [request.params.postId, request.params.userId])
    } else {
      await database.query('UPDATE youtopic_social_posts SET data = $1::jsonb WHERE id = $2 AND author_id = $3', [JSON.stringify(updatedData), request.params.postId, request.params.userId])
    }
    removed = true
    await updateStore((store) => store.socialAlbums.forEach((album) => {
      album.photos = album.photos.filter((photo) => photo.sourcePostId !== request.params.postId)
    }))
  } else {
    removed = await updateStore((store) => {
      const post = store.socialPosts.find((item) => String(item.id) === request.params.postId
        && item.authorId === request.params.userId && item.data.image)
      if (!post) return false
      removedMediaId = /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.image)?.[1] ?? ''
      delete post.data.image
      store.socialAlbums.forEach((album) => {
        album.photos = album.photos.filter((photo) => photo.sourcePostId !== request.params.postId)
      })
      if (!post.data.text && !post.data.video && !post.data.externalUrl && !post.data.sharedFrom) {
        store.socialPosts = store.socialPosts.filter((item) => item !== post)
      }
      return true
    })
  }
  if (!removed) return response.status(404).json({ error: 'Nie znaleziono zdjęcia na Tablicy.' })
  await deleteUnreferencedMedia(removedMediaId)
  return response.json({ ok: true })
})

app.delete('/api/admin/gallery/users/:userId/albums/:albumId/photos/:photoId', requireAdminAuthentication, requireAdminPermission('gallery.photos.delete'), adminMutationLimit, async (request, response) => {
  const removal = await updateStore((store) => {
    const album = store.socialAlbums.find((item) => item.id === request.params.albumId && item.ownerId === request.params.userId)
    if (!album) return null
    const photo = album.photos.find((item) => item.id === request.params.photoId)
    if (!photo) return null
    album.photos = album.photos.filter((photo) => photo.id !== request.params.photoId)
    return { mediaId: photo.mediaId ?? '' }
  })
  if (!removal) return response.status(404).json({ error: 'Nie znaleziono zdjęcia w albumie.' })
  await deleteUnreferencedMedia(removal.mediaId)
  return response.json({ ok: true })
})

app.patch('/api/admin/users/:id/block', requireAdminAuthentication, requireAdminPermission('users.block'), adminMutationLimit, async (request, response) => {
  const { blocked, reason, durationDays = 7, blockIp = false } = request.body ?? {}
  if (typeof blocked !== 'boolean') return response.status(400).json({ error: 'Nieprawidłowa wartość blokady.' })
  if (blocked && typeof reason === 'string' && reason.length > 500) return response.status(400).json({ error: 'Powód blokady może mieć maksymalnie 500 znaków.' })
  if (typeof blockIp !== 'boolean') return response.status(400).json({ error: 'Nieprawidłowa opcja blokady IP.' })
  if (blocked && ![7, 30, 90].includes(durationDays)) return response.status(400).json({ error: 'Wybierz blokadę na 7 dni, 30 dni lub 3 miesiące.' })

  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === request.params.id)
    if (!user) return { error: 'Nie znaleziono konta.', status: 404 }
    if (store.admins.some((admin) => admin.email === user.email)) return { error: 'Nie można zmienić statusu konta administratora.', status: 409 }
    if (blocked && blockIp && !user.lastIpHash) return { error: 'Brak zapisanego adresu IP tego użytkownika. Blokada IP będzie dostępna po jego kolejnym logowaniu.', status: 409 }
    const now = Date.now()
    user.blockedAt = blocked ? now : null
    user.blockedUntil = blocked ? now + durationDays * 24 * 60 * 60 * 1000 : null
    user.blockedReason = blocked ? (typeof reason === 'string' ? reason.trim() : '') : ''
    user.authVersion = (user.authVersion ?? 0) + 1
    store.ipBlocks = store.ipBlocks.filter((item) => item.userId !== user.id)
    if (blocked && blockIp) {
      store.ipBlocks.push({
        userId: user.id,
        ipHash: user.lastIpHash,
        createdAt: now,
        expiresAt: user.blockedUntil,
        createdBy: request.adminUser.id,
      })
    }
    const ipBlock = store.ipBlocks.find((item) => item.userId === user.id)
    return { ok: true, blockedUntil: user.blockedUntil, ipBlockedUntil: ipBlock?.expiresAt ?? null }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json(result)
})

app.patch('/api/admin/users/:id/verification', requireAdminAuthentication, requireAdminPermission('users.verify'), adminMutationLimit, async (request, response) => {
  const { verified } = request.body ?? {}
  if (typeof verified !== 'boolean') return response.status(400).json({ error: 'Nieprawidłowy status weryfikacji profilu.' })
  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === request.params.id)
    if (!user) return { error: 'Nie znaleziono aktywnego konta.', status: 404 }
    if (store.admins.some((admin) => admin.email === user.email)) return { error: 'Konta administratora nie można oznaczyć jako zweryfikowanego profilu.', status: 409 }
    user.profileVerified = verified
    user.profileVerifiedAt = verified ? Date.now() : null
    return { ok: true }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json({ ok: true, profileVerified: verified })
})

app.patch('/api/admin/users/:id/reports/review', requireAdminAuthentication, requireAdminPermission('users.reports.review'), adminMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const userExists = store.users.some((item) => item.id === request.params.id)
    if (!userExists) return { error: 'Nie znaleziono aktywnego konta.', status: 404 }
    const pendingReports = store.reports.filter((report) => report.targetUserId === request.params.id && report.status === 'pending')
    if (pendingReports.length === 0) return { error: 'Brak nowych zgłoszeń do weryfikacji.', status: 409 }
    const reviewedAt = Date.now()
    for (const report of pendingReports) {
      report.status = 'reviewed'
      report.reviewedAt = reviewedAt
      report.reviewedBy = request.adminUser.id
    }
    return { reviewedCount: pendingReports.length }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json({ ok: true, reviewedCount: result.reviewedCount })
})

app.get('/api/admin/users/:id/reports', requireAdminAuthentication, requireAdminPermission('users.reports.review'), async (request, response) => {
  const store = await readStore()
  if (!store.users.some((user) => user.id === request.params.id)) return response.status(404).json({ error: 'Nie znaleziono aktywnego konta.' })
  response.set('Cache-Control', 'no-store')
  return response.json({
    reports: store.reports
      .filter((report) => report.targetUserId === request.params.id && report.status === 'pending')
      .sort((first, second) => first.createdAt - second.createdAt)
      .map(({ id, reason, createdAt }) => ({ id, reason, createdAt })),
  })
})

app.delete('/api/admin/users/:id', requireAdminAuthentication, requireAdminPermission('users.delete'), adminMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === request.params.id)
    if (!user) return { error: 'Nie znaleziono aktywnego konta.', status: 404 }
    if (store.admins.some((admin) => admin.email === user.email)) return { error: 'Konta administratora nie można usunąć z listy użytkowników.', status: 409 }
    store.users = store.users.filter((item) => item.id !== user.id)
    store.deletedUsers.unshift({
      id: user.id,
      createdAt: user.createdAt ?? null,
      deletedAt: Date.now(),
      deletedBy: request.adminUser.id,
    })
    const removedReportIds = new Set(store.reports.filter((report) => report.targetUserId === user.id || report.reporterId === user.id).map((report) => report.id))
    store.reports = store.reports.filter((report) => !removedReportIds.has(report.id))
    store.reportNotifications = store.reportNotifications.filter((notification) => notification.userId !== user.id && !removedReportIds.has(notification.reportId))
    store.ipBlocks = store.ipBlocks.filter((block) => block.userId !== user.id)
    return { ok: true }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json({ ok: true })
})

app.post('/api/users/:id/reports', requireAuthentication, authRateLimit, async (request, response) => {
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
  if (!reason || reason.length > 500) return response.status(400).json({ error: 'Podaj powód zgłoszenia (maksymalnie 500 znaków).' })
  const result = await updateStore((store) => {
    if (request.authUser.id === request.params.id) return { error: 'Nie możesz zgłosić własnego profilu.', status: 400 }
    if (!store.users.some((user) => user.id === request.params.id)) return { error: 'Nie znaleziono aktywnego profilu.', status: 404 }
    if (store.reports.some((report) => report.targetUserId === request.params.id && report.reporterId === request.authUser.id && report.status === 'pending')) {
      return { error: 'To zgłoszenie zostało już wysłane i czeka na weryfikację.', status: 409 }
    }
    store.reports.push({
      id: crypto.randomUUID(),
      targetUserId: request.params.id,
      reporterId: request.authUser.id,
      targetType: 'profile',
      targetId: `profile:${request.params.id}`,
      contentPreview: '',
      reason,
      createdAt: Date.now(),
      status: 'pending',
    })
    return { ok: true }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.status(201).json({ ok: true })
})

app.post('/api/reports', requireAuthentication, authRateLimit, async (request, response) => {
  const { targetType, targetId, targetUserId, reason, contentPreview = '', contentUrl = '', reasonCategory = 'other' } = request.body ?? {}
  const allowedTypes = new Set(['profile', 'post', 'photo', 'video', 'comment', 'message'])
  if (typeof targetType !== 'string' || !allowedTypes.has(targetType)) return response.status(400).json({ error: 'Nieprawidłowy rodzaj zgłoszenia.' })
  if (typeof targetId !== 'string' || !targetId.trim() || targetId.length > 200) return response.status(400).json({ error: 'Nieprawidłowy identyfikator zgłaszanej treści.' })
  if (typeof targetUserId !== 'string' || !targetUserId || targetUserId === request.authUser.id) return response.status(400).json({ error: 'Nie można zgłosić własnego konta ani treści.' })
  if (typeof reasonCategory !== 'string' || !reportCategoryLabels.has(reasonCategory)) return response.status(400).json({ error: 'Wybierz prawidłową kategorię zgłoszenia.' })
  if (typeof reason !== 'string' || reason.trim().length > 500) return response.status(400).json({ error: 'Dodatkowe wyjaśnienie może mieć maksymalnie 500 znaków.' })
  if (typeof contentPreview !== 'string' || contentPreview.length > 1000) return response.status(400).json({ error: 'Podgląd zgłaszanej treści jest zbyt długi.' })
  if (typeof contentUrl !== 'string' || contentUrl.length > 2048) return response.status(400).json({ error: 'Nieprawidłowy adres zgłaszanej treści.' })
  const result = await updateStore(async (store) => {
    const target = store.users.find((user) => user.id === targetUserId)
    if (!target) return { error: 'Nie znaleziono konta autora zgłaszanej treści.', status: 404 }
    if (store.reports.some((report) => report.reporterId === request.authUser.id && report.targetType === targetType && report.targetId === targetId && report.status === 'pending')) {
      return { error: 'To zgłoszenie już czeka na weryfikację.', status: 409 }
    }
    let snapshot = contentPreview.trim()
    let mediaId = ''
    const mediaMatch = /^\/?api\/media\/([\da-f-]{36})$/i.exec(contentUrl)
      ?? /^https?:\/\/[^/]+\/api\/media\/([\da-f-]{36})$/i.exec(contentUrl)
    if (targetType === 'profile') {
      if (targetId !== `profile:${targetUserId}`) return { error: 'Nieprawidłowy identyfikator profilu.', status: 400 }
      snapshot = [target.bio, snapshot].filter(Boolean).join('\n\n').slice(0, 1000)
    } else if (['post', 'photo', 'video', 'comment'].includes(targetType)) {
      const match = /^(?:post|photo|video|comment):(\d+)(?::(\d+))?$/.exec(targetId)
      if (!match) return { error: 'Nie znaleziono zgłaszanej treści.', status: 404 }
      const post = database
        ? await database.query('SELECT id, author_id AS "authorId", data FROM youtopic_social_posts WHERE id = $1 AND author_id = $2', [match[1], targetUserId]).then(({ rows }) => rows[0])
        : store.socialPosts.find((item) => String(item.id) === match[1] && item.authorId === targetUserId)
      if (!post) return { error: 'Nie znaleziono zgłaszanego posta.', status: 404 }
      if (post.data.bandId && !bandForMember(store, post.data.bandId, request.authUser.id)) return { error: 'Nie znaleziono zgłaszanego posta.', status: 404 }
      if (targetType === 'comment') {
        const comment = (post.comments ?? post.data.comments ?? []).find((item) => String(item.id) === match[2] && item.authorId === targetUserId)
        if (!comment) return { error: 'Nie znaleziono zgłaszanego komentarza.', status: 404 }
        snapshot = [comment.text, snapshot].filter(Boolean).join('\n\n').slice(0, 1000)
        const commentMedia = /^\/api\/media\/([\da-f-]{36})$/i.exec(comment.audioUrl ?? '')
        mediaId = commentMedia?.[1] ?? ''
      } else {
        const key = targetType === 'photo' ? 'image' : targetType === 'video' ? 'video' : null
        const postMedia = key
          ? /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data[key] ?? '')
          : /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.video ?? '') ?? /^\/api\/media\/([\da-f-]{36})$/i.exec(post.data.image ?? '')
        if (key && !postMedia) return { error: 'Nie znaleziono zgłaszanego zdjęcia lub filmu.', status: 404 }
        snapshot = [post.data.text, snapshot].filter(Boolean).join('\n\n').slice(0, 1000)
        mediaId = postMedia?.[1] ?? ''
      }
    } else if (targetType === 'message') {
      const messageId = targetId.replace(/^message:/, '')
      const message = store.socialChatMessages.find((item) => item.id === messageId && item.authorId === targetUserId)
      if (!message) return { error: 'Nie znaleziono zgłaszanej wiadomości.', status: 404 }
      snapshot = [message.text, snapshot].filter(Boolean).join('\n\n').slice(0, 1000)
    }
    if (contentUrl && targetType !== 'profile' && (!mediaId || !mediaMatch || mediaMatch[1] !== mediaId)) return { error: 'Nie można powiązać załącznika ze zgłaszaną treścią.', status: 400 }
    const report = {
      id: crypto.randomUUID(),
      reporterId: request.authUser.id,
      targetUserId,
      targetType,
      targetId: targetId.trim(),
      contentPreview: snapshot,
      mediaId: mediaId || undefined,
      reasonCategory,
      reason: reason.trim(),
      createdAt: Date.now(),
      status: 'pending',
    }
    store.reports.push(report)
    return { reportId: report.id }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.status(201).json({ ok: true, reportId: result.reportId })
})

app.get('/api/admin/reports', requireAdminAuthentication, requireAdminPermission('reports.view'), async (_request, response) => {
  const store = await readStore()
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  const reports = store.reports
    .slice()
    .sort((first, second) => second.createdAt - first.createdAt)
    .map((report) => {
      const reporter = usersById.get(report.reporterId)
      const target = usersById.get(report.targetUserId)
      const decidingAdmin = store.admins.find((admin) => admin.id === report.decidedBy)
      return {
        id: report.id,
        targetType: report.targetType || 'profile',
        targetId: report.targetId || `profile:${report.targetUserId}`,
        contentPreview: report.contentPreview || '',
        contentUrl: report.contentUrl || '',
        reasonCategory: report.reasonCategory || 'other',
        reasonCategoryLabel: reportCategoryLabels.get(report.reasonCategory || 'other') || 'Inne',
        reason: report.reason,
        createdAt: report.createdAt,
        status: report.status === 'pending' ? 'pending' : 'resolved',
        decision: report.decision || null,
        decisionNote: report.decisionNote || '',
        decidedAt: report.decidedAt || null,
        decidedBy: report.decidedByName || decidingAdmin?.name || null,
        reporter: reporter ? {
          id: reporter.id,
          name: [reporter.firstName, reporter.middleName, reporter.lastName, reporter.secondLastName].filter(Boolean).join(' '),
        } : { id: report.reporterId, name: 'Konto usunięte' },
        target: target ? {
          id: target.id,
          name: [target.firstName, target.middleName, target.lastName, target.secondLastName].filter(Boolean).join(' '),
          nickname: defaultProfileNickname(target),
        } : { id: report.targetUserId, name: 'Konto usunięte', nickname: '' },
      }
    })
  response.set('Cache-Control', 'no-store')
  return response.json({ reports })
})

app.patch('/api/admin/reports/:id/decision', requireAdminAuthentication, requireAdminPermission('reports.manage'), adminMutationLimit, async (request, response) => {
  const { decision, note = '', notifyReporter = true, notifyTarget = true, durationDays = 7 } = request.body ?? {}
  if (!['dismiss', 'remove_content', 'warn', 'block_account'].includes(decision)) return response.status(400).json({ error: 'Wybierz prawidłową decyzję dla zgłoszenia.' })
  if (typeof note !== 'string' || note.trim().length > 500) return response.status(400).json({ error: 'Notatka decyzji może mieć maksymalnie 500 znaków.' })
  if (typeof notifyReporter !== 'boolean' || typeof notifyTarget !== 'boolean') return response.status(400).json({ error: 'Nieprawidłowe ustawienia powiadomień.' })
  if (decision === 'block_account' && ![7, 30, 90].includes(durationDays)) return response.status(400).json({ error: 'Wybierz blokadę na 7 dni, 30 dni lub 3 miesiące.' })
  if (decision === 'block_account' && !request.adminUser.isSuperAdmin && !permissionsForAdmin(request.adminUser).includes('users.block')) {
    return response.status(403).json({ error: 'Do blokowania kont wymagane jest uprawnienie „Blokowanie i odblokowywanie kont”.' })
  }

  const result = await updateStore((store) => {
    const report = store.reports.find((item) => item.id === request.params.id)
    if (!report) return { error: 'Nie znaleziono zgłoszenia.', status: 404 }
    if (report.status !== 'pending') return { error: 'To zgłoszenie zostało już rozpatrzone.', status: 409 }
    if (decision === 'remove_content' && !['post', 'photo', 'video', 'comment', 'message'].includes(report.targetType || 'profile')) {
      return { error: 'Tej treści nie można usunąć z poziomu tej akcji.', status: 409 }
    }
    const target = store.users.find((user) => user.id === report.targetUserId)
    if (decision === 'block_account') {
      if (!target) return { error: 'Nie można zablokować konta, którego już nie ma.', status: 409 }
      if (store.admins.some((admin) => admin.email === target.email)) return { error: 'Nie można zablokować konta administratora.', status: 409 }
      const now = Date.now()
      target.blockedAt = now
      target.blockedUntil = now + durationDays * 24 * 60 * 60 * 1000
      target.blockedReason = 'Decyzja administratora w sprawie zgłoszenia'
      target.authVersion = (target.authVersion ?? 0) + 1
      store.ipBlocks = store.ipBlocks.filter((block) => block.userId !== target.id)
    }
    const now = Date.now()
    report.status = 'resolved'
    report.decision = decision
    report.decisionNote = note.trim()
    report.decidedAt = now
    report.decidedBy = request.adminUser.id
    report.decidedByName = request.adminUser.name
    const decisionLabels = {
      dismiss: 'Zgłoszenie zostało sprawdzone i odrzucone.',
      remove_content: 'Zgłoszona treść została usunięta przez moderację.',
      warn: 'Zgłoszenie zostało sprawdzone. Administrator przekazał ostrzeżenie.',
      block_account: `Konto zostało zablokowane na ${durationDays === 90 ? '3 miesiące' : `${durationDays} dni`}.`,
    }
    const notificationMessage = `${decisionLabels[decision]}${note.trim() ? ` Uzasadnienie: ${note.trim()}` : ''}`
    const recipients = new Set()
    if (notifyReporter) recipients.add(report.reporterId)
    if (notifyTarget) recipients.add(report.targetUserId)
    for (const userId of recipients) {
      store.reportNotifications.push({
        id: crypto.randomUUID(),
        userId,
        reportId: report.id,
        targetType: report.targetType || 'profile',
        message: notificationMessage,
        createdAt: now,
      })
    }
    if (decision === 'remove_content') {
      store.moderatedItems.push({
        reportId: report.id,
        targetType: report.targetType || 'profile',
        targetId: report.targetId || `profile:${report.targetUserId}`,
        targetUserId: report.targetUserId,
        removedAt: now,
      })
    }
    return { ok: true }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json(result)
})

app.get('/api/report-notifications', requireAuthentication, async (request, response) => {
  const store = request.authStore
  response.set('Cache-Control', 'no-store')
  return response.json({
    notifications: store.reportNotifications
      .filter((notification) => notification.userId === request.authUser.id)
      .sort((first, second) => second.createdAt - first.createdAt)
      .slice(0, 50)
      .map(({ id, targetType, message, createdAt }) => ({ id, targetType, message, createdAt })),
  })
})

app.get('/api/moderation/removed-content', requireAuthentication, async (request, response) => {
  const store = request.authStore
  response.set('Cache-Control', 'no-store')
  return response.json({
    items: store.moderatedItems.map(({ targetType, targetId, targetUserId }) => ({ targetType, targetId, targetUserId })),
  })
})

app.get('/api/support/tickets', requireAuthentication, async (request, response) => {
  const store = request.authStore
  const tickets = store.supportTickets
    .filter((ticket) => ticket.userId === request.authUser.id)
    .sort((first, second) => second.updatedAt - first.updatedAt)
  return response.json({ tickets })
})

app.post('/api/support/tickets', requireAuthentication, supportCreationLimit, async (request, response) => {
  const { subject, category, message } = request.body ?? {}
  if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 120) {
    return response.status(400).json({ error: 'Temat sprawy musi mieć od 1 do 120 znaków.' })
  }
  if (!['account', 'technical', 'security', 'idea', 'other'].includes(category)) {
    return response.status(400).json({ error: 'Wybierz kategorię zgłoszenia.' })
  }
  if (typeof message !== 'string' || message.trim().length < 10 || message.trim().length > 5000) {
    return response.status(400).json({ error: 'Opis sprawy musi mieć od 10 do 5000 znaków.' })
  }
  const now = Date.now()
  const ticket = {
    id: crypto.randomUUID(),
    userId: request.authUser.id,
    subject: subject.trim(),
    category,
    status: 'open',
    messages: [{ id: crypto.randomUUID(), authorType: 'user', authorName: defaultProfileNickname(request.authUser), message: message.trim(), createdAt: now }],
    createdAt: now,
    updatedAt: now,
  }
  await updateStore((store) => { store.supportTickets.unshift(ticket) })
  return response.status(201).json({ ticket })
})

app.get('/api/admin/support/tickets', requireAdminAuthentication, requireAdminPermission('support.view'), async (_request, response) => {
  const store = await readStore()
  const usersById = new Map(store.users.map((user) => [user.id, user]))
  const tickets = store.supportTickets
    .slice()
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .map((ticket) => {
      const user = usersById.get(ticket.userId)
      return {
        ...ticket,
        user: user ? {
          id: user.id,
          name: [user.firstName, user.middleName, user.lastName, user.secondLastName].filter(Boolean).join(' '),
          nickname: defaultProfileNickname(user),
        } : { id: ticket.userId, name: 'Konto usunięte', nickname: '' },
      }
    })
  return response.json({ tickets })
})

app.patch('/api/admin/support/tickets/:id', requireAdminAuthentication, requireAdminPermission('support.manage'), adminMutationLimit, async (request, response) => {
  const { status, reply } = request.body ?? {}
  if (status !== undefined && !['open', 'in_progress', 'resolved'].includes(status)) {
    return response.status(400).json({ error: 'Wybierz prawidłowy status sprawy.' })
  }
  if (reply !== undefined && (typeof reply !== 'string' || !reply.trim() || reply.trim().length > 5000)) {
    return response.status(400).json({ error: 'Odpowiedź musi mieć od 1 do 5000 znaków.' })
  }
  if (status === undefined && reply === undefined) return response.status(400).json({ error: 'Podaj odpowiedź lub nowy status sprawy.' })
  const result = await updateStore((store) => {
    const ticket = store.supportTickets.find((item) => item.id === request.params.id)
    if (!ticket) return null
    if (status) ticket.status = status
    if (reply) {
      ticket.messages.push({
        id: crypto.randomUUID(),
        authorType: 'admin',
        authorName: request.adminUser.name,
        message: reply.trim(),
        createdAt: Date.now(),
      })
      if (ticket.status === 'open') ticket.status = 'in_progress'
    }
    ticket.updatedAt = Date.now()
    return ticket
  })
  if (!result) return response.status(404).json({ error: 'Nie znaleziono sprawy pomocy.' })
  return response.json({ ticket: result })
})

app.get('/api/admin/announcements', requireAdminAuthentication, requireAdminPermission('announcements.view'), async (_request, response) => {
  const store = await readStore()
  const now = Date.now()
  response.set('Cache-Control', 'no-store')
  return response.json({
    announcements: store.announcements.slice().sort((first, second) => second.createdAt - first.createdAt).map((announcement) => ({
      ...announcement,
      status: !announcement.active
        ? 'disabled'
        : (Number.isFinite(announcement.endsAt) && announcement.endsAt <= now)
          ? 'ended'
          : (Number.isFinite(announcement.startsAt) && announcement.startsAt > now)
            ? 'scheduled'
            : 'active',
    })),
  })
})

app.post('/api/admin/announcements', requireAdminAuthentication, requireAdminPermission('announcements.manage'), adminMutationLimit, async (request, response) => {
  const { title, message, startsAt, endsAt } = request.body ?? {}
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) return response.status(400).json({ error: 'Podaj tytuł komunikatu (maksymalnie 120 znaków).' })
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 2000) return response.status(400).json({ error: 'Wpisz treść komunikatu (maksymalnie 2000 znaków).' })
  if (!Number.isFinite(startsAt) || startsAt < 0) return response.status(400).json({ error: 'Podaj prawidłową datę i godzinę rozpoczęcia komunikatu.' })
  if (endsAt !== null && endsAt !== undefined && (!Number.isFinite(endsAt) || endsAt <= startsAt)) return response.status(400).json({ error: 'Zakończenie komunikatu musi przypadać po jego rozpoczęciu.' })
  const announcement = {
    id: crypto.randomUUID(),
    title: title.trim(),
    message: message.trim(),
    createdAt: Date.now(),
    createdBy: request.adminUser.email,
    active: true,
    startsAt,
    endsAt: endsAt ?? null,
  }
  await updateStore((store) => { store.announcements.unshift(announcement) })
  return response.status(201).json({ announcement })
})

app.delete('/api/admin/announcements/:id', requireAdminAuthentication, requireAdminPermission('announcements.manage'), adminMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const announcement = store.announcements.find((item) => item.id === request.params.id)
    if (!announcement) return false
    announcement.active = false
    return true
  })
  if (!result) return response.status(404).json({ error: 'Nie znaleziono komunikatu.' })
  return response.json({ ok: true })
})

app.get('/api/admin/admins', requireAdminAuthentication, requireAdminPermission('admins.view'), async (_request, response) => {
  const store = await readStore()
  response.set('Cache-Control', 'no-store')
  return response.json({ admins: store.admins.map(safeAdmin), rankPermissionTemplates: store.rankPermissionTemplates })
})

app.post('/api/admin/admins', requireAdminAuthentication, requireAdminPermission('admins.manage'), requireSuperAdmin, adminMutationLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
  const rank = typeof request.body?.rank === 'string' ? request.body.rank.trim() : ''
  const password = request.body?.password
  const permissions = request.body?.permissions
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Podaj prawidłowy e-mail logowania.' })
  if (!name || name.length > 120) return response.status(400).json({ error: 'Podaj nazwę administratora (maksymalnie 120 znaków).' })
  if (!rank || rank.length > 80 || rank === 'Super Administrator') return response.status(400).json({ error: 'Wybierz prawidłową rangę. Ranga Super Administrator jest zarezerwowana.' })
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) return response.status(400).json({ error: 'Hasło początkowe musi mieć od 12 do 256 znaków.' })
  if (!Array.isArray(permissions) || permissions.length === 0 || permissions.some((permission) => typeof permission !== 'string' || !adminPermissions.has(permission) || permission === 'admins.manage')) {
    return response.status(400).json({ error: 'Lista uprawnień zawiera nieprawidłową funkcję.' })
  }
  const passwordHash = await hashPassword(password)
  const result = await updateStore((store) => {
    if (store.admins.some((admin) => admin.email === email)) return { error: 'Konto administratora z tym e-mailem już istnieje.' }
    const admin = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash,
      rank,
      permissions: [...new Set(permissions)],
      isSuperAdmin: false,
      createdAt: Date.now(),
      authVersion: 0,
    }
    store.admins.push(admin)
    store.rankPermissionTemplates[rank] = admin.permissions
    return { admin }
  })
  if (result.error) return response.status(409).json({ error: result.error })
  return response.status(201).json({ admin: safeAdmin(result.admin) })
})

app.patch('/api/admin/admins/:id', requireAdminAuthentication, requireAdminPermission('admins.manage'), requireSuperAdmin, adminMutationLimit, async (request, response) => {
  const { email: requestedEmail, name: requestedName, rank: requestedRank, permissions: requestedPermissions, password } = request.body ?? {}
  if (requestedEmail !== undefined && (typeof requestedEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail.trim()))) {
    return response.status(400).json({ error: 'Podaj prawidłowy e-mail logowania.' })
  }
  if (requestedName !== undefined && (typeof requestedName !== 'string' || !requestedName.trim() || requestedName.trim().length > 120)) {
    return response.status(400).json({ error: 'Podaj nazwę administratora (maksymalnie 120 znaków).' })
  }
  if (requestedRank !== undefined && (typeof requestedRank !== 'string' || !requestedRank.trim() || requestedRank.trim().length > 80 || requestedRank.trim() === 'Super Administrator')) {
    return response.status(400).json({ error: 'Ranga Super Administrator jest zarezerwowana.' })
  }
  if (requestedPermissions !== undefined && (!Array.isArray(requestedPermissions) || requestedPermissions.length === 0 || requestedPermissions.some((permission) => typeof permission !== 'string' || !adminPermissions.has(permission) || permission === 'admins.manage'))) {
    return response.status(400).json({ error: 'Lista uprawnień zawiera nieprawidłową funkcję.' })
  }
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 12 || password.length > 256)) {
    return response.status(400).json({ error: 'Nowe hasło musi mieć od 12 do 256 znaków.' })
  }

  const normalizedEmail = typeof requestedEmail === 'string' ? requestedEmail.trim().toLowerCase() : undefined
  const passwordHash = typeof password === 'string' && password ? await hashPassword(password) : undefined
  const result = await updateStore((store) => {
    const admin = store.admins.find((item) => item.id === request.params.id)
    if (!admin) return { error: 'Nie znaleziono konta administratora.', status: 404 }
    const isSelf = admin.id === request.adminUser.id
    if (admin.isSuperAdmin && !isSelf) return { error: 'Nie można zmienić konta Super Administratora.', status: 409 }
    if (admin.isSuperAdmin && (requestedRank !== undefined || requestedPermissions !== undefined)) {
      return { error: 'Ranga i pełne uprawnienia Super Administratora są stałe.', status: 409 }
    }
    if (normalizedEmail && store.admins.some((item) => item.id !== admin.id && item.email === normalizedEmail)) {
      return { error: 'Konto administratora z tym e-mailem już istnieje.', status: 409 }
    }
    if (typeof requestedName === 'string') admin.name = requestedName.trim()
    if (normalizedEmail) admin.email = normalizedEmail
    if (typeof requestedRank === 'string' && !admin.isSuperAdmin) admin.rank = requestedRank.trim()
    if (Array.isArray(requestedPermissions) && !admin.isSuperAdmin) admin.permissions = [...new Set(requestedPermissions)]
    if (!admin.isSuperAdmin && Array.isArray(requestedPermissions)) {
      store.rankPermissionTemplates[admin.rank] = [...admin.permissions]
    }
    if (passwordHash) admin.passwordHash = passwordHash
    admin.authVersion = (admin.authVersion ?? 0) + 1
    return { admin, isSelf }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  if (result.isSelf) setAdminSession(response, result.admin)
  return response.json({ admin: safeAdmin(result.admin) })
})

app.delete('/api/admin/admins/:id', requireAdminAuthentication, requireAdminPermission('admins.manage'), requireSuperAdmin, adminMutationLimit, async (request, response) => {
  const result = await updateStore((store) => {
    const admin = store.admins.find((item) => item.id === request.params.id)
    if (!admin) return { error: 'Nie znaleziono konta administratora.', status: 404 }
    if (admin.isSuperAdmin) return { error: 'Konta Super Administratora nie można usunąć.', status: 409 }
    store.admins = store.admins.filter((item) => item.id !== admin.id)
    return { ok: true }
  })
  if (result.error) return response.status(result.status).json({ error: result.error })
  return response.json({ ok: true })
})

app.post('/api/auth/register', authRateLimit, async (request, response) => {
  if ((await readStore()).platformSettings.registrationEnabled === false) {
    return response.status(403).json({ error: 'Rejestracja nowych kont jest obecnie wstrzymana. Spróbuj ponownie później.' })
  }
  const { firstName, lastName, gender, birthDate, email, phone, password, confirmPassword } = request.body ?? {}
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (typeof firstName !== 'string' || !firstName.trim() || firstName.length > 80 || typeof lastName !== 'string' || !lastName.trim() || lastName.length > 80 || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return response.status(400).json({ error: 'Uzupełnij imię, nazwisko i poprawny adres e-mail.' })
  if (!['female', 'male', 'other', 'undisclosed'].includes(gender)) return response.status(400).json({ error: 'Wybierz płeć lub opcję „Wolę nie podawać”.' })
  if (!isValidBirthDate(birthDate)) return response.status(400).json({ error: 'Konto mogą założyć osoby, które ukończyły 15 lat. Sprawdź datę urodzenia.' })
  if (!validPhone(phone)) return response.status(400).json({ error: 'Podaj numer telefonu w formacie międzynarodowym, np. +48123456789.' })
  if (typeof password !== 'string' || password.length < 7 || password.length > 256) return response.status(400).json({ error: 'Hasło musi mieć od 7 do 256 znaków.' })
  if (password !== confirmPassword) return response.status(400).json({ error: 'Powtórzone hasło nie jest takie samo.' })
  if (!mailer || !process.env.SMTP_FROM) return response.status(503).json({ error: 'Wysyłka e-maili nie jest skonfigurowana. Ustaw SMTP_URL i SMTP_FROM na serwerze.' })

  const normalizedPhone = phone.trim()
  const emailToken = crypto.randomBytes(32).toString('base64url')
  const passwordHash = await hashPassword(password)
  const user = {
    id: crypto.randomUUID(),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    gender,
    email: normalizedEmail,
    phone: normalizedPhone,
    birthDate,
    passwordHash,
    lastIpHash: hashIp(request.ip),
    emailVerified: false,
    emailTokenHash: digest(emailToken),
    emailTokenExpiresAt: Date.now() + emailLifetime,
    phoneVerified: false,
    createdAt: Date.now(),
  }
  const inserted = await updateStore((store) => {
    if (store.users.some((item) => item.email === normalizedEmail || item.phone === normalizedPhone)) return false
    store.users.push(user)
    return true
  })
  if (!inserted) return response.status(409).json({ error: 'Konto z tym adresem e-mail lub numerem telefonu już istnieje.' })
  try {
    await sendVerificationEmail(user, emailToken)
  } catch {
    await updateStore((store) => { store.users = store.users.filter((item) => item.id !== user.id) })
    return response.status(503).json({ error: 'Nie udało się wysłać e-maila. Sprawdź konfigurację SMTP i spróbuj ponownie.' })
  }
  return response.status(201).json({ message: 'Wysłaliśmy link potwierdzający na podany adres e-mail.' })
})

app.post('/api/auth/verify-email', authRateLimit, async (request, response) => {
  const token = request.body?.token
  if (typeof token !== 'string' || token.length < 32) return response.status(400).json({ error: 'Link weryfikacyjny jest nieprawidłowy lub wygasł.' })
  const user = await updateStore((store) => {
    const found = store.users.find((item) => item.emailTokenHash === digest(token) && item.emailTokenExpiresAt > Date.now())
    if (!found) return null
    Object.assign(found, { emailVerified: true, emailTokenHash: null, emailTokenExpiresAt: null })
    return found
  })
  if (!user) return response.status(400).json({ error: 'Link weryfikacyjny jest nieprawidłowy lub wygasł.' })
  return response.json({ message: 'Adres e-mail potwierdzony. Możesz się zalogować.' })
})

app.post('/api/auth/resend-email', authRateLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const user = (await readStore()).users.find((item) => item.email === email && !item.emailVerified)
  if (!user) return response.json({ message: 'Jeśli konto wymaga potwierdzenia, wyślemy nowy link.' })
  const token = crypto.randomBytes(32).toString('base64url')
  await updateStore((store) => {
    const savedUser = store.users.find((item) => item.id === user.id)
    if (savedUser) Object.assign(savedUser, { emailTokenHash: digest(token), emailTokenExpiresAt: Date.now() + emailLifetime })
  })
  try {
    await sendVerificationEmail(user, token)
  } catch {
    return response.status(503).json({ error: 'Nie udało się wysłać e-maila. Spróbuj ponownie później.' })
  }
  return response.json({ message: 'Wysłaliśmy nowy link potwierdzający.' })
})

app.post('/api/auth/forgot-password', authRateLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const channel = request.body?.channel
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Podaj prawidłowy adres e-mail przypisany do konta.' })
  if (channel !== 'email' && channel !== 'sms') return response.status(400).json({ error: 'Wybierz e-mail lub SMS jako sposób otrzymania kodu.' })
  const challengeId = crypto.randomUUID()
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const user = await updateStore((store) => {
    const found = store.users.find((item) => item.email === email && item.emailVerified)
    if (!found || (channel === 'sms' && !found.phoneVerified)) return null
    Object.assign(found, {
      passwordResetCodeHash: codeDigest(challengeId, code),
      passwordResetChallengeId: challengeId,
      passwordResetChannel: channel,
      passwordResetExpiresAt: Date.now() + passwordResetCodeLifetime,
      passwordResetAttempts: 0,
    })
    return found
  })
  try {
    if (user) {
      if (channel === 'email') await sendEmailCode(user.email, user.firstName, code, 'do zmiany hasła w YouTopic')
      else await sendSms(user.phone, code, 'zmiany hasła')
    }
  } catch {
    if (user) await updateStore((store) => {
      const savedUser = store.users.find((item) => item.id === user.id)
      if (savedUser?.passwordResetChallengeId === challengeId) Object.assign(savedUser, { passwordResetCodeHash: null, passwordResetChallengeId: null, passwordResetChannel: null, passwordResetExpiresAt: null, passwordResetAttempts: 0 })
    })
    return response.status(503).json({ error: 'Nie udało się wysłać kodu. Sprawdź konfigurację poczty lub SMS i spróbuj ponownie.' })
  }
  const destination = channel === 'email' ? 'potwierdzony adres e-mail' : 'zweryfikowany numer telefonu'
  return response.json({
    challengeId,
    channel,
    message: `Jeśli konto z tym adresem istnieje i ma ${destination}, kod został wysłany. Jeśli go nie otrzymasz, spróbuj drugiego sposobu.`,
  })
})

app.post('/api/auth/reset-password', authRateLimit, async (request, response) => {
  const { token, challengeId, code, password, confirmPassword } = request.body ?? {}
  const isLegacyToken = typeof token === 'string' && token.length >= 32
  if (!isLegacyToken && (typeof challengeId !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code))) return response.status(400).json({ error: 'Wpisz sześciocyfrowy kod z wiadomości.' })
  if (typeof password !== 'string' || password.length < 7 || password.length > 256) return response.status(400).json({ error: 'Hasło musi mieć od 7 do 256 znaków.' })
  if (password !== confirmPassword) return response.status(400).json({ error: 'Powtórzone hasło nie jest takie samo.' })
  const passwordHash = await hashPassword(password)
  const user = await updateStore((store) => {
    let found
    if (isLegacyToken) {
      found = store.users.find((item) => item.passwordResetTokenHash === digest(token) && item.passwordResetExpiresAt > Date.now())
      if (!found) return { error: 'Link do zmiany hasła jest nieprawidłowy lub wygasł.' }
    } else {
      found = store.users.find((item) => item.passwordResetChallengeId === challengeId)
      if (!found || !Number.isFinite(found.passwordResetExpiresAt) || found.passwordResetExpiresAt <= Date.now() || found.passwordResetAttempts >= 5) return { error: 'Kod jest nieprawidłowy lub wygasł.' }
      if (found.passwordResetCodeHash !== codeDigest(challengeId, code)) {
        found.passwordResetAttempts += 1
        return { error: 'Kod jest nieprawidłowy lub wygasł.' }
      }
    }
    Object.assign(found, {
      passwordHash,
      authVersion: (found.authVersion ?? 0) + 1,
      passwordResetCodeHash: null,
      passwordResetChallengeId: null,
      passwordResetChannel: null,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      phoneChallengeId: null,
      phoneCodeHash: null,
      phoneCodeExpiresAt: null,
      pendingDeviceHash: null,
      phoneChallengeRememberMe: null,
      phoneChangeChallengeId: null,
      phoneChangeCodeHash: null,
      phoneChangeExpiresAt: null,
      phoneChangeAttempts: 0,
      pendingLoginPhone: null,
      emailChangeChallengeId: null,
      emailChangeCodeHash: null,
      emailChangeExpiresAt: null,
      emailChangeAttempts: 0,
      pendingLoginEmail: null,
      trustedDevices: [],
    })
    return { user: found }
  })
  if (user.error) return response.status(400).json({ error: user.error })
  clearSession(response)
  response.clearCookie(trustedDeviceCookie, deviceCookieOptions(0))
  response.clearCookie(pendingDeviceCookie, deviceCookieOptions(0))
  return response.json({ message: 'Hasło zostało zmienione. Zaloguj się ponownie.' })
})

app.post('/api/auth/login/email', authRateLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = request.body?.password
  const rememberMe = request.body?.rememberMe === true
  if (typeof password !== 'string' || password.length < 7 || password.length > 256) return response.status(400).json({ error: 'Hasło musi mieć od 7 do 256 znaków.' })
  const user = (await readStore()).users.find((item) => item.email === email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) return response.status(401).json({ error: 'Nieprawidłowy e-mail lub hasło.' })
  if (!user.emailVerified) return response.status(403).json({ error: 'Najpierw potwierdź adres e-mail z wiadomości.' })
  if (isUserBlocked(user)) return response.status(403).json({ error: 'Dostęp do tego konta został czasowo ograniczony. Skontaktuj się z administracją YouTopic.' })
  const loggedInUser = await updateStore((store) => {
    const savedUser = store.users.find((item) => item.id === user.id)
    if (!savedUser || isUserBlocked(savedUser)) return null
    savedUser.lastIpHash = hashIp(request.ip)
    return savedUser
  })
  if (!loggedInUser) return response.status(403).json({ error: 'Dostęp do tego konta został czasowo ograniczony. Skontaktuj się z administracją YouTopic.' })
  setSession(response, loggedInUser, rememberMe)
  response.clearCookie(trustedDeviceCookie, deviceCookieOptions(0))
  response.clearCookie(pendingDeviceCookie, deviceCookieOptions(0))
  return response.json({ user: safeUser(loggedInUser) })
})

app.post('/api/auth/login/phone', authRateLimit, (_request, response) =>
  response.status(410).json({ error: 'Logowanie numerem telefonu jest tymczasowo wyłączone. Zaloguj się adresem e-mail.' }))

app.post('/api/auth/verify-phone', authRateLimit, (_request, response) =>
  response.status(410).json({ error: 'Weryfikacja SMS przy logowaniu jest tymczasowo wyłączona. Zaloguj się ponownie przez e-mail.' }))

app.get('/api/auth/me', requireAuthentication, (request, response) => response.json({ user: safeUser(request.authUser) }))

app.post('/api/account/phone-change/start', requireAuthentication, authRateLimit, async (request, response) => {
  const { phone, password } = request.body ?? {}
  const normalizedPhone = typeof phone === 'string' ? phone.trim().replace(/[\s()-]/g, '') : ''
  if (!validPhone(normalizedPhone)) return response.status(400).json({ error: 'Podaj nowy numer w formacie międzynarodowym, np. +48123456789.' })
  if (typeof password !== 'string' || !(await verifyPassword(password, request.authUser.passwordHash))) return response.status(401).json({ error: 'Nieprawidłowe hasło.' })
  const challengeId = crypto.randomUUID()
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0')
  const prepared = await updateStore((store) => {
    if (store.users.some((item) => item.phone === normalizedPhone && item.id !== request.authUser.id)) return false
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user) return false
    Object.assign(user, {
      phoneChangeChallengeId: challengeId,
      phoneChangeCodeHash: codeDigest(challengeId, code),
      phoneChangeExpiresAt: Date.now() + codeLifetime,
      phoneChangeAttempts: 0,
      pendingLoginPhone: normalizedPhone,
    })
    return true
  })
  if (!prepared) return response.status(409).json({ error: 'Nie można użyć tego numeru. Sprawdź, czy nie jest już przypisany do innego konta.' })
  try {
    await sendSms(normalizedPhone, code, 'potwierdzenia zmiany numeru')
  } catch {
    await updateStore((store) => {
      const user = store.users.find((item) => item.id === request.authUser.id)
      if (user?.phoneChangeChallengeId === challengeId) Object.assign(user, { phoneChangeChallengeId: null, phoneChangeCodeHash: null, phoneChangeExpiresAt: null, pendingLoginPhone: null })
    })
    return response.status(503).json({ error: 'Nie udało się wysłać SMS-a. Sprawdź konfigurację usługi i spróbuj ponownie.' })
  }
  return response.json({ challengeId, maskedPhone: maskPhone(normalizedPhone), message: 'Wysłaliśmy kod potwierdzający na nowy numer.' })
})

app.post('/api/account/phone-change/verify', requireAuthentication, authRateLimit, async (request, response) => {
  const { challengeId, code } = request.body ?? {}
  if (typeof challengeId !== 'string' || typeof code !== 'string' || !/^\d{4}$/.test(code)) return response.status(400).json({ error: 'Wpisz czterocyfrowy kod SMS.' })
  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user || user.phoneChangeChallengeId !== challengeId || !user.pendingLoginPhone || user.phoneChangeExpiresAt < Date.now() || user.phoneChangeAttempts >= 5) return { error: 'Kod jest nieprawidłowy lub wygasł.' }
    if (user.phoneChangeCodeHash !== codeDigest(challengeId, code)) {
      user.phoneChangeAttempts += 1
      return { error: 'Kod jest nieprawidłowy lub wygasł.' }
    }
    if (store.users.some((item) => item.phone === user.pendingLoginPhone && item.id !== user.id)) return { error: 'Ten numer jest już przypisany do innego konta.' }
    user.phone = user.pendingLoginPhone
    Object.assign(user, {
      phoneVerified: true,
      phoneChangeChallengeId: null,
      phoneChangeCodeHash: null,
      phoneChangeExpiresAt: null,
      phoneChangeAttempts: 0,
      pendingLoginPhone: null,
      passwordResetCodeHash: null,
      passwordResetChallengeId: null,
      passwordResetChannel: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      passwordResetTokenHash: null,
    })
    return { ok: true }
  })
  if (result.error) return response.status(400).json({ error: result.error })
  return response.json({ message: 'Numer logowania został zmieniony.' })
})

app.post('/api/account/email-change/start', requireAuthentication, authRateLimit, async (request, response) => {
  const { email, password } = request.body ?? {}
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return response.status(400).json({ error: 'Podaj prawidłowy nowy adres e-mail.' })
  if (typeof password !== 'string' || !(await verifyPassword(password, request.authUser.passwordHash))) return response.status(401).json({ error: 'Nieprawidłowe hasło.' })
  const challengeId = crypto.randomUUID()
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const prepared = await updateStore((store) => {
    if (store.users.some((item) => item.email === normalizedEmail && item.id !== request.authUser.id)) return { error: 'Ten adres e-mail jest już przypisany do innego konta.' }
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user) return { error: 'Nie można znaleźć konta. Zaloguj się ponownie.' }
    Object.assign(user, {
      pendingLoginEmail: normalizedEmail,
      emailChangeChallengeId: challengeId,
      emailChangeCodeHash: codeDigest(challengeId, code),
      emailChangeExpiresAt: Date.now() + codeLifetime,
      emailChangeAttempts: 0,
    })
    return { firstName: user.firstName }
  })
  if (prepared.error) return response.status(409).json({ error: prepared.error })
  try {
    await sendEmailCode(normalizedEmail, prepared.firstName, code, 'potwierdzenia nowego adresu logowania')
  } catch {
    await updateStore((store) => {
      const user = store.users.find((item) => item.id === request.authUser.id)
      if (user?.emailChangeChallengeId === challengeId) Object.assign(user, { pendingLoginEmail: null, emailChangeChallengeId: null, emailChangeCodeHash: null, emailChangeExpiresAt: null })
    })
    return response.status(503).json({ error: 'Nie udało się wysłać kodu na nowy adres. Sprawdź konfigurację poczty i spróbuj ponownie.' })
  }
  return response.json({ challengeId, maskedEmail: normalizedEmail.replace(/^(.{1,2}).*(@.*)$/, '$1•••$2'), message: 'Wysłaliśmy kod potwierdzający na nowy adres e-mail.' })
})

app.post('/api/account/email-change/verify', requireAuthentication, authRateLimit, async (request, response) => {
  const { challengeId, code } = request.body ?? {}
  if (typeof challengeId !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) return response.status(400).json({ error: 'Wpisz sześciocyfrowy kod z wiadomości.' })
  const result = await updateStore((store) => {
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user || user.emailChangeChallengeId !== challengeId || !user.pendingLoginEmail || !Number.isFinite(user.emailChangeExpiresAt) || user.emailChangeExpiresAt <= Date.now() || user.emailChangeAttempts >= 5) return { error: 'Kod jest nieprawidłowy lub wygasł.' }
    if (user.emailChangeCodeHash !== codeDigest(challengeId, code)) {
      user.emailChangeAttempts += 1
      return { error: 'Kod jest nieprawidłowy lub wygasł.' }
    }
    if (store.users.some((item) => item.email === user.pendingLoginEmail && item.id !== user.id)) return { error: 'Ten adres e-mail jest już przypisany do innego konta.' }
    user.email = user.pendingLoginEmail
    Object.assign(user, {
      emailVerified: true,
      pendingLoginEmail: null,
      emailChangeChallengeId: null,
      emailChangeCodeHash: null,
      emailChangeExpiresAt: null,
      emailChangeAttempts: 0,
      passwordResetCodeHash: null,
      passwordResetChallengeId: null,
      passwordResetChannel: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      passwordResetTokenHash: null,
    })
    return { ok: true }
  })
  if (result.error) return response.status(400).json({ error: result.error })
  return response.json({ message: 'Adres e-mail logowania został zmieniony.' })
})

app.post('/api/profile', requireAuthentication, async (request, response) => {
  const { nickname, firstName, middleName, lastName, secondLastName, location, contactPhone, secondContactPhone, bio, avatar, coverImage, socialLinks, profileVisibility, socialPrivacy } = request.body ?? {}
  const normalizedNickname = typeof nickname === 'string' ? nickname.trim().replace(/^@/, '') : ''
  if (!/^[\p{L}\p{N}._-]{2,24}$/u.test(normalizedNickname)) return response.status(400).json({ error: 'Nick musi mieć od 2 do 24 znaków: litery, cyfry, kropki, myślniki lub podkreślenia.' })
  if (typeof firstName !== 'string' || !firstName.trim() || firstName.trim().length > 80 || typeof lastName !== 'string' || !lastName.trim() || lastName.trim().length > 80) return response.status(400).json({ error: 'Imię i nazwisko są wymagane i mogą mieć maksymalnie 80 znaków.' })
  if (typeof middleName !== 'string' || middleName.trim().length > 80 || typeof secondLastName !== 'string' || secondLastName.trim().length > 80) return response.status(400).json({ error: 'Drugie imię i drugie nazwisko mogą mieć maksymalnie 80 znaków.' })
  if (typeof location !== 'string' || location.trim().length > 80) return response.status(400).json({ error: 'Miejscowość może mieć maksymalnie 80 znaków.' })
  const normalizeContactPhone = (value) => typeof value === 'string' ? value.trim().replace(/[\s()-]/g, '') : null
  const normalizedContactPhone = normalizeContactPhone(contactPhone)
  const normalizedSecondContactPhone = normalizeContactPhone(secondContactPhone)
  const validOptionalPhone = (value) => value === '' || (typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value))
  if (normalizedContactPhone === null || normalizedSecondContactPhone === null || !validOptionalPhone(normalizedContactPhone) || !validOptionalPhone(normalizedSecondContactPhone)) return response.status(400).json({ error: 'Numery kontaktowe podaj w formacie międzynarodowym, np. +48123456789.' })
  if (typeof bio !== 'string' || bio.trim().length > 160) return response.status(400).json({ error: 'Biografia może mieć maksymalnie 160 znaków.' })
  const validImage = (value) => typeof value === 'string' && value.length <= 900_000 && (/^https:\/\/[^\s]+$/i.test(value) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))
  if (!validImage(avatar) || !(coverImage === '' || validImage(coverImage))) return response.status(400).json({ error: 'Zdjęcia profilu lub tła są nieprawidłowe albo zbyt duże.' })
  if (!socialLinks || typeof socialLinks !== 'object' || Array.isArray(socialLinks) || Object.keys(socialLinks).some((platform) => !socialPlatforms.has(platform))) return response.status(400).json({ error: 'Wybierz obsługiwaną platformę społecznościową.' })
  const normalizedSocialLinks = {}
  for (const [platform, rawUrl] of Object.entries(socialLinks)) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 300) return response.status(400).json({ error: `Link do ${platform} jest nieprawidłowy.` })
    const value = rawUrl.trim()
    if (!value) continue
    let parsedUrl
    try {
      parsedUrl = new URL(value)
    } catch {
      return response.status(400).json({ error: `Wklej prawidłowy link do ${platform}.` })
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return response.status(400).json({ error: `Link do ${platform} musi zaczynać się od http:// lub https://.` })
    normalizedSocialLinks[platform] = parsedUrl.toString()
  }
  const visibilityFields = ['location', 'bio', 'contactPhone', 'secondContactPhone', 'socialLinks', 'crewMembers', 'crewSize']
  if (!profileVisibility || typeof profileVisibility !== 'object' || Array.isArray(profileVisibility) || visibilityFields.some((field) => !profileAudiences.has(profileVisibility[field]))) return response.status(400).json({ error: 'Wybierz widoczność dla każdego dodatkowego pola profilu.' })
  if (!socialPrivacy || typeof socialPrivacy !== 'object' || Array.isArray(socialPrivacy)
    || !['public', 'crew', 'private'].includes(socialPrivacy.profileAudience)
    || !['everyone', 'nobody'].includes(socialPrivacy.crewInviteAudience)) {
    return response.status(400).json({ error: 'Wybierz widoczność profilu i zasady zaproszeń do Ekipy.' })
  }
  const result = await updateStore((store) => {
    const duplicate = store.users.some((user) => user.id !== request.authUser.id && defaultProfileNickname(user).toLocaleLowerCase('pl-PL') === normalizedNickname.toLocaleLowerCase('pl-PL'))
    if (duplicate) return { error: 'Ten nick jest już zajęty.' }
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user) return { error: 'Nie znaleziono konta.' }
    Object.assign(user, {
      nickname: normalizedNickname,
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      secondLastName: secondLastName.trim(),
      location: location.trim(),
      contactPhone: normalizedContactPhone,
      secondContactPhone: normalizedSecondContactPhone,
      bio: bio.trim(),
      avatar,
      coverImage,
      socialLinks: normalizedSocialLinks,
      profileVisibility,
      socialPrivacy,
    })
    return { user: safeUser(user) }
  })
  if (result.error) return response.status(result.error === 'Ten nick jest już zajęty.' ? 409 : 404).json({ error: result.error })
  return response.json({ user: result.user })
})

app.post('/api/profile/nickname', requireAuthentication, async (request, response) => {
  const nickname = typeof request.body?.nickname === 'string' ? request.body.nickname.trim().replace(/^@/, '') : ''
  if (!/^[\p{L}\p{N}._-]{2,24}$/u.test(nickname)) return response.status(400).json({ error: 'Nick musi mieć od 2 do 24 znaków: litery, cyfry, kropki, myślniki lub podkreślenia.' })
  const result = await updateStore((store) => {
    const normalizedNickname = nickname.toLocaleLowerCase('pl-PL')
    const duplicate = store.users.some((user) => user.id !== request.authUser.id && defaultProfileNickname(user).toLocaleLowerCase('pl-PL') === normalizedNickname)
    if (duplicate) return { error: 'Ten nick jest już zajęty.' }
    const user = store.users.find((item) => item.id === request.authUser.id)
    if (!user) return { error: 'Nie znaleziono konta.' }
    user.nickname = nickname
    return { user: safeUser(user) }
  })
  if (result.error) return response.status(409).json({ error: result.error })
  return response.json({ user: result.user })
})

app.post('/api/auth/logout', (_request, response) => {
  clearSession(response)
  return response.json({ ok: true })
})

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'Żądanie jest zbyt duże.' })
  console.error('Auth API error:', error)
  return response.status(500).json({ error: 'Wystąpił błąd serwera.' })
})

await initializeDatabase()
app.listen(port, host, () => console.log(`YouTopic API listening on http://${host}:${port}`))