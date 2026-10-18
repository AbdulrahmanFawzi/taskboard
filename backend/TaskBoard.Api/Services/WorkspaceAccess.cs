using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TaskBoard.Api.Data;
using TaskBoard.Api.Domain;

namespace TaskBoard.Api.Services;

/// <summary>Thrown when the caller is not a member, or their role is too low. Mapped to 404 / 403.</summary>
public class AccessDeniedException(bool notMember) : Exception
{
    public bool NotMember { get; } = notMember;
}

public class WorkspaceAccess(AppDbContext db, IHttpContextAccessor http)
{
    public Guid UserId
    {
        get
        {
            var id = http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(id, out var g) ? g : throw new AccessDeniedException(true);
        }
    }

    /// <summary>
    /// Returns the caller's role in the workspace, or throws. Non-members get the same answer as a
    /// workspace that does not exist, so ids cannot be probed.
    /// </summary>
    public async Task<WorkspaceRole> RequireAsync(Guid workspaceId, WorkspaceRole minimum = WorkspaceRole.Viewer)
    {
        var userId = UserId;
        var member = await db.WorkspaceMembers.AsNoTracking()
            .FirstOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == userId);
        if (member is null) throw new AccessDeniedException(true);
        if (member.Role < minimum) throw new AccessDeniedException(false);
        return member.Role;
    }

    /// <summary>Looks up a task and checks the caller's role in its workspace.</summary>
    public async Task<TaskItem> RequireTaskAsync(Guid taskId, WorkspaceRole minimum)
    {
        var task = await db.Tasks.FirstOrDefaultAsync(t => t.Id == taskId) ?? throw new AccessDeniedException(true);
        await RequireAsync(task.WorkspaceId, minimum);
        return task;
    }
}
