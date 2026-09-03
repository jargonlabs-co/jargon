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

export async function signUpWithPassword(
  config: ServerConfig,
  input: { email: string; password: string; name?: string }
): Promise<{ accessToken: string; supabaseUser: SupabaseUser }> {
  const client = getSupabaseAnon(config)
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { name: input.name ?? input.email.split('@')[0] }
    }
  })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Sign up failed')
  // With autoconfirm, session is usually present; otherwise create a session via sign-in.
  if (data.session?.access_token) {
    return { accessToken: data.session.access_token, supabaseUser: data.user }
  }
  return signInWithPassword(config, { email: input.email, password: input.password })
}

export async function signInWithPassword(
  config: ServerConfig,
  input: { email: string; password: string }
): Promise<{ accessToken: string; supabaseUser: SupabaseUser }> {
  const client = getSupabaseAnon(config)
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email,
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
  const admin = getSupabaseAdmin(config)
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = listed?.users?.find((u) => u.email?.toLowerCase() === input.email.toLowerCase())
  if (existing) return existing

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name ?? input.email.split('@')[0] }
  })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Could not create Supabase user')
  return data.user
}
