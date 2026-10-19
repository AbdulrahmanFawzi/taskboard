using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TaskBoard.Api.Data;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Domain;

namespace TaskBoard.Tests;

public class BoardTests(TestApp app) : IClassFixture<TestApp>
{
    private async Task<(User Owner, WorkspaceDetail Ws)> NewWorkspace(bool sample = false)
    {
        var owner = await app.NewClient().SignUpAsync();
        var ws = await owner.PostOk<WorkspaceDetail>("/api/workspaces", new { name = "Fernly", withSampleData = sample });
        return (owner, ws);
    }

    [Fact]
    public async Task New_workspace_has_the_four_default_columns()
    {
        var (_, ws) = await NewWorkspace();
        Assert.Equal(["قائمة المهام", "قيد التنفيذ", "قيد المراجعة", "مكتملة"], ws.Columns.Select(c => c.Name));
        Assert.Equal(WorkspaceRole.Owner, ws.MyRole);
    }

    [Fact]
    public async Task Moving_cards_keeps_positions_contiguous_and_tracks_completion()
    {
        var (owner, ws) = await NewWorkspace();
        var todo = ws.Columns[0].Id;
        var done = ws.Columns[3].Id;
        var a = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "A" });
        var b = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "B" });
        var c = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "C" });
        Assert.Equal([0, 1, 2], new[] { a.Position, b.Position, c.Position });

        // Reorder inside a column: C to the top.
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{c.Id}/move", new { columnId = todo, index = 0 });
        var tasks = await owner.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks");
        Assert.Equal(["C", "A", "B"], tasks.Where(t => t.ColumnId == todo).OrderBy(t => t.Position).Select(t => t.Title));

        // Across columns: A to Done is a completion, and To do closes the gap.
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{a.Id}/move", new { columnId = done, index = 0 });
        tasks = await owner.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks");
        Assert.Equal([0, 1], tasks.Where(t => t.ColumnId == todo).OrderBy(t => t.Position).Select(t => t.Position));
        Assert.NotNull(tasks.Single(t => t.Id == a.Id).CompletedAt);

        // Back out of Done reopens it.
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{a.Id}/move", new { columnId = todo, index = 99 });
        tasks = await owner.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks");
        var reopened = tasks.Single(t => t.Id == a.Id);
        Assert.Null(reopened.CompletedAt);
        Assert.Equal(2, reopened.Position);
    }

    [Fact]
    public async Task Cards_carry_checklist_comments_and_assignees()
    {
        var (owner, ws) = await NewWorkspace();
        var task = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks",
            new { title = "Ship it", priority = "Urgent", assigneeIds = new[] { owner.Id, Guid.NewGuid() } });
        Assert.Equal([owner.Id], task.AssigneeIds); // strangers are dropped

        var item = await owner.PostOk<ChecklistItemDto>($"/api/tasks/{task.Id}/checklist", new { text = "Write tests" });
        await owner.PatchOk<ChecklistItemDto>($"/api/tasks/{task.Id}/checklist/{item.Id}", new { done = true });
        await owner.PostOk<CommentDto>($"/api/tasks/{task.Id}/comments", new { body = "Looks good" });

        var detail = await owner.GetOk<TaskDetailDto>($"/api/tasks/{task.Id}");
        Assert.Equal(1, detail.Task.ChecklistDone);
        Assert.Equal(1, detail.Task.CommentCount);
        Assert.Equal(TaskPriority.Urgent, detail.Task.Priority);

        var updated = await owner.PatchOk<TaskDto>($"/api/tasks/{task.Id}", new { title = "Ship it now", clearDueDate = true, assigneeIds = Array.Empty<Guid>() });
        Assert.Equal("Ship it now", updated.Title);
        Assert.Empty(updated.AssigneeIds);
    }

    [Fact]
    public async Task Outsiders_cannot_see_or_touch_a_workspace()
    {
        var (owner, ws) = await NewWorkspace();
        var task = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Secret" });
        var stranger = await app.NewClient().SignUpAsync();

        User.Status(HttpStatusCode.NotFound, await stranger.Http.GetAsync($"/api/workspaces/{ws.Id}"));
        User.Status(HttpStatusCode.NotFound, await stranger.Http.GetAsync($"/api/workspaces/{ws.Id}/tasks"));
        User.Status(HttpStatusCode.NotFound, await stranger.Http.GetAsync($"/api/tasks/{task.Id}"));
        User.Status(HttpStatusCode.NotFound, await stranger.Patch($"/api/tasks/{task.Id}", new { title = "Mine now" }));
        User.Status(HttpStatusCode.NotFound, await stranger.Post($"/api/tasks/{task.Id}/move", new { columnId = ws.Columns[1].Id, index = 0 }));
        Assert.Empty(await stranger.GetOk<List<WorkspaceSummary>>("/api/workspaces"));
    }

    [Fact]
    public async Task Invitations_enforce_email_and_roles()
    {
        var (owner, ws) = await NewWorkspace();
        var viewer = await app.NewClient().SignUpAsync();
        var member = await app.NewClient().SignUpAsync();

        var inviteViewer = await owner.PostOk<InvitationDto>($"/api/workspaces/{ws.Id}/invitations", new { email = viewer.Email, role = "Viewer" });
        // Someone else cannot use an invitation meant for another email.
        User.Status(HttpStatusCode.Forbidden, await member.Post($"/api/invitations/{inviteViewer.Token}/accept", new { }));
        await viewer.PostOk<WorkspaceSummary>($"/api/invitations/{inviteViewer.Token}/accept", new { });
        // Opening the link again just takes the member back in, at their current role.
        var again = await viewer.PostOk<WorkspaceSummary>($"/api/invitations/{inviteViewer.Token}/accept", new { });
        Assert.Equal(WorkspaceRole.Viewer, again.Role);

        // Viewers read but cannot write.
        User.Status(HttpStatusCode.OK, await viewer.Http.GetAsync($"/api/workspaces/{ws.Id}/tasks"));
        User.Status(HttpStatusCode.Forbidden, await viewer.Post($"/api/workspaces/{ws.Id}/tasks", new { title = "Nope" }));

        var inviteMember = await owner.PostOk<InvitationDto>($"/api/workspaces/{ws.Id}/invitations", new { email = member.Email, role = "Member" });
        await member.PostOk<WorkspaceSummary>($"/api/invitations/{inviteMember.Token}/accept", new { });
        User.Status(HttpStatusCode.OK, await member.Post($"/api/workspaces/{ws.Id}/tasks", new { title = "Yes" }));
        // Members cannot manage the board or people.
        User.Status(HttpStatusCode.Forbidden, await member.Post($"/api/workspaces/{ws.Id}/columns", new { name = "QA" }));
        User.Status(HttpStatusCode.Forbidden, await member.Patch($"/api/workspaces/{ws.Id}/members/{viewer.Id}", new { role = "Member" }));

        // An admin manages members but cannot mint other admins.
        User.Status(HttpStatusCode.NoContent, await owner.Patch($"/api/workspaces/{ws.Id}/members/{member.Id}", new { role = "Admin" }));
        User.Status(HttpStatusCode.Forbidden, await member.Patch($"/api/workspaces/{ws.Id}/members/{viewer.Id}", new { role = "Admin" }));
        User.Status(HttpStatusCode.NoContent, await member.Patch($"/api/workspaces/{ws.Id}/members/{viewer.Id}", new { role = "Member" }));
        User.Status(HttpStatusCode.Forbidden, await member.Http.DeleteAsync($"/api/workspaces/{ws.Id}/members/{owner.Id}"));

        // Once removed, the old link does not let them back in.
        User.Status(HttpStatusCode.NoContent, await owner.Http.DeleteAsync($"/api/workspaces/{ws.Id}/members/{viewer.Id}"));
        User.Status(HttpStatusCode.Conflict, await viewer.Post($"/api/invitations/{inviteViewer.Token}/accept", new { }));
    }

    private async Task<User> Join(User owner, WorkspaceDetail ws, string role)
    {
        var user = await app.NewClient().SignUpAsync();
        var invite = await owner.PostOk<InvitationDto>($"/api/workspaces/{ws.Id}/invitations", new { email = user.Email, role });
        await user.PostOk<WorkspaceSummary>($"/api/invitations/{invite.Token}/accept", new { });
        return user;
    }

    [Fact]
    public async Task Members_see_and_touch_only_their_own_cards()
    {
        var (owner, ws) = await NewWorkspace();
        var member = await Join(owner, ws, "Member");
        var viewer = await Join(owner, ws, "Viewer");
        var done = ws.Columns[3].Id;

        var hidden = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Owner only" });
        var assigned = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "For member", assigneeIds = new[] { member.Id, owner.Id } });
        var own = await member.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Member made", assigneeIds = new[] { owner.Id } });
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{hidden.Id}/move", new { columnId = done });

        // The board: assigned to them, or created by them. Nothing else.
        var seen = await member.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks");
        Assert.Equal(["For member", "Member made"], seen.Select(t => t.Title).Order());
        Assert.Empty(own.AssigneeIds); // a member cannot hand work to someone else

        // Someone else's card does not exist as far as a member is concerned.
        User.Status(HttpStatusCode.NotFound, await member.Http.GetAsync($"/api/tasks/{hidden.Id}"));
        User.Status(HttpStatusCode.NotFound, await member.Patch($"/api/tasks/{hidden.Id}", new { title = "x" }));
        User.Status(HttpStatusCode.NotFound, await member.Post($"/api/tasks/{hidden.Id}/move", new { columnId = ws.Columns[0].Id }));
        User.Status(HttpStatusCode.NotFound, await member.Post($"/api/tasks/{hidden.Id}/comments", new { body = "hi" }));
        User.Status(HttpStatusCode.NotFound, await member.Http.DeleteAsync($"/api/tasks/{hidden.Id}"));

        // On a shared card they can add or remove only themselves; the owner stays on it.
        var edited = await member.PatchOk<TaskDto>($"/api/tasks/{assigned.Id}", new { assigneeIds = Array.Empty<Guid>() });
        Assert.Equal([owner.Id], edited.AssigneeIds);
        User.Status(HttpStatusCode.NotFound, await member.Http.GetAsync($"/api/tasks/{assigned.Id}")); // no longer theirs
        // They delete only what they created.
        await owner.PatchOk<TaskDto>($"/api/tasks/{assigned.Id}", new { assigneeIds = new[] { member.Id } });
        User.Status(HttpStatusCode.Forbidden, await member.Http.DeleteAsync($"/api/tasks/{assigned.Id}"));

        // Moves return only their cards. With no visible neighbour the card goes to the top; "after X"
        // lands right after X in the full column, even with hidden cards around it.
        var moved = await member.PostOk<List<TaskDto>>($"/api/tasks/{own.Id}/move", new { columnId = done, afterTaskId = (Guid?)null, beforeTaskId = (Guid?)null });
        Assert.DoesNotContain(moved, t => t.Id == hidden.Id);
        var second = await member.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Member second" });
        await member.PostOk<List<TaskDto>>($"/api/tasks/{second.Id}/move", new { columnId = done, afterTaskId = own.Id });
        var full = await owner.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks");
        Assert.Equal([own.Id, second.Id, hidden.Id], full.Where(t => t.ColumnId == done).OrderBy(t => t.Position).Select(t => t.Id));

        // Numbers, activity and export cover their cards only.
        var dash = await member.GetOk<DashboardResponse>($"/api/workspaces/{ws.Id}/dashboard");
        Assert.Equal(1, dash.ActiveTasks);
        Assert.Equal(2, dash.CompletedThisWeek);
        Assert.DoesNotContain(dash.RecentActivity, a => a.Summary.Contains("Owner only"));
        var stats = await member.GetOk<AnalyticsResponse>($"/api/workspaces/{ws.Id}/analytics?range=7");
        Assert.Equal(2, stats.TasksCompleted.Value);
        Assert.Equal(3, stats.ByStatus.Sum(s => s.Count));
        var csv = await member.Http.GetStringAsync($"/api/workspaces/{ws.Id}/analytics/export?range=7");
        Assert.DoesNotContain("Owner only", csv);
        Assert.Contains("Member made", csv);

        // Colleagues' emails are hidden from members, but not their own.
        var detail = await member.GetOk<WorkspaceDetail>($"/api/workspaces/{ws.Id}");
        Assert.Equal("", detail.Members.Single(m => m.UserId == owner.Id).Email);
        Assert.Equal(member.Email, detail.Members.Single(m => m.UserId == member.Id).Email);

        // Owners and viewers still see the whole board.
        Assert.Equal(4, (await owner.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks")).Count);
        Assert.Equal(4, (await viewer.GetOk<List<TaskDto>>($"/api/workspaces/{ws.Id}/tasks")).Count);
        Assert.Equal(1, (await viewer.GetOk<DashboardResponse>($"/api/workspaces/{ws.Id}/dashboard")).ActiveTasks); // only "For member" is still open
    }

    [Fact]
    public async Task Last_owner_cannot_leave_or_be_demoted()
    {
        var (owner, ws) = await NewWorkspace();
        User.Status(HttpStatusCode.Conflict, await owner.Http.DeleteAsync($"/api/workspaces/{ws.Id}/members/{owner.Id}"));
        User.Status(HttpStatusCode.Conflict, await owner.Patch($"/api/workspaces/{ws.Id}/members/{owner.Id}", new { role = "Admin" }));
    }

    [Fact]
    public async Task Column_with_cards_cannot_be_deleted()
    {
        var (owner, ws) = await NewWorkspace();
        await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Holding" });
        User.Status(HttpStatusCode.Conflict, await owner.Http.DeleteAsync($"/api/workspaces/{ws.Id}/columns/{ws.Columns[0].Id}"));
        User.Status(HttpStatusCode.NoContent, await owner.Http.DeleteAsync($"/api/workspaces/{ws.Id}/columns/{ws.Columns[2].Id}"));
    }

    [Fact]
    public async Task Sample_workspace_fills_dashboard_and_analytics()
    {
        var (owner, ws) = await NewWorkspace(sample: true);

        var dash = await owner.GetOk<DashboardResponse>($"/api/workspaces/{ws.Id}/dashboard?tz=180");
        Assert.Equal(5, dash.TotalProjects);
        Assert.Equal(14, dash.ActiveTasks);
        Assert.Equal(5, dash.ThisWeek.Count);
        Assert.Equal([DayOfWeek.Sunday, DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday],
            dash.ThisWeek.Select(d => d.Date.DayOfWeek));
        Assert.NotEmpty(dash.MyTasks);

        var stats = await owner.GetOk<AnalyticsResponse>($"/api/workspaces/{ws.Id}/analytics?range=30&tz=180");
        Assert.Equal(30, stats.Throughput.Count);
        Assert.Equal(84, stats.Heatmap.Count);
        Assert.True(stats.TasksCompleted.Value > 0);
        Assert.Equal(stats.TasksCompleted.Value, stats.Throughput.Sum(p => p.Current));
        Assert.InRange(stats.OnTimeRate.Value, 0, 100);
        Assert.NotEmpty(stats.TimeByProject);
        Assert.Equal(4, stats.ByStatus.Count);

        var csv = await owner.Http.GetStringAsync($"/api/workspaces/{ws.Id}/analytics/export?range=90");
        Assert.StartsWith("العنوان,المشروع", csv.TrimStart('\uFEFF'));
    }

    [Fact]
    public async Task Week_shows_working_days_and_counts_weekend_work_apart()
    {
        var (owner, ws) = await NewWorkspace();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var sunday = today.AddDays(-(int)today.DayOfWeek);
        var tuesday = sunday.AddDays(2);
        var friday = sunday.AddDays(5);

        foreach (var day in new[] { tuesday, friday })
        {
            var t = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = $"Done {day}" });
            await owner.PostOk<List<TaskDto>>($"/api/tasks/{t.Id}/move", new { columnId = ws.Columns[3].Id, index = 0 });
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var at = day.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc);
            await db.Tasks.Where(x => x.Id == t.Id).ExecuteUpdateAsync(u => u.SetProperty(x => x.CompletedAt, at));
        }

        var dash = await owner.GetOk<DashboardResponse>($"/api/workspaces/{ws.Id}/dashboard?tz=0");
        Assert.Equal(sunday, dash.ThisWeek[0].Date);
        Assert.Equal(1, dash.ThisWeek.Single(d => d.Date == tuesday).Count);
        Assert.Equal(1, dash.ThisWeek.Sum(d => d.Count)); // Friday has no bar...
        Assert.Equal(1, dash.WeekendThisWeek);           // ...but is counted as weekend work
        Assert.Equal(2, dash.CompletedThisWeek);
    }

    [Fact]
    public async Task On_time_rate_judges_the_finish_in_the_viewers_day()
    {
        var (owner, ws) = await NewWorkspace();
        var due = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2));
        var task = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "Late by Riyadh time", dueDate = due });
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{task.Id}/move", new { columnId = ws.Columns[3].Id, index = 0 });

        // 22:30 UTC on the due date is 01:30 the next day in Riyadh (UTC+3): one day late there.
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var finished = due.ToDateTime(new TimeOnly(22, 30), DateTimeKind.Utc);
            await db.Tasks.Where(t => t.Id == task.Id).ExecuteUpdateAsync(u => u.SetProperty(t => t.CompletedAt, finished));
        }

        var riyadh = await owner.GetOk<AnalyticsResponse>($"/api/workspaces/{ws.Id}/analytics?range=7&tz=180");
        Assert.Equal(0, riyadh.OnTimeRate.Value);
        var utc = await owner.GetOk<AnalyticsResponse>($"/api/workspaces/{ws.Id}/analytics?range=7&tz=0");
        Assert.Equal(100, utc.OnTimeRate.Value);
    }

    [Fact]
    public async Task Csv_export_defuses_formulas()
    {
        var (owner, ws) = await NewWorkspace();
        var task = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "=HYPERLINK(\"http://evil\")" });
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{task.Id}/move", new { columnId = ws.Columns[3].Id, index = 0 });
        var csv = await owner.Http.GetStringAsync($"/api/workspaces/{ws.Id}/analytics/export?range=7");
        Assert.Contains("\"'=HYPERLINK(\"\"http://evil\"\")\"", csv);
    }
}
