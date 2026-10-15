import axios from 'axios';
import { Platform } from 'react-native';

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

export function getApiErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseData = error.response?.data as {
      message?: string;
      error?: string;
      path?: string;
    } | undefined;

    if (status === 403 && responseData?.path === '/api/auth/login') {
      return 'Connexion refusee. Verifie email/mot de passe ou le role DRIVER.';
    }

    const responseMessage = typeof error.response?.data === 'string'
      ? error.response.data
      : responseData?.message ?? responseData?.error;

    return responseMessage ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Une erreur inattendue est survenue.';
}

export function isRecoverableNetworkError(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  return !error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED';
}