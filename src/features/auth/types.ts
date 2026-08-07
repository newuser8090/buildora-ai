// ---------------------------------------------------------------------------
// Auth (Phase P6) — types
//
// Beginner-friendly email/password authentication with a provider abstraction
// so core logic is testable without a live backend. Sessions are always
// handled by the provider (provider-supported secure session handling) — no
// auth tokens are ever stored manually in localStorage by app code.
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  /** True when the provider has confirmed the email address. */
  emailVerified: boolean;
}

export interface AuthSession {
  user: AuthUser;
  /** ISO timestamp when the session was created. */
  createdAt: string;
  /** ISO timestamp when the session expires (provider policy). */
  expiresAt: string;
}

export type AuthStatus = "loading" | "signed-out" | "signed-in";

export type AuthErrorCode =
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_CREDENTIALS"
  | "WEAK_PASSWORD"
  | "INVALID_EMAIL"
  | "SESSION_EXPIRED"
  | "NETWORK_FAILED"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export interface AuthError {
  code: AuthErrorCode;
  /** User-safe message — never leaks whether an account exists. */
  message: string;
  /** Internal diagnostic detail (never shown by default). */
  cause?: string;
}

export type AuthResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: AuthError };

export interface AuthService {
  readonly kind: "supabase" | "mock";
  /** True when this auth backend is configured/available. */
  isConfigured(): boolean;
  /** Restore the current session (called on app start). */
  getSession(): Promise<AuthSession | null>;
  /** Subscribe to provider auth-state changes. Returns an unsubscribe fn. */
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void;
  signUp(email: string, password: string): Promise<AuthResult<AuthSession>>;
  signIn(email: string, password: string): Promise<AuthResult<AuthSession>>;
  signOut(): Promise<AuthResult<void>>;
  resetPassword(email: string): Promise<AuthResult<void>>;
}
