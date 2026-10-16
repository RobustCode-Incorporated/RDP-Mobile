import axios from 'axios';
import { Platform } from 'react-native';
import type { ApiError } from '../types/api';

export const hostedBaseUrl = 'https://rdp-backend-xr8r.onrender.com';

const localBaseUrl = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://127.0.0.1:8080',
  default: 'http://localhost:8080',
});

/**
 * API base URL resolution:
 * 1. EXPO_PUBLIC_API_BASE_URL when set (see .env.example) - wins in every build;
 * 2. otherwise the local backend in development (__DEV__);
 * 3. otherwise the hosted Render backend for release builds.
 */
export function resolveApiBaseUrl(options: {
  envUrl: string | undefined;
  isDev: boolean;
  localUrl: string;
  hostedUrl: string;
}) {
  const envUrl = options.envUrl?.trim();
  if (envUrl) {
    return envUrl;
  }

  return options.isDev ? options.localUrl : options.hostedUrl;
}

// process.env.EXPO_PUBLIC_* must be referenced statically so Expo can inline it at build time.
const baseURL = resolveApiBaseUrl({
  envUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  localUrl: localBaseUrl,
  hostedUrl: hostedBaseUrl,
});

let authToken: string | null = null;
let unauthorizedHandler: null | (() => void | Promise<void>) = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: null | (() => void | Promise<void>)) {
  unauthorizedHandler = handler;
}

export async function triggerUnauthorizedHandlerForTests() {
  if (unauthorizedHandler) {
    await unauthorizedHandler();
  }
}

export const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  if (authToken && config.headers) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && unauthorizedHandler) {
      await unauthorizedHandler();
    }

    return Promise.reject(error);
  }
);

/**
 * Extracts the contract error body `{ status, error, message, fieldErrors }` (contract 1.1)
 * from an axios error. Returns null for network errors or non-contract bodies.
 */
export function parseApiError(error: unknown): ApiError | null {
  if (!axios.isAxiosError(error) || !error.response) {
    return null;
  }

  const data = error.response.data as Partial<ApiError> | string | undefined;

  if (!data || typeof data !== 'object' || typeof data.message !== 'string') {
    return null;
  }

  const fieldErrors = data.fieldErrors && typeof data.fieldErrors === 'object'
    ? data.fieldErrors
    : undefined;

  return {
    status: typeof data.status === 'number' ? data.status : error.response.status,
    error: typeof data.error === 'string' ? data.error : '',
    message: data.message,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
    path: typeof data.path === 'string' ? data.path : (error.config?.url ?? ''),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

/** HTTP status of a failed request, or null when no response was received. */
export function getApiErrorStatus(error: unknown): number | null {
  if (axios.isAxiosError(error)) {
    return error.response?.status ?? null;
  }

  return null;
}

export function getApiErrorMessage(error: unknown) {
  const apiError = parseApiError(error);

  if (apiError) {
    const fieldMessages = apiError.fieldErrors ? Object.values(apiError.fieldErrors) : [];
    return fieldMessages.length > 0 ? fieldMessages.join(' ') : apiError.message;
  }

  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data === 'string' && error.response.data.trim()) {
      return error.response.data;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Une erreur inattendue est survenue.';
}

/** No response at all (offline, DNS, timeout). */
export function isRecoverableNetworkError(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  return !error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED';
}

/**
 * Errors worth retrying with backoff (contract 9.2): network errors and 5xx
 * (e.g. hosted backend cold start).
 */
export function isRetryableError(error: unknown) {
  if (isRecoverableNetworkError(error)) {
    return true;
  }

  const status = getApiErrorStatus(error);
  return status !== null && status >= 500;
}
