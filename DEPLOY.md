# دليل النشر: Staging ثم Production

كل بيئة تتكون من ثلاث حاويات Docker، وقاعدة البيانات على خادم Oracle 19c الخاص بالجهة:

```
الإنترنت → Caddy (HTTPS وشهادة مجانية تلقائية) → nginx (الواجهة + تمرير /api) → API (.NET) → Oracle 19c (خارج Docker)
```

البيئتين تستخدمان نفس الملف `deploy/docker-compose.yml`، والفرق بينهم في ملف الإعدادات
(`.env.staging` و `.env.production`).

## 1. وش تحتاج قبل ما تبدأ

| الشي | Staging | Production |
| --- | --- | --- |
| سيرفر Linux (Ubuntu 24.04) | 2 CPU / 2GB RAM يكفي | 2 CPU / 4GB RAM أو أكثر |
| اسم نطاق (Domain) | مثلاً `staging.taskboard.company.com` | مثلاً `taskboard.company.com` |
| منافذ مفتوحة | 80 و 443 (و 22 لـ SSH) | 80 و 443 (و 22 لـ SSH) |
| Oracle 19c | مستخدم (schema) مستقل للـ staging | مستخدم (schema) مستقل للـ production |
| وصول الشبكة | السيرفر يوصل لخادم Oracle على المنفذ 1521 | نفسه |

لازم يكون سيرفر production منفصل عن staging. وإذا ما عندكم إلا سيرفر واحد، شغّلوا البيئتين عليه
بأسماء مشاريع مختلفة (`-p taskboard-staging` و `-p taskboard-production`)، ومع مستخدم Oracle مختلف لكل بيئة.

## 2. تجهيز قاعدة البيانات Oracle 19c (يسويها الـ DBA مرة وحدة)

اطلب من الـ DBA ينشئ مستخدم لكل بيئة. مثال لـ production:

```sql
CREATE USER TASKBOARD IDENTIFIED BY "<كلمة سر قوية>"
  DEFAULT TABLESPACE USERS QUOTA 2G ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE PROCEDURE TO TASKBOARD;
```

ملاحظات:

- قاعدة البيانات لازم تكون بترميز **AL32UTF8** (أو NCHAR بـ AL16UTF16، وهو الافتراضي) عشان النصوص العربية. التطبيق يخزّن النصوص في أعمدة `NVARCHAR2` و `NCLOB`.
- عندك طريقتين لإنشاء الجداول:
  - **تلقائي** (`DB_APPLY_MIGRATIONS=true`): التطبيق ينشئ الجداول ويحدّثها أول ما يشتغل، ويحتاج الصلاحيات اللي فوق.
  - **يدوي عن طريق الـ DBA** (`DB_APPLY_MIGRATIONS=false`): الـ DBA يشغّل `deploy/oracle/schema.sql` قبل كل إصدار. الملف آمن للتشغيل أكثر من مرة لأنه يتخطى اللي انطبق قبل. وفي هالحالة يكفي المستخدم صلاحية `CREATE SESSION` مع صلاحيات القراءة والكتابة على جداوله.
- لو حدّث المطوّرين قاعدة البيانات، يطلّعون الملف من جديد بهالأمر:
  `dotnet ef migrations script --idempotent -p backend/TaskBoard.Api -o deploy/oracle/schema.sql`

## 3. تجهيز السيرفر (مرة وحدة)

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # بعدها اطلع وادخل مرة ثانية

# جدار الحماية
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

# نسخة من المشروع
git clone <رابط المستودع> ~/taskboard
cd ~/taskboard/deploy
```

وجّه سجل DNS من نوع A لاسم النطاق إلى IP السيرفر **قبل** التشغيل، لأن Caddy يطلب الشهادة أول ما يشتغل.

## 4. ملف الإعدادات

```bash
cp .env.example .env.staging          # أو .env.production
nano .env.staging
```

| المتغير | Staging | Production |
| --- | --- | --- |
| `DOMAIN` | `staging.taskboard.company.com` | `taskboard.company.com` |
| `APP_ENV` | `Staging` | `Production` |
| `AUTHENTICATOR_ISSUER` | `TaskBoard (staging)` | `TaskBoard` |
| `ORACLE_CONNECTION` | `User Id=TASKBOARD_STG;Password=…;Data Source=oracle-host:1521/STGPDB` | `User Id=TASKBOARD;Password=…;Data Source=oracle-host:1521/PRODPDB` |
| `DB_APPLY_MIGRATIONS` | `true` | `true` أو `false` حسب سياسة الـ DBA |
| `REGISTRY` | `ghcr.io/<اسم المنظمة>` | نفسه |

اسم الـ issuer المختلف يخلّي حساب staging يظهر منفصل في تطبيق المصادقة على الجوال،
فما تختلط الرموز بين البيئتين.

لا ترفع ملفات `.env.staging` و `.env.production` على git، لأنها موجودة في `.gitignore`.

## 5. النشر

### تلقائياً من GitHub Actions (المفضّل)

الملف `.github/workflows/ci.yml` يمشي بهالترتيب:

1. يشغّل الاختبارات ويبني الواجهة مع كل push.
2. على `master` يبني صور Docker ويرفعها إلى GHCR.
3. ينشر على **staging** ويسوي فحص سريع للتأكد إنه شغّال.
4. يوقف وينتظر موافقة شخص، وبعد الموافقة ينشر على **production**.

جهّز في GitHub (Settings → Environments):

- بيئتين اسمهم `staging` و `production`. فعّل **Required reviewers** على `production`،
  عشان ما ينزل شي على production إلا بعد ما أحد يجرّب staging ويوافق.
- Secrets: `STAGING_HOST`، `PRODUCTION_HOST`، `DEPLOY_USER`، `DEPLOY_SSH_KEY`.
- Variables: `STAGING_DOMAIN`، `PRODUCTION_DOMAIN`.

### يدوياً على السيرفر

```bash
cd ~/taskboard/deploy
./deploy.sh staging <tag>       # ياخذ نسخة احتياطية، يسحب الصور، يشغّل، وينتظر الـ health check
./deploy.sh production <tag>
```

## 6. قائمة الفحص على staging قبل production

- [ ] `https://<staging>/health` يرجّع `Healthy`، يعني الاتصال بـ Oracle شغّال
- [ ] `python3 -I scripts/staging_smoke.py https://<staging>` يطلع كله PASS
- [ ] تسجيل حساب جديد يحوّلك مباشرة لصفحة تفعيل 2FA
- [ ] مسح QR بتطبيق المصادقة وإدخال الرمز يفعّل 2FA ويعرض 10 رموز استرداد
- [ ] تسجيل الخروج ثم الدخول يطلب الرمز بعد كلمة السر
- [ ] الدخول برمز استرداد يشتغل مرة وحدة بس
- [ ] 5 محاولات خاطئة تقفل الحساب 10 دقائق
- [ ] إنشاء مساحة عمل بالبيانات التجريبية، وفتح Dashboard و Analytics
- [ ] سحب كرت بين الأعمدة، وفتح المتصفح الثاني والتأكد إن التغيير يظهر فيه مباشرة
- [ ] دعوة مستخدم ثاني بدور Viewer والتأكد إنه ما يقدر يعدّل
- [ ] تغيير اللون من Settings يغيّر الواجهة كاملة
- [ ] تصدير CSV ينزل الملف ويفتح في Excel

## 7. النسخ الاحتياطي

النسخ الاحتياطي على مسؤولية الـ DBA ضمن نسخ خادم Oracle (RMAN). ولو تبغى نسخة خاصة بهذا الـ schema، فيه سكربت يصدّرها بـ Data Pump إذا كانت أدوات Oracle مثبتة على السيرفر:

```bash
./backup.sh production     # expdp للـ schema إلى DATA_PUMP_DIR
```

## 8. أوامر مفيدة

```bash
docker compose -p taskboard-production --env-file .env.production ps          # حالة الحاويات
docker compose -p taskboard-production --env-file .env.production logs -f api # سجلات الـ API
./deploy.sh production <tag-سابق>                                             # رجوع لنسخة سابقة
```

إذا كان `DB_APPLY_MIGRATIONS=true`، قاعدة البيانات تتحدّث تلقائياً (EF migrations) أول ما يشتغل الـ API.
