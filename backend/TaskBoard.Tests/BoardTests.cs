using System.Net;
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
        User.Status(HttpStatusCode.Conflict, await viewer.Post($"/api/invitations/{inviteViewer.Token}/accept", new { }));

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
        Assert.Equal(7, dash.ThisWeek.Count);
        Assert.Equal(DayOfWeek.Monday, dash.ThisWeek[0].Date.DayOfWeek);
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
    public async Task Csv_export_defuses_formulas()
    {
        var (owner, ws) = await NewWorkspace();
        var task = await owner.PostOk<TaskDto>($"/api/workspaces/{ws.Id}/tasks", new { title = "=HYPERLINK(\"http://evil\")" });
        await owner.PostOk<List<TaskDto>>($"/api/tasks/{task.Id}/move", new { columnId = ws.Columns[3].Id, index = 0 });
        var csv = await owner.Http.GetStringAsync($"/api/workspaces/{ws.Id}/analytics/export?range=7");
        Assert.Contains("\"'=HYPERLINK(\"\"http://evil\"\")\"", csv);
    }
}
