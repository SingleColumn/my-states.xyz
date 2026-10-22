export type CredentialStorageMode = 'session' | 'persistent'
const SESSION_KEY = 'my-states:openai-key:session'
const PERSISTENT_KEY = 'my-states:openai-key'
function storage(mode: CredentialStorageMode): Storage { return mode === 'session' ? window.sessionStorage : window.localStorage }
export function getOpenAiCredential(): string | null { return window.sessionStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(PERSISTENT_KEY) }
export function hasOpenAiCredential() { return Boolean(getOpenAiCredential()) }
export function saveOpenAiCredential(key: string, mode: CredentialStorageMode) { const value = key.trim(); if (!value || value.length > 256) throw new Error('Enter a valid OpenAI API key.'); window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem(PERSISTENT_KEY); storage(mode).setItem(mode === 'session' ? SESSION_KEY : PERSISTENT_KEY, value) }
export function removeOpenAiCredential() { window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem(PERSISTENT_KEY) }
export function openAiCredentialMode(): CredentialStorageMode | null { if (window.sessionStorage.getItem(SESSION_KEY)) return 'session'; if (window.localStorage.getItem(PERSISTENT_KEY)) return 'persistent'; return null }
