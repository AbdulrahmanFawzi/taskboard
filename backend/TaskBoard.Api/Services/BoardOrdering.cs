using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

public class BoardOrdering(AppDbContext db)
{
    /// <summary>
    /// Moves a task to <paramref name="index"/> in <paramref name="target"/> and renumbers both
    /// columns to 0..n-1, so positions never drift or collide. Also keeps the lifecycle
    /// timestamps in step with the column kind. The caller saves.
    /// </summary>
    public async Task MoveAsync(TaskItem task, BoardColumn target, int index)
    {
        var sourceId = task.ColumnId;
        var targetTasks = await db.Tasks
            .Where(t => t.WorkspaceId == task.WorkspaceId && t.ColumnId == target.Id && t.Id != task.Id)
            .OrderBy(t => t.Position).ThenBy(t => t.CreatedAt)
            .ToListAsync();

        index = Math.Clamp(index, 0, targetTasks.Count);
        targetTasks.Insert(index, task);
        task.ColumnId = target.Id;
        for (var i = 0; i < targetTasks.Count; i++) targetTasks[i].Position = i;

        if (sourceId != target.Id)
        {
            var sourceTasks = await db.Tasks
                .Where(t => t.WorkspaceId == task.WorkspaceId && t.ColumnId == sourceId && t.Id != task.Id)
                .OrderBy(t => t.Position).ThenBy(t => t.CreatedAt)
                .ToListAsync();
            for (var i = 0; i < sourceTasks.Count; i++) sourceTasks[i].Position = i;
        }

        ApplyLifecycle(task, target.Kind);
        task.UpdatedAt = DateTime.UtcNow;
    }

    public static void ApplyLifecycle(TaskItem task, ColumnKind kind)
    {
        var now = DateTime.UtcNow;
        if (kind >= ColumnKind.InProgress) task.StartedAt ??= now;
        if (kind == ColumnKind.Done) task.CompletedAt ??= now;
        else task.CompletedAt = null;
    }

    public async Task<int> NextPositionAsync(Guid workspaceId, Guid columnId)
    {
        var max = await db.Tasks.Where(t => t.WorkspaceId == workspaceId && t.ColumnId == columnId)
            .Select(t => (int?)t.Position).MaxAsync();
        return (max ?? -1) + 1;
    }
}
