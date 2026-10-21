import { api, LOGIN_PATH } from './client';
import type { LoginResponse } from '../types/api';

interface LoginRequest {
  email: string;
  password: string;
}

export async function login(request: LoginRequest) {
  const { data } = await api.post<LoginResponse>(LOGIN_PATH, request);
  return data;
}