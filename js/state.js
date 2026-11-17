import { sb, must } from './supabase.js';

/**
 * Global app state.
 * state.user        – auth user or null
 * state.profile     – { id, full_name }
 * state.memberships – [{ space_id, role, space: { id, name, kind, teacher_invite_code, grade_scale, currency } }]
 * state.studentRecords – rows from `students` where user_id = me (student role)
 * state.space       – currently selected space object (staff)
 * state.role        – 'owner' | 'admin' | 'teacher' | 'student' | null
 * state.student     – current student record (student role)
 */
export const state = {
  user: null,
  profile: null,
  memberships: [],
  studentRecords: [],
  space: null,
  role: null,
  student: null,
  ready: false,
};

const LS_SPACE = 'kmitlyvo.space';

export function isStaff() { return ['owner', 'admin', 'teacher'].includes(state.role); }
export function isAdmin() { return ['owner', 'admin'].includes(state.role); }
export function isStudent() { return state.role === 'student'; }
export function isSchool() { return state.space?.kind === 'school'; }

export async function loadSession() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  if (!state.user) { resetState(); state.ready = true; return state; }
  await loadContext();
  state.ready = true;
  return state;
}

export async function loadContext() {
  const uid = state.user.id;
  const [profile, members, students] = await Promise.all([
    sb.from('profiles').select('id, full_name').eq('id', uid).maybeSingle(),
    sb.from('space_members').select('space_id, role, spaces(id, name, kind, teacher_invite_code, grade_scale, currency, owner_id)').eq('user_id', uid),
    sb.from('students').select('*, spaces(id, name, kind, grade_scale, currency)').eq('user_id', uid),
  ]);
  state.profile = must(profile) || { id: uid, full_name: state.user.user_metadata?.full_name || '' };
  state.memberships = (must(members) || []).map((m) => ({ space_id: m.space_id, role: m.role, space: m.spaces }));
  state.studentRecords = must(students) || [];

  if (state.memberships.length) {
    const saved = localStorage.getItem(LS_SPACE);
    const m = state.memberships.find((x) => x.space_id === saved) || state.memberships[0];
    state.space = m.space;
    state.role = m.role;
    state.student = null;
  } else if (state.studentRecords.length) {
    state.student = state.studentRecords[0];
    state.space = state.student.spaces;
    state.role = 'student';
  } else {
    state.space = null;
    state.role = null;
  }
}

export function switchSpace(spaceId) {
  const m = state.memberships.find((x) => x.space_id === spaceId);
  if (!m) return;
  try { localStorage.setItem(LS_SPACE, spaceId); } catch { /* ignore */ }
  state.space = m.space;
  state.role = m.role;
}

export function resetState() {
  Object.assign(state, { user: null, profile: null, memberships: [], studentRecords: [], space: null, role: null, student: null });
}

export async function signOut() {
  await sb.auth.signOut();
  resetState();
}
