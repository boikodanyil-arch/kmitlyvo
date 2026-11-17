import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const STUDENT_DOMAIN = "uchen.kmitlyvo.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(message: string, status = 400) { return json({ error: message }, status); }
const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => a[b % a.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Метод не підтримується", 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Некоректний запит"); }
  const action = clean(body.action, 40);

  try {
    // ---------- lookup (preview a code before signup) ----------
    if (action === "lookup") {
      const type = clean(body.type, 20);
      const code = clean(body.code, 20).toUpperCase();
      if (!code) return fail("Введіть код");
      if (type === "school") {
        const { data } = await admin.from("spaces").select("name").eq("teacher_invite_code", code).eq("kind", "school").maybeSingle();
        if (!data) return fail("Код школи не знайдено", 404);
        return json({ name: data.name });
      }
      if (type === "student") {
        const { data } = await admin.from("students").select("full_name, login, user_id, spaces(name)").eq("activation_code", code).maybeSingle();
        if (!data || data.user_id) return fail("Код запрошення не знайдено або вже використано", 404);
        // deno-lint-ignore no-explicit-any
        return json({ full_name: data.full_name, login: data.login, space: (data as any).spaces?.name ?? "" });
      }
      if (type === "beta") {
        const { data } = await admin.from("beta_codes").select("max_uses, used_count").eq("code", code).maybeSingle();
        if (!data || data.used_count >= data.max_uses) return fail("Код доступу недійсний", 404);
        return json({ ok: true });
      }
      return fail("Невідомий тип коду");
    }

    // ---------- teacher resets a student's password (requires caller session) ----------
    if (action === "reset_student_password") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: caller } = await admin.auth.getUser(token);
      if (!caller?.user) return fail("Увійдіть знову", 401);
      const studentId = clean(body.student_id, 60);
      const { data: st } = await admin.from("students").select("id, space_id, teacher_id, user_id, login").eq("id", studentId).maybeSingle();
      if (!st) return fail("Учня не знайдено", 404);
      let allowed = st.teacher_id === caller.user.id;
      if (!allowed) {
        const { data: m } = await admin.from("space_members").select("role").eq("space_id", st.space_id).eq("user_id", caller.user.id).maybeSingle();
        allowed = !!m && ["owner", "admin"].includes(m.role);
      }
      if (!allowed) return fail("Недостатньо прав", 403);
      if (!st.user_id) return fail("Учень ще не активував акаунт");
      const pwd = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(st.user_id, { password: pwd });
      if (error) return fail("Не вдалося змінити пароль");
      return json({ ok: true, login: st.login, password: pwd });
    }

    // ---------- already-registered teacher joins a school (requires caller session) ----------
    if (action === "join_school_existing") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: caller } = await admin.auth.getUser(token);
      if (!caller?.user) return fail("Увійдіть знову", 401);
      const code = clean(body.school_code, 20).toUpperCase();
      const { data: space } = await admin.from("spaces").select("id, name").eq("teacher_invite_code", code).eq("kind", "school").maybeSingle();
      if (!space) return fail("Код школи не знайдено");
      // учні не можуть стати вчителями цим шляхом
      const { data: asStudent } = await admin.from("students").select("id").eq("user_id", caller.user.id).limit(1);
      if (asStudent && asStudent.length) return fail("Цей акаунт належить учню. Використайте інший email.", 403);
      const { data: existing } = await admin.from("space_members").select("role").eq("space_id", space.id).eq("user_id", caller.user.id).maybeSingle();
      if (existing) return json({ ok: true, already: true, name: space.name });
      const { error } = await admin.from("space_members").insert({ space_id: space.id, user_id: caller.user.id, role: "teacher" });
      if (error) return fail("Не вдалося приєднатися. Спробуйте ще раз.");
      return json({ ok: true, name: space.name, space_id: space.id });
    }

    const password = String(body.password ?? "");
    if (password.length < 8) return fail("Пароль має містити щонайменше 8 символів");

    // ---------- owner creates a school or tutor space ----------
    if (action === "create_space") {
      const kind = clean(body.kind, 10);
      const spaceName = clean(body.space_name, 80);
      const fullName = clean(body.full_name, 80);
      const email = clean(body.email, 120).toLowerCase();
      const code = clean(body.beta_code, 30).toUpperCase();
      if (!["school", "tutor"].includes(kind)) return fail("Оберіть: школа чи репетитор");
      if (!fullName) return fail("Вкажіть імʼя");
      if (!emailOk(email)) return fail("Вкажіть коректний email");
      const { data: claimed, error: claimErr } = await admin.rpc("claim_beta_code", { p_code: code });
      if (claimErr || !claimed) return fail("Код доступу до бета-версії недійсний або вичерпаний");

      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
      if (error || !created.user) {
        await admin.rpc("release_beta_code", { p_code: code });
        const exists = (error?.message ?? "").toLowerCase().includes("already");
        return fail(exists ? "Акаунт з таким email вже існує. Увійдіть." : "Не вдалося створити акаунт");
      }
      const uid = created.user.id;
      await admin.from("profiles").insert({ id: uid, full_name: fullName });
      const { data: space, error: sErr } = await admin.from("spaces")
        .insert({ name: spaceName || (kind === "tutor" ? fullName : "Моя школа"), kind, owner_id: uid })
        .select("id").single();
      if (sErr || !space) { await admin.auth.admin.deleteUser(uid); await admin.rpc("release_beta_code", { p_code: code }); return fail("Не вдалося створити простір"); }
      await admin.from("space_members").insert({ space_id: space.id, user_id: uid, role: "owner" });
      return json({ ok: true, email });
    }

    // ---------- teacher joins a school ----------
    if (action === "join_school") {
      const fullName = clean(body.full_name, 80);
      const email = clean(body.email, 120).toLowerCase();
      const code = clean(body.school_code, 20).toUpperCase();
      if (!fullName) return fail("Вкажіть імʼя");
      if (!emailOk(email)) return fail("Вкажіть коректний email");
      const { data: space } = await admin.from("spaces").select("id").eq("teacher_invite_code", code).eq("kind", "school").maybeSingle();
      if (!space) return fail("Код школи не знайдено");
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
      if (error || !created.user) {
        const exists = (error?.message ?? "").toLowerCase().includes("already");
        return fail(exists ? "Акаунт з таким email вже існує. Увійдіть." : "Не вдалося створити акаунт");
      }
      const uid = created.user.id;
      await admin.from("profiles").insert({ id: uid, full_name: fullName });
      await admin.from("space_members").insert({ space_id: space.id, user_id: uid, role: "teacher" });
      return json({ ok: true, email });
    }

    // ---------- student activates personal invite ----------
    if (action === "activate_student") {
      const code = clean(body.activation_code, 20).toUpperCase();
      const { data: st } = await admin.from("students").select("id, full_name, login, user_id").eq("activation_code", code).maybeSingle();
      if (!st || st.user_id) return fail("Код запрошення не знайдено або вже використано");
      const email = `${st.login}@${STUDENT_DOMAIN}`;
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: st.full_name, student: true } });
      if (error || !created.user) return fail("Не вдалося активувати акаунт. Попросіть вчителя оновити код.");
      const uid = created.user.id;
      await admin.from("profiles").insert({ id: uid, full_name: st.full_name });
      const { error: uErr } = await admin.from("students").update({ user_id: uid, activation_code: null }).eq("id", st.id).is("user_id", null);
      if (uErr) { await admin.auth.admin.deleteUser(uid); return fail("Не вдалося активувати акаунт"); }
      return json({ ok: true, login: st.login, email });
    }

    return fail("Невідома дія");
  } catch (_e) {
    return fail("Сталася помилка сервера. Спробуйте ще раз.", 500);
  }
});
