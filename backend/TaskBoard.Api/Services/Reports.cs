using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

/// <summary>
/// Dashboard and analytics numbers. A workspace holds hundreds or a few thousand cards, so the
/// rows are loaded once and grouped in memory; that keeps the maths the same on every database.
/// </summary>
public class Reports(AppDbContext db)
{
    private record Row(
        Guid Id, Guid ColumnId, Guid? ProjectId, string Title, TaskPriority Priority, DateOnly? DueDate,
        int TrackedMinutes, DateTime CreatedAt, DateTime? StartedAt, DateTime? CompletedAt, List<Guid> Assignees);

    /// <param name="tzMinutes">The viewer's offset from UTC in minutes, so "today" and "this week" are theirs.</param>
    public async Task<DashboardResponse> DashboardAsync(Guid workspaceId, Guid userId, int tzMinutes)
    {
        var offset = TimeSpan.FromMinutes(Math.Clamp(tzMinutes, -840, 840));
        var today = DateOnly.FromDateTime(DateTime.UtcNow + offset);
        var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7)); // Monday
        var rows = await LoadAsync(workspaceId);

        DateOnly Local(DateTime utc) => DateOnly.FromDateTime(utc + offset);
        var open = rows.Where(r => r.CompletedAt == null).ToList();

        var thisWeek = Enumerable.Range(0, 7).Select(i => weekStart.AddDays(i))
            .Select(d => new DayCount(d, rows.Count(r => r.CompletedAt is { } c && Local(c) == d)))
            .ToList();
        var lastWeekTotal = rows.Count(r => r.CompletedAt is { } c && Local(c) >= weekStart.AddDays(-7) && Local(c) < weekStart);

        var projects = await db.Projects.Where(p => p.WorkspaceId == workspaceId).OrderBy(p => p.CreatedAt).ToListAsync();
        var progress = projects.Select(p => new ProjectProgress(p.Id, p.Name, p.Color,
            rows.Count(r => r.ProjectId == p.Id), rows.Count(r => r.ProjectId == p.Id && r.CompletedAt != null))).ToList();

        var mine = open.Where(r => r.Assignees.Contains(userId))
            .OrderBy(r => r.DueDate ?? DateOnly.MaxValue).ThenByDescending(r => r.Priority)
            .Take(8).Select(r => r.Id).ToList();
        var myTasks = await db.Tasks.Where(t => mine.Contains(t.Id)).ToDto().ToListAsync();
        myTasks = myTasks.OrderBy(t => mine.IndexOf(t.Id)).ToList();

        var recent = await db.Activity.Where(a => a.WorkspaceId == workspaceId)
            .OrderByDescending(a => a.CreatedAt).Take(12)
            .Select(a => new ActivityDto(a.Id, a.Type, a.Summary, a.ActorId, a.Actor.DisplayName, a.Actor.AvatarColor, a.TaskId, a.CreatedAt))
            .ToListAsync();

        return new DashboardResponse(
            TotalProjects: projects.Count,
            ActiveTasks: open.Count,
            CompletedThisWeek: thisWeek.Sum(d => d.Count),
            Overdue: open.Count(r => r.DueDate < today),
            DueToday: open.Count(r => r.DueDate == today),
            ThisWeek: thisWeek,
            LastWeekTotal: lastWeekTotal,
            Projects: progress,
            MyTasks: myTasks,
            RecentActivity: recent);
    }

    public async Task<AnalyticsResponse> AnalyticsAsync(Guid workspaceId, int rangeDays, int tzMinutes)
    {
        rangeDays = rangeDays is 7 or 30 or 90 ? rangeDays : 30;
        var offset = TimeSpan.FromMinutes(Math.Clamp(tzMinutes, -840, 840));
        var today = DateOnly.FromDateTime(DateTime.UtcNow + offset);
        var start = today.AddDays(-(rangeDays - 1));
        var prevStart = start.AddDays(-rangeDays);
        DateOnly Local(DateTime utc) => DateOnly.FromDateTime(utc + offset);

        var rows = await LoadAsync(workspaceId);
        var done = rows.Where(r => r.CompletedAt != null).Select(r => (Row: r, Day: Local(r.CompletedAt!.Value))).ToList();
        var current = done.Where(d => d.Day >= start && d.Day <= today).Select(d => d.Row).ToList();
        var previous = done.Where(d => d.Day >= prevStart && d.Day < start).Select(d => d.Row).ToList();

        var days = Enumerable.Range(0, rangeDays).Select(i => start.AddDays(i)).ToList();
        var perDay = done.GroupBy(d => d.Day).ToDictionary(g => g.Key, g => g.Select(x => x.Row).ToList());
        List<Row> On(DateOnly d) => perDay.TryGetValue(d, out var l) ? l : [];

        // Spark lines: one point per bucket, at most 12 buckets across the range.
        var bucket = Math.Max(1, rangeDays / 12);
        var buckets = days.Chunk(bucket).ToList();
        IReadOnlyList<double> Spark(Func<List<Row>, double> f) =>
            buckets.Select(b => f(b.SelectMany(On).ToList())).ToList();

        static double OnTime(List<Row> rs)
        {
            var dated = rs.Where(r => r.DueDate != null).ToList();
            if (dated.Count == 0) return 0;
            return Math.Round(100.0 * dated.Count(r => DateOnly.FromDateTime(r.CompletedAt!.Value) <= r.DueDate) / dated.Count, 1);
        }
        static double Cycle(List<Row> rs) => rs.Count == 0 ? 0 :
            Math.Round(rs.Average(r => (r.CompletedAt!.Value - (r.StartedAt ?? r.CreatedAt)).TotalDays), 1);
        static double Hours(List<Row> rs) => Math.Round(rs.Sum(r => r.TrackedMinutes) / 60.0, 1);

        var throughput = days.Select(d => new ThroughputPoint(d, On(d).Count, On(d.AddDays(-rangeDays)).Count)).ToList();

        var projects = await db.Projects.Where(p => p.WorkspaceId == workspaceId).ToDictionaryAsync(p => p.Id);
        var timeByProject = current.GroupBy(r => r.ProjectId)
            .Select(g => g.Key is { } id && projects.TryGetValue(id, out var p)
                ? new ProjectTime(id, p.Name, p.Color, Hours(g.ToList()))
                : new ProjectTime(null, "بدون مشروع", "#9da4ae", Hours(g.ToList())))
            .Where(p => p.Hours > 0).OrderByDescending(p => p.Hours).ToList();

        // Activity heatmap always covers the last 12 weeks, like a contribution graph.
        var heatStart = today.AddDays(-83);
        var events = await db.Activity.Where(a => a.WorkspaceId == workspaceId && a.CreatedAt >= DateTime.UtcNow.AddDays(-85))
            .Select(a => a.CreatedAt).ToListAsync();
        var eventDays = events.GroupBy(Local).ToDictionary(g => g.Key, g => g.Count());
        var heatmap = Enumerable.Range(0, 84).Select(i => heatStart.AddDays(i))
            .Select(d => new DayCount(d, eventDays.GetValueOrDefault(d))).ToList();

        var userIds = current.SelectMany(r => r.Assignees).Distinct().ToList();
        var people = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        var contributors = userIds.Where(people.ContainsKey).Select(id =>
            {
                var theirs = current.Where(r => r.Assignees.Contains(id)).ToList();
                return new Contributor(id, people[id].DisplayName, people[id].AvatarColor, theirs.Count, Hours(theirs));
            })
            .OrderByDescending(c => c.Completed).Take(6).ToList();

        var columns = await db.Columns.Where(c => c.WorkspaceId == workspaceId).OrderBy(c => c.Position).ToListAsync();
        var byStatus = columns.Select(c => new StatusCount(c.Id, c.Name, c.Kind, rows.Count(r => r.ColumnId == c.Id))).ToList();
        var byPriority = Enum.GetValues<TaskPriority>()
            .Select(p => new PriorityCount(p, rows.Count(r => r.Priority == p && r.CompletedAt == null))).ToList();

        return new AnalyticsResponse(
            rangeDays,
            new Metric(current.Count, previous.Count, Spark(l => l.Count)),
            new Metric(Hours(current), Hours(previous), Spark(Hours)),
            new Metric(OnTime(current), OnTime(previous), Spark(OnTime)),
            new Metric(Cycle(current), Cycle(previous), Spark(Cycle)),
            throughput, timeByProject, heatmap, contributors, byStatus, byPriority);
    }

    public async Task<string> CompletedCsvAsync(Guid workspaceId, int rangeDays)
    {
        rangeDays = rangeDays is 7 or 30 or 90 ? rangeDays : 30;
        var since = DateTime.UtcNow.AddDays(-rangeDays);
        var rows = await db.Tasks.Where(t => t.WorkspaceId == workspaceId && t.CompletedAt != null && t.CompletedAt >= since)
            .Select(t => new
            {
                t.Title, Project = t.Project != null ? t.Project.Name : "", t.Priority, t.Tag, t.DueDate,
                t.CreatedAt, t.CompletedAt, t.TrackedMinutes,
                Assignees = t.Assignees.Select(a => a.User.DisplayName).ToList(),
            })
            .ToListAsync();

        var sb = new StringBuilder("العنوان,المشروع,الأولوية,الوسم,المسؤولون,تاريخ الاستحقاق,تاريخ الإنشاء,تاريخ الإنجاز,الساعات\n");
        foreach (var r in rows.OrderBy(r => r.CompletedAt))
        {
            sb.AppendJoin(',',
                Csv(r.Title), Csv(r.Project), PriorityNames[r.Priority], Csv(r.Tag ?? ""), Csv(string.Join("، ", r.Assignees)),
                r.DueDate?.ToString("yyyy-MM-dd") ?? "",
                r.CreatedAt.ToString("yyyy-MM-dd HH:mm"), r.CompletedAt!.Value.ToString("yyyy-MM-dd HH:mm"),
                (r.TrackedMinutes / 60.0).ToString("0.0", CultureInfo.InvariantCulture));
            sb.Append('\n');
        }
        return sb.ToString();
    }

    private static readonly Dictionary<TaskPriority, string> PriorityNames = new()
    {
        [TaskPriority.Low] = "منخفضة", [TaskPriority.Medium] = "متوسطة",
        [TaskPriority.High] = "عالية", [TaskPriority.Urgent] = "عاجلة",
    };

    /// <summary>Quotes a field, and defuses leading = + - @ so spreadsheets do not run it as a formula.</summary>
    private static string Csv(string value)
    {
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private Task<List<Row>> LoadAsync(Guid workspaceId) =>
        db.Tasks.AsNoTracking().Where(t => t.WorkspaceId == workspaceId)
            .Select(t => new Row(t.Id, t.ColumnId, t.ProjectId, t.Title, t.Priority, t.DueDate, t.TrackedMinutes,
                t.CreatedAt, t.StartedAt, t.CompletedAt, t.Assignees.Select(a => a.UserId).ToList()))
            .ToListAsync();
}
