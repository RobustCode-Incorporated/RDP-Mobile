import axios from 'axios';
import { Platform } from 'react-native';

const defaultBaseUrl = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://127.0.0.1:8080',
  default: 'http://localhost:8080',
});

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL ?? defaultBaseUrl;

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
    const responseMessage = typeof error.response?.data === 'string'
      ? error.response.data
      : (error.response?.data as { message?: string } | undefined)?.message;

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