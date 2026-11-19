// Shared data access layer. Every function throws a friendly Error on failure (via must()).
import { sb, must } from './supabase.js';
import { state } from './state.js';
import { BUCKET, MAX_FILE_MB } from './config.js';
import { fileSafeName } from './utils.js';

const me = () => state.user?.id;
const spaceId = () => state.space?.id;

// ---------------- students ----------------
/** Students visible to the current staff member in the current space. opts: { teacherId, includeArchived } */
export async function listStudents({ teacherId = null, includeArchived = false } = {}) {
  let q = sb.from('students').select('*, teacher:profiles!students_teacher_id_fkey(id, full_name)').eq('space_id', spaceId()).order('full_name');
  if (teacherId) q = q.eq('teacher_id', teacherId);
  if (!includeArchived) q = q.neq('status', 'archived');
  return must(await q);
}
export async function getStudent(id) {
  return must(await sb.from('students').select('*, teacher:profiles!students_teacher_id_fkey(id, full_name)').eq('id', id).maybeSingle());
}
export async function createStudent(fields) {
  return must(await sb.from('students').insert({ space_id: spaceId(), teacher_id: fields.teacher_id || me(), ...fields }).select().single());
}
export async function updateStudent(id, patch) {
  return must(await sb.from('students').update(patch).eq('id', id).select().single());
}
export async function deleteStudent(id) { return must(await sb.from('students').delete().eq('id', id)); }
export async function getStudentNote(id) {
  const row = must(await sb.from('student_notes').select('body').eq('student_id', id).maybeSingle());
  return row?.body ?? '';
}
export async function saveStudentNote(id, body) {
  return must(await sb.from('student_notes').upsert({ student_id: id, body, updated_at: new Date().toISOString() }));
}
export async function regenerateActivationCode(studentId) {
  return must(await sb.rpc('regenerate_activation_code', { p_student: studentId }));
}

// ---------------- lessons ----------------
/** Lessons in [fromIso, toIso). opts: { studentId, teacherId } */
export async function listLessons(fromIso, toIso, { studentId = null, teacherId = null } = {}) {
  let q = sb.from('lessons').select('*, student:students(id, full_name, cefr_level, meeting_url)')
    .gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at');
  if (state.role !== 'student') q = q.eq('space_id', spaceId());
  if (studentId) q = q.eq('student_id', studentId);
  if (teacherId) q = q.eq('teacher_id', teacherId);
  return must(await q);
}
export async function listStudentLessons(studentId, { limit = 50, ascending = false } = {}) {
  return must(await sb.from('lessons').select('*').eq('student_id', studentId).order('starts_at', { ascending }).limit(limit));
}
export async function getLesson(id) {
  return must(await sb.from('lessons').select('*, student:students(id, full_name, cefr_level, meeting_url, next_topic, teacher_id)').eq('id', id).maybeSingle());
}
/** rows: [{ student_id, starts_at, duration_min, topic, meeting_url, series_id }] */
export async function createLessons(rows) {
  const full = rows.map((r) => ({ space_id: spaceId(), teacher_id: r.teacher_id || me(), status: 'scheduled', ...r }));
  return must(await sb.from('lessons').insert(full).select());
}
export async function updateLesson(id, patch) { return must(await sb.from('lessons').update(patch).eq('id', id).select().single()); }
export async function deleteLesson(id) { return must(await sb.from('lessons').delete().eq('id', id)); }
export async function deleteSeriesFrom(seriesId, fromIso) {
  return must(await sb.from('lessons').delete().eq('series_id', seriesId).gte('starts_at', fromIso).eq('status', 'scheduled'));
}
export async function getLessonNote(id) {
  const row = must(await sb.from('lesson_private_notes').select('body').eq('lesson_id', id).maybeSingle());
  return row?.body ?? '';
}
export async function saveLessonNote(id, body) {
  return must(await sb.from('lesson_private_notes').upsert({ lesson_id: id, body, updated_at: new Date().toISOString() }));
}

// ---------------- assignments ----------------
export async function listAssignments() {
  return must(await sb.from('assignments')
    .select('*, targets:assignment_targets(id, status, student_id, due_at, score)')
    .eq('space_id', spaceId()).order('created_at', { ascending: false }));
}
export async function getAssignment(id) {
  return must(await sb.from('assignments').select('*').eq('id', id).maybeSingle());
}
/** Staff: questions with keys. Student: questions only. */
export async function getQuiz(assignmentId, { withKeys = false } = {}) {
  const qs = must(await sb.from('quiz_questions').select('*').eq('assignment_id', assignmentId).order('position'));
  if (!withKeys || !qs.length) return qs;
  const keys = must(await sb.from('quiz_keys').select('*').in('question_id', qs.map((q) => q.id)));
  const byId = Object.fromEntries(keys.map((k) => [k.question_id, k.answer]));
  return qs.map((q) => ({ ...q, answer: byId[q.id] }));
}
/**
 * Create assignment with optional quiz and targets.
 * a: { title, instructions, kind, link_url, attachments, lesson_id }
 * questions: [{ qtype:'single'|'gap', prompt, options:[], answer }]  (answer: index for single, array of strings for gap)
 * targets: [{ student_id, due_at }]
 */
export async function createAssignment(a, questions = [], targets = []) {
  const row = must(await sb.from('assignments').insert({ space_id: spaceId(), teacher_id: me(), ...a }).select().single());
  await saveQuiz(row.id, questions);
  if (targets.length) await addTargets(row.id, targets);
  return row;
}
export async function updateAssignment(id, patch) { return must(await sb.from('assignments').update(patch).eq('id', id).select().single()); }
export async function deleteAssignment(id) { return must(await sb.from('assignments').delete().eq('id', id)); }
export async function saveQuiz(assignmentId, questions) {
  if (!questions?.length) return;
  must(await sb.from('quiz_questions').delete().eq('assignment_id', assignmentId));
  const rows = questions.map((q, i) => ({ assignment_id: assignmentId, position: i + 1, qtype: q.qtype, prompt: q.prompt, options: q.qtype === 'single' ? q.options : [] }));
  const inserted = must(await sb.from('quiz_questions').insert(rows).select());
  const keys = inserted.map((row) => {
    const q = questions[row.position - 1];
    return { question_id: row.id, answer: q.qtype === 'single' ? Number(q.answer) : q.answer };
  });
  must(await sb.from('quiz_keys').insert(keys));
}
export async function addTargets(assignmentId, targets) {
  const rows = targets.map((t) => ({ assignment_id: assignmentId, space_id: spaceId(), student_id: t.student_id, due_at: t.due_at || null }));
  return must(await sb.from('assignment_targets').upsert(rows, { onConflict: 'assignment_id,student_id', ignoreDuplicates: true }).select());
}

// ---------------- targets / review ----------------
const TARGET_SELECT = '*, assignment:assignments(id, title, kind, instructions, link_url, attachments, teacher_id, created_at, textbook_id, page_from, page_to), student:students(id, full_name, cefr_level, teacher_id)';
/** Staff: targets in the space. opts: { status: string|array, studentId, teacherId } */
export async function listTargets({ status = null, studentId = null, teacherId = null, limit = 500 } = {}) {
  let q = sb.from('assignment_targets').select(TARGET_SELECT).order('due_at', { ascending: true, nullsFirst: false }).limit(limit);
  if (state.role !== 'student') q = q.eq('space_id', spaceId());
  if (status) q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
  if (studentId) q = q.eq('student_id', studentId);
  let rows = must(await q);
  if (teacherId) rows = rows.filter((r) => r.student?.teacher_id === teacherId);
  return rows;
}
export async function getTarget(id) {
  return must(await sb.from('assignment_targets').select(TARGET_SELECT).eq('id', id).maybeSingle());
}
export async function listSubmissions(targetId) {
  return must(await sb.from('submissions').select('*').eq('target_id', targetId).order('attempt_no', { ascending: false }));
}
/** Staff grades or returns a target. action: 'grade' | 'return' */
export async function reviewTarget(id, { action, score = null, feedback = '', emoji = null }) {
  const patch = action === 'grade'
    ? { status: 'graded', score, feedback, graded_at: new Date().toISOString() }
    : { status: 'returned', feedback };
  if (emoji != null) patch.feedback_emoji = emoji;
  return must(await sb.from('assignment_targets').update(patch).eq('id', id).select().single());
}
export async function deleteTarget(id) { return must(await sb.from('assignment_targets').delete().eq('id', id)); }
/** Student submits. files: [{ path, name, type, size }] ; quiz: { [questionId]: answer } */
export async function submitAssignment(targetId, { text = '', files = [], quiz = null } = {}) {
  return must(await sb.rpc('submit_assignment', { p_target: targetId, p_text: text, p_files: files, p_quiz: quiz }));
}

// ---------------- payments ----------------
export async function listPayments({ studentId = null } = {}) {
  let q = sb.from('payments').select('*, student:students(id, full_name, teacher_id)').order('paid_on', { ascending: false });
  if (state.role !== 'student') q = q.eq('space_id', spaceId());
  if (studentId) q = q.eq('student_id', studentId);
  return must(await q);
}
export async function addPayment(p) {
  return must(await sb.from('payments').insert({ space_id: spaceId(), created_by: me(), ...p }).select().single());
}
export async function deletePayment(id) { return must(await sb.from('payments').delete().eq('id', id)); }
/**
 * Balance per student = lessons paid − lessons charged (done or no_show).
 * Returns Map(studentId → { paid, used, balance, amount })
 */
export async function balances(studentIds = null) {
  let pq = sb.from('payments').select('student_id, lessons_count, amount');
  let lq = sb.from('lessons').select('student_id, status').in('status', ['done', 'no_show']);
  if (state.role !== 'student') { pq = pq.eq('space_id', spaceId()); lq = lq.eq('space_id', spaceId()); }
  if (studentIds) { pq = pq.in('student_id', studentIds); lq = lq.in('student_id', studentIds); }
  const [pays, less] = await Promise.all([pq, lq]);
  const map = new Map();
  const get = (id) => { if (!map.has(id)) map.set(id, { paid: 0, used: 0, balance: 0, amount: 0 }); return map.get(id); };
  must(pays).forEach((p) => { const b = get(p.student_id); b.paid += p.lessons_count; b.amount += Number(p.amount); });
  must(less).forEach((l) => { get(l.student_id).used += 1; });
  map.forEach((b) => { b.balance = b.paid - b.used; });
  return map;
}

// ---------------- school ----------------
export async function listMembers() {
  return must(await sb.from('space_members').select('*, profile:profiles(id, full_name)').eq('space_id', spaceId()).order('created_at'));
}
export async function updateMemberRole(userId, role) {
  return must(await sb.from('space_members').update({ role }).eq('space_id', spaceId()).eq('user_id', userId));
}
export async function removeMember(userId) {
  return must(await sb.from('space_members').delete().eq('space_id', spaceId()).eq('user_id', userId));
}
export async function regenerateTeacherCode() { return must(await sb.rpc('regenerate_teacher_code', { p_space: spaceId() })); }
export async function updateSpace(patch) { return must(await sb.from('spaces').update(patch).eq('id', spaceId()).select().single()); }

// ---------------- demo ----------------
export async function seedDemo() { return must(await sb.rpc('seed_demo', { p_space: spaceId() })); }
export async function clearDemo() {
  must(await sb.from('students').delete().eq('space_id', spaceId()).eq('is_demo', true));
  must(await sb.from('assignments').delete().eq('space_id', spaceId()).eq('is_demo', true));
}

// ---------------- profile ----------------
export async function updateProfile(patch) {
  return must(await sb.from('profiles').update(patch).eq('id', me()).select().single());
}

// ---------------- feedback ----------------
export async function sendFeedback(message, page) {
  return must(await sb.from('feedback').insert({ user_id: me(), space_id: spaceId() || null, message, page, user_agent: navigator.userAgent.slice(0, 300) }));
}

// ---------------- files ----------------
/** Upload a File. kind 'a' (assignment attachment, ownerId=assignmentId) or 's' (submission, ownerId=studentId). */
export async function uploadFile(file, kind, ownerId, spaceIdOverride = null) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Файл «${file.name}» більший за ${MAX_FILE_MB} МБ.`);
  const path = `${kind}/${spaceIdOverride || spaceId()}/${ownerId}/${fileSafeName(file.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) {
    console.error(error);
    if (/mime|type/i.test(error.message)) throw new Error(`Тип файлу «${file.name}» не підтримується.`);
    throw new Error(`Не вдалося завантажити «${file.name}».`);
  }
  return { path, name: file.name, type: file.type, size: file.size };
}
export async function signedUrl(path, expires = 3600) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expires);
  if (error) { console.error(error); return ''; }
  return data.signedUrl;
}
/** Compress large photos in the browser before upload (keeps PDFs etc. untouched). */
export async function compressImage(file, maxSide = 1800, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
