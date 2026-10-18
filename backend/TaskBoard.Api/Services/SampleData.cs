using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

/// <summary>
/// Fills a new workspace with believable projects, cards and two months of history, so the
/// dashboard and analytics have something to show on day one. Only the creator is a member;
/// cards are assigned to them.
/// </summary>
public class SampleData(AppDbContext db)
{
    private static readonly (string Name, string Color)[] Projects =
    [
        ("منصة المدفوعات v2", "#1b8354"), ("تهيئة تطبيق الجوال", "#175cd3"),
        ("مراجعة نظام التصميم", "#6938ef"), ("تطوير البحث", "#e04f16"), ("موقع إطلاق الربع الرابع", "#dd2590"),
    ];

    private static readonly (string Title, string Tag)[] Titles =
    [
        ("توثيق واجهات API", "تطوير"), ("سلسلة رسائل الترحيب", "تسويق"),
        ("تسريع تحميل الصفحة لأقل من ثانيتين", "واجهات"), ("تصميم شاشات الدخول والتسجيل", "تصميم"),
        ("الدخول بمفاتيح المرور", "تطوير"), ("تحديث الموقع التعريفي", "واجهات"),
        ("إعلان إطلاق الربع الرابع", "تسويق"), ("اختبار التوافق مع المتصفحات", "جودة"),
        ("مجموعة الرسومات التوضيحية", "تصميم"), ("حفظ الفلاتر في المشاريع", "واجهات"),
        ("تحديد معدل الطلبات على API", "تطوير"), ("عناصر لوحة التحليلات", "واجهات"),
        ("الإطلاق التدريجي بمفاتيح الميزات", "تطوير"), ("حالات القوائم الفارغة", "تصميم"),
        ("إصلاح اختبار الدفع المتقطع", "جودة"), ("ترتيب نتائج البحث", "تطوير"),
        ("مراجعة إمكانية الوصول", "جودة"), ("نصوص صفحة الأسعار", "تسويق"),
        ("رموز الوضع الليلي", "تصميم"), ("إعادة محاولة الـ Webhooks", "تطوير"),
        ("تصدير فواتير الاستخدام", "تطوير"), ("طلب إذن الإشعارات", "واجهات"),
        ("مقالات مركز المساعدة", "تسويق"), ("تحديث الأيقونات", "تصميم"),
    ];

    public async Task FillAsync(Guid workspaceId, Guid userId)
    {
        var rng = new Random(workspaceId.GetHashCode());
        var columns = await db.Columns.Where(c => c.WorkspaceId == workspaceId).OrderBy(c => c.Position).ToListAsync();
        var projects = Projects.Select(p => new Project { WorkspaceId = workspaceId, Name = p.Name, Color = p.Color }).ToList();
        db.Projects.AddRange(projects);

        var now = DateTime.UtcNow;
        var positions = columns.ToDictionary(c => c.Id, _ => 0);
        var done = columns.First(c => c.Kind == ColumnKind.Done);

        // Open work spread across the board.
        foreach (var (title, tag) in Titles.Take(14))
        {
            var col = columns[rng.Next(columns.Count - 1)]; // not Done
            var created = now.AddDays(-rng.Next(1, 20));
            var task = NewTask(workspaceId, userId, col, title, tag, projects[rng.Next(projects.Count)], created, rng);
            task.Position = positions[col.Id]++;
            task.DueDate = DateOnly.FromDateTime(now.AddDays(rng.Next(-3, 14)));
            BoardOrdering.ApplyLifecycle(task, col.Kind);
            db.Tasks.Add(task);
        }

        // Finished work over the last 60 days, so charts have a shape and a previous period.
        for (var i = 0; i < 70; i++)
        {
            var (title, tag) = Titles[rng.Next(Titles.Length)];
            var completed = now.AddDays(-rng.Next(0, 60)).AddHours(-rng.Next(0, 10));
            var started = completed.AddDays(-rng.NextDouble() * 5 - 0.3);
            var task = NewTask(workspaceId, userId, done, title, tag, projects[rng.Next(projects.Count)], started.AddDays(-rng.Next(0, 4)), rng);
            task.Position = positions[done.Id]++;
            task.StartedAt = started;
            task.CompletedAt = completed;
            task.TrackedMinutes = rng.Next(1, 16) * 30;
            task.DueDate = DateOnly.FromDateTime(completed.AddDays(rng.Next(-2, 5)));
            db.Tasks.Add(task);
            db.Activity.Add(new ActivityEvent
            {
                WorkspaceId = workspaceId, ActorId = userId, TaskId = task.Id, Type = "task.completed",
                Summary = $"أنجز «{title}»", CreatedAt = completed,
            });
        }

        // Keep the Done column short on screen: only the newest ten stay near the top.
        await db.SaveChangesAsync();
        var doneTasks = await db.Tasks.Where(t => t.ColumnId == done.Id).OrderByDescending(t => t.CompletedAt).ToListAsync();
        for (var i = 0; i < doneTasks.Count; i++) doneTasks[i].Position = i;
        await db.SaveChangesAsync();
    }

    private static TaskItem NewTask(Guid ws, Guid user, BoardColumn col, string title, string tag, Project project, DateTime created, Random rng)
    {
        var task = new TaskItem
        {
            WorkspaceId = ws, ColumnId = col.Id, ProjectId = project.Id, Title = title, Tag = tag,
            Priority = (TaskPriority)rng.Next(4), CreatedById = user, CreatedAt = created, UpdatedAt = created,
        };
        task.Assignees.Add(new TaskAssignee { UserId = user });
        var steps = rng.Next(0, 5);
        for (var s = 0; s < steps; s++)
            task.Checklist.Add(new ChecklistItem { Text = $"الخطوة {s + 1}", Done = rng.Next(2) == 0, Position = s });
        return task;
    }
}
