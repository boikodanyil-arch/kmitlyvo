import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_URL } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

/** Call the public signup edge function. Returns parsed JSON or throws Error(message). */
export async function callSignup(payload) {
  let res;
  try {
    res = await fetch(`${FUNCTIONS_URL}/auth-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Немає звʼязку з сервером. Перевірте інтернет.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Сталася помилка. Спробуйте ще раз.');
  return data;
}

/** Call an authenticated edge function with the user's session. */
export async function callFunction(name, payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token ?? SUPABASE_KEY}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Сталася помилка. Спробуйте ще раз.');
  return data;
}

/** Unwrap a supabase response: throws a friendly Error on failure, returns data. */
export function must({ data, error }) {
  if (error) {
    console.error(error);
    const msg = error.message || '';
    if (/JWT|session/i.test(msg)) throw new Error('Сесія завершилась. Увійдіть знову.');
    if (/duplicate key.*login/i.test(msg)) throw new Error('Такий логін уже зайнятий. Оберіть інший.');
    if (/row-level security|forbidden|permission/i.test(msg)) throw new Error('Недостатньо прав для цієї дії.');
    if (/Failed to fetch|NetworkError/i.test(msg)) throw new Error('Немає звʼязку з сервером. Перевірте інтернет.');
    throw new Error('Не вдалося виконати дію. Спробуйте ще раз.');
  }
  return data;
}
