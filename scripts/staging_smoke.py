"""End-to-end check against a running stack: python3 -I scripts/staging_smoke.py http://localhost:8088"""
import http.cookiejar, json, secrets, subprocess, sys, urllib.request, os
base = sys.argv[1].rstrip("/")
here = os.path.dirname(os.path.abspath(__file__))

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(op, method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Requested-With": "taskboard"})
    try:
        with op.open(req) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw and r.headers.get_content_type() == "application/json" else raw)
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def code(key, offset=0):
    return subprocess.check_output([sys.executable, "-I", os.path.join(here, "totp.py"), key, str(offset)], text=True).strip()

def check(label, ok):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok: sys.exit(1)

a = client()
email, pw = f"smoke-{secrets.token_hex(4)}@taskboard.test", "smoke-" + secrets.token_urlsafe(12)
s, me = call(a, "POST", "/api/auth/register", {"email": email, "password": pw, "displayName": "Smoke Test"})
check("register", s == 200 and not me["sessionVerified"])
check("blocked before 2FA", call(a, "GET", "/api/workspaces")[0] == 403)
s, setup = call(a, "POST", "/api/auth/2fa/setup")
key = setup["sharedKey"]
s, rc = call(a, "POST", "/api/auth/2fa/enable", {"code": code(key)})
check("enable 2FA, 10 recovery codes", s == 200 and len(rc["recoveryCodes"]) == 10)

b = client()
s, r = call(b, "POST", "/api/auth/login", {"email": email, "password": pw})
check("password alone asks for code", s == 200 and r["requiresTwoFactor"])
check("wrong code rejected", call(b, "POST", "/api/auth/login/2fa", {"code": "000000"})[0] == 400)
s, r = call(b, "POST", "/api/auth/login/2fa", {"code": code(key)})
check("right code signs in", s == 200 and r["user"]["sessionVerified"])

s, ws = call(b, "POST", "/api/workspaces", {"name": "Smoke", "withSampleData": True})
check("workspace with sample data", s == 201 and len(ws["columns"]) == 4)
s, tasks = call(b, "GET", f"/api/workspaces/{ws['id']}/tasks")
todo = [t for t in tasks if t["columnId"] == ws["columns"][0]["id"]]
done_col = ws["columns"][3]["id"]
s, moved = call(b, "POST", f"/api/tasks/{todo[0]['id']}/move", {"columnId": done_col, "index": 0})
check("move card to Done marks it complete", s == 200 and any(t["id"] == todo[0]["id"] and t["completedAt"] for t in moved))
s, dash = call(b, "GET", f"/api/workspaces/{ws['id']}/dashboard?tz=180")
check("dashboard", s == 200 and dash["totalProjects"] == 5)
s, an = call(b, "GET", f"/api/workspaces/{ws['id']}/analytics?range=30&tz=180")
check("analytics", s == 200 and an["tasksCompleted"]["value"] > 0 and len(an["heatmap"]) == 84)
s, csv = call(b, "GET", f"/api/workspaces/{ws['id']}/analytics/export?range=30")
check("csv export", s == 200 and "العنوان,المشروع".encode() in csv)

tid = todo[1]["id"]
s, t = call(b, "PATCH", f"/api/tasks/{tid}", {"description": "", "dueDate": "2026-12-31", "priority": "Urgent", "trackedMinutes": 90})
check("edit card with empty description and a due date", s == 200 and t["description"] == "" and t["dueDate"] == "2026-12-31")
long_text = ("وصف " * 1500).strip()
s, t = call(b, "PATCH", f"/api/tasks/{tid}", {"description": long_text, "clearDueDate": True})
check("long Arabic description round-trips", s == 200 and t["description"] == long_text and t["dueDate"] is None)
s, item = call(b, "POST", f"/api/tasks/{tid}/checklist", {"text": "بند"})
s2, _ = call(b, "PATCH", f"/api/tasks/{tid}/checklist/{item['id']}", {"done": True})
s3, cm = call(b, "POST", f"/api/tasks/{tid}/comments", {"body": "تعليق طويل " * 300})
s4, detail = call(b, "GET", f"/api/tasks/{tid}")
check("checklist and long comment", s3 == 200 and any(i["id"] == item["id"] and i["done"] for i in detail["checklist"]) and any(len(c["body"]) > 2000 for c in detail["comments"]))
s, col = call(b, "POST", f"/api/workspaces/{ws['id']}/columns", {"name": "اختبار", "kind": "Review"})
check("add and delete a column", s == 200 and call(b, "DELETE", f"/api/workspaces/{ws['id']}/columns/{col['id']}")[0] == 204)

c = client()
c_email = f"x{secrets.token_hex(3)}@taskboard.test"
call(c, "POST", "/api/auth/register", {"email": c_email, "password": pw, "displayName": "Outsider"})
s, k2 = call(c, "POST", "/api/auth/2fa/setup"); call(c, "POST", "/api/auth/2fa/enable", {"code": code(k2["sharedKey"])})
check("outsider gets 404 on someone else's workspace", call(c, "GET", f"/api/workspaces/{ws['id']}")[0] == 404)
s, inv = call(b, "POST", f"/api/workspaces/{ws['id']}/invitations", {"email": c_email, "role": "Viewer"})
check("invite and accept", s == 200 and call(c, "POST", f"/api/invitations/{inv['token']}/accept")[0] == 200)
check("viewer cannot add cards", call(c, "POST", f"/api/workspaces/{ws['id']}/tasks", {"title": "x"})[0] == 403)
check("logout", call(b, "POST", "/api/auth/logout")[0] == 204 and call(b, "GET", "/api/auth/me")[0] == 401)
print("ALL PASS")
