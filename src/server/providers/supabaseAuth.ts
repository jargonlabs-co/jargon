import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js'
import type { ServerConfig } from '../config'

let anonClient: SupabaseClient | null = null
let adminClient: SupabaseClient | null = null

export function supabaseConfigured(config: ServerConfig): boolean {
  return Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey)
}

export function getSupabaseAnon(config: ServerConfig): SupabaseClient {
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new Error('Supabase is not configured')
  }
  if (!anonClient) {
    anonClient = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return anonClient
}

export function getSupabaseAdmin(config: ServerConfig): SupabaseClient {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error('Supabase is not configured')
  }
  if (!adminClient) {
    adminClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return adminClient
}

export function isAlreadyRegisteredError(message: string): boolean {
  return /already\s*(been\s*)?(registered|exists|taken)|user already|email.*exist/i.test(
    message
  )
}

/** Look up an Auth user by email via the Admin API. */
export async function findAuthUserByEmail(
  config: ServerConfig,
  email: string
): Promise<SupabaseUser | null> {
  const admin = getSupabaseAdmin(config)
  const normalized = email.trim().toLowerCase()
  // Prefer getUserByEmail when available on this SDK version.
  const anyAdmin = admin.auth.admin as typeof admin.auth.admin & {
    getUserByEmail?: (email: string) => Promise<{ data: { user: SupabaseUser | null }; error: Error | null }>
  }
  if (typeof anyAdmin.getUserByEmail === 'function') {
    const { data, error } = await anyAdmin.getUserByEmail(normalized)
    if (!error && data?.user) return data.user
  }
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw new Error(error.message)
  return data.users.find((u) => u.email?.toLowerCase() === normalized) ?? null
}

/**
 * Create a confirmed Auth user (server-side) then return a session via password sign-in.
 * Supabase Auth is the source of truth for credentials — not Railway jargon_state.
 */
export async function signUpWithPassword(
  config: ServerConfig,
  input: { email: string; password: string; name?: string }
): Promise<{ accessToken: string; supabaseUser: SupabaseUser }> {
  const email = input.email.trim().toLowerCase()
  const existing = await findAuthUserByEmail(config, email)
  if (existing) {
    throw new Error('Email already registered. Sign in instead.')
  }

  const admin = getSupabaseAdmin(config)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name ?? email.split('@')[0] }
  })
  if (error) {
    if (isAlreadyRegisteredError(error.message)) {
      throw new Error('Email already registered. Sign in instead.')
    }
    throw new Error(error.message)
  }
  if (!data.user) throw new Error('Sign up failed')

  return signInWithPassword(config, { email, password: input.password })
}

export async function signInWithPassword(
  config: ServerConfig,
  input: { email: string; password: string }
): Promise<{ accessToken: string; supabaseUser: SupabaseUser }> {
  const client = getSupabaseAnon(config)
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password
  })
  if (error) throw new Error(error.message)
  if (!data.session?.access_token || !data.user) throw new Error('Invalid credentials')
  return { accessToken: data.session.access_token, supabaseUser: data.user }
}

export async function getSupabaseUserFromToken(
  config: ServerConfig,
  accessToken: string
): Promise<SupabaseUser | null> {
  const client = getSupabaseAnon(config)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) return null
  return data.user
}

/** Ensure a Supabase auth user exists (for bootstrap / legacy migrate). */
export async function ensureSupabaseUser(
  config: ServerConfig,
  input: { email: string; password: string; name?: string }
): Promise<SupabaseUser> {
  const existing = await findAuthUserByEmail(config, input.email)
  if (existing) return existing

  const admin = getSupabaseAdmin(config)
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name ?? input.email.split('@')[0] }
  })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Could not create Supabase user')
  return data.user
}
