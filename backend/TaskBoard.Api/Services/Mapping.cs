using TaskBoard.Api.Contracts;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

public static class Mapping
{
    /// <summary>Projection used by every task list query, so the counts stay in SQL.</summary>
    public static IQueryable<TaskDto> ToDto(this IQueryable<TaskItem> q) => q.Select(t => new TaskDto(
        t.Id, t.ColumnId, t.ProjectId, t.Title, t.Description ?? "", t.Tag, t.Priority, t.DueDate, t.Position,
        t.TrackedMinutes,
        t.Assignees.Select(a => a.UserId).ToList(),
        t.Checklist.Count, t.Checklist.Count(c => c.Done), t.Comments.Count,
        t.CreatedAt, t.UpdatedAt, t.CompletedAt, t.CreatedById));

    public static ColumnDto ToDto(this BoardColumn c) => new(c.Id, c.Name, c.Kind, c.Position);
    public static ProjectDto ToDto(this Project p) => new(p.Id, p.Name, p.Color);
    public static ChecklistItemDto ToDto(this ChecklistItem c) => new(c.Id, c.Text, c.Done, c.Position);
}

public class ActivityLog(AppDbContext db)
{
    /// <summary>Adds an event to the change tracker; the caller's SaveChanges writes it.</summary>
    public void Add(Guid workspaceId, Guid actorId, string type, string summary, Guid? taskId = null) =>
        db.Activity.Add(new ActivityEvent
        {
            WorkspaceId = workspaceId,
            ActorId = actorId,
            Type = type,
            Summary = summary.Length > 300 ? summary[..300] : summary,
            TaskId = taskId,
        });
}
