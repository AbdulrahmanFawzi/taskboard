using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Contracts;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;
using TaskBoard.Api.Hubs;
using TaskBoard.Api.Services;

namespace TaskBoard.Api.Controllers;

[ApiController]
[Authorize]
public class TasksController(
    AppDbContext db, WorkspaceAccess access, BoardOrdering ordering, ActivityLog activity, BoardEvents events)
    : ControllerBase
{
    [HttpGet("api/workspaces/{workspaceId:guid}/tasks")]
    public async Task<IReadOnlyList<TaskDto>> List(Guid workspaceId)
    {
        await access.RequireAsync(workspaceId);
        return await db.Tasks.Where(t => t.WorkspaceId == workspaceId)
            .OrderBy(t => t.Position).ThenBy(t => t.CreatedAt)
            .ToDto().ToListAsync();
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/tasks")]
    public async Task<ActionResult<TaskDto>> Create(Guid workspaceId, CreateTaskRequest req)
    {
        await access.RequireAsync(workspaceId, WorkspaceRole.Member);
        var column = req.ColumnId is { } cid
            ? await db.Columns.FirstOrDefaultAsync(c => c.Id == cid && c.WorkspaceId == workspaceId)
            : await db.Columns.Where(c => c.WorkspaceId == workspaceId).OrderBy(c => c.Position).FirstOrDefaultAsync();
        if (column is null) return Problem("هذا العمود غير موجود في اللوحة.", statusCode: 400);
        if (req.ProjectId is { } pid && !await db.Projects.AnyAsync(p => p.Id == pid && p.WorkspaceId == workspaceId))
            return Problem("هذا المشروع غير موجود في مساحة العمل.", statusCode: 400);

        var task = new TaskItem
        {
            WorkspaceId = workspaceId,
            ColumnId = column.Id,
            ProjectId = req.ProjectId,
            Title = req.Title.Trim(),
            Description = req.Description?.Trim() ?? "",
            Tag = string.IsNullOrWhiteSpace(req.Tag) ? null : req.Tag.Trim(),
            Priority = req.Priority,
            DueDate = req.DueDate,
            CreatedById = access.UserId,
            Position = await ordering.NextPositionAsync(workspaceId, column.Id),
        };
        BoardOrdering.ApplyLifecycle(task, column.Kind);
        if (req.AssigneeIds is { Count: > 0 })
        {
            var valid = await ValidMemberIds(workspaceId, req.AssigneeIds);
            task.Assignees.AddRange(valid.Select(id => new TaskAssignee { UserId = id }));
        }
        db.Tasks.Add(task);
        activity.Add(workspaceId, access.UserId, "task.created", $"أضاف «{task.Title}» إلى {column.Name}", task.Id);
        await db.SaveChangesAsync();
        await events.ChangedAsync(workspaceId, "tasks", task.Id);
        return await One(task.Id);
    }

    [HttpGet("api/tasks/{id:guid}")]
    public async Task<TaskDetailDto> Get(Guid id)
    {
        await access.RequireTaskAsync(id, WorkspaceRole.Viewer);
        var dto = await One(id);
        var checklist = await db.ChecklistItems.Where(c => c.TaskId == id).OrderBy(c => c.Position)
            .Select(c => new ChecklistItemDto(c.Id, c.Text, c.Done, c.Position)).ToListAsync();
        var comments = await db.Comments.Where(c => c.TaskId == id).OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.AuthorId, c.Author.DisplayName, c.Author.AvatarColor, c.Body, c.CreatedAt))
            .ToListAsync();
        return new TaskDetailDto(dto, checklist, comments);
    }

    [HttpPatch("api/tasks/{id:guid}")]
    public async Task<ActionResult<TaskDto>> Update(Guid id, UpdateTaskRequest req)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        if (req.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Title)) return Problem("البطاقة تحتاج عنوانًا.", statusCode: 400);
            task.Title = req.Title.Trim();
        }
        if (req.Description is not null) task.Description = req.Description.Trim();
        if (req.Tag is not null) task.Tag = string.IsNullOrWhiteSpace(req.Tag) ? null : req.Tag.Trim();
        if (req.Priority is not null) task.Priority = req.Priority.Value;
        if (req.ClearDueDate) task.DueDate = null;
        else if (req.DueDate is not null) task.DueDate = req.DueDate;
        if (req.ClearProject) task.ProjectId = null;
        else if (req.ProjectId is { } pid)
        {
            if (!await db.Projects.AnyAsync(p => p.Id == pid && p.WorkspaceId == task.WorkspaceId))
                return Problem("هذا المشروع غير موجود في مساحة العمل.", statusCode: 400);
            task.ProjectId = pid;
        }
        if (req.TrackedMinutes is not null) task.TrackedMinutes = req.TrackedMinutes.Value;
        if (req.AssigneeIds is not null)
        {
            var valid = await ValidMemberIds(task.WorkspaceId, req.AssigneeIds);
            await db.TaskAssignees.Where(a => a.TaskId == id).ExecuteDeleteAsync();
            db.TaskAssignees.AddRange(valid.Select(u => new TaskAssignee { TaskId = id, UserId = u }));
        }
        task.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return await One(id);
    }

    [HttpPost("api/tasks/{id:guid}/move")]
    public async Task<ActionResult<IReadOnlyList<TaskDto>>> Move(Guid id, MoveTaskRequest req)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        var target = await db.Columns.FirstOrDefaultAsync(c => c.Id == req.ColumnId && c.WorkspaceId == task.WorkspaceId);
        if (target is null) return Problem("هذا العمود غير موجود في اللوحة.", statusCode: 400);

        var fromColumn = task.ColumnId;
        var wasDone = task.CompletedAt != null;
        await ordering.MoveAsync(task, target, req.Index);

        if (fromColumn != target.Id)
        {
            var type = target.Kind == ColumnKind.Done && !wasDone ? "task.completed" : "task.moved";
            var summary = type == "task.completed" ? $"أنجز «{task.Title}»" : $"نقل «{task.Title}» إلى {target.Name}";
            activity.Add(task.WorkspaceId, access.UserId, type, summary, task.Id);
        }
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);

        // Hand back both affected columns so the client can reconcile its optimistic order.
        return await db.Tasks.Where(t => t.ColumnId == target.Id || t.ColumnId == fromColumn)
            .OrderBy(t => t.Position).ToDto().ToListAsync();
    }

    [HttpDelete("api/tasks/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        db.Tasks.Remove(task);
        activity.Add(task.WorkspaceId, access.UserId, "task.deleted", $"حذف «{task.Title}»");
        await db.SaveChangesAsync();

        var rest = await db.Tasks.Where(t => t.ColumnId == task.ColumnId).OrderBy(t => t.Position).ToListAsync();
        for (var i = 0; i < rest.Count; i++) rest[i].Position = i;
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return NoContent();
    }

    // ---- Checklist ----

    [HttpPost("api/tasks/{id:guid}/checklist")]
    public async Task<ActionResult<ChecklistItemDto>> AddChecklistItem(Guid id, CreateChecklistItemRequest req)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        var count = await db.ChecklistItems.CountAsync(c => c.TaskId == id);
        if (count >= 50) return Problem("الحد الأقصى 50 بندًا في قائمة التحقق.", statusCode: 400);
        var item = new ChecklistItem { TaskId = id, Text = req.Text.Trim(), Position = count };
        db.ChecklistItems.Add(item);
        task.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return item.ToDto();
    }

    [HttpPatch("api/tasks/{id:guid}/checklist/{itemId:guid}")]
    public async Task<ActionResult<ChecklistItemDto>> UpdateChecklistItem(Guid id, Guid itemId, UpdateChecklistItemRequest req)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        var item = await db.ChecklistItems.FirstOrDefaultAsync(c => c.Id == itemId && c.TaskId == id);
        if (item is null) return NotFound();
        if (req.Text is not null) item.Text = req.Text.Trim();
        if (req.Done is not null) item.Done = req.Done.Value;
        task.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return item.ToDto();
    }

    [HttpDelete("api/tasks/{id:guid}/checklist/{itemId:guid}")]
    public async Task<IActionResult> DeleteChecklistItem(Guid id, Guid itemId)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        await db.ChecklistItems.Where(c => c.Id == itemId && c.TaskId == id).ExecuteDeleteAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return NoContent();
    }

    // ---- Comments ----

    [HttpPost("api/tasks/{id:guid}/comments")]
    public async Task<ActionResult<CommentDto>> AddComment(Guid id, CreateCommentRequest req)
    {
        // Viewers can read but not talk; commenting is a member action.
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Member);
        var me = access.UserId;
        var comment = new TaskComment { TaskId = id, AuthorId = me, Body = req.Body.Trim() };
        db.Comments.Add(comment);
        activity.Add(task.WorkspaceId, me, "comment.added", $"علّق على «{task.Title}»", id);
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        var author = await db.Users.AsNoTracking().FirstAsync(u => u.Id == me);
        return new CommentDto(comment.Id, me, author.DisplayName, author.AvatarColor, comment.Body, comment.CreatedAt);
    }

    [HttpDelete("api/tasks/{id:guid}/comments/{commentId:guid}")]
    public async Task<IActionResult> DeleteComment(Guid id, Guid commentId)
    {
        var task = await access.RequireTaskAsync(id, WorkspaceRole.Viewer);
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId && c.TaskId == id);
        if (comment is null) return NotFound();
        if (comment.AuthorId != access.UserId) await access.RequireAsync(task.WorkspaceId, WorkspaceRole.Admin);
        db.Comments.Remove(comment);
        await db.SaveChangesAsync();
        await events.ChangedAsync(task.WorkspaceId, "tasks", id);
        return NoContent();
    }

    private Task<TaskDto> One(Guid id) => db.Tasks.Where(t => t.Id == id).ToDto().FirstAsync();

    private async Task<List<Guid>> ValidMemberIds(Guid workspaceId, IEnumerable<Guid> ids)
    {
        var wanted = ids.Distinct().Take(10).ToList();
        return await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == workspaceId && wanted.Contains(m.UserId))
            .Select(m => m.UserId).ToListAsync();
    }
}
