import 'dotenv/config'
import crypto from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import nodemailer from 'nodemailer'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5173'
const allowedOrigins = new Set((process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((origin) => origin.trim()))
const sessionSecret = process.env.AUTH_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'))
const storePath = resolve('data/auth-store.json')
const sessionCookie = 'youtopic_session'
const trustedDeviceCookie = 'youtopic_trusted_device'
const pendingDeviceCookie = 'youtopic_pending_device'
const sessionLifetime = 12 * 60 * 60 * 1000
const rememberedSessionLifetime = 30 * 24 * 60 * 60 * 1000
const socialPlatforms = new Set(['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'LinkedIn', 'Twitch'])
const profileAudiences = new Set(['public', 'crew', 'private'])
const codeLifetime = 10 * 60 * 1000
const passwordResetCodeLifetime = 10 * 60 * 1000
const emailLifetime = 24 * 60 * 60 * 1000
const scrypt = promisify(crypto.scrypt)
let storeQueue = Promise.resolve()

if (!sessionSecret) throw new Error('AUTH_SESSION_SECRET is required in production.')

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
app.use(express.json({ limit: '2mb' }))
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false })
app.use('/api', (request, response, next) => {
  const origin = request.get('origin')
  if (origin && !isAllowedOrigin(origin)) return response.status(403).json({ error: 'Niedozwolone źródło żądania.' })
  if (process.env.NODE_ENV === 'production' && request.method !== 'GET' && !origin) return response.status(403).json({ error: 'Brak nagłówka Origin.' })
  next()
})

function emptyStore() {
  return { users: [] }
}

async function readStore() {
  try {
    return JSON.parse(await readFile(storePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore()
    throw error
  }
}

function updateStore(update) {
  const operation = storeQueue.then(async () => {
    const store = await readStore()
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
    online: true,
    crewMembers: 0,
    crewSize: 0,
  }
}

function findCookie(request, name) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null
}

function sessionValue(user, rememberMe) {
  const lifetime = rememberMe ? rememberedSessionLifetime : sessionLifetime
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + lifetime, ver: user.authVersion ?? 0 })).toString('base64url')
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function sessionUserId(request) {
  const value = findCookie(request, sessionCookie)
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
  const store = await readStore()
  const user = store.users.find((item) => item.id === session.sub)
  if (!user || (session.ver ?? 0) !== (user.authVersion ?? 0)) return response.status(401).json({ error: 'Zaloguj się ponownie.' })
  request.authUser = user
  next()
}

app.get('/api/health', (_request, response) => response.json({ ok: true }))

app.post('/api/auth/register', authRateLimit, async (request, response) => {
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
  setSession(response, user, rememberMe)
  response.clearCookie(trustedDeviceCookie, deviceCookieOptions(0))
  response.clearCookie(pendingDeviceCookie, deviceCookieOptions(0))
  return response.json({ user: safeUser(user) })
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
  const { nickname, firstName, middleName, lastName, secondLastName, location, contactPhone, secondContactPhone, bio, avatar, coverImage, socialLinks, profileVisibility } = request.body ?? {}
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

app.listen(port, '127.0.0.1', () => console.log(`YouTopic API listening on http://127.0.0.1:${port}`))