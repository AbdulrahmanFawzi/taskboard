using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TaskBoard.Api.Services;

namespace TaskBoard.Api.Hubs;

/// <summary>Pushes "something changed" pings so every open board refreshes without polling.</summary>
[Authorize]
public class BoardHub(WorkspaceAccess access) : Hub
{
    public async Task Join(Guid workspaceId)
    {
        await access.RequireAsync(workspaceId);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(workspaceId));
    }

    public Task Leave(Guid workspaceId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(workspaceId));

    public static string Group(Guid workspaceId) => $"ws:{workspaceId}";
}

public class BoardEvents(IHubContext<BoardHub> hub, IHttpContextAccessor http)
{
    /// <param name="scope">What changed: tasks, workspace, members.</param>
    public Task ChangedAsync(Guid workspaceId, string scope, Guid? taskId = null)
    {
        // The sender already updated its own cache optimistically; tell it apart by connection id.
        var origin = http.HttpContext?.Request.Headers["X-SignalR-Connection"].ToString();
        return hub.Clients.Group(BoardHub.Group(workspaceId))
            .SendAsync("changed", new { workspaceId, scope, taskId, origin });
    }
}
